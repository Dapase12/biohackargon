/**
 * Webhook payload processing.
 */

import type {
  WebhookPayload,
  RawSleepData,
  PipelineResult,
  AdvancedSleepStager,
} from './models.ts';
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateWebhookPayload } from './pipeline-validation.ts';
import { parseAccelSamples, parseHrSamples, parseRrSeries } from './pipeline-parsing.ts';
import { processSleepData } from './pipeline-process.ts';
import { createAdvancedSleepStager, DEFAULT_EPOCH_SEC } from './models.ts';

/**
 * Parse and validate webhook payload into RawSleepData.
 */
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

/**
 * Process webhook payload end-to-end.
 */
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