/**
 * ARGON v7.0 — Strain Pillar
 * 4D Strain: Cardio TRIMP + Neuro load + Shift load + ACWR
 * Pure functions, no side effects.
 */

import type {
  RawBiometricDay,
  HistoryDay,
  EngineConfig,
  ComputedDailyScore,
} from '@/engine/types';
import {
  trimpBanister,
  trimpFromZones,
  strainFromNetTrimp,
  acwr,
  acwrPenalty,
  hrMaxTanaka,
  clamp,
} from '@/engine/utils';

interface HRZonesInput {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
  real: boolean;
}

interface WorkoutInput {
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
}

/**
 * Compute HR zones from ghealth data (exercise + minute HR)
 * Priority: real HR zones from exercise HR > RPE-based estimation > ambient steps
 */
export function computeHRZones(
  todayRaw: RawBiometricDay,
  profile: { biologicalSex: 'male' | 'female'; birth: string },
  config: EngineConfig
): { zones: HRZonesInput; stepsNet: number; z13Min: number; z45Min: number } {
  const age = new Date().getFullYear() - new Date(profile.birth).getFullYear();
  const hrMax = hrMaxTanaka(age);
  const coeff = profile.biologicalSex === 'male' ? config.trimpCoeffMale : config.trimpCoeffFemale;

  // Check for real HR zones from ghealth exercise minute HR
  const hrZonesData = todayRaw.hr_zones_minutes;
  const workouts = hrZonesData?.workouts ?? [];
  const zonesReal = hrZonesData?.real === true;

  let zones: HRZonesInput = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, real: false };
  let stepsNet = 0;

  if (zonesReal && hrZonesData) {
    // Use real HR zones from exercise HR data - support both formats (z1_minutes and z1)
    zones = {
      z1: (hrZonesData.z1 ?? hrZonesData.z1_minutes ?? 0),
      z2: (hrZonesData.z2 ?? hrZonesData.z2_minutes ?? 0),
      z3: (hrZonesData.z3 ?? hrZonesData.z3_minutes ?? 0),
      z4: (hrZonesData.z4 ?? hrZonesData.z4_minutes ?? 0),
      z5: (hrZonesData.z5 ?? hrZonesData.z5_minutes ?? 0),
      real: true,
    };
    stepsNet = Math.max(0, (todayRaw.steps ?? 0) - (hrZonesData.walking_steps ?? 2000));
  } else if (workouts.length > 0) {
    // Estimate zones from workouts using RPE (sRPE)
    const totalWorkoutMin = workouts.reduce((sum: number, w: WorkoutInput) => sum + w.min, 0);
    const avgRPE = workouts.reduce((sum: number, w: WorkoutInput) => sum + (w.rpe ?? 0), 0) / workouts.length;

    // RPE factor: 1-10 scale mapped to 0-1
    const rpeFactor = clamp((avgRPE - 1) / 9, 0, 1);

    // Base distribution (Code.txt lines 1334-1365)
    const baseZ1 = Math.round(totalWorkoutMin * 0.22);
    const baseZ2 = Math.round(totalWorkoutMin * 0.33);
    const baseZ3 = Math.round(totalWorkoutMin * 0.20);
    const baseZ4 = Math.round(totalWorkoutMin * 0.17);
    const baseZ5 = Math.round(totalWorkoutMin * 0.08);

    // Shift from Z1/Z2 to higher zones based on RPE
    const shiftAmount = Math.round((baseZ1 + baseZ2) * rpeFactor * 0.5);
    const totalHigh = baseZ3 + baseZ4 + baseZ5;

    let shiftZ3 = 0, shiftZ4 = 0, shiftZ5 = 0;
    if (totalHigh > 0) {
      shiftZ3 = Math.round(shiftAmount * (baseZ3 / totalHigh));
      shiftZ4 = Math.round(shiftAmount * (baseZ4 / totalHigh));
      shiftZ5 = Math.round(shiftAmount * (baseZ5 / totalHigh));
    } else {
      shiftZ3 = Math.round(shiftAmount * 0.5);
      shiftZ4 = Math.round(shiftAmount * 0.3);
      shiftZ5 = Math.round(shiftAmount * 0.2);
    }

    zones = {
      z1: Math.max(0, baseZ1 - Math.round(baseZ1 * rpeFactor * 0.5)),
      z2: Math.max(0, baseZ2 - Math.round(baseZ2 * rpeFactor * 0.5)),
      z3: baseZ3 + shiftZ3,
      z4: baseZ4 + shiftZ4,
      z5: baseZ5 + shiftZ5,
      real: false,
    };

    stepsNet = Math.max(0, (todayRaw.steps ?? 0) - 2000);
  } else {
    // No workouts: ambient activity only
    const steps = todayRaw.steps ?? 0;
    const walkingSteps = 2000;
    stepsNet = Math.max(0, steps - walkingSteps);

    // Ambient Z1 from steps (Code.txt: (stepsNet - 2000) / 320)
    const ambientZ1 = Math.round(Math.max(0, stepsNet - 2000) / 320);

    zones = {
      z1: ambientZ1,
      z2: 0,
      z3: 0,
      z4: 0,
      z5: 0,
      real: false,
    };
  }

  // Add ambient Z1 from steps to existing Z1
  if (!zonesReal) {
    const ambientZ1 = Math.round(Math.max(0, stepsNet - 2000) / 320);
    zones.z1 += ambientZ1;
  }

  const z13Min = zones.z1 + zones.z2 + zones.z3;
  const z45Min = zones.z4 + zones.z5;

  return { zones, stepsNet, z13Min, z45Min };
}

/**
 * Compute cardio TRIMP load from HR zones
 */
export function computeCardioTrimp(
  zones: HRZonesInput,
  hrMax: number,
  coeff: { a: number; b: number }
): number {
  return trimpFromZones({
    z1: zones.z1,
    z2: zones.z2,
    z3: zones.z3,
    z4: zones.z4,
    z5: zones.z5,
  }, hrMax, coeff);
}

/**
 * Compute neuromuscular load (sRPE * workoutMin * factor)
 * Returns 0 (not null) when no workouts - matching Code.txt behavior
 * Handles undefined min/rpe to prevent NaN cascade
 */
export function computeNeuroLoad(
  todayRaw: RawBiometricDay,
  config: EngineConfig
): number {
  const workouts = todayRaw.hr_zones_minutes?.workouts ?? [];
  if (workouts.length === 0) return 0;

  let totalNeuroLoad = 0;
  for (const w of workouts) {
    const rpe = w.rpe ?? todayRaw.session_rpe ?? 5;
    const min = w.min ?? 0; // FIX: default to 0 to prevent NaN when min is undefined
    if (min > 0 && rpe > 0) {
      totalNeuroLoad += config.neuroLoadFactor * rpe * min;
    }
  }
  return totalNeuroLoad;
}

/**
 * Compute shift/orthostatic load
 */
export function computeShiftLoad(
  todayRaw: RawBiometricDay,
  config: EngineConfig
): number {
  if (!todayRaw.is_hospital_shift) return 0;
  const nightAwakeH = todayRaw.night_awake_shift_hours ?? 0;
  return config.shiftLoadFactor * nightAwakeH * config.shiftLoadMET;
}

/**
 * Compute ACWR from strain history
 */
export function computeACWR(
  history: HistoryDay[],
  config: EngineConfig
): { acwr: number; acwrPenalty: number; trainingLoad7d: number } {
  const validStrainHistory = history
    .filter(h => h.strain_score !== null && h.strain_score !== undefined)
    .slice(0, config.acwrChronicDays);

  if (validStrainHistory.length < config.acwrChronicDays) {
    return { acwr: 0, acwrPenalty: 0, trainingLoad7d: 0 };
  }

  const acute = validStrainHistory.slice(0, config.acwrAcuteDays);
  const chronic = validStrainHistory.slice(0, config.acwrChronicDays);

  const acuteAvg = acute.reduce((s, h) => s + (h.strain_score ?? 0), 0) / acute.length;
  const chronicAvg = chronic.reduce((s, h) => s + (h.strain_score ?? 0), 0) / chronic.length;

  const acwrRatio = acwr(acuteAvg, chronicAvg);
  const penalty = acwrPenalty(acwrRatio, config.acwrThreshold);

  // 7-day training load (sum of strain)
  const trainingLoad7d = validStrainHistory.slice(0, 7)
    .reduce((s, h) => s + (h.strain_score ?? 0), 0);

  return { acwr: acwrRatio, acwrPenalty: penalty, trainingLoad7d };
}

/**
 * Main strain pillar orchestrator
 */
export function computeStrainPillar(
  todayRaw: RawBiometricDay,
  history: HistoryDay[],
  profile: { biologicalSex: 'male' | 'female'; birth: string },
  config: EngineConfig
): Partial<ComputedDailyScore> {
  const age = new Date().getFullYear() - new Date(profile.birth).getFullYear();
  const hrMax = hrMaxTanaka(age);
  const coeff = profile.biologicalSex === 'male' ? config.trimpCoeffMale : config.trimpCoeffFemale;

  // 1. Compute HR zones
  const { zones, stepsNet, z13Min, z45Min } = computeHRZones(todayRaw, profile, config);

  // 2. Cardio TRIMP
  const cardioTrimp = computeCardioTrimp(zones, hrMax, coeff);

  // 3. Neuro load
  const neuroLoad = computeNeuroLoad(todayRaw, config);

  // 4. Shift load
  const shiftLoad = computeShiftLoad(todayRaw, config);

  // 5. Total load & strain
  const totalLoad = cardioTrimp + neuroLoad + shiftLoad;
  const strainScore = strainFromNetTrimp(
    totalLoad,
    config.strainSigmoidScale,
    config.strainMax
  );

  // 6. ACWR
  const { acwr: acwrRatio, acwrPenalty: acwrPenaltyVal, trainingLoad7d } = computeACWR(history, config);

  return {
    strain_score: strainScore,
    training_load_7d: trainingLoad7d,
    acwr: acwrRatio,
    acwr_penalty_strain: acwrPenaltyVal,
    cardio_trimp_load: cardioTrimp,
    neuromuscular_load: neuroLoad,
    shift_orthostatic_load: shiftLoad,
    z13_minutes: z13Min,
    z45_minutes: z45Min,
    hr_zones_minutes: { ...zones, real: zones.real },
    steps_net: stepsNet,
    steps_count: todayRaw.steps ?? 0,
    pickleball_or_gym_minutes: todayRaw.pickleball_or_gym_minutes ?? 0,
    session_rpe: todayRaw.session_rpe ?? null,
    is_hospital_shift: todayRaw.is_hospital_shift ?? false,
    night_awake_shift_hours: todayRaw.night_awake_shift_hours ?? 0,
  };
}