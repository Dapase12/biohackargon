/**
 * Van Hees sleep window detection algorithm.
 * Ported from python/argon_algorithms/sleep_stager.py
 */

import type { AccelSample, SleepWindow } from './models.ts';
import { createSleepWindow } from './models.ts';
import { computeImmobilityMask } from './immobility.ts';
import {
  DEFAULT_EPOCH_SEC,
  VAN_HEES_MIN_WINDOW_MIN,
  VAN_HEES_MERGE_GAP_MIN,
  STILL_CUT_G,
  MOVE_CUT_G,
  Z_ANGLE_STILL_DEG,
} from './constants.ts';

/**
 * Find contiguous immobility bouts from an immobility mask.
 * Bouts shorter than minBoutSec are discarded.
 * Gaps shorter than maxGapSec between bouts are merged.
 */
function findImmobilityBouts(
  immobility: { mask: number[]; tsMs: number[] },
  minBoutSec = 300,
  maxGapSec = 60,
): [number, number][] {
  if (!immobility.mask.length) return [];

  const bouts: [number, number][] = [];
  let inBout = false;
  let boutStart = 0.0;

  for (let i = 0; i < immobility.mask.length; i++) {
    const m = immobility.mask[i];
    const tS = immobility.tsMs[i] / 1000.0;
    if (m === 1 && !inBout) {
      inBout = true;
      boutStart = tS;
    } else if (m === 0 && inBout) {
      // Check gap to next immobile
      let gap = Infinity;
      for (let j = i + 1; j < immobility.mask.length; j++) {
        if (immobility.mask[j] === 1) {
          gap = (immobility.tsMs[j] - immobility.tsMs[i]) / 1000.0;
          break;
        }
      }
      if (gap > maxGapSec) {
        inBout = false;
        const boutEnd = tS;
        if (boutEnd - boutStart >= minBoutSec) {
          bouts.push([boutStart, boutEnd]);
        }
      }
    }
  }

  // Handle bout extending to end
  if (inBout) {
    const boutEnd = immobility.tsMs[immobility.tsMs.length - 1] / 1000.0;
    if (boutEnd - boutStart >= minBoutSec) {
      bouts.push([boutStart, boutEnd]);
    }
  }

  return bouts;
}

/**
 * Merge sleep windows that are close together.
 */
function mergeWindows(windows: SleepWindow[], maxGapMin = VAN_HEES_MERGE_GAP_MIN): SleepWindow[] {
  if (!windows.length) return [];
  const merged: SleepWindow[] = [windows[0]];
  for (const w of windows.slice(1)) {
    const last = merged[merged.length - 1];
    const gapMin = (w.startS - last.endS) / 60.0;
    if (gapMin <= maxGapMin) {
      merged[merged.length - 1] = createSleepWindow(last.startS, w.endS);
    } else {
      merged.push(w);
    }
  }
  return merged;
}

/**
 * Detect sleep windows using the Van Hees algorithm.
 * Identifies periods of sustained immobility within the in-bed period.
 */
export function vanHeesSleepWindow(
  accelSamples: AccelSample[],
  inBedStartS: number,
  inBedEndS: number,
  epochSec = DEFAULT_EPOCH_SEC,
  minWindowMin = VAN_HEES_MIN_WINDOW_MIN,
  stillCutG = STILL_CUT_G,
  moveCutG = MOVE_CUT_G,
  zAngleStillDeg = Z_ANGLE_STILL_DEG,
): SleepWindow[] {
  if (!accelSamples.length) return [];

  // Compute immobility mask for full in-bed period
  const immobility = computeImmobilityMask(
    accelSamples,
    epochSec,
    stillCutG,
    moveCutG,
    zAngleStillDeg,
  );

  // Find immobile bouts (minimum 5 min, merge gaps < 60 sec)
  const bouts = findImmobilityBouts(immobility, 5 * 60, 60);

  // Convert to SleepWindow and merge
  let windows = bouts.map(([s, e]) => createSleepWindow(s, e));
  windows = mergeWindows(windows, VAN_HEES_MERGE_GAP_MIN);

  // Filter by minimum duration and intersect with in-bed
  const result: SleepWindow[] = [];
  for (const w of windows) {
    const start = Math.max(w.startS, inBedStartS);
    const end = Math.min(w.endS, inBedEndS);
    if (end - start >= minWindowMin * 60) {
      result.push(createSleepWindow(start, end));
    }
  }

  return result;
}