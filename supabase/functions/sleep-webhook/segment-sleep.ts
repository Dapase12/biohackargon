/**
 * Main sleep staging entry point.
 * Ported from python/argon_algorithms/sleep_stager.py
 */

import type {
  SleepSession,
  SleepSegmentation,
  AdvancedSleepStager,
  SleepWindow,
} from './models.ts';
import { createSleepSegmentation, createAdvancedSleepStager } from './models.ts';
import { vanHeesSleepWindow } from './van-hees.ts';
import { cardioStager } from './cardio-stager.ts';
import { classifyCardioEpochs } from './classify-epochs.ts';
import { DEFAULT_EPOCH_SEC, MIN_VALID_HR_FRAC, MIN_VALID_RR_FRAC } from './constants.ts';

/**
 * Main sleep staging pipeline.
 * 1. Detect sleep windows using Van Hees algorithm
 * 2. Extract per-epoch cardio features
 * 3. Classify epochs into sleep stages
 * 4. Determine sleep onset/offset
 * 5. Compute confidence and unobserved time
 */
export function segmentSleep(
  session: SleepSession,
  config?: AdvancedSleepStager,
): SleepSegmentation {
  const cfg = config ?? createAdvancedSleepStager();

  // 1. Sleep window detection
  const sleepWindows = vanHeesSleepWindow(
    session.accel,
    session.inBedStartS,
    session.inBedEndS,
    cfg.epochSec,
    cfg.minSleepWindowMin,
    cfg.stillCutG,
    cfg.moveCutG,
    cfg.zAngleStillDeg,
  );

  // 2. Per-epoch features
  const features = cardioStager(session, cfg.epochSec, session.profile);

  // 3. Classification
  const [stages, deepFlags, confidence] = classifyCardioEpochs(
    features,
    sleepWindows,
    session.profile,
    cfg.epochSec,
  );

  // 4. Determine sleep onset/offset
  let sleepOnsetS: number | undefined;
  let sleepOffsetS: number | undefined;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i] === 1 || stages[i] === 2) {
      if (sleepOnsetS === undefined) sleepOnsetS = features[i].epochStartS;
      sleepOffsetS = features[i].epochStartS + cfg.epochSec;
    }
  }

  // 5. Count unobserved seconds
  let unobservedSec = 0;
  for (const feat of features) {
    if (feat.validHrFrac < MIN_VALID_HR_FRAC && feat.validRrFrac < MIN_VALID_RR_FRAC) {
      unobservedSec += cfg.epochSec;
    }
  }

  return createSleepSegmentation({
    stages,
    deepFlag: deepFlags,
    epochSec: cfg.epochSec,
    inBedStartS: session.inBedStartS,
    inBedEndS: session.inBedEndS,
    sleepOnsetS,
    sleepOffsetS,
    unobservedSec,
    confidence,
  });
}