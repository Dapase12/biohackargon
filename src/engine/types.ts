/**
 * ARGON v7.0 — Engine Types
 * Pure TypeScript interfaces for MBE computation engine.
 * Matches ARGON_ENGINE_COLS_ (166 columns) from Code.txt v6.0.
 */

// ========================================================================
// USER PROFILE (from config.js / profiles table)
// ========================================================================
export interface UserProfile {
  birth: string;                    // YYYY-MM-DD
  height_m: number;                 // e.g., 1.75
  timezone: string;                 // IANA, e.g., 'America/Caracas'
  basalSleepNeedH: number;          // default 7.5
  habitualWake: string;             // HH:mm, e.g., '06:30'
  goalWeightKg?: number;
  goalDate?: string;                // YYYY-MM-DD
  dailyDeficitKcal: number;         // default 500
  biologicalSex: 'male' | 'female';
  chronologicalAgeYears?: number;   // computed
}

// ========================================================================
// RAW BIOMETRICS (daily_raw_biometrics row, merged from ghealth)
// ========================================================================
export interface RawBiometricDay {
  log_date: string;                 // YYYY-MM-DD (Caracas timezone)

  // HRV
  rmssd_ms?: number | null;
  hrv_rmssd_ms?: number | null;
  hrv_sdnn_ms?: number | null;
  hrv_pnn50_pct?: number | null;

  // RHR
  rhr_bpm?: number | null;

  // Sleep (from ghealth sleep.stages)
  total_sleep_min?: number | null;
  deep_sleep_min?: number | null;
  rem_sleep_min?: number | null;
  light_sleep_min?: number | null;
  awake_sleep_min?: number | null;
  sleep_onset_latency_min?: number | null;
  sleep_efficiency_pct?: number | null;
  time_in_bed_min?: number | null;
  bedtime_start?: string | null;    // HH:mm
  bedtime_end?: string | null;      // HH:mm
  naps_count?: number;
  naps_total_min?: number;

  // Activity
  steps?: number | null;
  active_calories?: number | null;
  exercise_min?: number | null;
  exercise_type?: string | null;
  exercise_intensity?: string | null;

  // Body Composition (from ghealth weight/body-fat)
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  muscle_mass_kg?: number | null;
  hydration_ml?: number | null;
  body_water_pct?: number | null;
  water_mass_kg?: number | null;
  vo2_max_ml_kg_min?: number | null;

  // Nutrition (manual PWA meals + ghealth nutrition)
  intake_kcal?: number;
  intake_protein_g?: number;
  intake_carbs_g?: number;
  intake_fat_g?: number;
  meals_log_json?: Array<{
    id: string;
    date_caracas: string;
    time_caracas: string;
    kcal: number;
    prot: number;
    carbs: number;
    fat: number;
    name: string;
    est?: boolean;
    epochMs?: number;
  }>;

  // HR zones (from ghealth exercise + minute HR)
  z1_minutes?: number;
  z2_minutes?: number;
  z3_minutes?: number;
  z4_minutes?: number;
  z5_minutes?: number;
  hr_zones_minutes?: {
    z1?: number;
    z2?: number;
    z3?: number;
    z4?: number;
    z5?: number;
    real?: boolean;
    walking_steps?: number;
    workouts?: Array<{
      id: string;
      type: string;
      min: number;
      rpe: number;
      z?: { z1: number; z2: number; z3: number; z4: number; z5: number };
      start_ms: number;
      end_ms: number;
      avg_hr?: number;
      max_hr?: number;
      kcal?: number;
      kcal_est?: boolean;
    }>;
    hrv_n?: Array<[number, number]>;  // [epochSec, rmssd]
    hr_m?: Array<[number, number]>;   // [minuteIdx, bpm]
    hrv_nap?: { n: number; median: number };
    hrv_day?: { n: number; median: number; min: number; max: number };
    hypno?: { t0: number; seg: Array<[string, number, number]> };
    naps?: Array<{ t: string; min: number }>;
    active_kcal?: number;
    distance_m?: number;
  };

  // Respiratory / SpO2
  resp_rate_brpm?: number | null;
  spo2_pct?: number | null;

  // Hospital shift
  is_hospital_shift?: boolean;
  night_awake_shift_hours?: number;

  // Subjective
  session_rpe?: number | null;
  pickleball_or_gym_minutes?: number;

  // Metadata
  raw_payload_hash?: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

// ========================================================================
// HISTORY ROW (raw biometric + strain_score from computed)
// Includes extra fields for 14-day rolling window calculations
// ========================================================================
export interface HistoryDay extends RawBiometricDay {
  strain_score?: number | null;
  // Extra fields from daily_raw_biometrics for 14-day windows
  rhr_bpm?: number | null;
  resp_rate_brpm?: number | null;
  body_water_pct?: number | null;
  water_mass_kg?: number | null;
  vo2_max_ml_kg_min?: number | null;
}

// ========================================================================
// PREVIOUS COMPUTED (for trend calculations)
// ========================================================================
export interface PrevComputed {
  log_date: string;
  trend_weight_kg?: number | null;
  trend_body_fat_pct?: number | null;
  rmssd_ms?: number | null;
  rhr_bpm?: number | null;
  resp_rate_brpm?: number | null;
  body_water_pct?: number | null;
  water_mass_kg?: number | null;
  vo2_max_ml_kg_min?: number | null;
  strain_score?: number | null;
  total_sleep_min?: number | null;
  recovery_score?: number | null;
  dynamic_sleep_need_hours?: number | null;
  ln_rmssd?: number | null;
  ln_rmssd_14d_mean?: number | null;
  ln_rmssd_14d_sd?: number | null;
  hrv_z_score?: number | null;
  rhr_z_score?: number | null;
  sleep_regularity_pct?: number | null;
  cumulative_sleep_debt_hours?: number | null;
  hrv_mode?: string;
  [key: string]: unknown;
}

// ========================================================================
// ENGINE CONFIG
// ========================================================================
export interface EngineConfig {
  minBaselineDays: number;          // 7
  basalSleepNeedH: number;          // 7.5
  hrvSWCMultiplier: number;         // 0.5
  hrvDeadZoneSD: number;            // 1.0 (excess over SWC)
  rhrPenaltyThreshold: number;      // 20 rpm
  spo2PenaltyThreshold: number;     // 94%
  acwrAcuteDays: number;            // 3
  acwrChronicDays: number;          // 14
  acwrThreshold: number;            // 1.3
  ewmaAlphaWeight: number;          // 0.25
  ewmaAlphaBodyFat: number;         // 0.25
  maxHrvCapPercentile: number;      // 3 SD above mean ln
  trimpCoeffMale: { a: number; b: number };
  trimpCoeffFemale: { a: number; b: number };
  strainSigmoidScale: number;       // 0.00165
  strainMax: number;                // 21
  neuroLoadFactor: number;          // 0.85
  shiftLoadFactor: number;          // 1.40
  shiftLoadMET: number;             // 35
  sleepArchWeights: { duration: number; regularity: number; efficiency: number; architecture: number };
  recoveryWeights: { hrv: number; rhr: number; sleep: number };
  recoveryPenalty: { spo2: number; respRate: number };
  minValidSleepMin: number;         // 120
  minValidNapMin: number;           // 10
  maxNapMin: number;                // 240
  napStartHour: number;             // 8
  napEndHour: number;               // 20
}

// ========================================================================
// COMPUTED OUTPUT (matches ARGON_ENGINE_COLS_)
// ========================================================================
export interface ComputedDailyScore {
  log_date: string;

  // Recovery
  recovery_score: number | null;
  readiness_score: number | null;
  recovery_status: string;
  calibrating: boolean;
  sleep_missing: boolean;
  hrv_missing: boolean;
  recommended_max_strain: number | null;

  // HRV Pillar
  hrv_baseline_rmssd: number | null;
  hrv_7d_avg_rmssd: number | null;
  hrv_14d_avg_rmssd: number | null;
  hrv_swc: number | null;
  hrv_z_score: number | null;
  ln_rmssd: number | null;
  ln_rmssd_14d_mean: number | null;
  ln_rmssd_14d_sd: number | null;
  cv_lnrmssd_7d_pct: number | null;
  dynamic_rmssd_cap_ms: number | null;

  // RHR Pillar
  rhr_baseline: number | null;
  rhr_7d_avg: number | null;
  rhr_z_score: number | null;

  // Sleep Pillar
  sleep_hours_vs_needed_pct: number | null;
  sleep_regularity_pct: number | null;
  high_sleep_stress_pct: number | null;
  sleep_architecture_score: number | null;
  sleep_debt_h: number | null;
  dynamic_sleep_need_h: number | null;
  optimal_bedtime_start: string | null;
  optimal_bedtime_end: string | null;
  cumulative_sleep_debt_hours: number | null;

  // Strain
  strain_score: number | null;
  training_load_7d: number | null;
  acwr: number | null;
  acwr_penalty_strain: number | null;
  cardio_trimp_load: number | null;
  neuromuscular_load: number | null;
  shift_orthostatic_load: number | null;
  z13_minutes: number;
  z45_minutes: number;
  hr_zones_minutes: Record<string, unknown>;
  steps_net: number;

  // Sleep Staging
  time_in_bed_min: number | null;
  total_sleep_min: number | null;
  deep_sleep_min: number | null;
  rem_sleep_min: number | null;
  light_sleep_min: number | null;
  sleep_efficiency_pct: number | null;
  sleep_onset_latency_min: number | null;
  nap_sleep_min: number | null;

  // Autonomic
  rmssd_ms: number | null;
  rmssd_14d_mean_ms: number | null;
  rhr_bpm: number | null;
  rhr_14d_mean_bpm: number | null;
  resp_rate_brpm: number | null;
  resp_14d_mean_brpm: number | null;
  spo2_pct: number | null;

  // Nutrition
  target_kcal: number | null;
  intake_kcal: number | null;
  intake_protein_g: number | null;
  intake_carbs_g: number | null;
  intake_fat_g: number | null;
  tef_kcal: number | null;
  empirical_tdee_kcal: number | null;
  target_protein_g: number | null;
  target_carbs_g: number | null;
  target_fat_g: number | null;
  hydration_score: number | null;

  // Body Composition
  trend_weight_kg: number | null;
  trend_body_fat_pct: number | null;
  ffm_kg: number | null;
  ffm_pct: number | null;
  muscle_mass_kg: number | null;
  bone_mass_kg: number | null;
  skeletal_muscle_pct: number | null;
  visceral_fat_index: number | null;
  tmb_kcal: number | null;
  body_water_pct: number | null;
  water_mass_kg: number | null;
  bmi: number | null;
  fat_mass_kg: number | null;
  body_comp_score: number | null;

  // Longevity
  chronological_age: number | null;
  argon_physiological_age: number | null;
  pace_of_aging_x: number | null;
  total_age_delta: number | null;
  vo2_max_ml_kg_min: number | null;
  delta_cardio_years: number | null;
  delta_metabolic_years: number | null;
  delta_inflammatory_years: number | null;
  delta_autonomic_years: number | null;

  // Clinical
  clinical_coach_notes: string | null;

  // Meta
  computed_at: string;
  computation_version: string;
  engine_version: string;
  created_at: string;
  updated_at: string;
}

// ========================================================================
// MAIN ENGINE FUNCTION SIGNATURE
// ========================================================================
export interface ComputeEngineInput {
  todayRaw: RawBiometricDay;
  historyRaw: HistoryDay[];
  prevComputed: PrevComputed | null;
  profile: UserProfile;
  config: EngineConfig;
}

export type ComputeEngineFn = (input: ComputeEngineInput) => ComputedDailyScore;

// ========================================================================
// ARGON_ENGINE_COLS_ (from Code.txt line 1639-1666) - for validation
// ========================================================================
export const ARGON_ENGINE_COLS: readonly string[] = [
  'log_date',
  'chronological_age','argon_physiological_age','total_age_delta','pace_of_aging_x',
  'delta_vo2_years','delta_rhr_years','delta_lnrmssd_years','delta_ffm_years',
  'delta_sleep_years','delta_act_years','vo2_max_ml_kg_min',
  'weight_kg','body_fat_pct','fat_mass_kg','ffm_kg','ffm_pct',
  'muscle_mass_kg','bone_mass_kg','skeletal_muscle_pct','visceral_fat_index',
  'tmb_kcal','body_water_pct','water_mass_kg','bmi','trend_body_fat_pct',
  'rmssd_ms','rmssd_14d_mean_ms','rhr_bpm','rhr_14d_mean_bpm',
  'resp_rate_brpm','resp_14d_mean_brpm','spo2_pct',
  'ln_rmssd','ln_rmssd_14d_mean','ln_rmssd_14d_sd','hrv_z_score','rhr_z_score',
  'dynamic_rmssd_cap_ms','cv_lnrmssd_7d_pct','swc_lnrmssd','acwr_penalty_strain',
  'calibrating','sleep_missing','hrv_missing','nap_sleep_min',
  'recovery_score','recovery_status','recommended_max_strain',
  'time_in_bed_min','total_sleep_min','deep_sleep_min','rem_sleep_min','light_sleep_min',
  'sleep_efficiency_pct','sleep_architecture_score',
  'sleep_hours_vs_needed_pct','sleep_regularity_pct','high_sleep_stress_pct',
  'cumulative_sleep_debt_hours','dynamic_sleep_need_hours',
  'optimal_bedtime_start','optimal_bedtime_end',
  'steps_count','steps_net','pickleball_or_gym_minutes','session_rpe',
  'hr_zones_minutes','z13_minutes','z45_minutes',
  'is_hospital_shift','night_awake_shift_hours',
  'cardio_trimp_load','neuromuscular_load','shift_orthostatic_load','strain_score',
  'dynamic_tdee_kcal','target_kcal','target_protein_g','target_carbs_g','target_fat_g',
  'intake_kcal','intake_protein_g','intake_carbs_g','intake_fat_g',
  'tef_kcal','empirical_tdee_kcal',
  'clinical_coach_notes'
] as const;