#!/usr/bin/env node
/**
 * ARGON v7.0 — Recompute Computed Daily Scores
 *
 * Reads daily_raw_biometrics, runs the MBE compute engine,
 * and upserts to computed_daily_scores.
 *
 * Usage:
 *   npx tsx src/etl/recompute-scores.ts --from 2024-11-01 --to 2024-11-30 --user-id <uuid>
 *   npx tsx src/etl/recompute-scores.ts --backfill --user-id <uuid>
 *   npx tsx src/etl/recompute-scores.ts --from 2024-11-20 --dry-run --user-id <uuid>
 */

import { program } from 'commander';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { computeEngine, validateComputedOutput, createEmptyComputed, ENGINE_VERSION, COMPUTATION_VERSION } from '@/engine/compute-engine';
import type {
  RawBiometricDay,
  HistoryDay,
  UserProfile,
  EngineConfig,
  ComputedDailyScore,
  PrevComputed,
} from '@/engine/types';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ========================================================================
// DATE UTILITIES
// ========================================================================

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateArg(dateStr: string): Date {
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

// ========================================================================
// ENGINE CONFIG (matches Code.txt defaults)
// ========================================================================

const DEFAULT_CONFIG: EngineConfig = {
  minBaselineDays: 7,
  basalSleepNeedH: 7.5,
  hrvSWCMultiplier: 0.5,
  hrvDeadZoneSD: 1.0,
  rhrPenaltyThreshold: 20,
  spo2PenaltyThreshold: 94,
  acwrAcuteDays: 3,
  acwrChronicDays: 14,
  acwrThreshold: 1.3,
  ewmaAlphaWeight: 0.25,
  ewmaAlphaBodyFat: 0.25,
  maxHrvCapPercentile: 3,
  trimpCoeffMale: { a: 0.64, b: 1.92 },
  trimpCoeffFemale: { a: 0.86, b: 1.67 },
  strainSigmoidScale: 0.00165,
  strainMax: 21,
  neuroLoadFactor: 0.85,
  shiftLoadFactor: 1.40,
  shiftLoadMET: 35,
  sleepArchWeights: { duration: 0.3, regularity: 0.3, efficiency: 0.2, architecture: 0.2 },
  recoveryWeights: { hrv: 0.4, rhr: 0.2, sleep: 0.4 },
  recoveryPenalty: { spo2: 5, respRate: 5 },
  minValidSleepMin: 120,
  minValidNapMin: 10,
  maxNapMin: 240,
  napStartHour: 8,
  napEndHour: 20,
};

// ========================================================================
// ALLOWED COLUMNS WHITELIST (92 production columns)
// ========================================================================

const ALLOWED_SCORES_COLUMNS = new Set<string>([
  'log_date',
  'ln_rmssd', 'ln_rmssd_14d_mean', 'ln_rmssd_14d_sd', 'hrv_z_score', 'rhr_z_score',
  'recovery_score', 'recovery_status', 'cardio_trimp_load', 'neuromuscular_load',
  'shift_orthostatic_load', 'strain_score', 'recommended_max_strain',
  'sleep_efficiency_pct', 'sleep_architecture_score', 'cumulative_sleep_debt_hours',
  'dynamic_sleep_need_hours', 'optimal_bedtime_start', 'optimal_bedtime_end',
  'trend_weight_kg', 'trend_body_fat_pct', 'dynamic_tdee_kcal', 'target_kcal',
  'target_protein_g', 'target_carbs_g', 'target_fat_g', 'clinical_coach_notes',
  'computed_at', 'skeletal_muscle_pct', 'visceral_fat_index', 'body_water_pct',
  'tmb_kcal', 'sleep_hours_vs_needed_pct', 'sleep_regularity_pct', 'high_sleep_stress_pct',
  'vo2_max_ml_kg_min', 'argon_physiological_age', 'pace_of_aging_x',
  'intake_kcal', 'intake_protein_g', 'intake_carbs_g', 'intake_fat_g',
  'chronological_age', 'total_age_delta', 'delta_vo2_years', 'delta_rhr_years',
  'delta_lnrmssd_years', 'delta_ffm_years', 'delta_sleep_years', 'delta_act_years',
  'weight_kg', 'body_fat_pct', 'fat_mass_kg', 'ffm_kg', 'ffm_pct', 'muscle_mass_kg',
  'bone_mass_kg', 'water_mass_kg', 'bmi', 'rmssd_ms', 'rmssd_14d_mean_ms',
  'rhr_bpm', 'rhr_14d_mean_bpm', 'resp_rate_brpm', 'resp_14d_mean_brpm', 'spo2_pct',
  'dynamic_rmssd_cap_ms', 'cv_lnrmssd_7d_pct', 'swc_lnrmssd', 'acwr_penalty_strain',
  'calibrating', 'sleep_missing', 'hrv_missing', 'nap_sleep_min', 'time_in_bed_min',
  'total_sleep_min', 'deep_sleep_min', 'rem_sleep_min', 'light_sleep_min',
  'steps_net', 'session_rpe', 'hr_zones_minutes', 'z13_minutes', 'z45_minutes',
  'is_hospital_shift', 'night_awake_shift_hours', 'tef_kcal', 'empirical_tdee_kcal',
  'pickleball_or_gym_minutes', 'steps_count', 'meals_log_json', 'user_id',
]);

// ========================================================================
// UTILITIES
// ========================================================================

/**
 * Convert NaN/Infinity to null in an object recursively
 */
function sanitizeForDb(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
      result[key] = null;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeForDb(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map(v =>
        typeof v === 'number' && (Number.isNaN(v) || !Number.isFinite(v)) ? null :
        v && typeof v === 'object' ? sanitizeForDb(v as Record<string, unknown>) : v
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Filter payload to only allowed columns
 */
function filterAllowedColumns(payload: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (ALLOWED_SCORES_COLUMNS.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Fetch user profile from profiles table
 */
async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('birth_date, height_m, timezone, basal_sleep_need_h, habitual_wake, goal_weight_kg, goal_date, daily_deficit_kcal, biological_sex')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Profile not found for user ${userId}: ${error?.message}`);
  }

  // Compute age from birth_date
  const birthDate = new Date(data.birth_date);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return {
    birth: data.birth_date,
    height_m: Number(data.height_m),
    timezone: data.timezone,
    basalSleepNeedH: Number(data.basal_sleep_need_h) || 7.5,
    habitualWake: data.habitual_wake,
    goalWeightKg: data.goal_weight_kg ? Number(data.goal_weight_kg) : undefined,
    goalDate: data.goal_date ?? undefined,
    dailyDeficitKcal: Number(data.daily_deficit_kcal) || 500,
    biologicalSex: data.biological_sex === 'female' ? 'female' : 'male',
    chronologicalAgeYears: age,
  };
}

/**
 * Fetch daily_raw_biometrics for date range
 */
async function fetchRawBiometrics(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<RawBiometricDay[]> {
  const { data, error } = await supabase
    .from('daily_raw_biometrics')
    .select('*')
    .eq('user_id', userId)
    .gte('log_date', fromDate)
    .lte('log_date', toDate)
    .order('log_date', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch computed_daily_scores for date range (for prevComputed)
 */
async function fetchComputedScores(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<ComputedDailyScore[]> {
  const { data, error } = await supabase
    .from('computed_daily_scores')
    .select('*')
    .eq('user_id', userId)
    .gte('log_date', fromDate)
    .lte('log_date', toDate)
    .order('log_date', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Build history array for a specific date
 */
function buildHistory(
  allRaw: RawBiometricDay[],
  allComputed: ComputedDailyScore[],
  targetDate: string
): HistoryDay[] {
  const targetIndex = allRaw.findIndex(r => r.log_date === targetDate);
  if (targetIndex === -1) return [];

  // History is all days BEFORE target date (most recent first)
  const history: HistoryDay[] = [];
  for (let i = targetIndex - 1; i >= 0; i--) {
    const raw = allRaw[i];
    const computed = allComputed.find(c => c.log_date === raw.log_date);
    history.push({
      ...raw,
      strain_score: computed?.strain_score ?? null,
    });
  }
  return history;
}

/**
 * Build prevComputed from previous day
 */
function buildPrevComputed(
  allRaw: RawBiometricDay[],
  allComputed: ComputedDailyScore[],
  targetDate: string
): PrevComputed | null {
  const targetIndex = allRaw.findIndex(r => r.log_date === targetDate);
  if (targetIndex === 0) return null;

  const prevRaw = allRaw[targetIndex - 1];
  const prevComputed = allComputed.find(c => c.log_date === prevRaw.log_date);
  if (!prevComputed) return null;

  return {
    log_date: prevComputed.log_date,
    trend_weight_kg: prevComputed.trend_weight_kg ?? null,
    trend_body_fat_pct: prevComputed.trend_body_fat_pct ?? null,
    rmssd_ms: prevRaw.rmssd_ms ?? prevRaw.hrv_rmssd_ms ?? null,
    rhr_bpm: prevRaw.rhr_bpm ?? null,
    strain_score: prevComputed.strain_score ?? null,
    total_sleep_min: prevRaw.total_sleep_min ?? null,
    recovery_score: prevComputed.recovery_score ?? null,
    dynamic_sleep_need_hours: prevComputed.dynamic_sleep_need_hours ?? prevComputed.dynamic_sleep_need_h ?? null,
    ln_rmssd: prevComputed.ln_rmssd ?? null,
    ln_rmssd_14d_mean: prevComputed.ln_rmssd_14d_mean ?? null,
    ln_rmssd_14d_sd: prevComputed.ln_rmssd_14d_sd ?? null,
    hrv_z_score: prevComputed.hrv_z_score ?? null,
    rhr_z_score: prevComputed.rhr_z_score ?? null,
    sleep_regularity_pct: prevComputed.sleep_regularity_pct ?? null,
    cumulative_sleep_debt_hours: prevComputed.cumulative_sleep_debt_hours ?? null,
    hrv_mode: null,
  };
}

// ========================================================================
// MAIN RECOMPUTE LOGIC
// ========================================================================

export interface RecomputeOptions {
  userId: string;
  fromDate: string;
  toDate: string;
  dryRun: boolean;
}

export async function recomputeDailyScores(options: RecomputeOptions): Promise<{ success: number; failed: number; errors: string[] }> {
  const { userId, fromDate, toDate, dryRun } = options;

  console.log(`[RECOMPUTE] User: ${userId}, Range: ${fromDate} to ${toDate}, DryRun: ${dryRun}`);

  // Fetch user profile
  const profile = await fetchUserProfile(userId);
  console.log(`[RECOMPUTE] Profile: age=${profile.chronologicalAgeYears}, sex=${profile.biologicalSex}, height=${profile.height_m}m`);

  // We need 60 days before fromDate for rolling windows
  const extendedFrom = formatDate(new Date(fromDate + 'T00:00:00Z').getTime() - 60 * 86400000);

  // Fetch all raw biometrics from extended range
  const allRaw = await fetchRawBiometrics(userId, extendedFrom, toDate);
  console.log(`[RECOMPUTE] Fetched ${allRaw.length} raw biometric days (${extendedFrom} to ${toDate})`);

  // Fetch existing computed scores for the same range
  const allComputed = await fetchComputedScores(userId, extendedFrom, toDate);
  console.log(`[RECOMPUTE] Fetched ${allComputed.length} existing computed scores`);

  // Filter to only dates within [fromDate, toDate] that have raw data
  const targetDates = allRaw
    .filter(r => r.log_date >= fromDate && r.log_date <= toDate)
    .map(r => r.log_date);

  if (targetDates.length === 0) {
    console.log('[RECOMPUTE] No target dates with raw data in range');
    return { success: 0, failed: 0, errors: [] };
  }

  console.log(`[RECOMPUTE] Processing ${targetDates.length} dates: ${targetDates[0]} .. ${targetDates[targetDates.length - 1]}`);

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const logDate of targetDates) {
    const todayRaw = allRaw.find(r => r.log_date === logDate)!;
    const history = buildHistory(allRaw, allComputed, logDate);
    const prevComputed = buildPrevComputed(allRaw, allComputed, logDate);

    const input = {
      todayRaw,
      historyRaw: history,
      prevComputed,
      profile,
      config: DEFAULT_CONFIG,
    };

    let computed: ComputedDailyScore;
    try {
      computed = computeEngine(input);
    } catch (error) {
      console.error(`[RECOMPUTE] Compute error for ${logDate}:`, error);
      // Create empty computed for failed dates
      computed = createEmptyComputed(logDate);
    }

    // Validate output has all required columns
    const validation = validateComputedOutput(computed);
    if (!validation.valid) {
      console.warn(`[RECOMPUTE] Missing columns for ${logDate}: ${validation.missing.join(', ')}`);
    }

    // Sanitize NaN/Infinity
    const sanitized = sanitizeForDb(computed as unknown as Record<string, unknown>);

    // Filter to allowed columns
    const payload = filterAllowedColumns(sanitized);
    payload.user_id = userId;
    payload.updated_at = new Date().toISOString();

    if (dryRun) {
      console.log(`[DRY RUN] ${logDate}: OK (${Object.keys(payload).length} columns)`);
      success++;
      continue;
    }

    // Upsert to computed_daily_scores
    const { error } = await supabase
      .from('computed_daily_scores')
      .upsert(payload, { onConflict: 'user_id,log_date' });

    if (error) {
      failed++;
      errors.push(`${logDate}: ${error.message}`);
      console.error(`[RECOMPUTE] ✗ ${logDate}: ${error.message}`);
    } else {
      success++;
      console.log(`[RECOMPUTE] ✓ ${logDate}`);
    }
  }

  return { success, failed, errors };
}

// ========================================================================
// CLI ENTRY POINT
// ========================================================================

program
  .name('recompute-scores')
  .description('Recompute computed_daily_scores from daily_raw_biometrics using MBE engine')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--backfill', 'Backfill last 90 days')
  .option('--dry-run', 'Preview without writing to database')
  .requiredOption('--user-id <uuid>', 'User ID to recompute')
  .action(async (options: { from?: string; to?: string; backfill?: boolean; dryRun?: boolean; userId: string }) => {
    const backfill = options.backfill ?? false;
    const dryRun = options.dryRun ?? false;

    let fromDate: string;
    let toDate: string;

    if (backfill) {
      const end = new Date();
      const start = new Date(end.getTime() - 90 * 86400000);
      fromDate = formatDate(start);
      toDate = formatDate(end);
    } else {
      fromDate = options.from ?? formatDate(new Date());
      toDate = options.to ?? fromDate;
    }

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
  });

program.parse(process.argv);