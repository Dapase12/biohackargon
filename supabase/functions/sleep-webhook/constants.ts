/**
 * Constants for sleep staging algorithms.
 * Mirrors constants from python/argon_algorithms/sleep_stager.py
 */

export const DEFAULT_EPOCH_SEC = 30;
export const VAN_HEES_MIN_WINDOW_MIN = 30;
export const VAN_HEES_MERGE_GAP_MIN = 30;
export const Z_ANGLE_STILL_DEG = 5.0;
export const STILL_CUT_G = 0.015;
export const MOVE_CUT_G = 0.05;
export const ROBUST_Z_CLIP = 3.0;

export const WEIGHT_IMMOBILE = 0.25;
export const WEIGHT_HR = 0.25;
export const WEIGHT_HRV = 0.25;
export const WEIGHT_RK = 0.25;

export const MIN_VALID_HR_FRAC = 0.3;
export const MIN_VALID_RR_FRAC = 0.3;

export const LF_BAND: [number, number] = [0.04, 0.15];
export const HF_BAND: [number, number] = [0.15, 0.40];
export const RMSSD_WINDOW_S = 30;

// Coarser frequency grid for LF/HF (25 points instead of 49 for speed)
export { freqGrid } from './numerics.ts';
export const LFHF_FREQS = freqGrid(0.01, 0.51, 25);