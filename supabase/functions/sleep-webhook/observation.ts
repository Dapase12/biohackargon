/**
 * Nightly observation extraction from sleep staging results.
 * Ported from python/argon_algorithms/sleep_stager.py
 */

import type { SleepSegmentation, CardioEpochFeatures, SleepNightObservation, SleepStage } from './models.ts';
import { median, percentile, mad } from './numerics.ts';

/**
 * Extract nightly sleep observation from segmentation and features.
 * Computes HR floor, HRV metrics, ENMO cutoffs, LF/HF, and RK for the night.
 */
export function extractNightlyObservation(
  segmentation: SleepSegmentation,
  features: CardioEpochFeatures[],
): SleepNightObservation | null {
  if (!features.length || !segmentation.stages.length) return null;

  const sleepHr: number[] = [];
  const sleepRmssd: number[] = [];
  const sleepEnmo: number[] = [];
  const sleepLfhf: number[] = [];
  const sleepRk: number[] = [];

  for (let i = 0; i < segmentation.stages.length; i++) {
    const stage = segmentation.stages[i];
    const feat = features[i];
    if (stage === SleepStage.NREM || stage === SleepStage.REM) {
      if (feat.hrMedian !== null) sleepHr.push(feat.hrMedian);
      if (feat.rmssd !== null) sleepRmssd.push(feat.rmssd);
      if (feat.enmoMedian !== null) sleepEnmo.push(feat.enmoMedian);
      if (feat.lfhf !== null) sleepLfhf.push(feat.lfhf);
      if (feat.rk !== null) sleepRk.push(feat.rk);
    }
  }

  if (!sleepHr.length) return null;

  const hrSorted = [...sleepHr].sort((a, b) => a - b);
  const hrFloorP5 = percentile(hrSorted, 5);
  const hrFloorP25 = percentile(hrSorted, 25);
  const hrSleepMedian = median(hrSorted);
  const hrArousal = sleepHr.length >= 4 ? percentile(hrSorted, 75) : hrSleepMedian;

  const rmssdMed = median(sleepRmssd) ?? null;
  const rmssdMad = mad(sleepRmssd) ?? null;

  const enmoStillCut = sleepEnmo.length ? percentile(sleepEnmo, 10) : null;
  const enmoMoveCut = sleepEnmo.length ? percentile(sleepEnmo, 90) : null;

  const lfhfMed = median(sleepLfhf) ?? null;
  const rkMed = median(sleepRk) ?? null;

  return {
    hrFloorP5,
    hrFloorP25,
    hrSleepMedian,
    hrArousal,
    rmssdMed,
    rmssdMad,
    enmoStillCut,
    enmoMoveCut,
    lfhfMed,
    rkMed,
    updatedAtMs: Math.round(segmentation.inBedEndS * 1000),
  };
}