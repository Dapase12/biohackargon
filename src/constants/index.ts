/**
 * ARGON v6.0 — Constants & Defaults
 * Single source of truth for magic numbers, thresholds, and default values.
 * Import from: import { CONSTANTS, DEFAULTS } from '@/constants';
 */

// ============================================================
// TIME & DATE
// ============================================================
export const MILLIS_PER_DAY = 86_400_000;
export const MILLIS_PER_HOUR = 3_600_000;
export const MILLIS_PER_MINUTE = 60_000;
export const DAYS_IN_WEEK = 7;
export const DAYS_IN_MONTH = 30;
export const DAYS_IN_YEAR = 365;

// ============================================================
// SYNC WINDOWS
// ============================================================
export const SYNC_DAYS_DEFAULT = 45;      // PATCH: fetch last 45 days
export const SYNC_LIMIT = 60;             // Max rows per table
export const HISTORY_DAYS_DISPLAY = 30;   // UI history window

// ============================================================
// PHYSIOLOGICAL BOUNDS (validation)
// ============================================================
export const BOUNDS = {
  // Weight (kg)
  WEIGHT_MIN: 30,
  WEIGHT_MAX: 200,
  WEIGHT_SEED_MIN: 450,   // v54 seed marker (body weight * 10)
  WEIGHT_SEED_MAX: 550,

  // Body fat (%)
  BODY_FAT_MIN: 3,
  BODY_FAT_MAX: 55,
  BODY_FAT_SEED_MIN: 84,  // v54 seed marker (body fat * 10)
  BODY_FAT_SEED_MAX: 96,

  // HRV (ms)
  RMSSD_MIN: 5,
  RMSSD_MAX: 300,
  RMSSD_CAP_MAX: 200,

  // RHR (bpm)
  RHR_MIN: 30,
  RHR_MAX: 140,

  // Respiratory rate (breaths/min)
  RESP_RATE_MIN: 8,
  RESP_RATE_MAX: 40,
  RESP_RATE_PENALTY_THRESHOLD: 20,  // >20 penaliza recovery

  // SpO2 (%)
  SPO2_MIN: 70,
  SPO2_MAX: 100,

  // Sleep (minutes)
  SLEEP_MIN: 0,
  SLEEP_MAX: 1440,
  NAP_MIN_DURATION: 10,
  NAP_MAX_DURATION: 240,
  NAP_WINDOW_START_HOUR: 8,
  NAP_WINDOW_END_HOUR: 20,

  // Steps
  STEPS_MAX: 100_000,

  // Exercise
  EXERCISE_DURATION_MAX: 7200,  // 2 hours in seconds
  EXERCISE_KCAL_MAX: 3000,

  // Nutrition (g)
  MACRO_MIN: 0,
  MACRO_MAX: 500,
  KCAL_MIN: 0,
  KCAL_MAX: 10_000,

  // Hydration (ml)
  HYDRATION_ML_PER_KG: 35,
  HYDRATION_TOLERANCE_PCT: 0.25,  // ±25% of TDEE
} as const;

// ============================================================
// RECOVERY ALGORITHM (3-pillar linear model)
// ============================================================
export const RECOVERY = {
  // Pillar weights (sum = 1.0)
  HRV_WEIGHT: 0.40,
  RHR_WEIGHT: 0.20,
  SLEEP_WEIGHT: 0.40,

  // HRV (lnRMSSD)
  HRV_BASELINE_DAYS: 14,
  HRV_SWCV_MULTIPLIER: 0.5,      // SWC = 0.5 * SD
  HRV_DEAD_ZONE: true,           // Enable SWC dead zone
  HRV_CV_WINDOW_DAYS: 7,         // CV% over 7 days

  // RHR
  RHR_BASELINE_DAYS: 14,

  // Sleep
  SLEEP_BASELINE_DAYS: 14,
  SLEEP_DEBT_FULL_CREDIT: 1.0,   // 100% siesta credit (TODO: evaluate 0.75)
  SLEEP_DEBT_CREDIT: 0.75,       // Proposed siesta credit

  // Strain penalty (ACWR)
  ACWR_WINDOW_ACUTE_DAYS: 7,
  ACWR_WINDOW_CHRONIC_DAYS: 28,
  ACWR_PENALTY_MAX: 15,          // Max penalty points

  // Calibration
  CALIBRATION_MIN_DAYS: 7,       // Min days before recovery_score valid
  CALIBRATION_SCORE: 0,          // Score during calibration
} as const;

// ============================================================
// MBE (Metabolic Budget Engine) — Server is source of truth
// ============================================================
export const MBE = {
  // BMR: Mifflin-St Jeor
  // TEF: 2-step (protein 25%, carbs 7.5%, fat 1.5%)
  // NEAT: PAL-based
  // Exercise: Keytel 2005 (HR-based)

  PAL_SEDENTARY: 1.2,
  PAL_LIGHT: 1.375,
  PAL_MODERATE: 1.55,
  PAL_ACTIVE: 1.725,
  PAL_VERY_ACTIVE: 1.9,

  // Keytel coefficients
  KEYTEL: {
    MALE: { a: -59.3954, b: 0.271, c: 0.394, d: -0.110, e: 0.141 },
    FEMALE: { a: -59.3954, b: 0.271, c: 0.394, d: -0.110, e: 0.141 },
  },

  // Deficit bounds
  DEFICIT_MIN: -1000,
  DEFICIT_MAX: 0,
  DEFICIT_DEFAULT: -500,
} as const;

// ============================================================
// HYPOGRAM STAGE CODES
// ============================================================
export const SLEEP_STAGE = {
  AWAKE: 1,
  LIGHT: 4,
  DEEP: 5,
  REM: 6,
} as const;

export const SLEEP_STAGE_LABELS: Record<number, string> = {
  1: 'Despierto',
  4: 'Ligero',
  5: 'Profundo',
  6: 'REM',
};

export const SLEEP_STAGE_COLORS: Record<number, string> = {
  1: '#ef4444',   // red
  4: '#3b82f6',   // blue
  5: '#8b5cf6',   // purple
  6: '#22c55e',   // green
};

// ============================================================
// EXERCISE TYPES (Zepp)
// ============================================================
export const EXERCISE_TYPE = {
  UNKNOWN: '0',
  WORKOUT: '0',  // Only confirmed type from Zepp
} as const;

// ============================================================
// DEFAULT PROFILE (fallback when config.js missing)
// ============================================================
export const DEFAULTS = {
  // User profile
  birthYear: 1985,
  heightCm: 175,
  weightKg: 75,
  bodyFatPct: 20,
  biologicalSex: 'male' as 'male' | 'female',
  basalSleepNeedH: 7.5,
  habitualWake: '07:00',
  timezone: 'America/Caracas',
  goalWeightKg: 72,
  goalDate: null,
  dailyDeficitKcal: -500,

  // Targets (computed server-side)
  targetKcal: 2200,
  targetProteinG: 150,
  targetCarbsG: 200,
  targetFatG: 73,

  // Hydration
  hydrationMlPerKg: 35,

  // Training
  lthrBpm: 170,
  ftpWatts: 250,

  // App behavior
  syncDays: SYNC_DAYS_DEFAULT,
  showSiestaInDebt: true,
} as const;

// ============================================================
// STORAGE KEYS
// ============================================================
export const STORAGE_KEYS = {
  // Supabase
  SB_URL: 'argon_sb_url',
  SB_KEY: 'argon_sb_key',
  USER_ID: 'argon_user_id',

  // App config
  WEBAPP_URL: 'ARGON_WEBAPP_URL',
  CONFIG: 'argon_config',

  // Local data
  LOCAL_STORE: 'argon_local_store',
  SELECTED_DATE: 'argon_selected_date',

  // UI state
  THEME: 'argon_theme',
  ONBOARDING_DONE: 'argon_onboarding_done',
} as const;

// ============================================================
// API ENDPOINTS
// ============================================================
export const ENDPOINTS = {
  // Supabase REST
  DAILY_RAW: 'daily_raw_biometrics',
  DAILY_COMPUTED: 'computed_daily_scores',
  SLEEP_SEGMENTATIONS: 'sleep_segmentations',
  SLEEP_EPOCHS: 'sleep_epoch_features',
  SLEEP_OBSERVATIONS: 'sleep_night_observations',
  SLEEP_PROFILES: 'sleep_user_profiles',
  SLEEP_DAILY_SCORES: 'sleep_daily_scores',
  WEBHOOK_LOGS: 'webhook_logs',
  USER_PROFILE: 'user_clinical_profile',

  // GAS Webhook actions
  ACTIONS: {
    SYNC: 'sync',
    ASK_COACH: 'ask_coach',
    ESTIMATE_MEAL: 'estimate_meal',
    SET_PROFILE: 'set_profile',
    RECALC_DAY: 'recalc_day',
  },
} as const;

// ============================================================
// TOAST / UI
// ============================================================
export const TOAST_DURATION = 3000;
export const TOAST_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
} as const;

// ============================================================
// TIMEZONE (runtime mutable via config)
// ============================================================
export let TZ: string = DEFAULTS.timezone;

export function setTimezone(tz: string): void {
  TZ = tz;
}