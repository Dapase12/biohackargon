/**
 * Immobility mask computation for sleep staging.
 * Ported from python/argon_algorithms/sleep_stager.py
 */

import type { AccelSample, ImmobilityMask } from './models.ts';
import { createImmobilityMask } from './models.ts';
import { computeZAngle } from './z-angle.ts';
import { enmoFromAccel, rollingMedian } from './helpers.ts';
import {
  DEFAULT_EPOCH_SEC,
  STILL_CUT_G,
  MOVE_CUT_G,
  Z_ANGLE_STILL_DEG,
} from './constants.ts';

/**
 * Compute immobility mask from accelerometer samples.
 * Immobility is detected when ENMO (rolling median) < stillCutG AND z-angle < zAngleStillDeg.
 */
export function computeImmobilityMask(
  accelSamples: AccelSample[],
  epochSec = DEFAULT_EPOCH_SEC,
  stillCutG = STILL_CUT_G,
  moveCutG = MOVE_CUT_G,
  zAngleStillDeg = Z_ANGLE_STILL_DEG,
): ImmobilityMask {
  if (!accelSamples.length) return createImmobilityMask([], []);

  // Compute ENMO per second
  const enmoVals: number[] = [];
  const tsMs: number[] = [];
  for (const sample of accelSamples) {
    if (sample.valid) {
      enmoVals.push(enmoFromAccel(sample));
    } else {
      enmoVals.push(NaN);
    }
    tsMs.push(sample.tsMs);
  }

  // Rolling median of ENMO (5-second window = 5 samples at 1 Hz)
  const enmoMedian = rollingMedian(enmoVals, 5);

  // Compute z-angle
  const zAngle = computeZAngle(accelSamples);
  const zAngleVals = zAngle.zAngleDeg;

  // Immobility: ENMO median < still_cut AND z-angle < z_angle_still_deg
  const mask: number[] = [];
  for (let i = 0; i < enmoMedian.length; i++) {
    if (Number.isNaN(enmoMedian[i]) || Number.isNaN(zAngleVals[i])) {
      mask.push(0);
    } else {
      const immobile = enmoMedian[i] < stillCutG && zAngleVals[i] < zAngleStillDeg;
      mask.push(immobile ? 1 : 0);
    }
  }

  return createImmobilityMask(mask, tsMs);
}