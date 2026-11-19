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
import { config } from './src/config/index.ts';
import { STORAGE_KEYS } from './src/constants/index.ts';
import { supabaseClient, sbTestConnection, sbLoadRange, sbUpsertRawBiometric } from './src/api/client.ts';

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