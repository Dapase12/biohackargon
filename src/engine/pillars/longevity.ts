/**
 * ARGON v7.0 — Longevity Pillar
 * Physiological age, pace of aging, VO2max estimation, deltas.
 * Based on: Levine 2018 (PhenoAge), Jylhävä 2017, Katch-McArdle, Tanaka 2001.
 * Pure functions, no side effects.
 */

import type {
  RawBiometricDay,
  HistoryDay,
  UserProfile,
  EngineConfig,
  ComputedDailyScore,
} from '@/engine/types';
import {
  mean,
  clamp,
  vo2MaxFromHR,
  deltaVO2,
  deltaRHR,
  deltaLnRMSSD,
  deltaFFM,
  deltaSleep,
  deltaActivity,
  paceOfAging,
} from '@/engine/utils';

interface LongevityInputs {
  chronologicalAge: number;
  vo2Max: number | null;
  rhr: number | null;
  lnRmssd: number | null;
  ffmPct: number | null;
  sleepRegularityPct: number | null;
  tstH: number | null;
  avgSteps7d: number | null;
  workoutMin: number;
}

/**
 * Estimate VO2max from HRmax/RHR (ratio method)
 * VO2max = 15.3 * (HRmax / RHR) — Astrand-Ryhming / Nes et al.
 */
export function estimateVO2Max(hrMax: number, rhr: number | null): number | null {
  if (!rhr || rhr <= 0) return null;
  return vo2MaxFromHR(hrMax, rhr);
}

/**
 * Compute all longevity deltas and physiological age
 */
export function computeLongevityMetrics(
  inputs: LongevityInputs
): Partial<ComputedDailyScore> {
  const {
    chronologicalAge,
    vo2Max,
    rhr,
    lnRmssd,
    ffmPct,
    sleepRegularityPct,
    tstH,
    avgSteps7d,
    workoutMin,
  } = inputs;

  // Individual deltas (years)
  const deltaCardio = vo2Max ? deltaVO2(vo2Max) : 0;
  const deltaMetabolic = rhr ? deltaRHR(rhr) : 0;
  const deltaInflammatory = lnRmssd ? deltaLnRMSSD(lnRmssd) : 0;
  const deltaAutonomic = ffmPct ? deltaFFM(ffmPct) : 0;
  const deltaSleepYears = (sleepRegularityPct !== null && tstH !== null)
    ? deltaSleep(sleepRegularityPct, tstH)
    : 0;
  const deltaActivityYears = (avgSteps7d !== null)
    ? deltaActivity(avgSteps7d, workoutMin)
    : 0;

  // Total age delta (sum of all components)
  const totalAgeDelta = deltaCardio + deltaMetabolic + deltaInflammatory +
    deltaAutonomic + deltaSleepYears + deltaActivityYears;

  // Physiological age = chronological + total delta
  const physiologicalAge = chronologicalAge + totalAgeDelta;

  // Pace of aging (DunedinPACE-inspired): 1.0 = normal aging
  const pace = paceOfAging(totalAgeDelta);

  return {
    chronological_age: chronologicalAge,
    argon_physiological_age: +physiologicalAge.toFixed(1),
    total_age_delta: +totalAgeDelta.toFixed(2),
    pace_of_aging_x: +pace.toFixed(2),
    vo2_max_ml_kg_min: vo2Max ? +vo2Max.toFixed(1) : null,
    delta_cardio_years: +deltaCardio.toFixed(2),
    delta_metabolic_years: +deltaMetabolic.toFixed(2),
    delta_inflammatory_years: +deltaInflammatory.toFixed(2),
    delta_autonomic_years: +deltaAutonomic.toFixed(2),
    delta_sleep_years: +deltaSleepYears.toFixed(2),
    delta_act_years: +deltaActivityYears.toFixed(2),
  };
}

/**
 * Main longevity pillar orchestrator
 */
export function computeLongevityPillar(
  todayRaw: RawBiometricDay,
  history: HistoryDay[],
  profile: UserProfile,
  config: EngineConfig,
  recoveryData: {
    ln_rmssd: number | null;
    rhr_bpm: number | null;
    rhr_14d_mean_bpm: number | null;
  },
  bodyCompData: {
    ffm_pct: number | null;
    trend_weight_kg: number | null;
  },
  sleepData: {
    sleep_regularity_pct: number | null;
    total_sleep_min: number | null;
  },
  strainData: {
    strain_score: number | null;
    training_load_7d: number | null;
  }
): Partial<ComputedDailyScore> {
  // Chronological age
  const birthDate = new Date(profile.birth);
  const today = new Date();
  const chronologicalAge = today.getFullYear() - birthDate.getFullYear() -
    (today.getMonth() < birthDate.getMonth() ||
      (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
      ? 1 : 0);

  // HRmax for VO2max estimation
  const hrMax = 208 - 0.7 * chronologicalAge; // Tanaka formula

  // VO2max estimation
  const vo2Max = estimateVO2Max(hrMax, recoveryData.rhr_14d_mean_bpm ?? recoveryData.rhr_bpm);

  // 7-day average steps
  const recentSteps = history.slice(0, 7)
    .filter(h => h.steps && h.steps > 0)
    .map(h => h.steps!);
  const avgSteps7d = recentSteps.length > 0 ? mean(recentSteps) : null;

  // Workout minutes today
  const workoutMin = todayRaw.pickleball_or_gym_minutes ?? 0;

  const inputs: LongevityInputs = {
    chronologicalAge,
    vo2Max,
    rhr: recoveryData.rhr_14d_mean_bpm ?? recoveryData.rhr_bpm,
    lnRmssd: recoveryData.ln_rmssd,
    ffmPct: bodyCompData.ffm_pct,
    sleepRegularityPct: sleepData.sleep_regularity_pct,
    tstH: sleepData.total_sleep_min ? sleepData.total_sleep_min / 60 : null,
    avgSteps7d,
    workoutMin,
  };

  return computeLongevityMetrics(inputs);
}