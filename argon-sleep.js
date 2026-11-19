/**
 * ARGON v6.0 — Sleep Staging Dashboard Module (ES Module)
 *
 * Fetches sleep staging data from Supabase and renders:
 * - Hypnogram (sleep stage timeline)
 * - HRV trends (lnRMSSD, recovery score)
 * - Sleep scores (TST, SWS%, REM%, efficiency, debt)
 * - Cardio epoch features charts
 *
 * Usage: <script type="module" src="argon-sleep.js"></script>
 * Requires: localStorage 'argon_sb_url', 'argon_sb_key', 'argon_user_id' (set in Settings)
 */

import {
  renderHypnogram,
  renderHrvTrends,
  renderSleepScores,
  renderEpochCharts,
  renderProfileBaselines,
  renderTrendCharts,
  loadSleepData,
  getSleepState,
  getTodaySegmentation,
  getTodayDailyScore,
  getTodayNightObservation,
} from './src/components/sleep';

// ============================================================
// MAIN RENDER ORCHESTRATOR
// ============================================================
function renderAll() {
  const state = getSleepState();

  renderHypnogram({
    containerId: 'sleep-hypnogram',
    data: getTodaySegmentation() || null,
  });

  renderHrvTrends({
    containerId: 'sleep-hrv-trends',
    nightObservations: state.nightObservations,
    dailyScores: state.dailyScores,
  });

  renderSleepScores({
    containerId: 'sleep-scores',
    segmentation: getTodaySegmentation() || null,
    dailyScore: getTodayDailyScore() || null,
    nightObservation: getTodayNightObservation() || null,
    userProfile: state.userProfile,
  });

  renderEpochCharts({
    containerId: 'sleep-epoch-charts',
    epochFeatures: state.epochFeatures,
  });

  renderProfileBaselines({
    containerId: 'sleep-profile-baselines',
    userProfile: state.userProfile,
  });

  renderTrendCharts({
    containerId: 'sleep-trend-charts',
    dailyScores: state.dailyScores,
  });
}

// ============================================================
// PUBLIC API
// ============================================================
window.argonSleep = {
  load: loadSleepData,
  renderAll,
  getState: getSleepState,
};

// Auto-load if on sleep tab
document.addEventListener('DOMContentLoaded', () => {
  // Check if we're on sleep tab (tab 1)
  const sleepTab = document.querySelector('[data-argon-tab="1"]') ||
                   document.querySelector('#nav-btn-1') ||
                   document.querySelector('.swiper-slide:nth-child(2)');
  if (sleepTab) {
    loadSleepData();
  }
});

// Listen for tab changes
window.addEventListener('argon-tab-change', (e: CustomEvent) => {
  if (e.detail === 1) { // Sleep tab
    loadSleepData();
  }
});

// Export for testing
export { loadSleepData, renderAll, getSleepState };