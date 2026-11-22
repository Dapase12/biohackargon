/**
 * ARGON v7.0 — ETL Type Definitions
 * Types for ghealth CLI data structures and transformer outputs.
 * Matches actual ghealth CLI SIMPLIFIED JSON output (--format json).
 * See google-health-cli/pkg/output/simplify.go for source of truth.
 */

// ========================================================================
// GHEALTH SIMPLIFIED JSON RESPONSE TYPES (--format json)
// ========================================================================

// Common simplified dataPoint structure
export interface GHealthSimplifiedDataPoint {
  source: string;
  id: string;
}

// Heart Rate: dataPoints with time, beatsPerMinute
export interface GHealthHrvSimplifiedSample extends GHealthSimplifiedDataPoint {
  time: string; // ISO 8601 with offset, e.g. "2026-03-29T17:05:00+01:00"
  rmssd: number; // rootMeanSquareOfSuccessiveDifferencesMilliseconds
}

export interface GHealthHrSimplifiedSample extends GHealthSimplifiedDataPoint {
  time: string; // ISO 8601 with offset
  beatsPerMinute: number;
}

export interface GHealthHrListResponse {
  dataPoints: GHealthHrSimplifiedSample[];
  nextPageToken: string | null;
}

export interface GHealthHrvListResponse {
  dataPoints: GHealthHrvSimplifiedSample[];
  nextPageToken: string | null;
}

// Exercise: dataPoints with start, end, type, name, caloriesKcal, averageHeartRateBeatsPerMinute, maxHeartRateBeatsPerMinute
export interface GHealthExerciseSimplifiedSession extends GHealthSimplifiedDataPoint {
  start: string; // ISO 8601 with offset
  end: string;   // ISO 8601 with offset
  type: string;
  name: string;
  caloriesKcal: number;
  averageHeartRateBeatsPerMinute: number;
  maxHeartRateBeatsPerMinute: number;
}

export interface GHealthExerciseListResponse {
  dataPoints: GHealthExerciseSimplifiedSession[];
  nextPageToken: string | null;
}

// Exercise Events: rollupDataPoints with start, end, type
export interface GHealthExerciseEvent {
  start: string; // ISO 8601
  end: string;   // ISO 8601
  type: 'PAUSE' | 'RESUME';
}

export interface GHealthExerciseEventsResponse {
  rollupDataPoints: GHealthExerciseEvent[];
  nextPageToken: string | null;
}

// Sleep: dataPoints with start, end, sleepType, isNap, minutesAsleep, minutesAwake, totalMinutes, minutesToFallAsleep, stageMinutes, stages (with --detail)
export interface GHealthSleepSimplifiedSession extends GHealthSimplifiedDataPoint {
  start: string; // ISO 8601 with offset
  end: string;   // ISO 8601 with offset
  sleepType: string;
  isNap: boolean;
  minutesAsleep: number;
  minutesAwake: number;
  totalMinutes: number;
  minutesToFallAsleep: number;
  stageMinutes: Record<string, number>; // e.g. { "DEEP": 120, "LIGHT": 200, "REM": 90, "AWAKE": 30 }
  stages?: Array<{
    type: string;
    start: string; // ISO 8601 with offset
    end: string;   // ISO 8601 with offset
  }>;
}

export interface GHealthSleepListResponse {
  dataPoints: GHealthSleepSimplifiedSession[];
  nextPageToken: string | null;
}

// Weight: dataPoints with time (ISO 8601 with offset) or date (YYYY-MM-DD), weightGrams, unit
export interface GHealthWeightSimplifiedSample extends GHealthSimplifiedDataPoint {
  time?: string; // ISO 8601 with offset (from sampleTime in simplify.go)
  date?: string; // YYYY-MM-DD fallback
  weightGrams: number; // int64 value in grams
  unit: string; // "g" or "kg"
}

export interface GHealthWeightListResponse {
  dataPoints: GHealthWeightSimplifiedSample[];
  nextPageToken: string | null;
}

// Body Fat: dataPoints with time (ISO 8601 with offset) or date (YYYY-MM-DD), percentage, unit
// simplify.go copies percentage directly (float 0-100, e.g., 20.2)
export interface GHealthBodyFatSimplifiedSample extends GHealthSimplifiedDataPoint {
  time?: string; // ISO 8601 with offset (from sampleTime in simplify.go)
  date?: string; // YYYY-MM-DD fallback
  percentage: number; // float value 0-100 like 20.2 (NOT *100)
  unit: string; // "%"
}

export interface GHealthBodyFatListResponse {
  dataPoints: GHealthBodyFatSimplifiedSample[];
  nextPageToken: string | null;
}

// ========================================================================
// PARSED/INTERNAL TYPES (after parsing from ghealth simplified JSON)
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
  localDate?: string; // Local date YYYY-MM-DD from timestamp prefix
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
  hrv_mode: 'night' | 'nap' | 'deep' | 'fallback';
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