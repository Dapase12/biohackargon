/**
 * Per-epoch feature extraction for cardio-based sleep staging.
 * Ported from python/argon_algorithms/sleep_stager.py
 */

import type {
  AccelSample,
  CardioEpochFeatures,
  HrSample,
  RrSeries,
  SleepSession,
  SleepUserProfile,
} from './models.ts';
import { epochBounds, filterSamplesInEpoch, rollingMedian, enmoFromAccel } from './helpers.ts';
import { computeZAngle } from './z-angle.ts';
import { computeRmssd, computeLfhf, computeRk } from './hrv-features.ts';
import { createRrSeries } from './models.ts';
import {
  DEFAULT_EPOCH_SEC,
  STILL_CUT_G,
  MOVE_CUT_G,
  Z_ANGLE_STILL_DEG,
  MIN_VALID_HR_FRAC,
  MIN_VALID_RR_FRAC,
} from './constants.ts';
import { median, percentile } from './numerics.ts';

/**
 * Extract cardio features for each epoch in the in-bed period.
 * Computes motion (ENMO), HR, HRV (RMSSD, LF/HF, RK), and immobility features.
 */
export function cardioStager(
  session: SleepSession,
  epochSec = DEFAULT_EPOCH_SEC,
  profile?: SleepUserProfile,
): CardioEpochFeatures[] {
  if (!session.accel.length) return [];

  const inBedStart = session.inBedStartS;
  const inBedEnd = session.inBedEndS;
  const epochs = epochBounds(inBedStart, inBedEnd, epochSec);
  const effectiveProfile = profile ?? session.profile;

  const stillCut = effectiveProfile?.enmoStillCut ?? STILL_CUT_G;
  const moveCut = effectiveProfile?.enmoMoveCut ?? MOVE_CUT_G;

  // Compute z-angle once for all epochs
  const zAngle = computeZAngle(session.accel);

  const results: CardioEpochFeatures[] = [];

  for (const [epochStart, epochEnd] of epochs) {
    // Filter samples in this epoch
    const epochAccel = filterSamplesInEpoch(session.accel, epochStart, epochEnd);
    const epochHr = filterSamplesInEpoch(session.hr, epochStart, epochEnd);
    const epochRr = filterSamplesInEpoch(session.rr, epochStart, epochEnd);

    // ---- Motion features ----
    const enmoVals = epochAccel.filter(a => a.valid).map(enmoFromAccel);
    const enmoMedian = median(enmoVals) ?? 0.0;
    const enmoP95 = percentile(enmoVals, 95) ?? 0.0;

    let stillFrac: number;
    if (enmoVals.length >= 5) {
      const enmoRollMed = rollingMedian(enmoVals, 5);
      stillFrac = enmoRollMed.filter(v => v < stillCut).length / enmoRollMed.length;
    } else {
      stillFrac = enmoMedian < stillCut ? 1.0 : 0.0;
    }

    // ---- HR features ----
    const validHr = epochHr.filter(h => h.valid).map(h => h.hr);
    const validHrFrac = epochHr.length ? validHr.length / epochHr.length : 0.0;
    const hrMedian = median(validHr) ?? null;
    const hrP5 = percentile(validHr, 5) ?? null;
    const hrP25 = percentile(validHr, 25) ?? null;

    // ---- HRV features ----
    const epochRrMs: number[] = [];
    for (const rrSeries of epochRr) {
      for (let i = 0; i < rrSeries.tsMs.length; i++) {
        const ts = rrSeries.tsMs[i];
        if (epochStart * 1000 <= ts && ts < epochEnd * 1000) {
          epochRrMs.push(rrSeries.rrMs[i]);
        }
      }
    }

    const totalRr = epochRr.reduce((a, r) => a + r.length, 0);
    const validRrFrac = totalRr ? epochRrMs.length / totalRr : 0.0;

    const rmssd = epochRrMs.length >= 2 ? computeRmssd(epochRrMs) : null;

    // LF/HF from combined RR series in epoch
    let lfhf: number | null = null;
    if (epochRr.length && epochRrMs.length >= 10) {
      const combinedRr = createRrSeries(
        epochRr.flatMap(r => r.tsMs.filter(ts => epochStart * 1000 <= ts && ts < epochEnd * 1000)),
        epochRrMs,
      );
      lfhf = computeLfhf(combinedRr);
    }

    // RK
    const rk = epochRrMs.length >= 3 ? computeRk(epochRrMs) : null;

    // ---- Immobility fraction ----
    const epochZ = filterSamplesInEpoch(
      zAngle.zAngleDeg.map((za, i) => ({ zAngleDeg: za, tsMs: zAngle.tsMs[i] })),
      epochStart,
      epochEnd,
      'tsMs',
    );
    const zVals = epochZ.filter(z => !Number.isNaN(z.zAngleDeg)).map(z => z.zAngleDeg);
    const enmoValsZ = epochAccel.filter(a => a.valid).map(enmoFromAccel);
    const enmoRollMedZ = enmoValsZ.length >= 5 ? rollingMedian(enmoValsZ, 5) : enmoValsZ;

    let immobileCount = 0;
    const total = Math.min(enmoRollMedZ.length, zVals.length);
    for (let i = 0; i < total; i++) {
      if (enmoRollMedZ[i] < stillCut && zVals[i] < Z_ANGLE_STILL_DEG) immobileCount++;
    }
    const immobileFrac = total > 0 ? immobileCount / total : 0.0;

    results.push({
      epochStartS: epochStart,
      enmoMedian,
      enmoP95,
      stillFrac,
      hrMedian,
      hrP5,
      hrP25,
      rmssd,
      lfhf,
      rk,
      validHrFrac,
      validRrFrac,
      immobileFrac,
    });
  }

  return results;
}