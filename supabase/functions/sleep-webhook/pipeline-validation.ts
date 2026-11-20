/**
 * Strict payload validation for sleep webhook.
 */

import type { WebhookPayload, ValidationResult } from './pipeline-types.ts';

const MAX_SAMPLES = 100000;
const HR_MIN = 30;
const HR_MAX = 250;
const RR_MIN = 300;
const RR_MAX = 2000;
const TIMESTAMP_TOLERANCE_MS = 2 * 60 * 60 * 1000; // 2 hours in ms

/**
 * Validate webhook payload with comprehensive checks.
 */
export function validateWebhookPayload(payload: WebhookPayload): ValidationResult {
  const errors: string[] = [];

  // 1. Array size limits
  if (Array.isArray(payload.accel) && payload.accel.length > MAX_SAMPLES) {
    errors.push(`accel array exceeds maximum size of ${MAX_SAMPLES} samples (got ${payload.accel.length})`);
  }
  if (Array.isArray(payload.hr) && payload.hr.length > MAX_SAMPLES) {
    errors.push(`hr array exceeds maximum size of ${MAX_SAMPLES} samples (got ${payload.hr.length})`);
  }
  if (Array.isArray(payload.rr) && payload.rr.length > MAX_SAMPLES) {
    errors.push(`rr array exceeds maximum size of ${MAX_SAMPLES} samples (got ${payload.rr.length})`);
  }

  // 2. Required fields
  if (!payload.user_id || typeof payload.user_id !== 'string') {
    errors.push('user_id is required and must be a string');
  }
  if (!payload.log_date || typeof payload.log_date !== 'string') {
    errors.push('log_date is required and must be a string');
  }
  if (typeof payload.in_bed_start_s !== 'number' || !Number.isFinite(payload.in_bed_start_s)) {
    errors.push('in_bed_start_s is required and must be a finite number');
  }
  if (typeof payload.in_bed_end_s !== 'number' || !Number.isFinite(payload.in_bed_end_s)) {
    errors.push('in_bed_end_s is required and must be a finite number');
  }
  if (payload.in_bed_end_s <= payload.in_bed_start_s) {
    errors.push('in_bed_end_s must be greater than in_bed_start_s');
  }

  // 3. Epoch config validation
  if (payload.config && typeof payload.config.epoch_sec === 'number') {
    const epochSec = payload.config.epoch_sec;
    if (!Number.isFinite(epochSec) || epochSec < 10 || epochSec > 120) {
      errors.push(`epoch_sec must be between 10 and 120 (got ${epochSec})`);
    }
  }

  // 4. Validate accel samples
  if (Array.isArray(payload.accel)) {
    for (let i = 0; i < payload.accel.length; i++) {
      const sample = payload.accel[i];
      if (typeof sample !== 'object' || sample === null) {
        errors.push(`accel[${i}]: must be an object`);
        continue;
      }
      const obj = sample as Record<string, unknown>;
      if (typeof obj.ts_ms !== 'number' || !Number.isFinite(obj.ts_ms)) {
        errors.push(`accel[${i}]: ts_ms must be a finite number`);
      }
      if (typeof obj.x !== 'number' || !Number.isFinite(obj.x)) {
        errors.push(`accel[${i}]: x must be a finite number`);
      }
      if (typeof obj.y !== 'number' || !Number.isFinite(obj.y)) {
        errors.push(`accel[${i}]: y must be a finite number`);
      }
      if (typeof obj.z !== 'number' || !Number.isFinite(obj.z)) {
        errors.push(`accel[${i}]: z must be a finite number`);
      }
      if (obj.valid !== undefined && typeof obj.valid !== 'boolean') {
        errors.push(`accel[${i}]: valid must be a boolean`);
      }
      // Timestamp range validation
      if (typeof obj.ts_ms === 'number' && Number.isFinite(obj.ts_ms)) {
        const tsMs = obj.ts_ms;
        const inBedStartMs = payload.in_bed_start_s * 1000;
        const inBedEndMs = payload.in_bed_end_s * 1000;
        if (tsMs < inBedStartMs - TIMESTAMP_TOLERANCE_MS || tsMs > inBedEndMs + TIMESTAMP_TOLERANCE_MS) {
          errors.push(`accel[${i}]: ts_ms (${tsMs}) outside in_bed window ±2h`);
        }
      }
    }
  }

  // 5. Validate hr samples
  if (Array.isArray(payload.hr)) {
    for (let i = 0; i < payload.hr.length; i++) {
      const sample = payload.hr[i];
      if (typeof sample !== 'object' || sample === null) {
        errors.push(`hr[${i}]: must be an object`);
        continue;
      }
      const obj = sample as Record<string, unknown>;
      if (typeof obj.ts_ms !== 'number' || !Number.isFinite(obj.ts_ms)) {
        errors.push(`hr[${i}]: ts_ms must be a finite number`);
      }
      if (typeof obj.hr !== 'number' || !Number.isFinite(obj.hr)) {
        errors.push(`hr[${i}]: hr must be a finite number`);
      } else {
        const hr = obj.hr;
        if (hr < HR_MIN || hr > HR_MAX) {
          errors.push(`hr[${i}]: hr (${hr}) out of valid range [${HR_MIN}, ${HR_MAX}] bpm`);
        }
      }
      // Timestamp range validation
      if (typeof obj.ts_ms === 'number' && Number.isFinite(obj.ts_ms)) {
        const tsMs = obj.ts_ms;
        const inBedStartMs = payload.in_bed_start_s * 1000;
        const inBedEndMs = payload.in_bed_end_s * 1000;
        if (tsMs < inBedStartMs - TIMESTAMP_TOLERANCE_MS || tsMs > inBedEndMs + TIMESTAMP_TOLERANCE_MS) {
          errors.push(`hr[${i}]: ts_ms (${tsMs}) outside in_bed window ±2h`);
        }
      }
    }
  }

  // 6. Validate rr series
  if (Array.isArray(payload.rr)) {
    for (let i = 0; i < payload.rr.length; i++) {
      const sample = payload.rr[i];
      if (typeof sample !== 'object' || sample === null) {
        errors.push(`rr[${i}]: must be an object`);
        continue;
      }
      const obj = sample as Record<string, unknown>;
      if (!Array.isArray(obj.rr_ms) || obj.rr_ms.length === 0) {
        errors.push(`rr[${i}]: rr_ms must be a non-empty array`);
        continue;
      }
      // Validate each RR interval
      for (let j = 0; j < obj.rr_ms.length; j++) {
        const rr = obj.rr_ms[j];
        if (typeof rr !== 'number' || !Number.isFinite(rr)) {
          errors.push(`rr[${i}].rr_ms[${j}]: must be a finite number`);
        } else if (rr < RR_MIN || rr > RR_MAX) {
          errors.push(`rr[${i}].rr_ms[${j}]: rr interval (${rr}) out of valid range [${RR_MIN}, ${RR_MAX}] ms`);
        }
      }
      // Validate ts_ms (can be number or number[])
      const tsMs = obj.ts_ms;
      if (typeof tsMs === 'number') {
        if (!Number.isFinite(tsMs)) {
          errors.push(`rr[${i}]: ts_ms must be a finite number`);
        } else {
          // Timestamp range validation
          const inBedStartMs = payload.in_bed_start_s * 1000;
          const inBedEndMs = payload.in_bed_end_s * 1000;
          if (tsMs < inBedStartMs - TIMESTAMP_TOLERANCE_MS || tsMs > inBedEndMs + TIMESTAMP_TOLERANCE_MS) {
            errors.push(`rr[${i}]: ts_ms (${tsMs}) outside in_bed window ±2h`);
          }
        }
      } else if (Array.isArray(tsMs)) {
        for (let j = 0; j < tsMs.length; j++) {
          if (typeof tsMs[j] !== 'number' || !Number.isFinite(tsMs[j])) {
            errors.push(`rr[${i}].ts_ms[${j}]: must be a finite number`);
          } else {
            const inBedStartMs = payload.in_bed_start_s * 1000;
            const inBedEndMs = payload.in_bed_end_s * 1000;
            if (tsMs[j] < inBedStartMs - TIMESTAMP_TOLERANCE_MS || tsMs[j] > inBedEndMs + TIMESTAMP_TOLERANCE_MS) {
              errors.push(`rr[${i}].ts_ms[${j}]: (${tsMs[j]}) outside in_bed window ±2h`);
            }
          }
        }
      } else {
        errors.push(`rr[${i}]: ts_ms must be a number or number[]`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}