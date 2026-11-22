#!/usr/bin/env node
/**
 * ARGON v7.0 — Sync ghealth CLI → Supabase
 *
 * Fetches biometric data from Google Health via ghealth CLI,
 * transforms it, and upserts to Supabase with atomic operations
 * preserving meals_log_json and session_rpe.
 *
 * Usage:
 *   npx tsx src/etl/sync-ghealth.ts --from 2024-11-01 --to 2024-11-30 --user-id <uuid>
 *   npx tsx src/etl/sync-ghealth.ts --backfill --user-id <uuid>
 *   npx tsx src/etl/sync-ghealth.ts --from 2024-11-20 --dry-run --user-id <uuid>
 */

import { program } from 'commander';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createGHealthClient } from './ghealth-client';
import {
  parseSleepSessions,
  parseHrvSamples,
  crossReferenceHrvWithSleep,
  buildSleepTransformerOutput,
  parseExerciseSessions,
  parseHrSamples,
  parseExerciseEvents,
  filterHrDuringExercise,
  classifyHrZonesKarvonen,
  buildExerciseTransformerOutput,
  parseBodyCompositionSamples,
  crossReferenceWeightAndBodyFat,
  computeBodyCompositionMetrics,
} from './transformers';
import type {
  SleepTransformerOutput,
  ExerciseTransformerOutput,
  BodyCompositionTransformerOutput,
  UserEtlProfile,
  SyncOptions,
  SyncResult,
} from './types';

// ========================================================================
// CONFIGURATION
// ========================================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Default user profile (fallback if profiles table not found)
const DEFAULT_PROFILE: UserEtlProfile = {
  age: 30,
  restingHR: 55,
  maxHR: 187,
  biologicalSex: 'male',
  heightM: 1.75,
};

/**
 * Format Supabase/PostgREST error for logging - extracts message, code, details, hint
 */
function formatError(err: unknown): string {
  if (!err) return 'Unknown error';

  // PostgREST error object
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === 'string') parts.push(e.message);
    if (typeof e.code === 'string') parts.push(`code: ${e.code}`);
    if (typeof e.details === 'string') parts.push(`details: ${e.details}`);
    if (typeof e.hint === 'string') parts.push(`hint: ${e.hint}`);
    if (parts.length > 0) return parts.join(' | ');
    // Fallback: stringify the whole object
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  return String(err);
}

/**
 * Fetch user profile from profiles table, fallback to DEFAULT_PROFILE
 * profiles table has: birth_date, height_m, biological_sex, timezone, etc.
 * resting_hr and max_hr are computed from age if not present
 */
async function fetchUserProfile(userId: string): Promise<UserEtlProfile> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('birth_date, height_m, biological_sex, resting_hr, max_hr')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      console.warn(`[PROFILE] profiles not found for ${userId}, using DEFAULT_PROFILE`);
      return DEFAULT_PROFILE;
    }

    // Compute age from birth_date
    const birthDate = new Date(data.birth_date);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    // Compute maxHR from Tanaka formula if not stored
    const maxHR = data.max_hr ?? Math.round(208 - 0.7 * age);

    return {
      age,
      restingHR: data.resting_hr ?? DEFAULT_PROFILE.restingHR,
      maxHR,
      biologicalSex: data.biological_sex,
      heightM: data.height_m,
    };
  } catch (error) {
    console.warn(`[PROFILE] Error fetching profile for ${userId}:`, formatError(error));
    return DEFAULT_PROFILE;
  }
}

// ========================================================================
// DATE UTILITIES
// ========================================================================

function formatDate(date: Date): string {
  // Use UTC to ensure consistent date strings regardless of local timezone
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateArg(dateStr: string): Date {
  // Parse YYYY-MM-DD as UTC midnight for determinism
  const regex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = dateStr.match(regex);
  if (!match) {
    throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD`);
  }
  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10) - 1;
  const day = parseInt(match[3]!, 10);
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

/**
 * Format date as YYYY-MM-DD for ghealth CLI --from/--to flags.
 * ghealth --to is EXCLUSIVE, so pass D+1 to include day D.
 */
function formatGHealthDate(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}

/**
 * Get date range for ghealth CLI.
 * ghealth CLI --to is INCLUSIVE of the named day (it advances to next day internally).
 * Returns { from: YYYY-MM-DD, to: YYYY-MM-DD (inclusive, same as end date) }
 */
function getDateRange(from: string | undefined, to: string | undefined): { from: string; to: string } {
  const end = to ? parseDateArg(to) : new Date();

  const start = from ? parseDateArg(from) : new Date(end.getTime() - 30 * 86400000);

  return {
    from: formatGHealthDate(start),
    to: formatGHealthDate(end), // CLI handles --to as inclusive
  };
}

// ========================================================================
// TRANSFORMERS
// ========================================================================

async function transformSleepData(
  sleepSessions: any[],
  hrvSamples: any[],
  date: string
): Promise<SleepTransformerOutput | null> {
  const parsedSleep = parseSleepSessions({ dataPoints: sleepSessions, nextPageToken: null });
  const parsedHrv = parseHrvSamples({ dataPoints: hrvSamples, nextPageToken: null });

  // Defense-in-depth: filter sleep sessions to only those ending on the target date (local time)
  const sleepOnDate = parsedSleep.filter(s => {
    const endDate = new Date(s.endTimeMillis).toISOString().slice(0, 10);
    return endDate === date;
  });

  if (sleepOnDate.length === 0) return null;

  // For HRV cross-reference, we need HRV samples that could fall in sleep sessions
  // that END on this date. Sleep starting D-1 23:00 ending D 07:00 should include
  // HRV from D-1 night. Fetch HRV from D-1 to D+1 would be ideal, but for now
  // we rely on the CLI query window and cross-reference strictly against sleep windows.
  return buildSleepTransformerOutput(date, sleepOnDate, parsedHrv, { includeNaps: false });
}

async function transformExerciseData(
  exerciseSessions: any[],
  hrSamples: any[],
  exerciseEvents: any[],
  date: string,
  profile: UserEtlProfile
): Promise<ExerciseTransformerOutput[]> {
  const parsedExercises = parseExerciseSessions({ dataPoints: exerciseSessions, nextPageToken: null });
  const parsedHr = parseHrSamples({ dataPoints: hrSamples, nextPageToken: null });
  const parsedEvents = parseExerciseEvents({ rollupDataPoints: exerciseEvents, nextPageToken: null });

  // Defense-in-depth: filter exercise sessions to only those starting on the target date (local time)
  const exercisesOnDate = parsedExercises.filter(s => {
    const startDate = new Date(s.startTimeMillis).toISOString().slice(0, 10);
    return startDate === date;
  });

  const results: ExerciseTransformerOutput[] = [];

  for (const session of exercisesOnDate) {
    const filteredHr = filterHrDuringExercise(parsedHr, session, parsedEvents);
    const zones = classifyHrZonesKarvonen(filteredHr, profile);
    const output = buildExerciseTransformerOutput(date, session, filteredHr, zones, profile);
    results.push(output);
  }

  return results;
}

async function transformBodyCompositionData(
  weightSamples: any[],
  bodyFatSamples: any[],
  date: string,
  profile: UserEtlProfile
): Promise<BodyCompositionTransformerOutput | null> {
  const parsed = parseBodyCompositionSamples(
    { dataPoints: weightSamples, nextPageToken: null },
    { dataPoints: bodyFatSamples, nextPageToken: null }
  );
  const paired = crossReferenceWeightAndBodyFat(parsed);

  const dayData = paired.find((p: { date: string; weightKg: number | null; bodyFatPct: number | null }) => p.date === date);
  if (!dayData || dayData.weightKg === null) return null;

  return computeBodyCompositionMetrics(date, dayData, profile);
}

// ========================================================================
// DATABASE OPERATIONS
// ========================================================================

interface DailyRawBiometrics {
  user_id: string;
  log_date: string;
  // HRV
  hrv_rmssd_ms?: number | null;
  hrv_sdnn_ms?: number | null;
  hrv_pnn50_pct?: number | null;
  // RHR
  rhr_bpm?: number | null;
  // Sleep
  sleep_score?: number | null;
  total_sleep_min?: number | null;
  deep_sleep_min?: number | null;
  rem_sleep_min?: number | null;
  light_sleep_min?: number | null;
  awake_sleep_min?: number | null;
  sleep_efficiency_pct?: number | null;
  time_in_bed_min?: number | null;
  sleep_onset_latency_min?: number | null;
  naps_count?: number;
  naps_total_min?: number;
  // Activity
  steps?: number | null;
  active_calories?: number | null;
  exercise_min?: number | null;
  exercise_type?: string | null;
  exercise_intensity?: string | null;
  // Body Composition
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  muscle_mass_kg?: number | null;
  hydration_ml?: number | null;
  // Nutrition
  intake_kcal?: number | null;
  intake_protein_g?: number | null;
  intake_carbs_g?: number | null;
  intake_fat_g?: number | null;
  meals_log_json?: any;
  // HR zones (individual columns + jsonb)
  z1_minutes?: number | null;
  z2_minutes?: number | null;
  z3_minutes?: number | null;
  z4_minutes?: number | null;
  z5_minutes?: number | null;
  hr_zones_minutes?: any;
  // Respiratory rate
  resp_rate_brpm?: number | null;
  // SpO2
  spo2_pct?: number | null;
  // Hospital shift
  is_hospital_shift?: boolean | null;
  night_awake_shift_hours?: number | null;
  // Subjective
  session_rpe?: number | null;
  pickleball_or_gym_minutes?: number | null;
  // Metadata
  raw_payload_hash?: string | null;
  source?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface ComputedDailyScores {
  user_id: string;
  log_date: string;
  recovery_score?: number | null;
  recovery_status?: string | null;
  recommended_max_strain?: number | null;
  strain_score?: number | null;
  trimp_total?: number | null;
  hr_z1_min?: number | null;
  hr_z2_min?: number | null;
  hr_z3_min?: number | null;
  hr_z4_min?: number | null;
  hr_z5_min?: number | null;
  acwr_7d?: number | null;
  neuro_load_score?: number | null;
  shift_load_score?: number | null;
  sleep_architecture_score?: number | null;
  sleep_regularity_pct?: number | null;
  sleep_debt_h?: number | null;
  dynamic_sleep_need_h?: number | null;
  optimal_bedtime_start?: string | null;
  optimal_bedtime_end?: string | null;
  high_sleep_stress_pct?: number | null;
  cumulative_sleep_debt_hours?: number | null;
  ln_rmssd?: number | null;
  ln_rmssd_14d_mean?: number | null;
  ln_rmssd_14d_sd?: number | null;
  hrv_z_score?: number | null;
  hrv_swc?: number | null;
  hrv_baseline_rmssd?: number | null;
  hrv_7d_avg_rmssd?: number | null;
  hrv_14d_avg_rmssd?: number | null;
  dynamic_rmssd_cap_ms?: number | null;
  cv_lnrmssd_7d_pct?: number | null;
  rhr_bpm?: number | null;
  rhr_14d_mean_bpm?: number | null;
  rhr_z_score?: number | null;
  rhr_baseline?: number | null;
  rhr_7d_avg?: number | null;
  ffm_kg?: number | null;
  ffm_pct?: number | null;
  muscle_mass_kg?: number | null;
  bone_mass_kg?: number | null;
  water_kg?: number | null;
  visceral_fat_index?: number | null;
  bmi?: number | null;
  body_comp_score?: number | null;
  chronological_age?: number | null;
  argon_physiological_age?: number | null;
  pace_of_aging_x?: number | null;
  total_age_delta?: number | null;
  vo2_max_ml_kg_min?: number | null;
  target_kcal?: number | null;
  target_protein_g?: number | null;
  target_carbs_g?: number | null;
  target_fat_g?: number | null;
  hydration_score?: number | null;
  tef_kcal?: number | null;
  readiness_score?: number | null;
  sleep_missing?: boolean;
  hrv_missing?: boolean;
  calibrating?: boolean;
  meals_log_json?: any;
  session_rpe?: number | null;
  computation_version?: string;
  engine_version?: string;
  computed_at?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Atomic upsert for daily_raw_biometrics preserving meals_log_json and session_rpe
 */
async function upsertDailyRawBiometrics(
  client: SupabaseClient,
  data: DailyRawBiometrics
): Promise<{ success: boolean; error?: string }> {
  try {
    // First, try to get existing row to preserve meals_log_json and session_rpe
    const { data: existing } = await client
      .from('daily_raw_biometrics')
      .select('meals_log_json, session_rpe')
      .eq('user_id', data.user_id)
      .eq('log_date', data.log_date)
      .single();

    const payload = {
      ...data,
      meals_log_json: existing?.meals_log_json ?? data.meals_log_json ?? null,
      session_rpe: existing?.session_rpe ?? data.session_rpe ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await client
      .from('daily_raw_biometrics')
      .upsert(payload, { onConflict: 'user_id,log_date' });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * Upsert computed daily scores
 */
async function upsertComputedDailyScores(
  client: SupabaseClient,
  data: ComputedDailyScores
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload = {
      ...data,
      computation_version: 'v7.0-mbe',
      engine_version: '7.0.0',
      computed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await client
      .from('computed_daily_scores')
      .upsert(payload, { onConflict: 'user_id,log_date' });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Build daily_raw_biometrics from sleep transformer output
 * Maps SleepTransformerOutput fields to daily_raw_biometrics schema columns
 */
function buildRawBiometricsFromSleep(
  userId: string,
  date: string,
  sleep: SleepTransformerOutput
): DailyRawBiometrics {
  return {
    user_id: userId,
    log_date: date,
    // HRV: use nocturnal median as rmssd
    hrv_rmssd_ms: sleep.hrv_nocturnal_median ? Math.round(sleep.hrv_nocturnal_median * 100) / 100 : null,
    // RHR: not available from sleep alone
    rhr_bpm: null,
    // Sleep
    sleep_score: null, // computed elsewhere
    total_sleep_min: sleep.total_sleep_min ? Math.round(sleep.total_sleep_min) : null,
    deep_sleep_min: sleep.deep_sleep_min ? Math.round(sleep.deep_sleep_min) : null,
    rem_sleep_min: sleep.rem_sleep_min ? Math.round(sleep.rem_sleep_min) : null,
    light_sleep_min: sleep.light_sleep_min ? Math.round(sleep.light_sleep_min) : null,
    awake_sleep_min: sleep.awake_sleep_min ? Math.round(sleep.awake_sleep_min) : null,
    sleep_efficiency_pct: sleep.sleep_efficiency_pct ? Math.round(sleep.sleep_efficiency_pct * 10) / 10 : null,
    time_in_bed_min: sleep.time_in_bed_min ? Math.round(sleep.time_in_bed_min) : null,
    sleep_onset_latency_min: sleep.sleep_onset_latency_min ? Math.round(sleep.sleep_onset_latency_min) : null,
    naps_count: sleep.naps_count ?? 0,
    naps_total_min: sleep.naps_total_min ?? 0,
    // Activity: not from sleep
    steps: null,
    active_calories: null,
    exercise_min: null,
    exercise_type: null,
    exercise_intensity: null,
    // Body composition: not from sleep
    weight_kg: null,
    body_fat_pct: null,
    muscle_mass_kg: null,
    hydration_ml: null,
    // Nutrition: not from sleep
    intake_kcal: null,
    intake_protein_g: null,
    intake_carbs_g: null,
    intake_fat_g: null,
    meals_log_json: null,
    // HR zones: not from sleep
    z1_minutes: null,
    z2_minutes: null,
    z3_minutes: null,
    z4_minutes: null,
    z5_minutes: null,
    hr_zones_minutes: null,
    // Respiratory rate / SpO2: not available
    resp_rate_brpm: null,
    spo2_pct: null,
    // Hospital shift
    is_hospital_shift: false,
    night_awake_shift_hours: null,
    // Subjective
    session_rpe: null,
    pickleball_or_gym_minutes: null,
    // Metadata
    raw_payload_hash: null,
    source: 'health_connect',
  };
}

/**
 * Build daily_raw_biometrics from exercise transformer outputs
 */
function buildRawBiometricsFromExercise(
  userId: string,
  date: string,
  exercises: ExerciseTransformerOutput[]
): DailyRawBiometrics {
  if (exercises.length === 0) {
    return { user_id: userId, log_date: date };
  }

  // Aggregate multiple workouts
  const totalDuration = exercises.reduce((sum, e) => sum + e.duration_min, 0);
  const totalKcal = exercises.reduce((sum, e) => sum + e.kcal, 0);
  const maxHr = Math.max(...exercises.map(e => e.max_hr ?? 0).filter(h => h > 0));
  const avgHr = exercises.reduce((sum, e) => sum + (e.avg_hr ?? 0), 0) / exercises.length;

  // Combine HR zones (sum minutes across workouts)
  const combinedZones = exercises.reduce((acc, e) => {
    acc.z1_minutes += e.zones.z1;
    acc.z2_minutes += e.zones.z2;
    acc.z3_minutes += e.zones.z3;
    acc.z4_minutes += e.zones.z4;
    acc.z5_minutes += e.zones.z5;
    acc.real = acc.real || e.zones.real;
    acc.workouts.push(...e.zones.workouts);
    return acc;
  }, {
    z1_minutes: 0,
    z2_minutes: 0,
    z3_minutes: 0,
    z4_minutes: 0,
    z5_minutes: 0,
    real: false,
    workouts: [] as any[],
  });

  // Determine primary exercise type from first workout
  const primaryType = exercises[0]?.zones.workouts[0]?.type ?? null;

  return {
    user_id: userId,
    log_date: date,
    // Activity
    steps: null, // not from exercise sessions
    active_calories: Math.round(totalKcal),
    exercise_min: Math.round(totalDuration),
    exercise_type: primaryType,
    exercise_intensity: maxHr > 0 && avgHr > 0 ? (avgHr / maxHr > 0.8 ? 'vigorous' : avgHr / maxHr > 0.6 ? 'moderate' : 'light') : null,
    // HR zones (individual columns - rounded integers)
    z1_minutes: Math.round(combinedZones.z1_minutes),
    z2_minutes: Math.round(combinedZones.z2_minutes),
    z3_minutes: Math.round(combinedZones.z3_minutes),
    z4_minutes: Math.round(combinedZones.z4_minutes),
    z5_minutes: Math.round(combinedZones.z5_minutes),
    hr_zones_minutes: combinedZones,
    // Subjective
    pickleball_or_gym_minutes: Math.round(totalDuration),
    // Other fields not from exercise
    hrv_rmssd_ms: null,
    hrv_sdnn_ms: null,
    hrv_pnn50_pct: null,
    rhr_bpm: null,
    sleep_score: null,
    total_sleep_min: null,
    deep_sleep_min: null,
    rem_sleep_min: null,
    light_sleep_min: null,
    awake_sleep_min: null,
    sleep_efficiency_pct: null,
    time_in_bed_min: null,
    sleep_onset_latency_min: null,
    naps_count: 0,
    naps_total_min: 0,
    weight_kg: null,
    body_fat_pct: null,
    muscle_mass_kg: null,
    hydration_ml: null,
    intake_kcal: null,
    intake_protein_g: null,
    intake_carbs_g: null,
    intake_fat_g: null,
    meals_log_json: null,
    resp_rate_brpm: null,
    spo2_pct: null,
    is_hospital_shift: false,
    night_awake_shift_hours: null,
    session_rpe: null,
    raw_payload_hash: null,
    source: 'health_connect',
  };
}

/**
 * Build daily_raw_biometrics from body composition transformer output
 */
function buildRawBiometricsFromBodyComp(
  userId: string,
  date: string,
  bodyComp: BodyCompositionTransformerOutput
): DailyRawBiometrics {
  return {
    user_id: userId,
    log_date: date,
    weight_kg: bodyComp.weight_kg,
    body_fat_pct: bodyComp.body_fat_pct,
  };
}

/**
 * Merge multiple raw biometrics objects (later properties win)
 */
function mergeRawBiometrics(...objects: DailyRawBiometrics[]): DailyRawBiometrics {
  return Object.assign({}, ...objects);
}

// ========================================================================
// MAIN SYNC LOGIC
// ========================================================================

async function syncDate(
  userId: string,
  date: string,
  ghealthClient: ReturnType<typeof createGHealthClient>,
  profile: UserEtlProfile,
  dryRun: boolean
): Promise<SyncResult> {
  // ghealth CLI --to is INCLUSIVE of the named day (it advances to next day internally).
  // For a single day, pass SAME date for --from and --to.
  // Parse date as UTC to match formatDate() output
  const startDate = new Date(date + 'T00:00:00Z');
  const fromGHealth = formatGHealthDate(startDate);
  const toGHealth = fromGHealth; // CLI handles --to as inclusive (advances to D+1 internally)

  try {
    // Fetch all data for this date using YYYY-MM-DD format
    const [sleepSessions, hrvSamples, exerciseSessions, hrSamples, exerciseEvents, bodyCompSamples] =
      await Promise.all([
        ghealthClient.getSleepSessions(fromGHealth, toGHealth),
        ghealthClient.getHrvSamples(fromGHealth, toGHealth),
        ghealthClient.getExerciseSessions(fromGHealth, toGHealth),
        ghealthClient.getHeartRateSamples(fromGHealth, toGHealth),
        ghealthClient.getExerciseEvents(fromGHealth, toGHealth),
        ghealthClient.getBodyCompositionSamples(fromGHealth, toGHealth),
      ]);

    // Diagnostic logging before transformers (dry-run only)
    if (dryRun) {
      const getFirstEl = (arr: any[]) => arr.length > 0 ? arr[0] : null;
      const firstSleep = getFirstEl(sleepSessions);
      const firstHrv = getFirstEl(hrvSamples);
      console.log(`[DRY RUN] ${date} - RAW RESPONSES:`, {
        rawCounts: {
          sleepSessions: sleepSessions.length,
          hrvSamples: hrvSamples.length,
          exerciseSessions: exerciseSessions.length,
          hrSamples: hrSamples.length,
          exerciseEvents: exerciseEvents.length,
          bodyCompWeight: bodyCompSamples.weight.length,
          bodyCompBodyFat: bodyCompSamples.bodyFat.length,
        },
        firstElements: {
          sleepSessions: firstSleep ? {
            start: firstSleep.start,
            end: firstSleep.end,
            isNap: firstSleep.isNap,
          } : null,
          hrvSample0: firstHrv ? {
            time: firstHrv.time,
            rootMeanSquareOfSuccessiveDifferencesMilliseconds: (firstHrv as any).rootMeanSquareOfSuccessiveDifferencesMilliseconds,
            rmssd: firstHrv.rmssd,
          } : null,
          exerciseSessions: getFirstEl(exerciseSessions),
          hrSamples: getFirstEl(hrSamples),
          exerciseEvents: getFirstEl(exerciseEvents),
          bodyCompWeight: getFirstEl(bodyCompSamples.weight),
          bodyCompBodyFat: getFirstEl(bodyCompSamples.bodyFat),
        },
      });
    }

    // Transform
    const sleepData = await transformSleepData(sleepSessions, hrvSamples, date);
    const exerciseData = await transformExerciseData(exerciseSessions, hrSamples, exerciseEvents, date, profile);
    const bodyCompData = await transformBodyCompositionData(bodyCompSamples.weight, bodyCompSamples.bodyFat, date, profile);

    // Skip if no data at all (empty day) - don't insert empty rows in backfill
    const hasAnyData = sleepData || exerciseData.length > 0 || bodyCompData;
    if (!hasAnyData) {
      console.log(`[SKIP] ${date}: no sleep, exercise, or body composition data`);
      return { date, success: true, rowsAffected: 0 };
    }

    // Build merged raw biometrics
    const rawParts: DailyRawBiometrics[] = [
      { user_id: userId, log_date: date },
    ];
    if (sleepData) rawParts.push(buildRawBiometricsFromSleep(userId, date, sleepData));
    if (exerciseData.length > 0) rawParts.push(buildRawBiometricsFromExercise(userId, date, exerciseData));
    if (bodyCompData) rawParts.push(buildRawBiometricsFromBodyComp(userId, date, bodyCompData));

    const mergedRaw = mergeRawBiometrics(...rawParts);

    if (dryRun) {
      // Helper to get first element keys
      const getFirstKeys = (arr: any[]) => arr.length > 0 ? Object.keys(arr[0]) : [];

      console.log(`[DRY RUN] ${date}:`, {
        sleep: sleepData ? 'yes' : 'no',
        exercise: exerciseData.length,
        bodyComp: bodyCompData ? 'yes' : 'no',
        rawCounts: {
          sleepSessions: sleepSessions.length,
          hrvSamples: hrvSamples.length,
          exerciseSessions: exerciseSessions.length,
          hrSamples: hrSamples.length,
          bodyCompWeight: bodyCompSamples.weight.length,
          bodyCompBodyFat: bodyCompSamples.bodyFat.length,
        },
        rawKeys: {
          sleepSessions: getFirstKeys(sleepSessions),
          hrvSamples: getFirstKeys(hrvSamples),
          exerciseSessions: getFirstKeys(exerciseSessions),
          hrSamples: getFirstKeys(hrSamples),
          exerciseEvents: getFirstKeys(exerciseEvents),
          bodyCompWeight: getFirstKeys(bodyCompSamples.weight),
          bodyCompBodyFat: getFirstKeys(bodyCompSamples.bodyFat),
        },
        mergedRaw,
      });
      return { date, success: true, rowsAffected: 0 };
    }

    // Upsert to Supabase - ONLY daily_raw_biometrics (computed_daily_scores disabled per audit)
    const rawResult = await upsertDailyRawBiometrics(supabase, mergedRaw);
    // upsertComputedDailyScores DISABLED - no placeholder scores written during ETL sync
    // computed_daily_scores is populated by a separate server-side computation job

    if (!rawResult.success) throw new Error(rawResult.error);

    return { date, success: true, rowsAffected: 1 };
  } catch (error) {
    return { date, success: false, error: formatError(error), rowsAffected: 0 };
  }
}

async function runSync(options: SyncOptions): Promise<void> {
  const ghealthClient = createGHealthClient();
  const profile = await fetchUserProfile(options.userId);

  const backfill = options.backfill ?? false;
  const dryRun = options.dryRun ?? false;

  let dates: string[];

  if (backfill) {
    // Backfill last 90 days
    const end = new Date();
    const start = new Date(end.getTime() - 90 * 86400000);
    dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(formatDate(d));
    }
  } else {
    const range = getDateRange(options.from, options.to);
    // Generate dates from range.from to range.to (exclusive)
    const start = parseDateArg(range.from);
    const end = parseDateArg(range.to);
    // end is already D+1 exclusive, so subtract 1 day to get the last inclusive date
    const lastInclusive = new Date(end.getTime() - 86400000);
    dates = [];
    for (let d = new Date(start); d <= lastInclusive; d.setDate(d.getDate() + 1)) {
      dates.push(formatDate(d));
    }
  }

  console.log(`Syncing ${dates.length} day(s) for user ${options.userId}...`);
  if (dryRun) console.log('DRY RUN MODE - no database writes');

  let successCount = 0;
  let failCount = 0;

  for (const date of dates) {
    const result = await syncDate(options.userId, date, ghealthClient, profile, dryRun);
    if (result.success) {
      successCount++;
      console.log(`✓ ${date}`);
    } else {
      failCount++;
      console.error(`✗ ${date}: ${result.error}`);
    }
  }

  console.log(`\nComplete: ${successCount} succeeded, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

// ========================================================================
// CLI ENTRY POINT
// ========================================================================

program
  .name('sync-ghealth')
  .description('Sync Google Health data to Supabase via ghealth CLI')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--backfill', 'Backfill last 90 days')
  .option('--dry-run', 'Preview without writing to database')
  .requiredOption('--user-id <uuid>', 'User ID to sync')
  .action(async (options: { from?: string; to?: string; backfill?: boolean; dryRun?: boolean; userId: string }) => {
    await runSync({
      from: options.from,
      to: options.to,
      backfill: options.backfill,
      dryRun: options.dryRun,
      userId: options.userId,
    });
  });

program.parse(process.argv);