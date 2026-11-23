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

import { Command } from 'commander';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createGHealthClient } from './ghealth-client';
import { recomputeDailyScores } from './recompute-scores';
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
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const program = new Command();

// ========================================================================
// CONFIGURATION (lazy-initialized in runSync)
// ========================================================================

let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
      process.exit(1);
    }

    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return supabase;
}

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
 * profiles table has: user_id, birth_date, height_m, timezone, basal_sleep_need_h,
 * habitual_wake, goal_weight_kg, goal_date, daily_deficit_kcal, biological_sex
 * restingHR is fetched from latest daily_raw_biometrics.rhr_bpm
 * maxHR is calculated from Tanaka formula: 208 - 0.7 * age
 */
async function fetchUserProfile(userId: string): Promise<UserEtlProfile> {
  try {
    const client = getSupabaseClient();
    const { data: profileRow, error: profileError } = await client
      .from('profiles')
      .select('birth_date, height_m, biological_sex')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      // Query error (schema, column, permission) - log full error details
      console.warn(`[PROFILE] Query error for ${userId}: ${formatError(profileError)}, using DEFAULT_PROFILE`);
      return DEFAULT_PROFILE;
    }
    if (!profileRow) {
      // Row not found - expected for new users
      console.warn(`[PROFILE] profiles not found for ${userId}, using DEFAULT_PROFILE`);
      return DEFAULT_PROFILE;
    }

    // Compute age from birth_date
    const birthDate = new Date(profileRow.birth_date);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    const finalAge = age || DEFAULT_PROFILE.age;

    // Compute maxHR from Tanaka formula
    const maxHR = Math.round(208 - 0.7 * finalAge);

    // Fetch restingHR from latest daily_raw_biometrics.rhr_bpm
    // Strict physiological filter: only accept 30 < rhr_bpm < 110 to avoid bad data (e.g., 0 from legacy rows)
    let restingHR = DEFAULT_PROFILE.restingHR;
    try {
      const client = getSupabaseClient();
      const { data: rhrRow } = await client
        .from('daily_raw_biometrics')
        .select('rhr_bpm')
        .eq('user_id', userId)
        .gt('rhr_bpm', 30)
        .lt('rhr_bpm', 110)
        .order('log_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      const rhr = rhrRow?.rhr_bpm;
      if (typeof rhr === 'number' && rhr > 30 && rhr < 110) {
        restingHR = rhr;
      }
    } catch {
      // Ignore, use default
    }

    const heightM = Number(profileRow.height_m) || DEFAULT_PROFILE.heightM;
    const biologicalSex = profileRow.biological_sex === 'female' ? 'female' : 'male';

    return {
      age: finalAge,
      restingHR,
      maxHR,
      biologicalSex,
      heightM,
    };
  } catch (error) {
    console.warn(`[PROFILE] Error fetching profile for ${userId}:`, formatError(error));
    return DEFAULT_PROFILE;
  }
}

// ========================================================================
// DATE UTILITIES
// ========================================================================

// Timezone for date calculations (America/Caracas = UTC-4)
const CARACAS_TIMEZONE = 'America/Caracas';

function formatDate(date: Date): string {
  // Use America/Caracas timezone to ensure consistent date strings matching user's local date
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CARACAS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

function getCaracasNow(): Date {
  // Returns current date/time in America/Caracas timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CARACAS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')!.value, 10);
  const month = parseInt(parts.find(p => p.type === 'month')!.value, 10) - 1;
  const day = parseInt(parts.find(p => p.type === 'day')!.value, 10);
  const hour = parseInt(parts.find(p => p.type === 'hour')!.value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')!.value, 10);
  const second = parseInt(parts.find(p => p.type === 'second')!.value, 10);
  return new Date(Date.UTC(year, month, day, hour, minute, second));
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
  // Sleep (from Health Connect) - PRODUCTION COLUMNS ONLY
  rmssd_ms?: number | null;
  time_in_bed_min?: number | null;
  total_sleep_min?: number | null;
  deep_sleep_min?: number | null;
  rem_sleep_min?: number | null;
  light_sleep_min?: number | null;
  nap_sleep_min?: number | null;
  sleep_onset_timestamp?: string | null;  // timestamptz ISO string
  wake_timestamp?: string | null;         // timestamptz ISO string
  // Exercise - PRODUCTION COLUMNS ONLY
  pickleball_or_gym_minutes?: number | null;
  active_calories_kcal?: number | null;
  hr_zones_minutes?: any;
  // Body Composition - PRODUCTION COLUMNS ONLY
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  // Manual fields (preserved from existing row, never overwritten by ETL)
  meals_log_json?: any;
  session_rpe?: number | null;
  intake_kcal?: number | null;
  intake_protein_g?: number | null;
  intake_carbs_g?: number | null;
  intake_fat_g?: number | null;
  is_hospital_shift?: boolean | null;
  night_awake_shift_hours?: number | null;
  // Metadata
  raw_payload_hash?: string | null;
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
 * Atomic upsert for daily_raw_biometrics preserving manual fields
 * Strips undefined/null keys and excludes manual fields from payload
 * Manual fields (preserved from existing row): meals_log_json, session_rpe,
 * intake_kcal, intake_protein_g, intake_carbs_g, intake_fat_g,
 * is_hospital_shift, night_awake_shift_hours
 */
async function upsertDailyRawBiometrics(
  client: SupabaseClient,
  data: DailyRawBiometrics
): Promise<{ success: boolean; error?: string }> {
  try {
    // First, get existing row to preserve manual fields
    type ManualFieldsRow = {
      meals_log_json: unknown;
      session_rpe: number | null;
      intake_kcal: number | null;
      intake_protein_g: number | null;
      intake_carbs_g: number | null;
      intake_fat_g: number | null;
      is_hospital_shift: boolean | null;
      night_awake_shift_hours: number | null;
    };
    const { data: existing } = await client
      .from('daily_raw_biometrics')
      .select('meals_log_json, session_rpe, intake_kcal, intake_protein_g, intake_carbs_g, intake_fat_g, is_hospital_shift, night_awake_shift_hours')
      .eq('user_id', data.user_id)
      .eq('log_date', data.log_date)
      .single();

    const existingRow = existing as ManualFieldsRow | null;

    // Strip undefined and null keys from data (defense-in-depth)
    const cleanData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        cleanData[key] = value;
      }
    }

    // Build payload: only include non-manual fields from cleanData
    // Manual fields are preserved from existing row (not overwritten)
    const manualFields: (keyof ManualFieldsRow)[] = [
      'meals_log_json',
      'session_rpe',
      'intake_kcal',
      'intake_protein_g',
      'intake_carbs_g',
      'intake_fat_g',
      'is_hospital_shift',
      'night_awake_shift_hours',
    ];

    // Runtime whitelist: ONLY these 17 production columns may be sent to upsert
    // Matches exact production schema from information_schema.columns
    const ALLOWED_UPSERT_COLUMNS = new Set<string>([
      'user_id',
      'log_date',
      'updated_at',
      'rmssd_ms',
      'time_in_bed_min',
      'total_sleep_min',
      'deep_sleep_min',
      'rem_sleep_min',
      'light_sleep_min',
      'nap_sleep_min',
      'sleep_onset_timestamp',
      'wake_timestamp',
      'pickleball_or_gym_minutes',
      'active_calories_kcal',
      'hr_zones_minutes',
      'weight_kg',
      'body_fat_pct',
    ]);

    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Add non-manual fields from cleanData, but ONLY if in ALLOWED_UPSERT_COLUMNS
    for (const [key, value] of Object.entries(cleanData)) {
      if (!manualFields.includes(key as keyof ManualFieldsRow) && ALLOWED_UPSERT_COLUMNS.has(key)) {
        payload[key] = value;
      }
    }

    // Preserve manual fields from existing row (don't overwrite with null)
    if (existingRow) {
      for (const field of manualFields) {
        const value = existingRow[field];
        if (value !== null && value !== undefined) {
          payload[field] = value;
        }
      }
    }

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
 * Outputs ONLY production columns from daily_raw_biometrics:
 * rmssd_ms, time_in_bed_min, total_sleep_min, deep_sleep_min, rem_sleep_min,
 * light_sleep_min, nap_sleep_min, sleep_onset_timestamp, wake_timestamp
 */
function buildRawBiometricsFromSleep(
  userId: string,
  date: string,
  sleep: SleepTransformerOutput
): DailyRawBiometrics {
  return {
    user_id: userId,
    log_date: date,
    // HRV: nocturnal median RMSSD
    rmssd_ms: sleep.hrv_nocturnal_median ? Math.round(sleep.hrv_nocturnal_median * 100) / 100 : null,
    // Sleep - only production columns
    time_in_bed_min: sleep.time_in_bed_min ? Math.round(sleep.time_in_bed_min) : null,
    total_sleep_min: sleep.total_sleep_min ? Math.round(sleep.total_sleep_min) : null,
    deep_sleep_min: sleep.deep_sleep_min ? Math.round(sleep.deep_sleep_min) : null,
    rem_sleep_min: sleep.rem_sleep_min ? Math.round(sleep.rem_sleep_min) : null,
    light_sleep_min: sleep.light_sleep_min ? Math.round(sleep.light_sleep_min) : null,
    nap_sleep_min: sleep.nap_sleep_min ? Math.round(sleep.nap_sleep_min) : null,
    // Timestamps as ISO strings (timestamptz)
    sleep_onset_timestamp: sleep.sleep_onset_timestamp ?? null,
    wake_timestamp: sleep.wake_timestamp ?? null,
    // Other fields not from sleep - set to null to be filtered out by upsert
    pickleball_or_gym_minutes: null,
    active_calories_kcal: null,
    hr_zones_minutes: null,
    weight_kg: null,
    body_fat_pct: null,
    raw_payload_hash: null,
  };
}

/**
 * Build daily_raw_biometrics from exercise transformer outputs
 * Outputs ONLY production columns from daily_raw_biometrics:
 * pickleball_or_gym_minutes, active_calories_kcal, hr_zones_minutes (jsonb)
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

  // Combine HR zones (sum minutes across workouts)
  const combinedZones = exercises.reduce((acc, e) => {
    acc.z1_minutes += e.zones.z1;
    acc.z2_minutes += e.zones.z2;
    acc.z3_minutes += e.zones.z3;
    acc.z4_minutes += e.zones.z4;
    acc.z5_minutes += e.zones.z5;
    // Also populate z1..z5 for computed_daily_scores compatibility
    acc.z1 += e.zones.z1;
    acc.z2 += e.zones.z2;
    acc.z3 += e.zones.z3;
    acc.z4 += e.zones.z4;
    acc.z5 += e.zones.z5;
    acc.real = acc.real || e.zones.real;
    acc.workouts.push(...e.zones.workouts);
    return acc;
  }, {
    z1_minutes: 0,
    z2_minutes: 0,
    z3_minutes: 0,
    z4_minutes: 0,
    z5_minutes: 0,
    z1: 0,
    z2: 0,
    z3: 0,
    z4: 0,
    z5: 0,
    real: false,
    workouts: [] as any[],
  });

  return {
    user_id: userId,
    log_date: date,
    // Exercise - only production columns
    pickleball_or_gym_minutes: Math.round(totalDuration),
    active_calories_kcal: Math.round(totalKcal),
    hr_zones_minutes: combinedZones,
    // Other fields not from exercise - set to null to be filtered out by upsert
    rmssd_ms: null,
    time_in_bed_min: null,
    total_sleep_min: null,
    deep_sleep_min: null,
    rem_sleep_min: null,
    light_sleep_min: null,
    nap_sleep_min: null,
    sleep_onset_timestamp: null,
    wake_timestamp: null,
    weight_kg: null,
    body_fat_pct: null,
    raw_payload_hash: null,
  };
}

/**
 * Build daily_raw_biometrics from body composition transformer output
 * Outputs ONLY production columns from daily_raw_biometrics:
 * weight_kg, body_fat_pct (both numeric)
 */
function buildRawBiometricsFromBodyComp(
  userId: string,
  date: string,
  bodyComp: BodyCompositionTransformerOutput
): DailyRawBiometrics {
  return {
    user_id: userId,
    log_date: date,
    // Body composition - only production columns
    weight_kg: bodyComp.weight_kg,
    body_fat_pct: bodyComp.body_fat_pct,
    // Other fields not from body comp - set to null to be filtered out by upsert
    rmssd_ms: null,
    time_in_bed_min: null,
    total_sleep_min: null,
    deep_sleep_min: null,
    rem_sleep_min: null,
    light_sleep_min: null,
    nap_sleep_min: null,
    sleep_onset_timestamp: null,
    wake_timestamp: null,
    pickleball_or_gym_minutes: null,
    active_calories_kcal: null,
    hr_zones_minutes: null,
    raw_payload_hash: null,
  };
}

/**
 * Merge multiple raw biometrics objects (later non-null/undefined properties win)
 * Skips null and undefined values to preserve data from earlier sources
 */
function mergeRawBiometrics(...objects: DailyRawBiometrics[]): DailyRawBiometrics {
  const result: DailyRawBiometrics = { user_id: '', log_date: '' };
  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined && value !== null) {
        (result as any)[key] = value;
      }
    }
  }
  return result;
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
    const client = getSupabaseClient();
    const rawResult = await upsertDailyRawBiometrics(client, mergedRaw);
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

  // Log resolved profile for debugging Karvonen zone calculations
  console.log(`[PROFILE] Resolved: age=${profile.age}, restingHR=${profile.restingHR}, maxHR=${profile.maxHR}, heightM=${profile.heightM}, sex=${profile.biologicalSex}`);

  const backfill = options.backfill ?? false;
  const dryRun = options.dryRun ?? false;
  const recomputeOnly = options.recomputeOnly ?? false;

  // If --recompute-only is set, skip ETL sync and only recompute scores
  if (recomputeOnly) {
    // Use Caracas timezone for default date range when --backfill is also specified
    const caracasNow = getCaracasNow();
    const fromDate = options.from ?? (backfill ? formatDate(new Date(caracasNow.getTime() - 90 * 86400000)) : formatDate(caracasNow));
    const toDate = options.to ?? formatDate(caracasNow);

    console.log(`[RECOMPUTE ONLY] Recomputing scores for ${fromDate} to ${toDate} (${backfill ? 'backfill 90 days' : 'single day'})`);

    const result = await recomputeDailyScores({
      userId: options.userId,
      fromDate,
      toDate,
      dryRun,
    });

    console.log(`\n[RECOMPUTE] Complete: ${result.success} succeeded, ${result.failed} failed`);
    if (result.errors.length > 0) {
      console.error('Errors:');
      for (const err of result.errors) {
        console.error(`  ${err}`);
      }
      process.exit(1);
    }
    return;
  }

  let dates: string[];

  if (backfill) {
    // Backfill last 90 days using Caracas timezone
    const caracasNow = getCaracasNow();
    const end = caracasNow;
    const start = new Date(end.getTime() - 90 * 86400000);
    dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(formatDate(d));
    }
  } else {
    const range = getDateRange(options.from, options.to);
    // getDateRange returns inclusive dates (both from and to are actual dates to sync)
    // Generate dates from range.from to range.to (both inclusive)
    const start = parseDateArg(range.from);
    const end = parseDateArg(range.to);
    dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(formatDate(d));
    }
  }

  if (dates.length === 0) {
    console.error(`[ERROR] No dates to sync. Check --from/--to or --backfill.`);
    process.exit(1);
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

  // After successful sync, recompute scores for the same date range
  if (successCount > 0 && !dryRun && dates.length > 0) {
    const fromDate = dates[0]!;
    const toDate = dates[dates.length - 1]!;
    console.log(`\n[RECOMPUTE] Recomputing scores for ${fromDate} to ${toDate}...`);

    const recomputeResult = await recomputeDailyScores({
      userId: options.userId,
      fromDate,
      toDate,
      dryRun: false,
    });

    console.log(`[RECOMPUTE] Complete: ${recomputeResult.success} succeeded, ${recomputeResult.failed} failed`);
    if (recomputeResult.errors.length > 0) {
      console.error('Recompute errors:');
      for (const err of recomputeResult.errors) {
        console.error(`  ${err}`);
      }
      // Don't exit with error - sync succeeded, just recompute had issues
    }
  }
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
  .option('--recompute-only', 'Skip ETL sync, only recompute computed_daily_scores from existing daily_raw_biometrics')
  .requiredOption('--user-id <uuid>', 'User ID to sync')
  .action(async (options: { from?: string; to?: string; backfill?: boolean; dryRun?: boolean; recomputeOnly?: boolean; userId: string }) => {
    await runSync({
      from: options.from,
      to: options.to,
      backfill: options.backfill,
      dryRun: options.dryRun,
      recomputeOnly: options.recomputeOnly,
      userId: options.userId,
    });
  });

// Only parse CLI args when run directly (not when imported)
function isMainModule(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;
  const currentFile = path.resolve(fileURLToPath(metaUrl));
  const entryFile = path.resolve(argv1);
  return process.platform === 'win32'
    ? currentFile.toLowerCase() === entryFile.toLowerCase()
    : currentFile === entryFile;
}

if (isMainModule(import.meta.url)) {
  program.parse(process.argv);
}