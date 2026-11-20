/**
 * Sleep staging pipeline for Supabase Edge Functions (Deno).
 * Ported from python/argon_algorithms/pipeline.py
 *
 * Handles webhook processing, sleep staging, and Supabase storage.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import {
  AccelSample,
  AdvancedSleepStager,
  CardioEpochFeatures,
  HrSample,
  RrSeries,
  SleepNightObservation,
  SleepSegmentation,
  SleepSession,
  SleepUserProfile,
  createAccelSample,
  createHrSample,
  createRrSeries,
  createSleepSession,
  createSleepUserProfile,
  createAdvancedSleepStager,
  sleepUserProfileFromJson,
} from './models.ts';

import {
  segmentSleep,
  cardioStager,
  extractNightlyObservation,
  DEFAULT_EPOCH_SEC,
} from './index.ts';

// ── Types ────────────────────────────────────────────────────────────────

export interface RawSleepData {
  user_id: string;
  log_date: string; // ISO date string YYYY-MM-DD
  accel: AccelSample[];
  hr: HrSample[];
  rr: RrSeries[];
  in_bed_start_s: number;
  in_bed_end_s: number;
  config?: Record<string, unknown>;
}

export interface PipelineResult {
  segmentation: SleepSegmentation | null;
  features: CardioEpochFeatures[];
  observation: SleepNightObservation | null;
  profile: SleepUserProfile | null;
  stored: boolean;
  error: string | null;
}

// ── Parsing Functions ────────────────────────────────────────────────────

function parseAccelSamples(data: unknown[]): AccelSample[] {
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

function parseHrSamples(data: unknown[]): HrSample[] {
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

function parseRrSeries(data: unknown[]): RrSeries[] {
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

// ── Profile Management ───────────────────────────────────────────────────

export async function getUserProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<SleepUserProfile> {
  const { data, error } = await supabase
    .from('sleep_user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return createSleepUserProfile({ nights: 0 });
  }

  // Parse updated_at to milliseconds
  let updatedAtMs = 0;
  if (data.updated_at) {
    try {
      updatedAtMs = new Date(data.updated_at).getTime();
    } catch {
      updatedAtMs = 0;
    }
  }

  return sleepUserProfileFromJson({
    nights: data.nights ?? 0,
    hr_floor_p5: data.hr_floor_p5 ?? undefined,
    hr_floor_p25: data.hr_floor_p25 ?? undefined,
    hr_sleep_median: data.hr_sleep_median ?? undefined,
    hr_arousal: data.hr_arousal ?? undefined,
    rmssd_med: data.rmssd_med_ms ?? undefined,
    rmssd_mad: data.rmssd_mad_ms ?? undefined,
    enmo_still_cut: data.enmo_still_cut_g ?? undefined,
    enmo_move_cut: data.enmo_move_cut_g ?? undefined,
    lfhf_med: data.lfhf_med ?? undefined,
    rk_med: data.rk_med_bpm ?? undefined,
    updated_at_ms: updatedAtMs,
  });
}

export async function upsertUserProfile(
  supabase: SupabaseClient,
  userId: string,
  profile: SleepUserProfile,
): Promise<boolean> {
  const profileJson = profile.toJson();
  const data = {
    user_id: userId,
    nights: profile.nights,
    hr_floor_p5: profileJson.hr_floor_p5 ?? null,
    hr_floor_p25: profileJson.hr_floor_p25 ?? null,
    hr_sleep_median: profileJson.hr_sleep_median ?? null,
    hr_arousal: profileJson.hr_arousal ?? null,
    rmssd_med_ms: profileJson.rmssd_med ?? null,
    rmssd_mad_ms: profileJson.rmssd_mad ?? null,
    enmo_still_cut_g: profileJson.enmo_still_cut ?? null,
    enmo_move_cut_g: profileJson.enmo_move_cut ?? null,
    lfhf_med: profileJson.lfhf_med ?? null,
    rk_med_bpm: profileJson.rk_med ?? null,
    personal_weight: profile.personalWeight,
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase.from('sleep_user_profiles').upsert(data).select().single();
    return !error;
  } catch {
    return false;
  }
}

// ── Storage Functions ────────────────────────────────────────────────────

export async function storeResults(
  supabase: SupabaseClient,
  userId: string,
  logDate: string,
  segmentation: SleepSegmentation,
  features: CardioEpochFeatures[],
  observation: SleepNightObservation | null,
  updatedProfile: SleepUserProfile | null,
): Promise<boolean> {
  try {
    // 1. Store segmentation
    const segData = {
      user_id: userId,
      log_date: logDate,
      session_start: new Date(segmentation.inBedStartS * 1000).toISOString(),
      session_end: new Date(segmentation.inBedEndS * 1000).toISOString(),
      sleep_onset: segmentation.sleepOnsetS
        ? new Date(segmentation.sleepOnsetS * 1000).toISOString()
        : null,
      sleep_offset: segmentation.sleepOffsetS
        ? new Date(segmentation.sleepOffsetS * 1000).toISOString()
        : null,
      epoch_sec: segmentation.epochSec,
      stages: segmentation.stages,
      deep_flags: segmentation.deepFlag,
      total_epochs: segmentation.stages.length,
      wake_pct: Math.round(
        (segmentation.stages.filter(s => s === 0).length / Math.max(1, segmentation.stages.length)) * 10000
      ) / 100,
      nrem_pct: Math.round(
        (segmentation.stages.filter(s => s === 1).length / Math.max(1, segmentation.stages.length)) * 10000
      ) / 100,
      rem_pct: Math.round(
        (segmentation.stages.filter(s => s === 2).length / Math.max(1, segmentation.stages.length)) * 10000
      ) / 100,
      deep_pct: Math.round(
        (segmentation.deepFlag.filter(Boolean).length / Math.max(1, segmentation.deepFlag.length)) * 10000
      ) / 100,
      unobserved_sec: segmentation.unobservedSec,
      confidence: segmentation.confidence,
      sleep_windows: [],
      config: { epoch_sec: segmentation.epochSec },
    };

    const { data: segResult, error: segError } = await supabase
      .from('sleep_segmentations')
      .insert(segData)
      .select('id')
      .single();

    if (segError || !segResult) {
      console.error('Segmentation insert error:', segError);
      return false;
    }
    const segmentationId = segResult.id;

    // 2. Store epoch features
    const epochData = features.map((feat, i) => ({
      segmentation_id: segmentationId,
      epoch_index: i,
      epoch_start: new Date(feat.epochStartS * 1000).toISOString(),
      enmo_median: feat.enmoMedian,
      enmo_p95: feat.enmoP95,
      still_frac: feat.stillFrac,
      immobile_frac: feat.immobileFrac,
      hr_median: feat.hrMedian ?? null,
      hr_p5: feat.hrP5 ?? null,
      hr_p25: feat.hrP25 ?? null,
      valid_hr_frac: feat.validHrFrac,
      rmssd_ms: feat.rmssd ?? null,
      lfhf_ratio: feat.lfhf ?? null,
      rk_bpm: feat.rk ?? null,
      valid_rr_frac: feat.validRrFrac,
      stage: segmentation.stages[i] ?? 0,
      deep_flag: segmentation.deepFlag[i] ?? false,
    }));

    if (epochData.length > 0) {
      const { error: epochError } = await supabase
        .from('sleep_epoch_features')
        .insert(epochData);
      if (epochError) {
        console.error('Epoch features insert error:', epochError);
        return false;
      }
    }

    // 3. Store observation
    if (observation) {
      const obsData = {
        user_id: userId,
        segmentation_id: segmentationId,
        log_date: logDate,
        hr_floor_p5: observation.hrFloorP5 ?? null,
        hr_floor_p25: observation.hrFloorP25 ?? null,
        hr_sleep_median: observation.hrSleepMedian ?? null,
        hr_arousal: observation.hrArousal ?? null,
        rmssd_med_ms: observation.rmssdMed ?? null,
        rmssd_mad_ms: observation.rmssdMad ?? null,
        enmo_still_cut_g: observation.enmoStillCut ?? null,
        enmo_move_cut_g: observation.enmoMoveCut ?? null,
        lfhf_med: observation.lfhfMed ?? null,
        rk_med_bpm: observation.rkMed ?? null,
      };

      const { error: obsError } = await supabase
        .from('sleep_night_observations')
        .insert(obsData);
      if (obsError) {
        console.error('Observation insert error:', obsError);
        return false;
      }
    }

    // 4. Update profile
    if (updatedProfile) {
      await upsertUserProfile(supabase, userId, updatedProfile);
    }

    return true;
  } catch (e) {
    console.error('Error storing results:', e);
    return false;
  }
}

// ── High-level Pipeline ──────────────────────────────────────────────────

function buildSleepSession(
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

function runSleepStaging(
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

export async function processSleepData(
  raw: RawSleepData,
  supabase: SupabaseClient,
  config: AdvancedSleepStager | null = null,
): Promise<PipelineResult> {
  try {
    // 1. Get or create profile
    const profile = await getUserProfile(supabase, raw.user_id);

    // 2. Build session
    const session = buildSleepSession(raw, profile);

    // 3. Run sleep staging
    const [segmentation, features] = runSleepStaging(session, config);

    // 4. Extract observation
    const observation = extractNightlyObservation(segmentation, features);

    // 5. Fold observation into profile
    let updatedProfile: SleepUserProfile | null = null;
    if (observation) {
      updatedProfile = profile.fold(observation, 14);
    }

    // 6. Store in Supabase
    const stored = await storeResults(
      supabase,
      raw.user_id,
      raw.log_date,
      segmentation,
      features,
      observation,
      updatedProfile,
    );

    return {
      segmentation,
      features,
      observation,
      profile: updatedProfile,
      stored,
      error: null,
    };
  } catch (e) {
    return {
      segmentation: null,
      features: [],
      observation: null,
      profile: null,
      stored: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Webhook Payload Processing ───────────────────────────────────────────

export interface WebhookPayload {
  user_id: string;
  log_date: string;
  accel: unknown[];
  hr: unknown[];
  rr: unknown[];
  in_bed_start_s: number;
  in_bed_end_s: number;
  config?: Record<string, unknown>;
}

// Validation constants
const MAX_SAMPLES = 100000;
const HR_MIN = 30;
const HR_MAX = 250;
const RR_MIN = 300;
const RR_MAX = 2000;
const TIMESTAMP_TOLERANCE_MS = 2 * 60 * 60 * 1000; // 2 hours in ms

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateWebhookPayload(payload: WebhookPayload): ValidationResult {
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

export function parseWebhookPayload(payload: WebhookPayload): RawSleepData {
  const validation = validateWebhookPayload(payload);
  if (!validation.valid) {
    throw new Error(`Payload validation failed: ${validation.errors.join('; ')}`);
  }

  const config = payload.config ?? {};
  // FIX: use snake_case epoch_sec from config (matching Python/Python API)
  const epochSec = typeof config.epoch_sec === 'number' ? config.epoch_sec : DEFAULT_EPOCH_SEC;

  return {
    user_id: payload.user_id,
    log_date: payload.log_date,
    accel: parseAccelSamples(payload.accel),
    hr: parseHrSamples(payload.hr),
    rr: parseRrSeries(payload.rr),
    in_bed_start_s: payload.in_bed_start_s,
    in_bed_end_s: payload.in_bed_end_s,
    config: { epoch_sec: epochSec },
  };
}

export async function processWebhookPayload(
  payload: WebhookPayload,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<PipelineResult> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const raw = parseWebhookPayload(payload);
  // FIX: config is already snake_case (epoch_sec), convert to camelCase for factory
  const config = raw.config ? createAdvancedSleepStager({ epochSec: raw.config.epoch_sec }) : null;
  return processSleepData(raw, supabase, config);
}