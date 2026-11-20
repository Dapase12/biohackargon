/**
 * Epoch classification decision layer for sleep staging.
 * Ported from python/argon_algorithms/sleep_stager.py
 */

import type { CardioEpochFeatures, SleepWindow, SleepUserProfile } from './models.ts';
import {
  WEIGHT_IMMOBILE,
  WEIGHT_HR,
  WEIGHT_HRV,
  WEIGHT_RK,
  MIN_VALID_HR_FRAC,
  MIN_VALID_RR_FRAC,
} from './constants.ts';
import { SleepStage } from './models.ts';
import { median, mad } from './numerics.ts';

/**
 * Interface for epoch scores used in classification.
 */
export interface EpochScoresInternal {
  immobile: number;
  hr: number;
  hrv: number;
  rk: number;
  valid: boolean;
}

/**
 * Collect valid features that meet minimum HR/RR fraction requirements.
 */
export function collectValidFeatures(
  features: CardioEpochFeatures[],
  minHrFrac = MIN_VALID_HR_FRAC,
  minRrFrac = MIN_VALID_RR_FRAC,
): [number[], CardioEpochFeatures[]] {
  const validIdx: number[] = [];
  const validFeat: CardioEpochFeatures[] = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (f.validHrFrac >= minHrFrac && f.validRrFrac >= minRrFrac) {
      validIdx.push(i);
      validFeat.push(f);
    }
  }
  return [validIdx, validFeat];
}

/**
 * Compute robust z-scores with clipping.
 */
export function robustZScores(values: number[], clip = 3.0): number[] {
  if (!values.length) return [];
  const med = median(values)!;
  const madVal = mad(values)!;
  if (madVal === 0) return values.map(() => 0);
  return values.map(v => {
    const z = (v - med) / madVal;
    return Math.max(-clip, Math.min(clip, z));
  });
}

/**
 * Compute epoch scores for classification.
 */
export function computeEpochScores(
  features: CardioEpochFeatures[],
  profile?: SleepUserProfile,
): EpochScoresInternal[] {
  const n = features.length;
  const scores: EpochScoresInternal[] = Array.from({ length: n }, () => ({
    immobile: 0, hr: 0, hrv: 0, rk: 0, valid: false,
  }));

  const [validIdx, validFeat] = collectValidFeatures(features);
  if (!validFeat.length) return scores;

  // Immobile score
  const immobileVals = validFeat.map(f => f.immobileFrac);
  const immobileZ = robustZScores(immobileVals);

  // HR score (lower HR = more sleep-like)
  const hrFeat = validFeat.filter(f => f.hrMedian !== null);
  const hrVals = hrFeat.map(f => f.hrMedian!);
  const hrIdx = validIdx.filter((_, i) => validFeat[i].hrMedian !== null);
  let hrZ: number[];
  if (hrVals.length) {
    hrZ = robustZScores(hrVals).map(z => -z);
  } else {
    hrZ = validIdx.map(() => 0);
  }

  // HRV score (higher RMSSD = more sleep-like)
  const hrvFeat = validFeat.filter(f => f.rmssd !== null);
  const hrvVals = hrvFeat.map(f => f.rmssd!);
  const hrvIdx = validIdx.filter((_, i) => validFeat[i].rmssd !== null);
  let hrvZ: number[];
  if (hrvVals.length) {
    hrvZ = robustZScores(hrvVals);
  } else {
    hrvZ = validIdx.map(() => 0);
  }

  // RK score (lower |ΔIHR| = more sleep-like)
  const rkFeat = validFeat.filter(f => f.rk !== null);
  const rkVals = rkFeat.map(f => f.rk!);
  const rkIdx = validIdx.filter((_, i) => validFeat[i].rk !== null);
  let rkZ: number[];
  if (rkVals.length) {
    rkZ = robustZScores(rkVals).map(z => -z);
  } else {
    rkZ = validIdx.map(() => 0);
  }

  // Assign back
  for (let i = 0; i < validIdx.length; i++) {
    const idx = validIdx[i];
    scores[idx] = {
      ...scores[idx],
      valid: true,
    };
  }
  for (let i = 0; i < hrIdx.length; i++) scores[hrIdx[i]].hr = hrZ[i];
  for (let i = 0; i < hrvIdx.length; i++) scores[hrvIdx[i]].hrv = hrvZ[i];
  for (let i = 0; i < rkIdx.length; i++) scores[rkIdx[i]].rk = rkZ[i];
  for (let i = 0; i < validIdx.length; i++) scores[validIdx[i]].immobile = immobileZ[i];

  return scores;
}

/**
 * Compute composite score from epoch scores.
 */
export function compositeScore(s: EpochScoresInternal): number {
  return WEIGHT_IMMOBILE * s.immobile + WEIGHT_HR * s.hr + WEIGHT_HRV * s.hrv + WEIGHT_RK * s.rk;
}

/**
 * HMM-style smoothing to enforce minimum run lengths.
 */
export function hmmSmooth(
  stages: number[],
  scores: number[],
  minNremRun = 3,
  minRemRun = 2,
): number[] {
  if (!stages.length) return stages;
  const result = [...stages];
  const n = result.length;

  // Enforce minimum NREM run
  let i = 0;
  while (i < n) {
    if (result[i] === 1) {
      const runStart = i;
      while (i < n && result[i] === 1) i++;
      const runLen = i - runStart;
      if (runLen < minNremRun) {
        for (let j = runStart; j < i; j++) result[j] = 0;
      }
    } else {
      i++;
    }
  }

  // Enforce minimum REM run
  i = 0;
  while (i < n) {
    if (result[i] === 2) {
      const runStart = i;
      while (i < n && result[i] === 2) i++;
      const runLen = i - runStart;
      if (runLen < minRemRun) {
        for (let j = runStart; j < i; j++) result[j] = 1;
      }
    } else {
      i++;
    }
  }

  return result;
}

/**
 * Classify epochs into sleep stages (0=Wake, 1=NREM, 2=REM).
 * Returns [stages, deepFlags, confidence].
 */
export function classifyCardioEpochs(
  features: CardioEpochFeatures[],
  sleepWindows: SleepWindow[],
  profile?: SleepUserProfile,
  epochSec = 30,
): [number[], boolean[], number] {
  if (!features.length) return [[], [], 0.0];

  const n = features.length;
  const scoresList = computeEpochScores(features, profile);
  const composite = scoresList.map(compositeScore);

  const stages: number[] = [];
  const deepFlags: boolean[] = [];

  for (let i = 0; i < n; i++) {
    const f = features[i];
    const s = scoresList[i];
    const c = composite[i];

    const inSleepWindow = sleepWindows.some(
      w => w.startS <= f.epochStartS && f.epochStartS < w.endS,
    );

    if (!s.valid || !inSleepWindow) {
      stages.push(SleepStage.WAKE);
      deepFlags.push(false);
      continue;
    }

    if (c > 0.5) {
      if (f.rmssd !== null && f.rk !== null) {
        const hrvZ = s.hrv;
        const rkZ = s.rk;

        if (hrvZ > 0 && rkZ > 0) {
          stages.push(SleepStage.NREM);
          deepFlags.push(hrvZ > 1.0);
        } else if (hrvZ < 0 && rkZ < 0) {
          stages.push(SleepStage.REM);
          deepFlags.push(false);
        } else {
          if (c > 1.0) {
            stages.push(SleepStage.NREM);
            deepFlags.push(false);
          } else {
            stages.push(SleepStage.REM);
            deepFlags.push(false);
          }
        }
      } else {
        if (c > 1.0) {
          stages.push(SleepStage.NREM);
          deepFlags.push(false);
        } else {
          stages.push(SleepStage.REM);
          deepFlags.push(false);
        }
      }
    } else if (c > -0.5) {
      stages.push(SleepStage.NREM);
      deepFlags.push(false);
    } else {
      stages.push(SleepStage.WAKE);
      deepFlags.push(false);
    }
  }

  // Smooth
  const smoothedStages = hmmSmooth(stages, composite);

  // Ensure deep_flags only on NREM
  for (let i = 0; i < n; i++) {
    if (smoothedStages[i] !== SleepStage.NREM) deepFlags[i] = false;
  }

  // Confidence
  let validInWindow = 0;
  let totalInWindow = 0;
  for (let i = 0; i < n; i++) {
    const f = features[i];
    const inWindow = sleepWindows.some(w => w.startS <= f.epochStartS && f.epochStartS < w.endS);
    if (inWindow) {
      totalInWindow++;
      if (scoresList[i].valid) validInWindow++;
    }
  }
  const confidence = totalInWindow > 0 ? validInWindow / totalInWindow : 0.0;

  return [smoothedStages, deepFlags, confidence];
}