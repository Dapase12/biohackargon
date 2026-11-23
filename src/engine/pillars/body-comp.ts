/**
 * ARGON v7.0 — Body Composition Pillar
 * EWMA trends, fat/FFM/muscle/bone/water, visceral fat index, BMI, TDEE (Katch-McArdle).
 * Pure functions, no side effects.
 */

import type {
  RawBiometricDay,
  HistoryDay,
  PrevComputed,
  UserProfile,
  EngineConfig,
  ComputedDailyScore,
} from '@/engine/types';
import {
  ewma,
  clamp,
  fatMassKg,
  ffmKg,
  muscleMassKg,
  boneMassKg,
  waterMassKg,
  bmi,
  visceralFatIndex,
  tdeeKatchMcArdle,
} from '@/engine/utils';

interface BodyCompInput {
  weightKg: number | null;
  bodyFatPct: number | null;
  hydrationMl: number | null;
}

interface BodyCompTrends {
  trendWeightKg: number | null;
  trendBodyFatPct: number | null;
  trendMuscleKg: number | null;
}

/**
 * Extract latest valid body comp measurement from today or history
 */
export function getLatestBodyComp(todayRaw: RawBiometricDay, history: HistoryDay[]): BodyCompInput {
  // Priority: today's data > most recent history
  if (todayRaw.weight_kg && todayRaw.body_fat_pct) {
    return {
      weightKg: todayRaw.weight_kg,
      bodyFatPct: todayRaw.body_fat_pct,
      hydrationMl: todayRaw.hydration_ml ?? null,
    };
  }

  for (const h of history) {
    if (h.weight_kg && h.body_fat_pct) {
      return {
        weightKg: h.weight_kg,
        bodyFatPct: h.body_fat_pct,
        hydrationMl: h.hydration_ml ?? null,
      };
    }
  }

  return { weightKg: null, bodyFatPct: null, hydrationMl: null };
}

/**
 * Compute EWMA trends for weight and body fat
 * alpha = 0.25 (config.ewmaAlphaWeight / ewmaAlphaBodyFat)
 */
export function computeBodyCompTrends(
  history: HistoryDay[],
  prevComputed: PrevComputed | null,
  config: EngineConfig
): BodyCompTrends {
  // Weight trend
  const weightHistory = history
    .filter(h => h.weight_kg && h.weight_kg > 0)
    .map(h => h.weight_kg!);

  let trendWeightKg: number | null = null;
  if (weightHistory.length > 0) {
    // Use EWMA if we have history, otherwise use previous computed
    if (prevComputed?.trend_weight_kg) {
      const alpha = config.ewmaAlphaWeight;
      trendWeightKg = alpha * weightHistory[0] + (1 - alpha) * prevComputed.trend_weight_kg;
    } else {
      trendWeightKg = ewma(weightHistory.reverse(), config.ewmaAlphaWeight); // oldest first
    }
  } else if (prevComputed?.trend_weight_kg) {
    trendWeightKg = prevComputed.trend_weight_kg;
  }

  // Body fat trend
  const bfHistory = history
    .filter(h => h.body_fat_pct && h.body_fat_pct > 0)
    .map(h => h.body_fat_pct!);

  let trendBodyFatPct: number | null = null;
  if (bfHistory.length > 0) {
    if (prevComputed?.trend_body_fat_pct) {
      const alpha = config.ewmaAlphaBodyFat;
      trendBodyFatPct = alpha * bfHistory[0] + (1 - alpha) * prevComputed.trend_body_fat_pct;
    } else {
      trendBodyFatPct = ewma(bfHistory.reverse(), config.ewmaAlphaBodyFat);
    }
  } else if (prevComputed?.trend_body_fat_pct) {
    trendBodyFatPct = prevComputed.trend_body_fat_pct;
  }

  // Muscle mass trend (derived from weight and BF%)
  let trendMuscleKg: number | null = null;
  if (trendWeightKg && trendBodyFatPct) {
    const trendFfm = ffmKg(trendWeightKg, trendBodyFatPct);
    trendMuscleKg = muscleMassKg(trendFfm);
  }

  return {
    trendWeightKg: trendWeightKg ? +trendWeightKg.toFixed(2) : null,
    trendBodyFatPct: trendBodyFatPct ? +trendBodyFatPct.toFixed(1) : null,
    trendMuscleKg: trendMuscleKg ? +trendMuscleKg.toFixed(1) : null,
  };
}

/**
 * Compute all body composition metrics from latest measurement
 * Preserves raw skeletal_muscle_pct and body_water_pct when available (matching Code.txt)
 */
export function computeBodyCompMetrics(
  input: BodyCompInput,
  profile: UserProfile,
  trends: BodyCompTrends,
  todayRaw: RawBiometricDay // for hydration fallback and raw body comp fields
): Partial<ComputedDailyScore> {
  const { weightKg, bodyFatPct, hydrationMl } = input;

  if (!weightKg || !bodyFatPct || weightKg <= 0 || bodyFatPct <= 0) {
    return {
      weight_kg: weightKg,
      body_fat_pct: bodyFatPct,
      trend_weight_kg: trends.trendWeightKg,
      trend_body_fat_pct: trends.trendBodyFatPct,
      fat_mass_kg: null,
      ffm_kg: null,
      ffm_pct: null,
      muscle_mass_kg: null,
      bone_mass_kg: null,
      skeletal_muscle_pct: todayRaw.skeletal_muscle_pct ?? null, // Preserve raw if available
      visceral_fat_index: null,
      tmb_kcal: null,
      body_water_pct: todayRaw.body_water_pct ?? null, // Preserve raw if available
      water_mass_kg: todayRaw.water_mass_kg ?? null, // Preserve raw if available
      bmi: null,
      body_comp_score: null,
    };
  }

  // Core calculations
  const fatMass = fatMassKg(weightKg, bodyFatPct);
  const ffm = ffmKg(weightKg, bodyFatPct);
  const ffmPct = +((ffm / weightKg) * 100).toFixed(1);
  const muscleMass = muscleMassKg(ffm);
  const boneMass = boneMassKg(weightKg);

  // FIX: Preserve raw skeletal_muscle_pct when available (Code.txt uses raw value 48.9, not calculated)
  // Only calculate if raw not available
  const skeletalMusclePct = todayRaw.skeletal_muscle_pct !== undefined && todayRaw.skeletal_muscle_pct !== null
    ? todayRaw.skeletal_muscle_pct
    : +((muscleMass / weightKg) * 100).toFixed(1);

  const visceralFat = visceralFatIndex(bodyFatPct);
  const bmiVal = bmi(weightKg, profile.height_m);
  const tmb = tdeeKatchMcArdle(ffm);

  // Hydration - preserve raw body_water_pct when available
  let bodyWaterPct: number | null = todayRaw.body_water_pct ?? null;
  let waterMass: number | null = todayRaw.water_mass_kg ?? null;

  // If raw not available, calculate from hydration_ml
  if (bodyWaterPct === null) {
    const hydrationMlFinal = hydrationMl ?? todayRaw.hydration_ml ?? null;
    if (hydrationMlFinal && hydrationMlFinal > 0) {
      bodyWaterPct = +((hydrationMlFinal / 1000 / weightKg) * 100).toFixed(1);
    }
  }

  // Calculate water_mass_kg using weight (trend or current) and body_water_pct
  // Use trend_weight_kg as carry-forward weight if available, else current weight
  const weightForWater = trends.trendWeightKg ?? weightKg;
  if (waterMass === null && bodyWaterPct !== null && weightForWater > 0) {
    waterMass = waterMassKg(weightForWater, bodyWaterPct);
  }

  // Body composition score (0-100): based on FFM%, visceral fat, BF%
  // Higher FFM% = better, lower visceral = better, BF% in healthy range = better
  let bodyCompScore: number | null = null;
  if (ffmPct && visceralFat !== null && bodyFatPct) {
    // FFM% score: 79% reference (from longevity delta)
    const ffmScore = clamp(100 - Math.abs(ffmPct - 79) * 2, 0, 100);
    // Visceral fat score: 1-12 scale, lower better
    const visceralScore = clamp(100 - (visceralFat - 1) * 8, 0, 100);
    // BF% score: healthy range 10-25% male, 18-32% female
    const bfTarget = profile.biologicalSex === 'male' ? 15 : 24;
    const bfScore = clamp(100 - Math.abs(bodyFatPct - bfTarget) * 3, 0, 100);

    bodyCompScore = Math.round(ffmScore * 0.4 + visceralScore * 0.3 + bfScore * 0.3);
  }

  return {
    weight_kg: weightKg,
    body_fat_pct: bodyFatPct,
    trend_weight_kg: trends.trendWeightKg,
    trend_body_fat_pct: trends.trendBodyFatPct,
    fat_mass_kg: fatMass,
    ffm_kg: ffm,
    ffm_pct: ffmPct,
    muscle_mass_kg: muscleMass,
    bone_mass_kg: boneMass,
    skeletal_muscle_pct: skeletalMusclePct,
    visceral_fat_index: visceralFat,
    tmb_kcal: tmb,
    body_water_pct: bodyWaterPct,
    water_mass_kg: waterMass,
    bmi: bmiVal,
    body_comp_score: bodyCompScore,
  };
}

/**
 * Main body composition pillar orchestrator
 */
export function computeBodyCompPillar(
  todayRaw: RawBiometricDay,
  history: HistoryDay[],
  prevComputed: PrevComputed | null,
  profile: UserProfile,
  config: EngineConfig
): Partial<ComputedDailyScore> {
  const latestInput = getLatestBodyComp(todayRaw, history);
  const trends = computeBodyCompTrends(history, prevComputed, config);
  const metrics = computeBodyCompMetrics(latestInput, profile, trends, todayRaw);

  return metrics;
}