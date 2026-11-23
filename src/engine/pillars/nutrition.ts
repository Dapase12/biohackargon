/**
 * ARGON v7.0 — Nutrition Pillar
 * TDEE, targets, TEF, hydration, meal logging.
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
  tdeeKatchMcArdle,
} from '@/engine/utils';

interface NutritionInputs {
  tdee: number;
  intakeKcal: number;
  intakeProteinG: number;
  intakeCarbsG: number;
  intakeFatG: number;
  mealsLog: RawBiometricDay['meals_log_json'];
  weightKg: number | null;
  heightM: number;
  biologicalSex: 'male' | 'female';
  dailyDeficitKcal: number;
  bodyFatPct: number | null;
}

/**
 * Compute TEF (Thermic Effect of Food) ~10% of intake
 * Protein: 20-30%, Carbs: 5-10%, Fat: 0-3%
 */
export function computeTEF(
  proteinG: number,
  carbsG: number,
  fatG: number
): number {
  const proteinKcal = proteinG * 4;
  const carbsKcal = carbsG * 4;
  const fatKcal = fatG * 9;

  const tefProtein = proteinKcal * 0.25;
  const tefCarbs = carbsKcal * 0.075;
  const tefFat = fatKcal * 0.015;

  return Math.round(tefProtein + tefCarbs + tefFat);
}

/**
 * Compute dynamic TDEE from empirical data (weight trend + intake)
 * If weight stable: TDEE ≈ intake - deficit
 * If weight changing: adjust based on 7700 kcal/kg
 * Returns null if insufficient data or intake is 0 (no intake data)
 */
export function computeEmpiricalTDEE(
  history: HistoryDay[],
  profile: UserProfile,
  currentIntakeKcal: number
): number | null {
  // Need at least some intake data for empirical TDEE to be meaningful
  if (!currentIntakeKcal || currentIntakeKcal <= 0) return null;

  const weightHistory = history
    .filter(h => h.weight_kg && h.weight_kg > 0)
    .slice(0, 14)
    .map(h => h.weight_kg!);

  if (weightHistory.length < 7) return null;

  // Weight change per day (kg/day)
  const weightChangePerDay = (weightHistory[0] - weightHistory[weightHistory.length - 1]) / weightHistory.length;

  // 1 kg fat ≈ 7700 kcal
  const kcalImbalancePerDay = weightChangePerDay * 7700;

  // Empirical TDEE = intake + imbalance
  const empiricalTdee = Math.round(currentIntakeKcal + kcalImbalancePerDay);

  // Sanity check: TDEE should be positive and reasonable (800-5000 kcal)
  if (empiricalTdee <= 0 || empiricalTdee > 5000) return null;

  return empiricalTdee;
}

/**
 * Compute macro targets based on TDEE and goals
 * Protein: 1.6-2.2g/kg (higher for deficit)
 * Fat: 25-30% of calories
 * Carbs: remainder
 * Guards against negative TDEE/targetKcal
 */
export function computeMacroTargets(
  tdee: number,
  profile: UserProfile,
  bodyFatPct: number | null,
  weightKg: number | null
): { proteinG: number; carbsG: number; fatG: number } {
  // Guard: TDEE must be positive and reasonable
  const safeTdee = Math.max(tdee, 1200);
  const targetKcal = Math.max(safeTdee - profile.dailyDeficitKcal, 1200);

  // Protein target: 1.8-2.2g/kg LBM or total weight
  // Use FFM if available, else total weight * 0.8
  const proteinPerKg = profile.dailyDeficitKcal > 300 ? 2.2 : 1.8;
  const refWeight = weightKg ?? 70;
  const proteinG = Math.round(refWeight * proteinPerKg);

  // Fat target: 25-30% of target calories
  const fatPct = 0.28;
  const fatKcal = targetKcal * fatPct;
  const fatG = Math.max(0, Math.round(fatKcal / 9));

  // Carbs: remainder
  const proteinKcal = proteinG * 4;
  const carbsKcal = targetKcal - proteinKcal - fatKcal;
  const carbsG = Math.max(0, Math.round(carbsKcal / 4));

  return { proteinG, carbsG, fatG };
}

/**
 * Compute hydration score (0-100)
 * Target: 35 ml/kg body weight
 */
export function computeHydrationScore(
  hydrationMl: number | null,
  weightKg: number | null
): number | null {
  if (!hydrationMl || !weightKg || weightKg <= 0) return null;

  const targetMl = weightKg * 35;
  const score = Math.min(100, Math.round((hydrationMl / targetMl) * 100));
  return clamp(score, 0, 100);
}

/**
 * Main nutrition pillar orchestrator
 */
export function computeNutritionPillar(
  todayRaw: RawBiometricDay,
  history: HistoryDay[],
  profile: UserProfile,
  config: EngineConfig,
  bodyCompData: {
    tmb_kcal: number | null;
    weight_kg: number | null;
    body_fat_pct: number | null;
    ffm_kg: number | null;
  },
  strainData: {
    strain_score: number | null;
  }
): Partial<ComputedDailyScore> {
  const intakeKcal = todayRaw.intake_kcal ?? 0;
  const intakeProteinG = todayRaw.intake_protein_g ?? 0;
  const intakeCarbsG = todayRaw.intake_carbs_g ?? 0;
  const intakeFatG = todayRaw.intake_fat_g ?? 0;
  const mealsLog = todayRaw.meals_log_json ?? [];

  // TDEE from Katch-McArdle (using FFM from body comp)
  let tdee = bodyCompData.tmb_kcal ?? 0;
  if (bodyCompData.ffm_kg && bodyCompData.ffm_kg > 0) {
    tdee = tdeeKatchMcArdle(bodyCompData.ffm_kg);
  }

  // Minimum reasonable TDEE (BMR ~1200 for most adults)
  const minTdee = 1200;
  tdee = Math.max(tdee, minTdee);

  // Empirical TDEE from weight trend
  const empiricalTdee = computeEmpiricalTDEE(history, profile, intakeKcal);

  // Use empirical if available and valid, else Katch-McArdle
  const finalTdee = (empiricalTdee !== null && empiricalTdee > minTdee) ? empiricalTdee : tdee;

  // Target calories (guarded in computeMacroTargets as well)
  const targetKcal = Math.round(finalTdee - profile.dailyDeficitKcal);

  // TEF
  const tefKcal = computeTEF(intakeProteinG, intakeCarbsG, intakeFatG);

  // Macro targets
  const { proteinG: targetProteinG, carbsG: targetCarbsG, fatG: targetFatG } =
    computeMacroTargets(finalTdee, profile, bodyCompData.body_fat_pct, bodyCompData.weight_kg);

  // Hydration score
  const hydrationScore = computeHydrationScore(todayRaw.hydration_ml, bodyCompData.weight_kg);

  return {
    target_kcal: targetKcal,
    intake_kcal: intakeKcal,
    intake_protein_g: intakeProteinG,
    intake_carbs_g: intakeCarbsG,
    intake_fat_g: intakeFatG,
    tef_kcal: tefKcal,
    empirical_tdee_kcal: empiricalTdee,
    dynamic_tdee_kcal: finalTdee,
    target_protein_g: targetProteinG,
    target_carbs_g: targetCarbsG,
    target_fat_g: targetFatG,
    hydration_score: hydrationScore,
  };
}