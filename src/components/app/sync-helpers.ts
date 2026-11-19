/**
 * ARGON v6.0 — Sync Helpers Component
 * Data synchronization with Supabase, recompute, and push/pull operations.
 * Import from: import { recomputeAll, pushDayToSupabase, syncFromSupabase, showToast } from '@/components/app/sync-helpers';
 */

import { config } from '@/config';

const SUPABASE_URL = config.supabase?.url || '';
const SUPABASE_ANON_KEY = config.supabase?.anonKey || '';

function getLocalStore(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem('argon_local_store') || '{}'); } catch { return {}; }
}

function setLocalStore(data: Record<string, any>): void {
  localStorage.setItem('argon_local_store', JSON.stringify(data));
}

function showToast(msg: string): void {
  if (typeof window !== 'undefined' && window.showToast) {
    window.showToast(msg);
  } else {
    console.log('Toast:', msg);
  }
}

function sbHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  };
}

async function sbFetch(path: string, opts: RequestInit = {}): Promise<any> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Supabase no configurado');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...sbHeaders(), ...(opts.headers || {}) } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.json();
}

/**
 * Recompute all daily scores from local store
 */
export async function recomputeAll(): Promise<void> {
  const store = getLocalStore();
  const dates = Object.keys(store).sort();
  for (const d of dates) {
    try {
      await recomputeDay(d);
    } catch (e) {
      console.error(`Error recomputing ${d}:`, e);
    }
  }
  showToast('✓ Recálculo completo');
}

/**
 * Recompute a single day
 */
export async function recomputeDay(date: string): Promise<void> {
  const store = getLocalStore();
  const rec = store[date];
  if (!rec) return;

  // Compute target kcal
  const profile = JSON.parse(localStorage.getItem('argon_profile_v1') || '{}');
  // BMR not in Profile schema - compute from local profile or use target + deficit
  const bmr = profile.height_cm && profile.birth ? calculateBMR(profile) : (config.targets?.kcal + Math.abs(config.profile?.dailyDeficitKcal || 500));
  const deficit = parseFloat(profile.deficit) || Math.abs(config.profile?.dailyDeficitKcal || 500);
  const targetKcal = Math.round(bmr - deficit);

  // Compute sleep debt
  const sleepNeed = config.profile?.basalSleepNeedH || 7.5;
  const sleepHours = rec.sleep_total_min ? rec.sleep_total_min / 60 : 0;
  const debt = Math.max(0, sleepNeed - sleepHours);

  // Compute HRV/RHR baselines (7-day rolling)
  const dates7 = Object.keys(store).filter(d => d <= date).sort().slice(-7);
  const hrvs = dates7.map(d => store[d]?.rmssd_ms).filter(v => v != null && v > 0) as number[];
  const rhrs = dates7.map(d => store[d]?.rhr_bpm).filter(v => v != null && v > 0) as number[];
  const hrvBaseline = hrvs.length ? hrvs.reduce((a, b) => a + b, 0) / hrvs.length : null;
  const rhrBaseline = rhrs.length ? rhrs.reduce((a, b) => a + b, 0) / rhrs.length : null;

  // Recovery score (simplified 3-pillar)
  let recovery = 50;
  if (hrvBaseline && rec.rmssd_ms) {
    const hrvRatio = rec.rmssd_ms / hrvBaseline;
    recovery = Math.round(40 * Math.min(1.5, Math.max(0.5, hrvRatio)) * 100);
  }
  if (rhrBaseline && rec.rhr_bpm) {
    const rhrDiff = rhrBaseline - rec.rhr_bpm;
    recovery = Math.round(recovery * 0.6 + 20 * (1 + rhrDiff / 10) * 100) / 100;
  }
  recovery = Math.max(0, Math.min(100, recovery));

  // Strain from workouts
  const workouts = JSON.parse(localStorage.getItem('argon_workouts_v1') || '{}')[date] || [];
  const strain = workouts.reduce((s: number, w: any) => s + (w.min || 0) * (w.rpe || 5) / 60, 0);

  // Nutrition
  const meals = JSON.parse(localStorage.getItem('argon_meals_v2') || '{}')[date] || {};
  const totalKcal = Object.values(meals).reduce((s: number, m: any) => s + (m?.kcal || 0), 0);
  const totalProtein = Object.values(meals).reduce((s: number, m: any) => s + (m?.protein || 0), 0);

  // Update local store
  store[date] = {
    ...rec,
    target_kcal: targetKcal,
    sleep_debt_h: Math.round(debt * 10) / 10,
    recovery_score: recovery,
    strain_score: Math.round(strain * 10) / 10,
    total_kcal: totalKcal,
    total_protein: totalProtein,
  };
  setLocalStore(store);
}

function calculateBMR(profile: any): number {
  const age = Math.floor((Date.now() - new Date(profile.birth).getTime()) / (365.25 * 86400000));
  const weight = parseFloat(localStorage.getItem('argon_start_w') || '75');
  const height = parseFloat(profile.height_cm) || 175;
  const sex = profile.biologicalSex || 'male';
  if (sex === 'female') {
    return Math.round(10 * weight + 6.25 * height - 5 * age - 161);
  }
  return Math.round(10 * weight + 6.25 * height - 5 * age + 5);
}

/**
 * Push a day's data to Supabase
 */
export async function pushDayToSupabase(date: string): Promise<void> {
  const store = getLocalStore();
  const rec = store[date];
  if (!rec) return showToast('No hay datos para este día');

  const workouts = JSON.parse(localStorage.getItem('argon_workouts_v1') || '{}')[date] || [];
  const meals = JSON.parse(localStorage.getItem('argon_meals_v2') || '{}')[date] || {};

  const raw = {
    log_date: date,
    rmssd_ms: rec.rmssd_ms,
    rhr_bpm: rec.rhr_bpm,
    sleep_total_min: rec.sleep_total_min,
    sleep_deep_min: rec.sleep_deep_min,
    sleep_rem_min: rec.sleep_rem_min,
    sleep_light_min: rec.sleep_light_min,
    sleep_awake_min: rec.sleep_awake_min,
    nap_count: rec.nap_count,
    nap_total_min: rec.nap_total_min,
    steps: rec.steps,
    active_calories: rec.active_calories,
    distance_m: rec.distance_m,
    weight_kg: rec.weight_kg,
    body_fat_pct: rec.body_fat_pct,
    muscle_kg: rec.muscle_kg,
    water_pct: rec.water_pct,
    visceral_fat: rec.visceral_fat,
    spo2_pct: rec.spo2_pct,
    resp_rate: rec.resp_rate,
    temp_delta: rec.temp_delta,
    hrv_source: rec.hrv_source,
    hrv_n_samples: rec.hrv_n_samples,
    workout_sessions: workouts,
    meal_sessions: meals,
  };

  const comp = {
    log_date: date,
    recovery_score: rec.recovery_score,
    strain_score: rec.strain_score,
    sleep_score: rec.sleep_score,
    readiness_score: rec.readiness_score,
    hrv_baseline_ms: rec.hrv_baseline_ms,
    rhr_baseline_bpm: rec.rhr_baseline_bpm,
    sleep_debt_h: rec.sleep_debt_h,
    target_kcal: rec.target_kcal,
    total_kcal: rec.total_kcal,
    total_protein: rec.total_protein,
    bmr_kcal: rec.bmr_kcal,
    tdee_kcal: rec.tdee_kcal,
    exercise_kcal: rec.exercise_kcal,
    neat_kcal: rec.neat_kcal,
  };

  try {
    await sbFetch('daily_raw_biometrics?on_conflict=log_date', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(raw),
    });
    await sbFetch('computed_daily_scores?on_conflict=log_date', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(comp),
    });
    showToast(`✓ ${date} subido a Supabase`);
  } catch (e) {
    console.error('Push error:', e);
    showToast('✗ Error subiendo a Supabase');
  }
}

/**
 * Sync all data from Supabase to local store
 */
export async function syncFromSupabase(renderAllFn?: () => void): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return showToast('Configura Supabase en Ajustes');

  try {
    const [raw, comp] = await Promise.all([
      sbFetch('daily_raw_biometrics?select=*&order=log_date.asc'),
      sbFetch('computed_daily_scores?select=*&order=log_date.asc'),
    ]);

    const store = getLocalStore();
    const byDate: Record<string, any> = {};

    for (const r of raw) {
      byDate[r.log_date] = { ...byDate[r.log_date], ...r };
    }
    for (const c of comp) {
      byDate[c.log_date] = { ...byDate[c.log_date], ...c };
    }

    let count = 0;
    for (const [date, data] of Object.entries(byDate)) {
      store[date] = data;
      count++;
    }
    setLocalStore(store);

    // Sync workouts
    const wkData = await sbFetch('workout_sessions?select=*').catch(() => []);
    if (wkData.length) {
      const wkStore: Record<string, any[]> = {};
      for (const w of wkData) {
        const date = w.log_date;
        if (!wkStore[date]) wkStore[date] = [];
        wkStore[date].push(w);
      }
      localStorage.setItem('argon_workouts_v1', JSON.stringify(wkStore));
    }

    // Sync meals
    const mlData = await sbFetch('meal_sessions?select=*').catch(() => []);
    if (mlData.length) {
      const mlStore: Record<string, any> = {};
      for (const m of mlData) {
        const date = m.log_date;
        if (!mlStore[date]) mlStore[date] = {};
        mlStore[date][m.meal_type] = m;
      }
      localStorage.setItem('argon_meals_v2', JSON.stringify(mlStore));
    }

    showToast(`✓ Sincronizado: ${count} días`);
    if (renderAllFn) renderAllFn();
  } catch (e) {
    console.error('Sync error:', e);
    showToast('✗ Error sincronizando');
  }
}

/**
 * Push all local data to Supabase
 */
export async function pushAllToSupabase(): Promise<void> {
  const store = getLocalStore();
  const dates = Object.keys(store).sort();
  for (const d of dates) {
    await pushDayToSupabase(d);
  }
  showToast('✓ Todo subido a Supabase');
}

// Attach to window for inline onclick
if (typeof window !== 'undefined') {
  (window as any).recomputeAll = recomputeAll;
  (window as any).pushDayToSupabase = pushDayToSupabase;
  (window as any).syncFromSupabase = syncFromSupabase;
  (window as any).pushAllToSupabase = pushAllToSupabase;
  (window as any).showToast = showToast;
}

export { showToast };