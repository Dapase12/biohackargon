/* ============================================================================
   ARGON v6.0 — PATCH 1 (cargar DESPUÉS del <script> principal, antes de </body>)
   <script src="argon-patch.js"></script>
   Corrige: sync que traía los 30 días MÁS ANTIGUOS, merge de ingesta con Math.max,
   push de comidas que pisaba datos reales, seed "Base 14d" que subía datos simulados,
   y añade verificación QA contra la fila real de Supabase.
   ========================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const setStatus = (t) => { const el = $('sync-status-text'); if (el) el.textContent = t; };
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : null;
  };

  // ---------------------------------------------------------------------------
  // 1. SYNC: últimos 45 días (DESC) y reordenado ASC en cliente
  // ---------------------------------------------------------------------------
  window.syncFromSupabase = async function syncFromSupabase() {
    if (!supabaseClient) return;
    try {
      setStatus('Sincronizando DAG...');
      const since = new Date(Date.now() - 45 * 86400000).toISOString().split('T')[0];
      const q = (t) => supabaseClient.from(t).select('*')
        .gte('log_date', since).order('log_date', { ascending: false }).limit(60);

      const [rawRes, compRes] = await Promise.all([q('daily_raw_biometrics'), q('computed_daily_scores')]);
      if (rawRes.error) throw rawRes.error;
      if (compRes.error) throw compRes.error;

      const rawMap = {}; (rawRes.data || []).forEach(r => { rawMap[r.log_date] = r; });
      const compMap = {}; (compRes.data || []).forEach(c => { compMap[c.log_date] = c; });

      const todayIso = getLocalTodayIso();
      const allDates = Array.from(new Set([...Object.keys(rawMap), ...Object.keys(compMap), todayIso])).sort();

      const store = getLocalStore();
      // Elimina días simulados (seed) dentro de la ventana que no existen en la nube
      Object.keys(store).forEach(d => { if (d >= since && !allDates.includes(d)) delete store[d]; });

      const historyRaw = [];
      let prevComp = null;

      allDates.forEach(dStr => {
        const r = rawMap[dStr] || {};
        const c = compMap[dStr] || {};

        // Quita nulls para que no pisen valores; ceros inválidos de sensores = sin dato
        const rClean = {};
        Object.keys(r).forEach(k => { if (r[k] !== null && r[k] !== undefined) rClean[k] = r[k]; });
        ['rmssd_ms', 'rhr_bpm', 'resp_rate_brpm', 'spo2_pct'].forEach(k => {
          if (!(num(rClean[k]) > 0)) delete rClean[k];
        });

        const lastW = prevComp ? prevComp.weight_kg : (window.CONFIG?.defaults?.weightKg || 70);
        const lastBf = prevComp ? prevComp.body_fat_pct : (window.CONFIG?.defaults?.bodyFatPct || 20);
        const w = num(r.weight_kg), bf = num(r.body_fat_pct);

        const pick = (k, isInt) => {
          const rv = num(r[k]);
          const v = rv !== null ? rv : (num(c[k]) || 0);
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

        const recalc = computeArgonDayScore(merged, [...historyRaw].reverse(), prevComp);
        store[dStr] = recalc;
        historyRaw.push(merged);
        prevComp = recalc;
      });

      saveLocalStore(store);
      const cur = ($('selected-date') || {}).value;
      loadDayData(store[cur] ? cur : todayIso);
      setStatus(`Cloud Activo (${allDates.length}d)`);
      const dot = $('status-dot');
      if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
    } catch (e) {
      console.error('syncFromSupabase:', e);
      setStatus('Error sync: ' + (e.message || e));
      const dot = $('status-dot');
      if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
    }
  };

  // Auto-sync al volver a la app y cada 5 min
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') window.syncFromSupabase();
  });
  setInterval(() => { if (document.visibilityState === 'visible') window.syncFromSupabase(); }, 300000);

  // ---------------------------------------------------------------------------
  // 2. COMIDAS: push parcial (solo columnas de ingesta) + mutaciones coherentes
  // ---------------------------------------------------------------------------
  window.pushMealsToSupabase = async function pushMealsToSupabase(c) {
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
      setStatus('Error guardando comida: ' + (err.message || err));
    }
  };

  async function mutateMeals(mutator) {
    const dateStr = ($('selected-date') || {}).value || getLocalTodayIso();
    const store = getLocalStore();
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

    const pastList = Object.keys(store).filter(d => d < dateStr).sort().reverse().map(d => store[d]);
    const recomputed = computeArgonDayScore(updatedRaw, pastList, pastList[0] || null);
    store[dateStr] = recomputed;
    saveLocalStore(store);
    loadDayData(dateStr);
    await window.pushMealsToSupabase(recomputed);
  }

  window.quickAddMeal = function (addKcal, addProt, addCarbs, addFat, customLabel) {
    const labelMap = { 420: 'Desayuno', 650: 'Almuerzo', 480: 'Cena', 130: 'Whey Protein' };
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

  window.removeMealByIndex = function (idx) {
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

  window.resetTodayMeals = function () {
    return mutateMeals(() => ({
      meals: [],
      totals: { intake_kcal: 0, intake_protein_g: 0, intake_carbs_g: 0, intake_fat_g: 0 }
    }));
  };

  // ---------------------------------------------------------------------------
  // 3. SEED "Base 14d": nunca sube a la nube; no se auto-ejecuta si hay Supabase
  // ---------------------------------------------------------------------------
  const _seedOrig = window.seedCalibratedFeelfitHistory;
  window.seedCalibratedFeelfitHistory = function (fromButton) {
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
  const _qaOrig = window.runQualityAuditModal;
  window.runQualityAuditModal = async function () {
    await _qaOrig();
    try {
      const list = $('qa-results-list');
      if (!list || !supabaseClient) return;
      const dateStr = ($('selected-date') || {}).value || getLocalTodayIso();
      const rec = getLocalStore()[dateStr];
      const { data, error } = await supabaseClient.from('daily_raw_biometrics')
        .select('*').eq('log_date', dateStr).limit(1);
      if (error) throw error;
      const row = data && data[0];
      let pass, detail;
      const todayIso = getLocalTodayIso();
      const isToday = dateStr === todayIso;
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
        const mism = [];
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

  // Primer sync con el parche activo (el inicial pudo correr con la versión vieja)
  if (typeof supabaseClient !== 'undefined' && supabaseClient) window.syncFromSupabase();
})();
