/**
 * ARGON v7.0 — Engine Public API
 * Main entry point for the MBE computation engine.
 */

// Types
export type {
  UserProfile,
  RawBiometricDay,
  HistoryDay,
  PrevComputed,
  EngineConfig,
  ComputedDailyScore,
  ComputeEngineInput,
  ComputeEngineFn,
} from './types';

export { ARGON_ENGINE_COLS } from './types';

// Utils
export {
  mean,
  median,
  sd,
  clamp,
  ewma,
  zScore,
  trimpBanister,
  trimpFromZones,
  strainFromNetTrimp,
  computeSleepDebt,
  dynamicSleepNeed,
  bedtimeWindow,
  hrMaxTanaka,
  vo2MaxFromHR,
  fatMassKg,
  ffmKg,
  muscleMassKg,
  boneMassKg,
  waterMassKg,
  bmi,
  visceralFatIndex,
  tdeeKatchMcArdle,
  recoveryFromPillars,
  deltaVO2,
  deltaRHR,
  deltaLnRMSSD,
  deltaFFM,
  deltaSleep,
  deltaActivity,
  paceOfAging,
  acwr,
  acwrPenalty,
  highSleepStress,
  ZONE_MIDPOINTS,
} from './utils';

export type { TrimpCoefficients, SleepDebtConfig } from './utils';

// Pillars
export {
  computeHRVPillar,
  computeRHRPillar,
  computeSleepPillar,
  computeRecoveryScore,
  computeRecoveryPillar,
} from './pillars/recovery';

export {
  computeHRZones,
  computeCardioTrimp,
  computeNeuroLoad,
  computeShiftLoad,
  computeACWR,
  computeStrainPillar,
} from './pillars/strain';

export {
  parseHypnogram,
  detectNaps,
  computeSleepArchitectureScore,
  computeSleepRegularity,
  computeSleepPillarExtended,
} from './pillars/sleep';

export {
  getLatestBodyComp,
  computeBodyCompTrends,
  computeBodyCompMetrics,
  computeBodyCompPillar,
} from './pillars/body-comp';

export {
  estimateVO2Max,
  computeLongevityMetrics,
  computeLongevityPillar,
} from './pillars/longevity';

export {
  computeTEF,
  computeEmpiricalTDEE,
  computeMacroTargets,
  computeHydrationScore,
  computeNutritionPillar,
} from './pillars/nutrition';

// Main Engine
export {
  computeEngine,
  validateComputedOutput,
  createEmptyComputed,
} from './compute-engine';

export { ENGINE_VERSION, COMPUTATION_VERSION } from './compute-engine';

// Default Engine Config
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  minBaselineDays: 7,
  basalSleepNeedH: 7.5,
  hrvSWCMultiplier: 0.5,
  hrvDeadZoneSD: 1.0,
  rhrPenaltyThreshold: 20,
  spo2PenaltyThreshold: 94,
  acwrAcuteDays: 3,
  acwrChronicDays: 14,
  acwrThreshold: 1.3,
  ewmaAlphaWeight: 0.25,
  ewmaAlphaBodyFat: 0.25,
  maxHrvCapPercentile: 3,
  trimpCoeffMale: { a: 0.64, b: 1.92 },
  trimpCoeffFemale: { a: 0.86, b: 1.67 },
  strainSigmoidScale: 0.00165,
  strainMax: 21,
  neuroLoadFactor: 0.85,
  shiftLoadFactor: 1.40,
  shiftLoadMET: 35,
  sleepArchWeights: { duration: 0.50, regularity: 0.25, efficiency: 0.15, architecture: 0.10 },
  recoveryWeights: { hrv: 0.40, rhr: 0.20, sleep: 0.40 },
  recoveryPenalty: { spo2: 10, respRate: 5 },
  minValidSleepMin: 120,
  minValidNapMin: 10,
  maxNapMin: 240,
  napStartHour: 8,
  napEndHour: 20,
};

// Need to import EngineConfig for DEFAULT_ENGINE_CONFIG
import type { EngineConfig } from './types';