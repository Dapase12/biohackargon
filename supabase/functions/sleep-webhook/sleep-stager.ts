/**
 * Sleep staging module - main exports.
 * Re-exports all sleep staging functionality from modular files.
 */

// Constants
export {
  DEFAULT_EPOCH_SEC,
  VAN_HEES_MIN_WINDOW_MIN,
  VAN_HEES_MERGE_GAP_MIN,
  Z_ANGLE_STILL_DEG,
  STILL_CUT_G,
  MOVE_CUT_G,
  ROBUST_Z_CLIP,
  WEIGHT_IMMOBILE,
  WEIGHT_HR,
  WEIGHT_HRV,
  WEIGHT_RK,
  MIN_VALID_HR_FRAC,
  MIN_VALID_RR_FRAC,
  LF_BAND,
  HF_BAND,
  RMSSD_WINDOW_S,
  LFHF_FREQS,
} from './constants.ts';

// Helpers
export {
  enmoFromAccel,
  epochBounds,
  filterSamplesInEpoch,
  rollingMedian,
} from './helpers.ts';

// Z-angle
export { computeZAngle } from './z-angle.ts';

// Immobility
export { computeImmobilityMask } from './immobility.ts';

// Van Hees sleep window detection
export { vanHeesSleepWindow } from './van-hees.ts';

// HRV features
export {
  computeRmssd,
  computeLfhf,
  computeRk,
} from './hrv-features.ts';

// Cardio stager
export { cardioStager } from './cardio-stager.ts';

// Epoch classification
export {
  collectValidFeatures,
  robustZScores,
  computeEpochScores,
  compositeScore,
  hmmSmooth,
  classifyCardioEpochs,
  type EpochScoresInternal,
} from './classify-epochs.ts';

// Main entry point
export { segmentSleep } from './segment-sleep.ts';

// Observation extraction
export { extractNightlyObservation } from './observation.ts';

// High-level API
export { stageSleep } from './stage-sleep.ts';