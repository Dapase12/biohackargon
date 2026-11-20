/**
 * Sleep session building and staging execution.
 */

import type {
  RawSleepData,
  SleepSession,
  SleepUserProfile,
  AdvancedSleepStager,
  CardioEpochFeatures,
  SleepSegmentation,
} from './models.ts';
import { createSleepSession, createAdvancedSleepStager } from './models.ts';
import { segmentSleep, cardioStager, DEFAULT_EPOCH_SEC } from './sleep-stager.ts';

/**
 * Build SleepSession from raw data and profile.
 */
export function buildSleepSession(
  raw: RawSleepData,
  profile: SleepUserProfile | null,
): SleepSession {
  return createSleepSession(
    raw.accel,
    raw.hr,
    raw.rr,
    raw.in_bed_start_s,
    raw.in_bed_end_s,
    profile ?? undefined,
  );
}

/**
 * Run sleep staging on session.
 */
export function runSleepStaging(
  session: SleepSession,
  config: AdvancedSleepStager | null,
): [SleepSegmentation, CardioEpochFeatures[]] {
  const segmentation = segmentSleep(session, config ?? undefined);
  const features = cardioStager(
    session,
    config?.epochSec ?? DEFAULT_EPOCH_SEC,
    session.profile,
  );
  return [segmentation, features];
}