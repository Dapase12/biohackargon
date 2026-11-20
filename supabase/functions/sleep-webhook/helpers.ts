/**
 * Helper functions for sleep staging.
 * Ported from python/argon_algorithms/sleep_stager.py
 */

import type { AccelSample } from './models.ts';
import { median } from './numerics.ts';

/**
 * Compute ENMO (Euclidean Norm Minus One) from accelerometer sample.
 * ENMO = max(0, sqrt(x^2 + y^2 + z^2) - 1)
 */
export function enmoFromAccel(accel: AccelSample): number {
  const mag = Math.sqrt(accel.x ** 2 + accel.y ** 2 + accel.z ** 2);
  return Math.max(0.0, mag - 1.0);
}

/**
 * Generate epoch boundaries for a time range.
 * @returns Array of [startS, endS] pairs for each epoch
 */
export function epochBounds(startS: number, endS: number, epochSec: number): [number, number][] {
  const epochs: [number, number][] = [];
  const first = Math.floor(startS / epochSec) * epochSec;
  for (let t = first; t < endS; t += epochSec) {
    epochs.push([t, Math.min(t + epochSec, endS)]);
  }
  return epochs;
}

/**
 * Filter samples that fall within a given epoch time range.
 */
export function filterSamplesInEpoch<T>(
  samples: T[],
  epochStartS: number,
  epochEndS: number,
  tsField: keyof T = 'tsMs' as keyof T,
): T[] {
  const startMs = epochStartS * 1000;
  const endMs = epochEndS * 1000;
  const result: T[] = [];
  for (const s of samples) {
    const tsVal = s[tsField];
    if (Array.isArray(tsVal)) {
      if (tsVal.some(ts => startMs <= ts && ts < endMs)) result.push(s);
    } else if (typeof tsVal === 'number') {
      if (startMs <= tsVal && tsVal < endMs) result.push(s);
    }
  }
  return result;
}

/**
 * Compute rolling median with given window size.
 */
export function rollingMedian(values: number[], window: number): number[] {
  const n = values.length;
  if (n === 0 || window <= 1) return [...values];
  const half = Math.floor(window / 2);
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    const windowVals = values.slice(start, end);
    result.push(median(windowVals) ?? 0);
  }
  return result;
}