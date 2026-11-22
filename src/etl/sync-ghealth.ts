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

// Default user profile (should come from user_profiles table in production)
const DEFAULT_PROFILE: UserEtlProfile = {
  age: 30,
  restingHR: 55,
  maxHR: 187,
  biologicalSex: 'male',
  heightM: 1.75,
};

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
  return Date.UTC(year, month, day, 0, 0, 0, 0);
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
 * Returns { from: YYYY-MM-DD, to: YYYY-MM-DD (exclusive, so D+1 for inclusive end) }
 */
function getDateRange(from: string | undefined, to: string | undefined): { from: string; to: string } {
  const end = to ? parseDateArg(to) : new Date();
  // ghealth --to is exclusive, so add 1 day to include the end date
  const toDate = new Date(end.getTime() + 86400000);

  const start = from ? parseDateArg(from) : new Date(end.getTime() - 30 * 86400000);

  return {
    from: formatGHealthDate(start),
    to: formatGHealthDate(toDate),
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

  if (parsedSleep.length === 0) return null;

  return buildSleepTransformerOutput(date, parsedSleep, parsedHrv, { includeNaps: false });
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
  const parsedEvents = parseExerciseEvents({ events: exerciseEvents, nextPageToken: null });

  const results: ExerciseTransformerOutput[] = [];

  for (const session of parsedExercises) {
    const filteredHr = filterHrDuringExercise(parsedHr, session, parsedEvents);
    const zones = classifyHrZonesKarvonen(filteredHr, profile);
    const output = buildExerciseTransformerOutput(date, session, filteredHr, zones);
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
  rmssd_ms?: number | null;
  rhr_bpm?: number | null;
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
  steps?: number | null;
  intake_kcal?: number | null;
  intake_protein_g?: number | null;
  intake_carbs_g?: number | null;
  intake_fat_g?: number | null;
  weight_kg?: number | null;
  body_fat_pct?: number | null;
  hydration_ml?: number | null;
  resp_rate_brpm?: number | null;
  spo2_pct?: number | null;
  session_rpe?: number | null;
  pickleball_or_gym_minutes?: number | null;
  hr_zones_minutes?: any;
  meals_log_json?: any;
  hrv_nocturnal_median?: number | null;
  hrv_deep_sleep_median?: number | null;
  hrv_nocturnal_count?: number;
  hrv_mode?: string;
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
    return { success: false, error: String(error) };
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
 */
function buildRawBiometricsFromSleep(
  userId: string,
  date: string,
  sleep: SleepTransformerOutput
): DailyRawBiometrics {
  return {
    user_id: userId,
    log_date: date,
    rmssd_ms: sleep.hrv_nocturnal_median,
    total_sleep_min: sleep.total_sleep_min,
    deep_sleep_min: sleep.deep_sleep_min,
    rem_sleep_min: sleep.rem_sleep_min,
    light_sleep_min: sleep.light_sleep_min,
    awake_sleep_min: sleep.awake_sleep_min,
    sleep_efficiency_pct: sleep.sleep_efficiency_pct,
    time_in_bed_min: sleep.time_in_bed_min,
    sleep_onset_latency_min: sleep.sleep_onset_latency_min,
    naps_count: sleep.naps_count,
    naps_total_min: sleep.naps_total_min,
    hrv_nocturnal_median: sleep.hrv_nocturnal_median,
    hrv_deep_sleep_median: sleep.hrv_deep_sleep_median,
    hrv_nocturnal_count: sleep.hrv_nocturnal_count,
    hrv_mode: sleep.hrv_mode,
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

  // Combine HR zones
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

  return {
    user_id: userId,
    log_date: date,
    pickleball_or_gym_minutes: totalDuration,
    hr_zones_minutes: combinedZones,
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
  // ghealth expects YYYY-MM-DD for --from/--to, with --to being exclusive (D+1)
  const startDate = new Date(date + 'T00:00:00');
  const endDate = new Date(startDate.getTime() + 86400000); // D+1 for exclusive --to
  const fromGHealth = formatGHealthDate(startDate);
  const toGHealth = formatGHealthDate(endDate);

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

    // Transform
    const sleepData = await transformSleepData(sleepSessions, hrvSamples, date);
    const exerciseData = await transformExerciseData(exerciseSessions, hrSamples, exerciseEvents, date, profile);
    const bodyCompData = await transformBodyCompositionData(bodyCompSamples.weight, bodyCompSamples.bodyFat, date, profile);

    // Build merged raw biometrics
    const rawParts: DailyRawBiometrics[] = [
      { user_id: userId, log_date: date },
    ];
    if (sleepData) rawParts.push(buildRawBiometricsFromSleep(userId, date, sleepData));
    if (exerciseData.length > 0) rawParts.push(buildRawBiometricsFromExercise(userId, date, exerciseData));
    if (bodyCompData) rawParts.push(buildRawBiometricsFromBodyComp(userId, date, bodyCompData));

    const mergedRaw = mergeRawBiometrics(...rawParts);

    // Build computed scores (placeholder - would use computeEngine in production)
    const computed: ComputedDailyScores = {
      user_id: userId,
      log_date: date,
      // Sleep scores
      sleep_architecture_score: sleepData?.sleep_architecture_score ?? null,
      sleep_regularity_pct: sleepData?.sleep_regularity_pct ?? null,
      sleep_debt_h: sleepData?.sleep_debt_h ?? null,
      dynamic_sleep_need_h: sleepData?.dynamic_sleep_need_h ?? null,
      optimal_bedtime_start: sleepData?.optimal_bedtime_start ?? null,
      optimal_bedtime_end: sleepData?.optimal_bedtime_end ?? null,
      high_sleep_stress_pct: sleepData?.high_sleep_stress_pct ?? null,
      cumulative_sleep_debt_hours: sleepData?.cumulative_sleep_debt_hours ?? null,
      // HRV scores
      ln_rmssd: sleepData?.hrv_nocturnal_median ? Math.log(sleepData.hrv_nocturnal_median) : null,
      hrv_7d_avg_rmssd: sleepData?.hrv_nocturnal_median ?? null,
      hrv_14d_avg_rmssd: sleepData?.hrv_nocturnal_median ?? null,
      // Exercise scores
      strain_score: exerciseData.length > 0 ? 8 : null, // placeholder
      hr_z1_min: exerciseData.reduce((sum, e) => sum + e.zones.z1, 0) || null,
      hr_z2_min: exerciseData.reduce((sum, e) => sum + e.zones.z2, 0) || null,
      hr_z3_min: exerciseData.reduce((sum, e) => sum + e.zones.z3, 0) || null,
      hr_z4_min: exerciseData.reduce((sum, e) => sum + e.zones.z4, 0) || null,
      hr_z5_min: exerciseData.reduce((sum, e) => sum + e.zones.z5, 0) || null,
      // Body comp scores
      ffm_kg: bodyCompData?.ffm_kg ?? null,
      muscle_mass_kg: bodyCompData?.muscle_mass_kg ?? null,
      bone_mass_kg: bodyCompData?.bone_mass_kg ?? null,
      water_kg: bodyCompData?.water_kg ?? null,
      visceral_fat_index: bodyCompData?.visceral_fat_index ?? null,
      bmi: bodyCompData?.bmi ?? null,
    };

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

    // Upsert to Supabase
    const [rawResult, computedResult] = await Promise.all([
      upsertDailyRawBiometrics(supabase, mergedRaw),
      upsertComputedDailyScores(supabase, computed),
    ]);

    if (!rawResult.success) throw new Error(rawResult.error);
    if (!computedResult.success) throw new Error(computedResult.error);

    return { date, success: true, rowsAffected: 2 };
  } catch (error) {
    const err = error as Error;
    return { date, success: false, error: `${err.message}\n${err.stack ?? ''}`, rowsAffected: 0 };
  }
}

async function runSync(options: SyncOptions): Promise<void> {
  const ghealthClient = createGHealthClient();
  const profile = DEFAULT_PROFILE; // TODO: fetch from user_profiles table

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