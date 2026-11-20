/**
 * Pipeline types and interfaces.
 */

import type {
  AccelSample,
  AdvancedSleepStager,
  CardioEpochFeatures,
  HrSample,
  RrSeries,
  SleepNightObservation,
  SleepSegmentation,
  SleepSession,
  SleepUserProfile,
} from './models.ts';

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

// ── Webhook Payload Types ───────────────────────────────────────────────────

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

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}