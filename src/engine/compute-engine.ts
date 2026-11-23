/**
 * ARGON v7.0 — Main Compute Engine Orchestrator
 * Coordinates all pillars: Recovery, Strain, Sleep, Body Comp, Longevity, Nutrition
 * Pure function: ComputeEngineInput -> ComputedDailyScore
 */

import type {
  ComputeEngineInput,
  ComputeEngineFn,
  ComputedDailyScore,
  RawBiometricDay,
  HistoryDay,
  PrevComputed,
  UserProfile,
  EngineConfig,
} from '@/engine/types';
import { computeRecoveryPillar } from './pillars/recovery';
import { computeStrainPillar } from './pillars/strain';
import { computeSleepPillarExtended } from './pillars/sleep';
import { computeBodyCompPillar } from './pillars/body-comp';
import { computeLongevityPillar } from './pillars/longevity';
import { computeNutritionPillar } from './pillars/nutrition';
import { ARGON_ENGINE_COLS } from '@/engine/types';

const ENGINE_VERSION = '7.0.0';
const COMPUTATION_VERSION = 'v7.0-mbe';

/**
 * Main compute engine function
 * Runs all pillars in dependency order:
 * 1. Body Comp (needed for TDEE, FFM)
 * 2. Strain (needed for dynamic sleep need)
 * 3. Sleep Extended (needs strain score)
 * 4. Recovery (needs sleep, HRV, RHR)
 * 5. Longevity (needs recovery, body comp, sleep, strain)
 * 6. Nutrition (needs body comp, strain)
 */
export const computeEngine: ComputeEngineFn = (input: ComputeEngineInput): ComputedDailyScore => {
  const { todayRaw, historyRaw, prevComputed, profile, config } = input;

  const now = new Date().toISOString();
  const logDate = todayRaw.log_date;

  // ========================================================================
  // 1. BODY COMPOSITION (needed first for TDEE, FFM)
  // ========================================================================
  const bodyComp = computeBodyCompPillar(todayRaw, historyRaw, prevComputed, profile, config);

  // ========================================================================
  // 2. STRAIN (needed for dynamic sleep need)
  // ========================================================================
  const strain = computeStrainPillar(
    todayRaw,
    historyRaw,
    { biologicalSex: profile.biologicalSex, birth: profile.birth },
    config
  );

  // ========================================================================
  // 3. SLEEP EXTENDED (needs strain score for dynamic sleep need)
  // ========================================================================
  const sleep = computeSleepPillarExtended(
    todayRaw,
    historyRaw,
    profile,
    config,
    strain.strain_score ?? 8
  );

  // ========================================================================
  // 4. RECOVERY (needs sleep architecture, HRV, RHR)
  // ========================================================================
  const recovery = computeRecoveryPillar(todayRaw, historyRaw, prevComputed, profile, config);

  // Apply ACWR penalty to recommended_max_strain (matching Code.txt line 1513)
  // recMaxStrain = Math.max(4.0, recMaxStrain - acwrPenalty)
  if (recovery.recommended_max_strain !== null && strain.acwr_penalty_strain !== null) {
    recovery.recommended_max_strain = Math.max(4.0, +(recovery.recommended_max_strain - strain.acwr_penalty_strain).toFixed(1));
  }

  // ========================================================================
  // 5. LONGEVITY (needs recovery, body comp, sleep, strain)
  // ========================================================================
  const longevity = computeLongevityPillar(
    todayRaw,
    historyRaw,
    profile,
    config,
    {
      ln_rmssd: recovery.ln_rmssd,
      rhr_bpm: recovery.rhr_bpm,
      rhr_14d_mean_bpm: recovery.rhr_14d_mean_bpm,
    },
    {
      ffm_pct: bodyComp.ffm_pct,
      trend_weight_kg: bodyComp.trend_weight_kg,
    },
    {
      sleep_regularity_pct: sleep.sleep_regularity_pct,
      total_sleep_min: sleep.total_sleep_min,
    },
    {
      strain_score: strain.strain_score,
      training_load_7d: strain.training_load_7d,
    }
  );

  // ========================================================================
  // 6. NUTRITION (needs body comp, strain)
  // ========================================================================
  const nutrition = computeNutritionPillar(
    todayRaw,
    historyRaw,
    profile,
    config,
    {
      tmb_kcal: bodyComp.tmb_kcal,
      weight_kg: bodyComp.weight_kg,
      body_fat_pct: bodyComp.body_fat_pct,
      ffm_kg: bodyComp.ffm_kg,
    },
    {
      strain_score: strain.strain_score,
    }
  );

  // ========================================================================
  // MERGE ALL RESULTS
  // ========================================================================
  const merged: ComputedDailyScore = {
    log_date: logDate,

    // Recovery (from recovery pillar)
    recovery_score: recovery.recovery_score ?? null,
    readiness_score: recovery.readiness_score ?? null,
    recovery_status: recovery.recovery_status ?? 'unknown',
    calibrating: recovery.calibrating ?? true,
    sleep_missing: recovery.sleep_missing ?? false,
    hrv_missing: recovery.hrv_missing ?? false,
    recommended_max_strain: recovery.recommended_max_strain ?? null,

    // HRV Pillar
    hrv_baseline_rmssd: recovery.hrv_baseline_rmssd ?? null,
    hrv_7d_avg_rmssd: recovery.hrv_7d_avg_rmssd ?? null,
    hrv_14d_avg_rmssd: recovery.hrv_14d_avg_rmssd ?? null,
    hrv_swc: recovery.hrv_swc ?? null,
    hrv_z_score: recovery.hrv_z_score ?? null,
    ln_rmssd: recovery.ln_rmssd ?? null,
    ln_rmssd_14d_mean: recovery.ln_rmssd_14d_mean ?? null,
    ln_rmssd_14d_sd: recovery.ln_rmssd_14d_sd ?? null,
    cv_lnrmssd_7d_pct: recovery.cv_lnrmssd_7d_pct ?? null,
    dynamic_rmssd_cap_ms: recovery.dynamic_rmssd_cap_ms ?? null,

    // RHR Pillar
    rhr_baseline: recovery.rhr_baseline ?? null,
    rhr_7d_avg: recovery.rhr_7d_avg ?? null,
    rhr_z_score: recovery.rhr_z_score ?? null,

    // Sleep Pillar (from sleep extended)
    sleep_hours_vs_needed_pct: sleep.sleep_hours_vs_needed_pct ?? null,
    sleep_regularity_pct: sleep.sleep_regularity_pct ?? null,
    high_sleep_stress_pct: sleep.high_sleep_stress_pct ?? 0,
    sleep_architecture_score: sleep.sleep_architecture_score ?? null,
    sleep_debt_h: sleep.sleep_debt_h ?? null,
    dynamic_sleep_need_h: sleep.dynamic_sleep_need_h ?? null,
    optimal_bedtime_start: sleep.optimal_bedtime_start ?? null,
    optimal_bedtime_end: sleep.optimal_bedtime_end ?? null,
    cumulative_sleep_debt_hours: sleep.cumulative_sleep_debt_hours ?? null,

    // Strain
    strain_score: strain.strain_score ?? null,
    training_load_7d: strain.training_load_7d ?? null,
    acwr: strain.acwr ?? null,
    acwr_penalty_strain: strain.acwr_penalty_strain ?? null,
    cardio_trimp_load: strain.cardio_trimp_load ?? null,
    neuromuscular_load: strain.neuromuscular_load ?? null,
    shift_orthostatic_load: strain.shift_orthostatic_load ?? null,
    z13_minutes: strain.z13_minutes ?? 0,
    z45_minutes: strain.z45_minutes ?? 0,
    hr_zones_minutes: strain.hr_zones_minutes ?? {},
    steps_net: strain.steps_net ?? 0,

    // Sleep Staging
    time_in_bed_min: sleep.time_in_bed_min ?? null,
    total_sleep_min: sleep.total_sleep_min ?? null,
    deep_sleep_min: sleep.deep_sleep_min ?? null,
    rem_sleep_min: sleep.rem_sleep_min ?? null,
    light_sleep_min: sleep.light_sleep_min ?? null,
    sleep_efficiency_pct: sleep.sleep_efficiency_pct ?? null,
    sleep_onset_latency_min: sleep.sleep_onset_latency_min ?? null,
    nap_sleep_min: sleep.nap_sleep_min ?? null,

    // Autonomic
    rmssd_ms: todayRaw.rmssd_ms ?? todayRaw.hrv_rmssd_ms ?? null,
    rmssd_14d_mean_ms: recovery.hrv_14d_avg_rmssd ?? null,
    rhr_bpm: recovery.rhr_bpm ?? null,
    rhr_14d_mean_bpm: recovery.rhr_14d_mean_bpm ?? null,
    resp_rate_brpm: todayRaw.resp_rate_brpm ?? null,
    resp_14d_mean_brpm: null, // computed if needed
    spo2_pct: todayRaw.spo2_pct ?? null,

    // Nutrition
    target_kcal: nutrition.target_kcal ?? null,
    intake_kcal: nutrition.intake_kcal ?? null,
    intake_protein_g: nutrition.intake_protein_g ?? null,
    intake_carbs_g: nutrition.intake_carbs_g ?? null,
    intake_fat_g: nutrition.intake_fat_g ?? null,
    tef_kcal: nutrition.tef_kcal ?? null,
    empirical_tdee_kcal: nutrition.empirical_tdee_kcal ?? null,
    dynamic_tdee_kcal: nutrition.dynamic_tdee_kcal ?? null,
    target_protein_g: nutrition.target_protein_g ?? null,
    target_carbs_g: nutrition.target_carbs_g ?? null,
    target_fat_g: nutrition.target_fat_g ?? null,
    hydration_score: nutrition.hydration_score ?? null,

    // Body Composition
    trend_weight_kg: bodyComp.trend_weight_kg ?? null,
    trend_body_fat_pct: bodyComp.trend_body_fat_pct ?? null,
    ffm_kg: bodyComp.ffm_kg ?? null,
    ffm_pct: bodyComp.ffm_pct ?? null,
    muscle_mass_kg: bodyComp.muscle_mass_kg ?? null,
    bone_mass_kg: bodyComp.bone_mass_kg ?? null,
    skeletal_muscle_pct: bodyComp.skeletal_muscle_pct ?? null,
    visceral_fat_index: bodyComp.visceral_fat_index ?? null,
    tmb_kcal: bodyComp.tmb_kcal ?? null,
    body_water_pct: bodyComp.body_water_pct ?? null,
    water_mass_kg: bodyComp.water_mass_kg ?? null,
    bmi: bodyComp.bmi ?? null,
    fat_mass_kg: bodyComp.fat_mass_kg ?? null,
    body_comp_score: bodyComp.body_comp_score ?? null,

    // Longevity
    chronological_age: longevity.chronological_age ?? null,
    argon_physiological_age: longevity.argon_physiological_age ?? null,
    pace_of_aging_x: longevity.pace_of_aging_x ?? null,
    total_age_delta: longevity.total_age_delta ?? null,
    vo2_max_ml_kg_min: longevity.vo2_max_ml_kg_min ?? null,
    delta_cardio_years: longevity.delta_cardio_years ?? null,
    delta_metabolic_years: longevity.delta_metabolic_years ?? null,
    delta_inflammatory_years: longevity.delta_inflammatory_years ?? null,
    delta_autonomic_years: longevity.delta_autonomic_years ?? null,
    delta_sleep_years: longevity.delta_sleep_years ?? null,
    delta_act_years: longevity.delta_act_years ?? null,

    // ARGON_ENGINE_COLS aliases (different names for same data)
    delta_vo2_years: longevity.delta_cardio_years ?? null,
    delta_rhr_years: longevity.delta_metabolic_years ?? null,
    delta_lnrmssd_years: longevity.delta_inflammatory_years ?? null,
    delta_ffm_years: longevity.delta_autonomic_years ?? null,

    // Body Composition (from todayRaw/bodyComp)
    weight_kg: bodyComp.weight_kg ?? todayRaw.weight_kg ?? null,
    body_fat_pct: bodyComp.body_fat_pct ?? todayRaw.body_fat_pct ?? null,

    // HRV aliases
    swc_lnrmssd: recovery.hrv_swc ?? null,

    // Sleep aliases
    dynamic_sleep_need_hours: sleep.dynamic_sleep_need_h ?? null,

    // Activity fields from todayRaw
    steps_count: todayRaw.steps ?? null,
    pickleball_or_gym_minutes: todayRaw.pickleball_or_gym_minutes ?? null,
    session_rpe: todayRaw.session_rpe ?? null,
    is_hospital_shift: todayRaw.is_hospital_shift ?? false,
    night_awake_shift_hours: todayRaw.night_awake_shift_hours ?? 0,

    // Clinical
    clinical_coach_notes: null, // generated separately by coach

    // Meta
    computed_at: now,
    computation_version: COMPUTATION_VERSION,
    engine_version: ENGINE_VERSION,
    created_at: now,
    updated_at: now,
  };

  return merged;
};

/**
 * Validate computed output has all required columns
 */
export function validateComputedOutput(computed: ComputedDailyScore): { valid: boolean; missing: string[] } {
  const missing = ARGON_ENGINE_COLS.filter((col: string) => !(col in computed));
  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Create empty ComputedDailyScore with nulls for calibration/insufficient data
 */
export function createEmptyComputed(logDate: string): ComputedDailyScore {
  const now = new Date().toISOString();
  const empty: ComputedDailyScore = {
    log_date: logDate,
    recovery_score: null,
    readiness_score: null,
    recovery_status: 'insufficient_data',
    calibrating: true,
    sleep_missing: false,
    hrv_missing: false,
    recommended_max_strain: null,
    hrv_baseline_rmssd: null,
    hrv_7d_avg_rmssd: null,
    hrv_14d_avg_rmssd: null,
    hrv_swc: null,
    hrv_z_score: null,
    ln_rmssd: null,
    ln_rmssd_14d_mean: null,
    ln_rmssd_14d_sd: null,
    cv_lnrmssd_7d_pct: null,
    dynamic_rmssd_cap_ms: null,
    rhr_baseline: null,
    rhr_7d_avg: null,
    rhr_z_score: null,
    sleep_hours_vs_needed_pct: null,
    sleep_regularity_pct: null,
    high_sleep_stress_pct: null,
    sleep_architecture_score: null,
    sleep_debt_h: null,
    dynamic_sleep_need_h: null,
    optimal_bedtime_start: null,
    optimal_bedtime_end: null,
    cumulative_sleep_debt_hours: null,
    strain_score: null,
    training_load_7d: null,
    acwr: null,
    acwr_penalty_strain: null,
    cardio_trimp_load: null,
    neuromuscular_load: null,
    shift_orthostatic_load: null,
    z13_minutes: 0,
    z45_minutes: 0,
    hr_zones_minutes: {},
    steps_net: 0,
    time_in_bed_min: null,
    total_sleep_min: null,
    deep_sleep_min: null,
    rem_sleep_min: null,
    light_sleep_min: null,
    sleep_efficiency_pct: null,
    sleep_onset_latency_min: null,
    nap_sleep_min: null,
    rmssd_ms: null,
    rmssd_14d_mean_ms: null,
    rhr_bpm: null,
    rhr_14d_mean_bpm: null,
    resp_rate_brpm: null,
    resp_14d_mean_brpm: null,
    spo2_pct: null,
    target_kcal: null,
    intake_kcal: null,
    intake_protein_g: null,
    intake_carbs_g: null,
    intake_fat_g: null,
    tef_kcal: null,
    empirical_tdee_kcal: null,
    dynamic_tdee_kcal: null,
    target_protein_g: null,
    target_carbs_g: null,
    target_fat_g: null,
    hydration_score: null,
    trend_weight_kg: null,
    trend_body_fat_pct: null,
    ffm_kg: null,
    ffm_pct: null,
    muscle_mass_kg: null,
    bone_mass_kg: null,
    skeletal_muscle_pct: null,
    visceral_fat_index: null,
    tmb_kcal: null,
    body_water_pct: null,
    water_mass_kg: null,
    bmi: null,
    fat_mass_kg: null,
    body_comp_score: null,
    chronological_age: null,
    argon_physiological_age: null,
    pace_of_aging_x: null,
    total_age_delta: null,
    vo2_max_ml_kg_min: null,
    delta_cardio_years: null,
    delta_metabolic_years: null,
    delta_inflammatory_years: null,
    delta_autonomic_years: null,
    delta_sleep_years: null,
    delta_act_years: null,
    clinical_coach_notes: null,
    computed_at: now,
    computation_version: COMPUTATION_VERSION,
    engine_version: ENGINE_VERSION,
    created_at: now,
    updated_at: now,
  };
  return empty;
}