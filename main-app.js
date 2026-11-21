/**
 * ARGON v6.0 — Main Application Module (ES Module)
 *
 * Core application logic: dashboard rendering, sync, profile, workouts, meals, modals.
 * Replaces the monolithic inline script in index.html.
 *
 * Usage: <script type="module" src="main-app.js"></script>
 */

import { todayIso, fmtHHMM, addDays } from './src/utils/date.ts';
import { fmtPct, fmtDuration, kcalOf } from './src/utils/format.ts';
import { num, mean } from './src/utils/math.ts';
import { s, sf, si } from './src/utils/helpers.ts';
import { config } from './src/config/index.ts';
import { STORAGE_KEYS } from './src/constants/index.ts';
import { supabaseClient, sbTestConnection, sbLoadRange, sbUpsertRawBiometric, getClientAsync, getClient } from './src/api/client.ts';

// Expose sbTestConnection globally for console debugging
window.sbTestConnection = sbTestConnection;
// Expose getClientAsync for initSupabaseFromStorage
window.getClientAsync = getClientAsync;
// Expose getClient for argon-patch.js (sync access to shared client)
window.getClient = getClient;

// Import app components
import {
  injectProfileModal,
  openProfileModal,
  saveProfile,
  skipOnboarding,
  getProfile,
} from './src/components/app/profile-helpers.ts';
import {
  injectWorkoutModal,
  openWorkoutModal,
  closeWorkoutModal,
  wkTimerStart,
  wkTimerStop,
  wkPickType,
  wkRpeLabel,
  wkSave,
  wkRemove,
  renderWorkoutCard,
  getDayWorkouts,
  setDayWorkouts,
  getWorkoutTypes,
  getCurrentWorkoutType,
  setWorkoutType,
  getRpeLabels,
} from './src/components/app/workout-helpers.ts';
import {
  injectMealModal,
  openMealModal,
  closeMealModal,
  mfDebouncedSearch,
  mfAddFood,
  mfRemoveFood,
  mfAiEstimate,
  mfQuickWater,
  mfSave,
  mfRenderList,
  renderMealCard,
  getDayMeals,
  setDayMeals,
  getMealTypes,
} from './src/components/app/meal-helpers.ts';
import {
  recomputeAll,
  pushDayToSupabase,
  syncFromSupabase,
  pushAllToSupabase,
  showToast,
} from './src/components/app/sync-helpers.ts';
import {
  openModal,
  closeModal,
} from './src/components/app/modal-helpers.ts';
import { renderDashboard } from './src/components/dashboard/index.ts';

// ============================================================
// CONSTANTS (from original index.html inline scripts)
// ============================================================
const CACHE_KEY_PREFIX = 'argon:cache:';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const STORAGE_KEY_RECORDS = 'argon_graphos_records_v54';

// ============================================================
// CACHE / STORE HELPERS (exposed on window for inline handlers)
// ============================================================

function getCache(dateStr: string): any {
  try {
    const item = localStorage.getItem(CACHE_KEY_PREFIX + dateStr);
    if (!item) return null;
    const { data, ts } = JSON.parse(item);
    if (Date.now() - ts > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY_PREFIX + dateStr);
      return null;
    }
    return data;
  } catch { return null; }
}

function setCache(dateStr: string, data: any): void {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + dateStr, JSON.stringify({ data, ts: Date.now() }));
  } catch { }
}

function clearCache(): void {
  try {
    Object.keys(localStorage).forEach(k => { if (k.startsWith(CACHE_KEY_PREFIX)) localStorage.removeItem(k); });
  } catch { }
}

function getLocalStore(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_RECORDS) || '{}'); }
  catch { return {}; }
}

function saveLocalStore(store: Record<string, any>): void {
  localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(store));
}

// ============================================================
// GLOBAL HELPERS (exposed on window for inline handlers)
// ============================================================
const $ = (id: string) => document.getElementById(id);
const E = (s: any) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": "'" }[c]));
const rd1 = (x: number) => Math.round(x * 10) / 10;
const lsGet = (k: string, d: any) => { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch { return d; } };

const sel = () => (($('selected-date') as HTMLInputElement)?.value) || todayIso();
const gas = () => (localStorage.getItem('argon_gas_url') || '').trim();

// Expose for global access (legacy inline handlers)
(window as any).$ = $;
(window as any).E = E;
(window as any).rd1 = rd1;
(window as any).lsGet = lsGet;
(window as any).sel = sel;
(window as any).gas = gas;
(window as any).todayIso = todayIso;
(window as any).fmtHHMM = fmtHHMM;
(window as any).addDays = addDays;
(window as any).fmtPct = fmtPct;
(window as any).fmtDuration = fmtDuration;
(window as any).kcalOf = kcalOf;

// Expose cache/store/date functions to window for inline handlers
(window as any).getCache = getCache;
(window as any).setCache = setCache;
(window as any).clearCache = clearCache;
(window as any).getLocalStore = getLocalStore;
(window as any).saveLocalStore = saveLocalStore;
(window as any).getLocalTodayIso = getLocalTodayIso;
(window as any).loadDayData = loadDayData;
(window as any).stepArgonDate = stepArgonDate;
(window as any).updateTodayButtonVisibility = updateTodayButtonVisibility;
(window as any).renderDashboard = renderDashboard;
(window as any).s = s;
(window as any).sf = sf;
(window as any).si = si;

// Expose component functions to window for inline handlers
(window as any).openProfile = openProfileModal;
(window as any).skipOnboarding = skipOnboarding;
(window as any).saveProfile = saveProfile;
(window as any).openWorkoutModal = openWorkoutModal;
(window as any).closeWorkoutModal = closeWorkoutModal;
(window as any).wkTimerStart = wkTimerStart;
(window as any).wkTimerStop = wkTimerStop;
(window as any).wkPickType = wkPickType;
(window as any).wkRpeLabel = wkRpeLabel;
(window as any).wkSave = wkSave;
(window as any).wkRemove = wkRemove;
(window as any).openMealModal = openMealModal;
(window as any).closeMealModal = closeMealModal;
(window as any).mfDebouncedSearch = mfDebouncedSearch;
(window as any).mfAddFood = mfAddFood;
(window as any).mfRemoveFood = mfRemoveFood;
(window as any).mfAiEstimate = mfAiEstimate;
(window as any).mfQuickWater = mfQuickWater;
(window as any).mfSave = mfSave;
(window as any).mfRenderList = mfRenderList;
(window as any).recomputeAll = recomputeAll;
(window as any).pushDayToSupabase = pushDayToSupabase;
(window as any).syncFromSupabase = syncFromSupabase;
(window as any).pushAllToSupabase = pushAllToSupabase;
(window as any).showToast = showToast;
(window as any).openModal = openModal;
(window as any).closeModal = closeModal;
(window as any).s = s;
(window as any).sf = sf;
(window as any).si = si;

// ============================================================
// DATE NAVIGATION (exposed on window for inline handlers)
// ============================================================

function getLocalTodayIso(): string {
  try {
    const tz = window.CONFIG?.profile?.timezone || 'UTC';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch (_) {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  }
}

function updateTodayButtonVisibility(dateStr: string): void {
  const btn = document.getElementById('btn-today');
  if (btn) {
    const todayStr = getLocalTodayIso();
    if (dateStr === todayStr) {
      btn.classList.add('hidden');
    } else {
      btn.classList.remove('hidden');
    }
  }
}

function loadDayData(dateStr: string): void {
  // 1. Try cache (instant, 5min TTL)
  const cached = getCache(dateStr);
  if (cached) {
    const store = getLocalStore();
    const sortedDates = Object.keys(store).sort();
    const allSorted = sortedDates.map(d => store[d]);
    const dateInput = document.getElementById('selected-date') as HTMLInputElement;
    if (dateInput) dateInput.value = cached.log_date;
    renderDashboard(cached, allSorted);
    updateTodayButtonVisibility(cached.log_date);
    if (window.argonSleep && typeof window.argonSleep.load === 'function') {
      window.argonSleep.load(dateStr);
    }
    return;
  }
  // 2. Fallback to localStorage
  const store = getLocalStore();
  const sortedDates = Object.keys(store).sort();
  const allSorted = sortedDates.map(d => store[d]);
  const record = store[dateStr] || allSorted[allSorted.length - 1];
  if (record) {
    const dateInput = document.getElementById('selected-date') as HTMLInputElement;
    if (dateInput) dateInput.value = record.log_date;
    renderDashboard(record, allSorted);
    updateTodayButtonVisibility(record.log_date);
    if (window.argonSleep && typeof window.argonSleep.load === 'function') {
      window.argonSleep.load(dateStr);
    }
  }
}

function stepArgonDate(deltaDays: number): void {
  const input = document.getElementById('selected-date') as HTMLInputElement;
  if (!input || !input.value) return;
  const nextIso = addDays(input.value, deltaDays);
  if (nextIso > getLocalTodayIso()) return;
  input.value = nextIso;
  loadDayData(nextIso);
}

// Expose for global access (legacy inline handlers)
(window as any).getLocalTodayIso = getLocalTodayIso;
(window as any).loadDayData = loadDayData;
(window as any).stepArgonDate = stepArgonDate;
(window as any).updateTodayButtonVisibility = updateTodayButtonVisibility;

// ============================================================
// INITIALIZATION
// ============================================================

// Inject all modals
document.addEventListener('DOMContentLoaded', () => {
  injectProfileModal();
  injectWorkoutModal();
  injectMealModal();

  // Initial render of cards
  renderWorkoutCard();
  renderMealCard();

  // Auto-open onboarding if needed
  setTimeout(() => {
    if (!localStorage.getItem('argon_profile_v1') && !localStorage.getItem('argon_onboard_seen')) {
      openProfileModal(true);
    }
  }, 1500);
});

// Override renderDashboard to also update our cards
const _rd = (window as any).renderDashboard;
(window as any).renderDashboard = function (rec: any, all: any) {
  _rd(rec, all);
  try {
    renderWorkoutCard();
    renderMealCard();
  } catch (e) {
    console.error('ARGON+C', e);
  }
};

// ============================================================
// EXPORTS FOR TESTING
// ============================================================
export {
  kcalOf,
  todayIso,
  fmtHHMM,
  addDays,
  fmtPct,
  fmtDuration,
  getProfile,
  getDayWorkouts,
  setDayWorkouts,
  getWorkoutTypes,
  getCurrentWorkoutType,
  setWorkoutType,
  getRpeLabels,
  getDayMeals,
  setDayMeals,
  getMealTypes,
  recomputeAll,
  pushDayToSupabase,
  syncFromSupabase,
  pushAllToSupabase,
  showToast,
  openModal,
  closeModal,
};