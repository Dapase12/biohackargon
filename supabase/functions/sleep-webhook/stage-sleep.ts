/**
 * High-level sleep staging API.
 * Ported from python/argon_algorithms/sleep_stager.py
 */

import type { SleepSession, AdvancedSleepStager, CardioStagerResult } from './models.ts';
import { segmentSleep } from './segment-sleep.ts';

/**
 * High-level sleep staging function.
 * Returns CardioStagerResult with stages, deep flags, and confidence.
 */
export function stageSleep(
  session: SleepSession,
  config?: AdvancedSleepStager,
): CardioStagerResult {
  const segmentation = segmentSleep(session, config);
  return segmentation.toCardioResult();
}