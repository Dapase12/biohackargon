/**
 * Z-angle computation for sleep staging.
 * Ported from python/argon_algorithms/sleep_stager.py
 */

import type { AccelSample, ZAngle } from './models.ts';
import { createZAngle } from './models.ts';

/**
 * Compute z-angle (angle from vertical) for each accelerometer sample.
 * The z-angle is the angle between the accelerometer vector and the vertical axis.
 * Used to detect posture changes during sleep.
 */
export function computeZAngle(accelSamples: AccelSample[]): ZAngle {
  if (!accelSamples.length) return createZAngle([], []);

  const zAngles: number[] = [];
  const tsMs: number[] = [];

  for (const sample of accelSamples) {
    if (!sample.valid) {
      zAngles.push(NaN);
      tsMs.push(sample.tsMs);
      continue;
    }

    const mag = Math.sqrt(sample.x ** 2 + sample.y ** 2 + sample.z ** 2);
    let zAngle: number;
    if (mag < 1e-6) {
      zAngle = 90.0;
    } else {
      const cosTheta = Math.abs(sample.z) / mag;
      const clamped = Math.max(-1.0, Math.min(1.0, cosTheta));
      zAngle = (Math.acos(clamped) * 180) / Math.PI;
    }

    zAngles.push(zAngle);
    tsMs.push(sample.tsMs);
  }

  return createZAngle(zAngles, tsMs);
}