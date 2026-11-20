/**
 * HRV feature computation per epoch.
 * Ported from python/argon_algorithms/sleep_stager.py
 */

import type { RrSeries } from './models.ts';
import { createRrSeries } from './models.ts';
import { median, lombScargle } from './numerics.ts';
import { LF_BAND, HF_BAND, LFHF_FREQS } from './constants.ts';

/**
 * Compute RMSSD (Root Mean Square of Successive Differences) from RR intervals.
 */
export function computeRmssd(rrMs: number[]): number | null {
  if (rrMs.length < 2) return null;
  const diffs = rrMs.slice(1).map((rr, i) => rr - rrMs[i]);
  const sqDiffs = diffs.map(d => d * d);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / sqDiffs.length);
}

/**
 * Compute LF/HF ratio from RR series using Lomb-Scargle periodogram.
 */
export function computeLfhf(rrSeries: RrSeries): number | null {
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

/**
 * Compute RK (Renewing Kinetics) metric from RR intervals.
 * Median of absolute differences between successive instantaneous HR values.
 */
export function computeRk(rrMs: number[]): number | null {
  if (rrMs.length < 3) return null;
  const ihr = rrMs.filter(rr => rr > 0).map(rr => 60000.0 / rr);
  if (ihr.length < 2) return null;
  const diffs = ihr.slice(1).map((v, i) => Math.abs(v - ihr[i]));
  return median(diffs);
}