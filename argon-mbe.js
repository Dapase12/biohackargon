/**
 * ARGON v6.0 — MBE+ Panel (ES Module)
 *
 * Fetches computed daily scores and raw biometrics from Supabase
 * and renders MBE+ dashboard sections.
 *
 * Usage: <script type="module" src="argon-mbe.js"></script>
 * Requires: localStorage 'argon_sb_url', 'argon_sb_key', 'argon_user_id' (set in Settings)
 */

import {
  renderDatePicker,
  renderBedTime,
  renderHypnogram,
  renderNaps,
  renderHrv,
  renderWorkouts,
  renderSteps,
  renderRetrain,
  renderLT,
  renderArgonAge,
  renderHeatMap,
  renderAchievements,
  renderWeek,
  renderTheme,
  applyAccent,
  loadMbeData,
  getMbeState,
  setSelectedDate,
  weekStats,
} from './src/components/mbe';

// ============================================================
// SLOT MAPPING (tab index -> section functions)
// ============================================================
const SLOTS = {
  0: [renderDatePicker, renderSteps, renderRetrain, renderWorkouts],
  1: [renderBedTime, renderHypnogram, renderNaps, renderHrv],
  2: [renderLT, renderArgonAge],
  4: [renderHeatMap, renderAchievements, renderWeek, renderTheme],
};

// ============================================================
// RENDER & WIRE
// ============================================================
function wire() {
  const g = document.getElementById('mbe-goal');
  if (g) g.onchange = () => {
    const LS = (key, def) => {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : def;
      } catch {
        return def;
      }
    };
    localStorage.setItem('argon_steps_goal', JSON.stringify(Math.max(1000, parseInt(g.value, 10) || 8000)));
    renderAll();
  };
  const dp = document.getElementById('mbe-date');
  if (dp) dp.onchange = () => { load(dp.value); };
  const b = document.getElementById('lt-save');
  if (b) b.onclick = () => {
    const LS = (key, def) => {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : def;
      } catch {
        return def;
      }
    };
    const km = parseFloat(document.getElementById('lt-km').value);
    const hr = parseFloat(document.getElementById('lt-hr').value);
    if (!(km >= 2 && km <= 12) || !(hr >= 120 && hr <= 220)) return alert('Datos fuera de rango (km 2–12, FC 120–220).');
    const h = LS('argon_lt_v1', []);
    h.push({ date: todayIso(), km, hr });
    localStorage.setItem('argon_lt_v1', JSON.stringify(h.slice(-10)));
    renderAll();
  };
}

import { todayIso } from './src/utils/date';

function renderAll(errMsg) {
  const state = getMbeState();
  const slides = document.querySelectorAll('.argon-main-swiper .swiper-slide');
  Object.keys(SLOTS).forEach(i => {
    const s = slides[Number(i)];
    if (!s) return;
    let box = s.querySelector(':scope > .mbe-slot');
    if (!box) {
      box = document.createElement('div');
      box.className = 'mbe-slot space-y-3.5';
      s.appendChild(box);
    }
    box.innerHTML = (errMsg && i == 1 ? renderDatePicker({ state, onDateChange: () => {}, onTodayClick: () => {} }) : '') +
      SLOTS[Number(i)].map(f => {
        try { return f({ state }); } catch (e) { return renderDatePicker({ state, onDateChange: () => {}, onTodayClick: () => {} }); }
      }).join('');
  });
  wire();
  if (typeof window.argonSwiper !== 'undefined' && window.argonSwiper) {
    setTimeout(() => window.argonSwiper.updateAutoHeight(200), 60);
  }
}

// ============================================================
// DATA LOADING
// ============================================================
async function load(dateStr) {
  if (dateStr) setSelectedDate(dateStr);

  // Check Supabase config first to give actionable feedback
  const config = await import('./src/config/index.js').then(m => m.config);
  if (!config.supabase?.url || !config.supabase?.anonKey) {
    renderAll('Configura Supabase en ⚙️ Ajustes → Credenciales Cloud');
    return;
  }

  try {
    await loadMbeData(dateStr);
    renderAll();
  } catch (e) {
    renderAll('No se pudieron cargar los datos MBE+: ' + (e instanceof Error ? e.message : String(e)));
  }
}

// API pública: window.mbeLoad('2026-01-15')
window.mbeLoad = load;

window.openMbe = () => {
  if (typeof window.goToArgonTab === 'function') window.goToArgonTab(1);
  load();
};

// ============================================================
// INIT
// ============================================================
function init() {
  applyAccent(localStorage.getItem('argon_accent') || 'cyan');
  setTimeout(load, 1200);
  const wrap = () => {
    const s = window.syncFromSupabase;
    if (typeof s === 'function' && !s._mbe) {
      const w = async function () {
        const r = await s.apply(this, arguments);
        load();
        return r;
      };
      w._mbe = true;
      window.syncFromSupabase = w;
    }
  };
  setTimeout(wrap, 1500);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

// Export for testing
export { load, renderAll, getMbeState, weekStats };