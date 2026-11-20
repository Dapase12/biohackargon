/**
 * Sleep staging algorithms ported from OpenStrap analytics (Dart) to TypeScript.
 * Mirrors python/argon_algorithms/sleep_stager.py
 */

import {
  AccelSample,
  AdvancedSleepStager,
  CardioEpochFeatures,
  CardioStagerResult,
  HrSample,
  ImmobilityMask,
  RrSeries,
  SleepNightObservation,
  SleepSegmentation,
  SleepSession,
  SleepStage,
  SleepUserProfile,
  SleepWindow,
  ZAngle,
  createImmobilityMask,
  createRrSeries,
  createSleepSegmentation,
  createSleepWindow,
  createZAngle,
  createAdvancedSleepStager,
} from './models.ts';
import {
  mad,
  median,
  percentile,
  lombScargle,
  freqGrid,
  cleanBeatsInWindow,
} from './numerics.ts';

// ── Constants matching Python implementation ────────────────────────────────

const DEFAULT_EPOCH_SEC = 30;
const VAN_HEES_MIN_WINDOW_MIN = 30;
const VAN_HEES_MERGE_GAP_MIN = 30;
const Z_ANGLE_STILL_DEG = 5.0;
const STILL_CUT_G = 0.015;
const MOVE_CUT_G = 0.05;
const ROBUST_Z_CLIP = 3.0;

const WEIGHT_IMMOBILE = 0.25;
const WEIGHT_HR = 0.25;
const WEIGHT_HRV = 0.25;
const WEIGHT_RK = 0.25;

const MIN_VALID_HR_FRAC = 0.3;
const MIN_VALID_RR_FRAC = 0.3;

const LF_BAND: [number, number] = [0.04, 0.15];
const HF_BAND: [number, number] = [0.15, 0.40];
const RMSSD_WINDOW_S = 30;

// Coarser frequency grid for LF/HF (25 points instead of 49 for speed)
const LFHF_FREQS = freqGrid(0.01, 0.51, 25);

// ── Helpers ────────────────────────────────────────────────────────────────

function enmoFromAccel(accel: AccelSample): number {
  const mag = Math.sqrt(accel.x ** 2 + accel.y ** 2 + accel.z ** 2);
  return Math.max(0.0, mag - 1.0);
}

function epochBounds(startS: number, endS: number, epochSec: number): [number, number][] {
  const epochs: [number, number][] = [];
  const first = Math.floor(startS / epochSec) * epochSec;
  for (let t = first; t < endS; t += epochSec) {
    epochs.push([t, Math.min(t + epochSec, endS)]);
  }
  return epochs;
}

function filterSamplesInEpoch<T>(
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

function rollingMedian(values: number[], window: number): number[] {
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

// ── zAngle computation ────────────────────────────────────────────────────

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

// ── Immobility mask ────────────────────────────────────────────────────────

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

// ── van Hees sleep window detection ────────────────────────────────────────

function findImmobilityBouts(
  immobility: ImmobilityMask,
  minBoutSec = 300,
  maxGapSec = 60,
): [number, number][] {
  if (immobility.isEmpty) return [];

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

  // Find immobile bouts
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

// ── HRV features per epoch ────────────────────────────────────────────────

function computeRmssd(rrMs: number[]): number | null {
  if (rrMs.length < 2) return null;
  const diffs = rrMs.slice(1).map((rr, i) => rr - rrMs[i]);
  const sqDiffs = diffs.map(d => d * d);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / sqDiffs.length);
}

function computeLfhf(rrSeries: RrSeries): number | null {
  if (rrSeries.length < 10) return null;

  // Get beat times in seconds
  const beatTimesS = rrSeries.beatTimesMs(0.0).map(t => t / 1000.0);

  // Quick check: if RR intervals are very regular, LF/HF is not meaningful
  const rrMean = rrSeries.rrMs.reduce((a, b) => a + b, 0) / rrSeries.rrMs.length;
  const rrStd = Math.sqrt(
    rrSeries.rrMs.reduce((a, b) => a + (b - rrMean) ** 2, 0) / (rrSeries.rrMs.length - 1),
  );
  const rrCv = rrMean > 0 ? rrStd / rrMean : 0;
  if (rrCv < 0.01) return null;

  try {
    const lsResult = lombScargle(beatTimesS, rrSeries.rrMs, LFHF_FREQS);
    if (!lsResult) return null;

    const power = lsResult.spectrum.map(pt => pt.psd);
    const freqs = LFHF_FREQS;

    // Trapezoidal integration (matching np.trapz in Python)
    let lfPower = 0;
    let hfPower = 0;
    for (let i = 1; i < freqs.length; i++) {
      const df = freqs[i] - freqs[i - 1];
      const pMid = (power[i] + power[i - 1]) / 2;
      const fMid = (freqs[i] + freqs[i - 1]) / 2;
      if (fMid >= LF_BAND[0] && fMid < LF_BAND[1]) lfPower += pMid * df;
      if (fMid >= HF_BAND[0] && fMid < HF_BAND[1]) hfPower += pMid * df;
    }

    if (hfPower <= 0) return null;
    return lfPower / hfPower;
  } catch {
    return null;
  }
}

function computeRk(rrMs: number[]): number | null {
  if (rrMs.length < 3) return null;
  const ihr = rrMs.filter(rr => rr > 0).map(rr => 60000.0 / rr);
  if (ihr.length < 2) return null;
  const diffs = ihr.slice(1).map((v, i) => Math.abs(v - ihr[i]));
  return median(diffs);
}

// ── cardioStager: per-epoch feature extraction ───────────────────────────

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

// ── classifyCardioEpochs: decision layer ────────────────────────────────

interface EpochScores {
  immobile: number;
  hr: number;
  hrv: number;
  rk: number;
  valid: boolean;
}

function collectValidFeatures(
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

function robustZScores(values: number[], clip = ROBUST_Z_CLIP): number[] {
  if (!values.length) return [];
  const med = median(values)!;
  const madVal = mad(values)!;
  if (madVal === 0) return values.map(() => 0);
  return values.map(v => {
    const z = (v - med) / madVal;
    return Math.max(-clip, Math.min(clip, z));
  });
}

function computeEpochScores(
  features: CardioEpochFeatures[],
  profile?: SleepUserProfile,
): EpochScores[] {
  const n = features.length;
  const scores: EpochScores[] = Array.from({ length: n }, () => ({
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

function compositeScore(s: EpochScores): number {
  return WEIGHT_IMMOBILE * s.immobile + WEIGHT_HR * s.hr + WEIGHT_HRV * s.hrv + WEIGHT_RK * s.rk;
}

function hmmSmooth(
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

export function classifyCardioEpochs(
  features: CardioEpochFeatures[],
  sleepWindows: SleepWindow[],
  profile?: SleepUserProfile,
  epochSec = DEFAULT_EPOCH_SEC,
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
      stages.push(0);
      deepFlags.push(false);
      continue;
    }

    if (c > 0.5) {
      if (f.rmssd !== null && f.rk !== null) {
        const hrvZ = s.hrv;
        const rkZ = s.rk;

        if (hrvZ > 0 && rkZ > 0) {
          stages.push(1);
          deepFlags.push(hrvZ > 1.0);
        } else if (hrvZ < 0 && rkZ < 0) {
          stages.push(2);
          deepFlags.push(false);
        } else {
          if (c > 1.0) {
            stages.push(1);
            deepFlags.push(false);
          } else {
            stages.push(2);
            deepFlags.push(false);
          }
        }
      } else {
        if (c > 1.0) {
          stages.push(1);
          deepFlags.push(false);
        } else {
          stages.push(2);
          deepFlags.push(false);
        }
      }
    } else if (c > -0.5) {
      stages.push(1);
      deepFlags.push(false);
    } else {
      stages.push(0);
      deepFlags.push(false);
    }
  }

  // Smooth
  const smoothedStages = hmmSmooth(stages, composite);

  // Ensure deep_flags only on NREM
  for (let i = 0; i < n; i++) {
    if (smoothedStages[i] !== 1) deepFlags[i] = false;
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

// ── segmentSleep: main entry point ───────────────────────────────────────

export function segmentSleep(
  session: SleepSession,
  config?: AdvancedSleepStager,
): SleepSegmentation {
  const cfg = config ?? createAdvancedSleepStager();

  // 1. Sleep window detection - FIXED: use positional arguments instead of Python kwargs
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

// ── SleepNightObservation extraction ──────────────────────────────────────

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
    if (stage === 1 || stage === 2) {
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

// ── High-level API ────────────────────────────────────────────────────────

export function stageSleep(
  session: SleepSession,
  config?: AdvancedSleepStager,
): CardioStagerResult {
  const segmentation = segmentSleep(session, config);
  return segmentation.toCardioResult();
}

// Export constants
export {
  DEFAULT_EPOCH_SEC,
  STILL_CUT_G,
  MOVE_CUT_G,
  Z_ANGLE_STILL_DEG,
};