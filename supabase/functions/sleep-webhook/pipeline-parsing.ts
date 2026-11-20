/**
 * Payload parsing functions for webhook data.
 */

import type { AccelSample, HrSample, RrSeries } from './models.ts';
import { createAccelSample, createHrSample, createRrSeries } from './models.ts';

/**
 * Parse accelerometer samples from raw webhook data.
 */
export function parseAccelSamples(data: unknown[]): AccelSample[] {
  const samples: AccelSample[] = [];
  for (const d of data) {
    if (typeof d !== 'object' || d === null) continue;
    const obj = d as Record<string, unknown>;
    try {
      const tsMs = Number(obj.ts_ms);
      const x = Number(obj.x);
      const y = Number(obj.y);
      const z = Number(obj.z);
      const valid = obj.valid !== undefined ? Boolean(obj.valid) : true;
      if (Number.isFinite(tsMs) && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        samples.push(createAccelSample(tsMs, x, y, z, valid));
      }
    } catch {
      continue;
    }
  }
  return samples;
}

/**
 * Parse heart rate samples from raw webhook data.
 */
export function parseHrSamples(data: unknown[]): HrSample[] {
  const samples: HrSample[] = [];
  for (const d of data) {
    if (typeof d !== 'object' || d === null) continue;
    const obj = d as Record<string, unknown>;
    try {
      const tsMs = Number(obj.ts_ms);
      const hr = Number(obj.hr);
      if (Number.isFinite(tsMs) && Number.isFinite(hr)) {
        samples.push(createHrSample(tsMs, hr));
      }
    } catch {
      continue;
    }
  }
  return samples;
}

/**
 * Parse RR interval series from raw webhook data.
 * Handles both single timestamp + multiple RR intervals and timestamp array + RR array formats.
 */
export function parseRrSeries(data: unknown[]): RrSeries[] {
  const series: RrSeries[] = [];
  for (const d of data) {
    if (typeof d !== 'object' || d === null) continue;
    const obj = d as Record<string, unknown>;
    try {
      const tsMs = obj.ts_ms as number[] | number;
      const rrMs = obj.rr_ms as number[];
      if (!Array.isArray(rrMs) || rrMs.length === 0) continue;

      // Handle single timestamp (end time) + multiple RR intervals
      // Python's parse_rr_series reconstructs beat times from end time + intervals
      if (typeof tsMs === 'number' && rrMs.length > 1) {
        // Reconstruct beat times: start from end time and subtract RR intervals backwards
        const reconstructedTs: number[] = [];
        let currentTime = tsMs;
        for (const rr of [...rrMs].reverse()) {
          reconstructedTs.unshift(currentTime);
          currentTime -= rr;
        }
        series.push(createRrSeries(reconstructedTs, rrMs));
      } else if (Array.isArray(tsMs) && tsMs.length === rrMs.length && tsMs.length > 0) {
        series.push(createRrSeries(tsMs, rrMs));
      }
    } catch {
      continue;
    }
  }
  return series;
}