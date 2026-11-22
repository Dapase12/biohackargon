/**
 * ARGON v7.0 — ETL Type Definitions
 * Types for ghealth CLI data structures and transformer outputs.
 */

// ========================================================================
// GHEALTH RAW RESPONSE TYPES (from Google Health API v4)
// ========================================================================

export interface GHealthSleepSession {
  startTimeMillis: string;
  endTimeMillis: string;
  isNap: boolean;
  sleepQuality: string;
  stageMinutes: Record<string, string>;
  stages: Array<{
    start: number;
    end: number;
    type: string;
  }>;
}

export interface GHealthSleepListResponse {
  sessions: GHealthSleepSession[];
  nextPageToken: string | null;
}

export interface GHealthHrvSample {
  startTimeMillis: string;
  endTimeMillis: string;
  rootMeanSquareOfSuccessiveDifferencesMilliseconds: string;
}

export interface GHealthHrvListResponse {
  samples: GHealthHrvSample[];
  nextPageToken: string | null;
}

export interface GHealthExerciseSession {
  startTimeMillis: string;
  endTimeMillis: string;
  name: string;
  type: string;
  averageHeartRateBeatsPerMinute: string | null;
  maxHeartRateBeatsPerMinute: string | null;
  caloriesBurned: string | null;
}

export interface GHealthExerciseListResponse {
  sessions: GHealthExerciseSession[];
  nextPageToken: string | null;
}

export interface GHealthHrSampleRaw {
  startTimeMillis: string;
  endTimeMillis: string;
  beatsPerMinute: string;
}

export interface GHealthHrListResponse {
  samples: GHealthHrSampleRaw[];
  nextPageToken: string | null;
}

export type GHealthExerciseEventType = 'PAUSE' | 'RESUME';

export interface GHealthExerciseEvent {
  startTimeMillis: string;
  endTimeMillis: string;
  type: GHealthExerciseEventType;
}

export interface GHealthExerciseEventsResponse {
  events: GHealthExerciseEvent[];
  nextPageToken: string | null;
}

export interface GHealthBodyCompositionSample {
  startTimeMillis: string;
  endTimeMillis: string;
  weight: { value: string; unit: string };
  bodyFatPercentage: { value: string; unit: string };
}

export interface GHealthBodyCompositionResponse {
  samples: GHealthBodyCompositionSample[];
  nextPageToken: string | null;
}

// ========================================================================
// PARSED/INTERNAL TYPES (after parsing from ghealth)
// ========================================================================

export interface ParsedSleepSession {
  startTimeMillis: number;
  endTimeMillis: number;
  isNap: boolean;
  sleepQuality: string;
  stageMinutes: Record<string, number>;
  stages: Array<{
    start: number;
    end: number;
    type: string;
  }>;
  durationMin: number;
}

export interface ParsedHrvSample {
  startTimeMillis: number;
  endTimeMillis: number;
  rmssd: number | null;
}

export interface ParsedExerciseSession {
  startTimeMillis: number;
  endTimeMillis: number;
  name: string;
  type: string;
  averageHeartRateBeatsPerMinute: number | null;
  maxHeartRateBeatsPerMinute: number | null;
  caloriesBurned: number | null;
  durationMin: number;
}

export interface ParsedHrSample {
  startTimeMillis: number;
  endTimeMillis: number;
  bpm: number;
}

export interface ParsedExerciseEvent {
  startTimeMillis: number;
  endTimeMillis: number;
  type: 'PAUSE' | 'RESUME';
}

export interface ParsedBodyCompositionSample {
  startTimeMillis: number;
  endTimeMillis: number;
  weightKg: number | null;
  bodyFatPct: number | null;
}

// ========================================================================
// TRANSFORMER OUTPUT TYPES
// ========================================================================

export interface HrZoneMinutes {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
  real: boolean;
  workouts: Array<{
    startTimeMillis: number;
    endTimeMillis: number;
    name: string;
    type: string;
    zones: {
      z1: number;
      z2: number;
      z3: number;
      z4: number;
      z5: number;
    };
  }>;
}

export interface SleepTransformerOutput {
  log_date: string;
  total_sleep_min: number | null;
  deep_sleep_min: number | null;
  rem_sleep_min: number | null;
  light_sleep_min: number | null;
  awake_sleep_min: number | null;
  sleep_efficiency_pct: number | null;
  time_in_bed_min: number | null;
  sleep_onset_latency_min: number | null;
  nap_sleep_min: number | null;
  sleep_hours_vs_needed_pct: number | null;
  sleep_regularity_pct: number | null;
  high_sleep_stress_pct: number | null;
  sleep_architecture_score: number | null;
  sleep_debt_h: number | null;
  dynamic_sleep_need_h: number | null;
  optimal_bedtime_start: string | null;
  optimal_bedtime_end: string | null;
  cumulative_sleep_debt_hours: number | null;
  naps_count: number;
  naps_total_min: number;
  hrv_nocturnal_median: number | null;
  hrv_deep_sleep_median: number | null;
  hrv_nocturnal_count: number;
  hrv_mode: 'night' | 'nap' | 'fallback';
}

export interface ExerciseTransformerOutput {
  log_date: string;
  duration_min: number;
  kcal: number;
  avg_hr: number | null;
  max_hr: number | null;
  zones: HrZoneMinutes;
}

export interface BodyCompositionTransformerOutput {
  log_date: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  fat_mass_kg: number | null;
  ffm_kg: number | null;
  muscle_mass_kg: number | null;
  water_kg: number | null;
  bone_mass_kg: number | null;
  visceral_fat_index: number | null;
  bmi: number | null;
}

// ========================================================================
// USER PROFILE FOR CALCULATIONS
// ========================================================================

export interface UserEtlProfile {
  age: number;
  restingHR: number;
  maxHR: number; // Tanaka formula: 208 - 0.7 * age
  biologicalSex: 'male' | 'female';
  heightM: number;
}

// ========================================================================
// SYNC CLI TYPES
// ========================================================================

export interface SyncOptions {
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  dryRun?: boolean;
  backfill?: boolean;
  userId: string;
}

export interface SyncResult {
  date: string;
  success: boolean;
  error?: string;
  rowsAffected: number;
}