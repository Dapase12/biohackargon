/**
 * ARGON v6.0 — PATCH 1 (ES Module)
 *
 * Corrige:
 * - sync que traía los 30 días MÁS ANTIGUOS
 * - merge de ingesta con Math.max
 * - push de comidas que pisaba datos reales
 * - seed "Base 14d" que subía datos simulados
 * - añade verificación QA contra la fila real de Supabase
 *
 * Usage: <script type="module" src="argon-patch.js"></script>
 * Debe cargar DESPUÉS del script principal (index.html) y ANTES de </body>
 */

import { num } from './src/utils/math.ts';
import { todayIso } from './src/utils/date.ts';
import { config } from './src/config/index.ts';
import { supabaseClient, sbTestConnection } from './src/api/client.ts';

const $ = (id: string) => document.getElementById(id);
const setStatus = (t: string) => { const el = $('sync-status-text'); if (el) el.textContent = t; };

// ---------------------------------------------------------------------------
// 1. SYNC: últimos 45 días (DESC) y reordenado ASC en cliente
// ---------------------------------------------------------------------------
async function syncFromSupabase() {
  if (!supabaseClient) return;
  try {
    setStatus('Sincronizando DAG...');
    const since = new Date(Date.now() - 45 * 86400000).toISOString().split('T')[0];

    const q = (t: string) => supabaseClient.from(t).select('*')
      .gte('log_date', since).order('log_date', { ascending: false }).limit(60);

    const [rawRes, compRes] = await Promise.all([q('daily_raw_biometrics'), q('computed_daily_scores')]);
    if (rawRes.error) throw rawRes.error;
    if (compRes.error) throw compRes.error;

    const rawMap: Record<string, any> = {};
    (rawRes.data || []).forEach(r => { rawMap[r.log_date] = r; });
    const compMap: Record<string, any> = {};
    (compRes.data || []).forEach(c => { compMap[c.log_date] = c; });

    const today = todayIso();
    const allDates = Array.from(new Set([...Object.keys(rawMap), ...Object.keys(compMap), today])).sort();

    const store = window.getLocalStore();
    // Elimina días simulados (seed) dentro de la ventana que no existen en la nube
    Object.keys(store).forEach(d => { if (d >= since && !allDates.includes(d)) delete store[d]; });

    const historyRaw: any[] = [];
    let prevComp: any = null;

    allDates.forEach(dStr => {
      const r = rawMap[dStr] || {};
      const c = compMap[dStr] || {};

      // Quita nulls para que no pisen valores; ceros inválidos de sensores = sin dato
      const rClean: Record<string, any> = {};
      Object.keys(r).forEach(k => { if (r[k] !== null && r[k] !== undefined) rClean[k] = r[k]; });
      ['rmssd_ms', 'rhr_bpm', 'resp_rate_brpm', 'spo2_pct'].forEach(k => {
        if (!(num(rClean[k]) > 0)) delete rClean[k];
      });

      const lastW = prevComp ? prevComp.weight_kg : (config.defaults.weightKg || 70);
      const lastBf = prevComp ? prevComp.body_fat_pct : (config.defaults.bodyFatPct || 20);
      const w = num(r.weight_kg);
      const bf = num(r.body_fat_pct);

      const pick = (k: string, isInt: boolean) => {
        const rv = num(r[k]);
        const v = rv !== null ? rv : (num(c[k]) ?? 0);
        return isInt ? Math.round(v) : v;
      };

      const merged = {
        ...c,
        ...rClean,
        log_date: dStr,
        weight_kg: (w !== null && w >= 65) ? w : lastW,
        body_fat_pct: (bf !== null && bf >= 10) ? bf : lastBf,
        steps_count: parseInt(r.steps_count, 10) || 0,
        pickleball_or_gym_minutes: num(r.pickleball_or_gym_minutes) || 0,
        // La fuente de verdad es la tabla cruda; computed solo como respaldo si raw es null
        intake_kcal: pick('intake_kcal', true),
        intake_protein_g: pick('intake_protein_g', false),
        intake_carbs_g: pick('intake_carbs_g', false),
        intake_fat_g: pick('intake_fat_g', false),
        meals_log_json: Array.isArray(r.meals_log_json) ? r.meals_log_json : []
      };

      // thin-client: usa computed_daily_scores del servidor (ya computado)
      const serverComp = compMap[dStr];
      if (serverComp) {
        store[dStr] = { ...merged, ...serverComp };
        historyRaw.push({ ...merged, ...serverComp });
        prevComp = { ...merged, ...serverComp };
      } else {
        store[dStr] = merged;
        historyRaw.push(merged);
        prevComp = merged;
      }
    });

    window.saveLocalStore(store);
    const cur = ($('selected-date') as HTMLInputElement)?.value;
    loadDayData(store[cur] ? cur : today);
    setStatus(`Cloud Activo (${allDates.length}d)`);
    const dot = $('status-dot');
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
  } catch (e) {
    console.error('syncFromSupabase:', e);
    setStatus('Error sync: ' + (e instanceof Error ? e.message : String(e)));
    const dot = $('status-dot');
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
  }
}

// Exponer globalmente para compatibilidad
(window as any).syncFromSupabase = syncFromSupabase;

// Auto-sync al volver a la app y cada 5 min
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncFromSupabase();
});
setInterval(() => { if (document.visibilityState === 'visible') syncFromSupabase(); }, 300000);

// ---------------------------------------------------------------------------
// 2. COMIDAS: push parcial (solo columnas de ingesta) + mutaciones coherentes
// ---------------------------------------------------------------------------
async function pushMealsToSupabase(c: any) {
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient.from('daily_raw_biometrics').upsert({
      log_date: c.log_date,
      intake_kcal: c.intake_kcal,
      intake_protein_g: c.intake_protein_g,
      intake_carbs_g: c.intake_carbs_g,
      intake_fat_g: c.intake_fat_g,
      meals_log_json: c.meals_log_json || []
    }, { onConflict: 'log_date' });
    if (error) throw error;
    setStatus('Comida guardada en Supabase ✓');
  } catch (err) {
    console.error('pushMealsToSupabase:', err);
    setStatus('Error guardando comida: ' + (err instanceof Error ? err.message : String(err)));
  }
}

(window as any).pushMealsToSupabase = pushMealsToSupabase;

async function mutateMeals(mutator: (meals: any[], totals: any) => { meals: any[]; totals: any } | null) {
  const dateStr = ($('selected-date') as HTMLInputElement)?.value || todayIso();
  const store = window.getLocalStore();
  const current = store[dateStr];
  if (!current) return;

  const meals = Array.isArray(current.meals_log_json) ? [...current.meals_log_json] : [];
  const totals = {
    intake_kcal: current.intake_kcal || 0,
    intake_protein_g: current.intake_protein_g || 0,
    intake_carbs_g: current.intake_carbs_g || 0,
    intake_fat_g: current.intake_fat_g || 0
  };
  const next = mutator(meals, totals);
  if (!next) return;

  const updatedRaw = {
    ...current,
    intake_kcal: Math.max(0, Math.round(next.totals.intake_kcal)),
    intake_protein_g: Math.max(0, Math.round(next.totals.intake_protein_g)),
    intake_carbs_g: Math.max(0, Math.round(next.totals.intake_carbs_g)),
    intake_fat_g: Math.max(0, Math.round(next.totals.intake_fat_g)),
    meals_log_json: next.meals
  };

  // thin-client: optimistic update raw only; server recomputes scores
  store[dateStr] = updatedRaw;
  window.saveLocalStore(store);
  loadDayData(dateStr);
  await pushMealsToSupabase(updatedRaw);
}

(window as any).quickAddMeal = function (addKcal: number, addProt: number, addCarbs: number, addFat: number, customLabel?: string) {
  const labelMap: Record<number, string> = { 420: 'Desayuno', 650: 'Almuerzo', 480: 'Cena', 130: 'Whey Protein' };
  return mutateMeals((meals, t) => {
    meals.push({
      id: 'manual_' + Date.now(),
      name: customLabel || labelMap[addKcal] || 'Comida',
      kcal: addKcal, prot: addProt, carbs: addCarbs, fat: addFat
    });
    return {
      meals,
      totals: {
        intake_kcal: t.intake_kcal + addKcal,
        intake_protein_g: t.intake_protein_g + addProt,
        intake_carbs_g: t.intake_carbs_g + addCarbs,
        intake_fat_g: t.intake_fat_g + addFat
      }
    };
  });
};

(window as any).removeMealByIndex = function (idx: number) {
  return mutateMeals((meals, t) => {
    const [m] = meals.splice(idx, 1);
    if (!m) return null;
    // Resta solo la comida eliminada: conserva lo que vino por webhook/Zepp
    return {
      meals,
      totals: {
        intake_kcal: t.intake_kcal - (parseInt(m.kcal, 10) || 0),
        intake_protein_g: t.intake_protein_g - (parseFloat(m.prot) || 0),
        intake_carbs_g: t.intake_carbs_g - (parseFloat(m.carbs) || 0),
        intake_fat_g: t.intake_fat_g - (parseFloat(m.fat) || 0)
      }
    };
  });
};

(window as any).resetTodayMeals = function () {
  return mutateMeals(() => ({
    meals: [],
    totals: { intake_kcal: 0, intake_protein_g: 0, intake_carbs_g: 0, intake_fat_g: 0 }
  }));
};

// ---------------------------------------------------------------------------
// 3. SEED "Base 14d": nunca sube a la nube; no se auto-ejecuta si hay Supabase
// ---------------------------------------------------------------------------
const _seedOrig = (window as any).seedCalibratedFeelfitHistory;
(window as any).seedCalibratedFeelfitHistory = function (fromButton: boolean) {
  if (fromButton === true) {
    if (!confirm('Esto reemplaza el historial LOCAL con datos simulados (no toca Supabase). ¿Continuar?')) return;
    return _seedOrig(false);
  }
  if (supabaseClient) return; // el sync cargará los datos reales
  return _seedOrig(false);
};

// ---------------------------------------------------------------------------
// 4. QA: compara la app contra la fila real de Supabase del día seleccionado
// ---------------------------------------------------------------------------
const _qaOrig = (window as any).runQualityAuditModal;
(window as any).runQualityAuditModal = async function () {
  await _qaOrig();
  try {
    const list = $('qa-results-list');
    if (!list || !supabaseClient) return;
    const dateStr = ($('selected-date') as HTMLInputElement)?.value || todayIso();
    const store = window.getLocalStore();
    const rec = store[dateStr];
    const { data, error } = await supabaseClient.from('daily_raw_biometrics')
      .select('*').eq('log_date', dateStr).limit(1);
    if (error) throw error;
    const row = data && data[0];
    let pass: boolean;
    let detail: string;
    const today = todayIso();
    const isToday = dateStr === today;
    if (!row) {
      // Debug: check if there are rows for nearby dates
      let debugInfo = '';
      try {
        const { data: nearby } = await supabaseClient.from('daily_raw_biometrics')
          .select('log_date').order('log_date', { ascending: false }).limit(5);
        if (nearby && nearby.length) {
          debugInfo = ' Últimas fechas: ' + nearby.map(r => r.log_date).join(', ');
        }
      } catch (_) {}
      if (isToday) {
        pass = true; detail = `Webhook aún no ha sincronizado hoy (cada 15 min).${debugInfo}`;
      } else {
        pass = false; detail = `No existe fila en daily_raw_biometrics para ${dateStr}.${debugInfo}`;
      }
    } else if (!rec) {
      pass = false; detail = 'Sin registro local para comparar.';
    } else {
      const mism: string[] = [];
      if (Math.abs((num(row.weight_kg) || 0) - rec.weight_kg) > 0.3) mism.push(`peso ${row.weight_kg} vs ${rec.weight_kg}`);
      if ((parseInt(row.steps_count, 10) || 0) !== rec.steps_count) mism.push(`pasos ${row.steps_count} vs ${rec.steps_count}`);
      if ((parseInt(row.intake_kcal, 10) || 0) !== rec.intake_kcal) mism.push(`kcal ${row.intake_kcal} vs ${rec.intake_kcal}`);
      if (row.total_sleep_min && (parseInt(row.total_sleep_min, 10) !== rec.total_sleep_min)) mism.push(`sueño ${row.total_sleep_min} vs ${rec.total_sleep_min}`);
      pass = mism.length === 0;
      detail = pass ? 'App y Supabase coinciden (peso, pasos, kcal, sueño).' : 'Difieren: ' + mism.join(' | ');
    }
    const div = document.createElement('div');
    div.className = `p-2.5 rounded-xl border ${pass ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`;
    div.innerHTML = `<div class="font-bold ${pass ? 'text-emerald-400' : 'text-red-400'}">${pass ? '✓ PASS' : '✕ FAIL'} — 7. App ↔ Supabase (${dateStr})</div><div class="text-[11px] text-slate-300 mt-0.5"></div>`;
    div.lastChild.textContent = detail;
    list.insertBefore(div, list.firstChild);
  } catch (e) {
    console.error('QA patch:', e);
  }
};

// NO auto-ejecutar: initSupabaseFromStorage() en el script principal llama a syncFromSupabase()
// tras inicializar window.supabaseClient en DOMContentLoaded

// Export for testing
export { syncFromSupabase, pushMealsToSupabase, mutateMeals };