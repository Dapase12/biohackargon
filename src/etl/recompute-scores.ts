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

import { Command } from 'commander';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { computeEngine, validateComputedOutput, createEmptyComputed } from '@/engine/compute-engine';
import type {
  RawBiometricDay,
  HistoryDay,
  UserProfile,
  EngineConfig,
  ComputedDailyScore,
  PrevComputed,
} from '@/engine/types';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const program = new Command();

// ========================================================================
// DATE UTILITIES
// ========================================================================

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

// ========================================================================
// SCORES_COLUMN_SPECS — Strict typed validator for all 92 production columns
// Matches information_schema.columns from production Supabase
// Types: integer | numeric(p,s) | numeric | time | boolean | date | timestamptz | uuid | jsonb | text
// ========================================================================

type ColumnType =
  | { kind: 'integer'; min?: number; max?: number }
  | { kind: 'numeric'; precision?: number; scale?: number; min?: number; max?: number }
  | { kind: 'time' }
  | { kind: 'boolean' }
  | { kind: 'date' }
  | { kind: 'timestamptz' }
  | { kind: 'uuid' }
  | { kind: 'jsonb' }
  | { kind: 'text' };

export const SCORES_COLUMN_SPECS: ReadonlyMap<string, ColumnType> = new Map([
  // 1 DATE column
  ['log_date', { kind: 'date' }],

  // 1 TIMESTAMPTZ column
  ['computed_at', { kind: 'timestamptz' }],

  // 1 UUID column
  ['user_id', { kind: 'uuid' }],

  // 2 TIME columns (HH:mm[:ss] format)
  ['optimal_bedtime_start', { kind: 'time' }],
  ['optimal_bedtime_end', { kind: 'time' }],

  // 4 BOOLEAN columns
  ['calibrating', { kind: 'boolean' }],
  ['sleep_missing', { kind: 'boolean' }],
  ['hrv_missing', { kind: 'boolean' }],
  ['is_hospital_shift', { kind: 'boolean' }],

  // 2 JSONB columns
  ['hr_zones_minutes', { kind: 'jsonb' }],
  ['meals_log_json', { kind: 'jsonb' }],

  // 2 TEXT columns
  ['recovery_status', { kind: 'text' }],
  ['clinical_coach_notes', { kind: 'text' }],

  // 28 INTEGER columns (PostgreSQL integer / smallint)
  ['recovery_score', { kind: 'integer', min: 0, max: 100 }],
  ['dynamic_tdee_kcal', { kind: 'integer', min: 0, max: 10000 }],
  ['target_kcal', { kind: 'integer', min: 0, max: 10000 }],
  ['target_protein_g', { kind: 'integer', min: 0, max: 500 }],
  ['target_carbs_g', { kind: 'integer', min: 0, max: 1000 }],
  ['target_fat_g', { kind: 'integer', min: 0, max: 500 }],
  ['tmb_kcal', { kind: 'integer', min: 0, max: 10000 }],
  ['sleep_hours_vs_needed_pct', { kind: 'integer', min: 0, max: 200 }],
  ['sleep_regularity_pct', { kind: 'integer', min: 0, max: 100 }],
  ['high_sleep_stress_pct', { kind: 'integer', min: 0, max: 100 }],
  ['intake_kcal', { kind: 'integer', min: 0, max: 10000 }],
  ['intake_protein_g', { kind: 'integer', min: 0, max: 500 }],
  ['intake_carbs_g', { kind: 'integer', min: 0, max: 1000 }],
  ['intake_fat_g', { kind: 'integer', min: 0, max: 500 }],
  ['dynamic_rmssd_cap_ms', { kind: 'integer', min: 0, max: 2000 }],
  ['nap_sleep_min', { kind: 'integer', min: 0, max: 1440 }],
  ['time_in_bed_min', { kind: 'integer', min: 0, max: 1440 }],
  ['total_sleep_min', { kind: 'integer', min: 0, max: 1440 }],
  ['deep_sleep_min', { kind: 'integer', min: 0, max: 1440 }],
  ['rem_sleep_min', { kind: 'integer', min: 0, max: 1440 }],
  ['light_sleep_min', { kind: 'integer', min: 0, max: 1440 }],
  ['steps_net', { kind: 'integer', min: -100000, max: 100000 }],
  ['session_rpe', { kind: 'integer', min: 0, max: 10 }],
  ['z13_minutes', { kind: 'integer', min: 0, max: 1440 }],
  ['z45_minutes', { kind: 'integer', min: 0, max: 1440 }],
  ['tef_kcal', { kind: 'integer', min: 0, max: 500 }],
  ['empirical_tdee_kcal', { kind: 'integer', min: 0, max: 10000 }],
  ['pickleball_or_gym_minutes', { kind: 'integer', min: 0, max: 1440 }],
  ['steps_count', { kind: 'integer', min: 0, max: 200000 }],

  // 22 NUMERIC columns with precision/scale (PostgreSQL numeric(p,s))
  ['ln_rmssd', { kind: 'numeric', precision: 6, scale: 3, min: 0, max: 10 }],
  ['ln_rmssd_14d_mean', { kind: 'numeric', precision: 6, scale: 3, min: 0, max: 10 }],
  ['ln_rmssd_14d_sd', { kind: 'numeric', precision: 6, scale: 3, min: 0, max: 5 }],
  ['hrv_z_score', { kind: 'numeric', precision: 4, scale: 2, min: -10, max: 10 }],
  ['rhr_z_score', { kind: 'numeric', precision: 4, scale: 2, min: -10, max: 10 }],
  ['cardio_trimp_load', { kind: 'numeric', precision: 7, scale: 2, min: 0, max: 10000 }],
  ['neuromuscular_load', { kind: 'numeric', precision: 7, scale: 2, min: 0, max: 10000 }],
  ['shift_orthostatic_load', { kind: 'numeric', precision: 7, scale: 2, min: 0, max: 10000 }],
  ['strain_score', { kind: 'numeric', precision: 4, scale: 2, min: 0, max: 21 }],
  ['recommended_max_strain', { kind: 'numeric', precision: 4, scale: 2, min: 0, max: 21 }],
  ['sleep_efficiency_pct', { kind: 'numeric', precision: 5, scale: 2, min: 0, max: 100 }],
  ['sleep_architecture_score', { kind: 'numeric', precision: 5, scale: 2, min: 0, max: 100 }],
  ['cumulative_sleep_debt_hours', { kind: 'numeric', precision: 5, scale: 2, min: -100, max: 100 }],
  ['dynamic_sleep_need_hours', { kind: 'numeric', precision: 4, scale: 2, min: 4, max: 12 }],
  ['trend_weight_kg', { kind: 'numeric', precision: 5, scale: 2, min: 30, max: 200 }],
  ['trend_body_fat_pct', { kind: 'numeric', precision: 5, scale: 2, min: 2, max: 60 }],
  ['vo2_max_ml_kg_min', { kind: 'numeric', precision: 5, scale: 2, min: 10, max: 100 }],
  ['argon_physiological_age', { kind: 'numeric', precision: 5, scale: 2, min: 10, max: 120 }],
  ['pace_of_aging_x', { kind: 'numeric', precision: 4, scale: 2, min: 0.1, max: 5 }],
  ['chronological_age', { kind: 'numeric', precision: 5, scale: 2, min: 0, max: 150 }],
  ['total_age_delta', { kind: 'numeric', precision: 5, scale: 2, min: -50, max: 50 }],

  // 29 NUMERIC columns unbounded (PostgreSQL numeric without precision/scale)
  ['weight_kg', { kind: 'numeric', min: 20, max: 300 }],
  ['body_fat_pct', { kind: 'numeric', min: 2, max: 60 }],
  ['fat_mass_kg', { kind: 'numeric', min: 0, max: 200 }],
  ['ffm_kg', { kind: 'numeric', min: 10, max: 150 }],
  ['ffm_pct', { kind: 'numeric', min: 10, max: 100 }],
  ['muscle_mass_kg', { kind: 'numeric', min: 5, max: 100 }],
  ['bone_mass_kg', { kind: 'numeric', min: 1, max: 10 }],
  ['water_mass_kg', { kind: 'numeric', min: 10, max: 100 }],
  ['bmi', { kind: 'numeric', min: 10, max: 60 }],
  ['rmssd_ms', { kind: 'numeric', min: 0, max: 300 }],
  ['rmssd_14d_mean_ms', { kind: 'numeric', min: 0, max: 300 }],
  ['rhr_bpm', { kind: 'numeric', min: 30, max: 120 }],
  ['rhr_14d_mean_bpm', { kind: 'numeric', min: 30, max: 120 }],
  ['resp_rate_brpm', { kind: 'numeric', min: 5, max: 50 }],
  ['resp_14d_mean_brpm', { kind: 'numeric', min: 5, max: 50 }],
  ['spo2_pct', { kind: 'numeric', min: 70, max: 100 }],
  ['cv_lnrmssd_7d_pct', { kind: 'numeric', min: 0, max: 100 }],
  ['swc_lnrmssd', { kind: 'numeric', min: 0, max: 5 }],
  ['acwr_penalty_strain', { kind: 'numeric', min: 0, max: 21 }],
  ['night_awake_shift_hours', { kind: 'numeric', min: 0, max: 24 }],
  ['skeletal_muscle_pct', { kind: 'numeric', min: 0, max: 60 }],
  ['visceral_fat_index', { kind: 'numeric', min: 0, max: 30 }],
  ['body_water_pct', { kind: 'numeric', min: 30, max: 80 }],
  ['delta_vo2_years', { kind: 'numeric', min: -50, max: 50 }],
  ['delta_rhr_years', { kind: 'numeric', min: -50, max: 50 }],
  ['delta_lnrmssd_years', { kind: 'numeric', min: -50, max: 50 }],
  ['delta_ffm_years', { kind: 'numeric', min: -50, max: 50 }],
  ['delta_sleep_years', { kind: 'numeric', min: -50, max: 50 }],
  ['delta_act_years', { kind: 'numeric', min: -50, max: 50 }],
]);

// Derived whitelist from specs (single source of truth)
export const ALLOWED_SCORES_COLUMNS = new Set<string>(SCORES_COLUMN_SPECS.keys());

// ========================================================================
// UTILITIES
// ========================================================================

// Integer columns in computed_daily_scores that must be rounded (not truncated)
// Matches production schema: these are integer type in computed_daily_scores
// Kept for backward compatibility with existing code
export const INTEGER_SCORES_COLUMNS = new Set<string>([
  'recovery_score',
  'dynamic_tdee_kcal',
  'target_kcal',
  'target_protein_g',
  'target_carbs_g',
  'target_fat_g',
  'tmb_kcal',
  'sleep_hours_vs_needed_pct',
  'sleep_regularity_pct',
  'high_sleep_stress_pct',
  'intake_kcal',
  'intake_protein_g',
  'intake_carbs_g',
  'intake_fat_g',
  'dynamic_rmssd_cap_ms',
  'nap_sleep_min',
  'time_in_bed_min',
  'total_sleep_min',
  'deep_sleep_min',
  'rem_sleep_min',
  'light_sleep_min',
  'steps_net',
  'z13_minutes',
  'z45_minutes',
  'tef_kcal',
  'empirical_tdee_kcal',
  'pickleball_or_gym_minutes',
  'steps_count',
]);

/**
 * Strict validator & sanitizer using SCORES_COLUMN_SPECS
 * Applies exact type rules for all 92 production columns:
 * - integer: round + clamp to int32 range
 * - numeric(p,s): round to scale decimal places + clamp to min/max
 * - numeric: clamp to min/max
 * - time: validate HH:mm[:ss] regex, null if invalid
 * - boolean: coerce to boolean
 * - date: validate YYYY-MM-DD
 * - timestamptz: validate ISO 8601
 * - uuid: validate UUID v4 format
 * - jsonb: recursive NaN/Infinity → null
 * - text: passthrough (max 10000 chars)
 */
export function sanitizeForDb(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip columns not in production schema
    const spec = SCORES_COLUMN_SPECS.get(key);
    if (!spec) continue;

    // Special handling for boolean: null/undefined -> false
    if (spec.kind === 'boolean' && (value === null || value === undefined)) {
      result[key] = false;
      continue;
    }

    // Handle null/undefined for other types
    if (value === null || value === undefined) {
      result[key] = null;
      continue;
    }

    // Handle NaN/Infinity for numbers
    if (typeof value === 'number') {
      if (Number.isNaN(value) || !Number.isFinite(value)) {
        result[key] = null;
        continue;
      }
    }

    // Apply type-specific validation & coercion
    switch (spec.kind) {
      case 'integer': {
        if (typeof value === 'number' && Number.isFinite(value)) {
          let rounded = Math.round(value);
          // Clamp to int32 range and column-specific min/max
          const min = spec.min ?? -2147483648;
          const max = spec.max ?? 2147483647;
          rounded = Math.max(min, Math.min(max, rounded));
          result[key] = rounded;
        } else if (typeof value === 'string') {
          // Try to parse string numbers - empty string should be null
          if (value.trim() === '') {
            result[key] = null;
          } else {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
              let rounded = Math.round(parsed);
              const min = spec.min ?? -2147483648;
              const max = spec.max ?? 2147483647;
              rounded = Math.max(min, Math.min(max, rounded));
              result[key] = rounded;
            } else {
              result[key] = null;
            }
          }
        } else {
          result[key] = null;
        }
        break;
      }

      case 'numeric': {
        if (typeof value === 'number' && Number.isFinite(value)) {
          let num = value;
          // Round to scale decimal places if precision/scale specified
          if (spec.scale !== undefined) {
            const factor = Math.pow(10, spec.scale);
            num = Math.round(num * factor) / factor;
          }
          // Clamp to min/max
          const min = spec.min ?? -1e15;
          const max = spec.max ?? 1e15;
          num = Math.max(min, Math.min(max, num));
          result[key] = num;
        } else if (typeof value === 'string') {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            let num = parsed;
            if (spec.scale !== undefined) {
              const factor = Math.pow(10, spec.scale);
              num = Math.round(num * factor) / factor;
            }
            const min = spec.min ?? -1e15;
            const max = spec.max ?? 1e15;
            num = Math.max(min, Math.min(max, num));
            result[key] = num;
          } else {
            result[key] = null;
          }
        } else {
          result[key] = null;
        }
        break;
      }

      case 'time': {
        // Validate HH:mm[:ss] format
        if (typeof value === 'string') {
          const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
          if (timeRegex.test(value)) {
            result[key] = value;
          } else {
            result[key] = null; // Invalid time format → null
          }
        } else {
          result[key] = null;
        }
        break;
      }

      case 'boolean': {
        // Coerce to boolean - null/undefined becomes false
        if (value === null || value === undefined) {
          result[key] = false;
        } else if (typeof value === 'boolean') {
          result[key] = value;
        } else if (typeof value === 'number') {
          result[key] = value !== 0;
        } else if (typeof value === 'string') {
          const lower = value.toLowerCase();
          result[key] = lower === 'true' || lower === '1' || lower === 'yes';
        } else {
          result[key] = false;
        }
        break;
      }

      case 'date': {
        // Validate YYYY-MM-DD format
        if (typeof value === 'string') {
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (dateRegex.test(value)) {
            // Additional validation: check it's a valid date (no month/day overflow)
            const [year, month, day] = value.split('-').map(Number);
            const parsed = new Date(Date.UTC(year, month - 1, day));
            if (!isNaN(parsed.getTime()) &&
                parsed.getUTCFullYear() === year &&
                parsed.getUTCMonth() === month - 1 &&
                parsed.getUTCDate() === day) {
              result[key] = value;
            } else {
              result[key] = null;
            }
          } else {
            result[key] = null;
          }
        } else if (value instanceof Date) {
          result[key] = value.toISOString().split('T')[0];
        } else {
          result[key] = null;
        }
        break;
      }

      case 'timestamptz': {
        // Validate ISO 8601 datetime
        if (typeof value === 'string') {
          const parsed = new Date(value);
          if (!isNaN(parsed.getTime())) {
            result[key] = parsed.toISOString();
          } else {
            result[key] = null;
          }
        } else if (value instanceof Date) {
          result[key] = value.toISOString();
        } else {
          result[key] = null;
        }
        break;
      }

      case 'uuid': {
        // Validate UUID format (any version)
        if (typeof value === 'string') {
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (uuidRegex.test(value)) {
            result[key] = value.toLowerCase();
          } else {
            result[key] = null;
          }
        } else {
          result[key] = null;
        }
        break;
      }

      case 'jsonb': {
        // Recursively sanitize JSONB: NaN/Infinity → null
        if (value && typeof value === 'object') {
          result[key] = sanitizeJsonb(value);
        } else {
          result[key] = null;
        }
        break;
      }

      case 'text': {
        // Passthrough with length limit
        if (typeof value === 'string') {
          result[key] = value.length > 10000 ? value.slice(0, 10000) : value;
        } else if (value === null || value === undefined) {
          result[key] = null;
        } else {
          result[key] = String(value);
        }
        break;
      }

      default: {
        // Exhaustive check - should never reach here
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Recursively sanitize JSONB values: NaN/Infinity → null
 */
function sanitizeJsonb(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonb);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = sanitizeJsonb(v);
    }
    return result;
  }
  return value;
}

/**
 * Filter payload to only allowed columns
 */
export function filterAllowedColumns(payload: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (ALLOWED_SCORES_COLUMNS.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Normalize habitual_wake to HH:mm format with safe fallback
 * Root cause of "NaN:NaN": habitual_wake was null/undefined/empty from profiles,
 * causing computeEngine to produce NaN bedtime calculations.
 */
export function normalizeHabitualWake(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    return '07:00'; // Safe default: 7 AM
  }
  const trimmed = raw.trim();
  // Validate HH:mm or HH:mm:ss format
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
  if (timeRegex.test(trimmed)) {
    // Return HH:mm (strip seconds if present)
    return trimmed.slice(0, 5);
  }
  // Invalid format → fallback
  console.warn(`[RECOMPUTE] Invalid habitual_wake format "${raw}", using fallback 07:00`);
  return '07:00';
}

/**
 * Fetch user profile from profiles table
 */
async function fetchUserProfile(supabase: SupabaseClient, userId: string): Promise<UserProfile> {
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

  // Normalize habitual_wake with safe fallback (fixes NaN:NaN root cause)
  const habitualWake = normalizeHabitualWake(data.habitual_wake);

  return {
    birth: data.birth_date,
    height_m: Number(data.height_m),
    timezone: data.timezone,
    basalSleepNeedH: Number(data.basal_sleep_need_h) || 7.5,
    habitualWake,
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
  supabase: SupabaseClient,
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
  supabase: SupabaseClient,
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
    if (!raw) continue;
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
  if (!prevRaw) return null;
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
    dynamic_sleep_need_hours: prevComputed.dynamic_sleep_need_h ?? null,
    ln_rmssd: prevComputed.ln_rmssd ?? null,
    ln_rmssd_14d_mean: prevComputed.ln_rmssd_14d_mean ?? null,
    ln_rmssd_14d_sd: prevComputed.ln_rmssd_14d_sd ?? null,
    hrv_z_score: prevComputed.hrv_z_score ?? null,
    rhr_z_score: prevComputed.rhr_z_score ?? null,
    sleep_regularity_pct: prevComputed.sleep_regularity_pct ?? null,
    cumulative_sleep_debt_hours: prevComputed.cumulative_sleep_debt_hours ?? null,
    hrv_mode: undefined,
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

  // Validate environment variables at runtime
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    return { success: 0, failed: 1, errors: ['Missing environment variables'] };
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  console.log(`[RECOMPUTE] User: ${userId}, Range: ${fromDate} to ${toDate}, DryRun: ${dryRun}`);

  // Fetch user profile
  const profile = await fetchUserProfile(supabase, userId);
  console.log(`[RECOMPUTE] Profile: age=${profile.chronologicalAgeYears}, sex=${profile.biologicalSex}, height=${profile.height_m}m`);

  // We need 60 days before fromDate for rolling windows
  const extendedFrom = formatDate(new Date(new Date(fromDate + 'T00:00:00Z').getTime() - 60 * 86400000));

  // Fetch all raw biometrics from extended range
  const allRaw = await fetchRawBiometrics(supabase, userId, extendedFrom, toDate);
  console.log(`[RECOMPUTE] Fetched ${allRaw.length} raw biometric days (${extendedFrom} to ${toDate})`);

  // Fetch existing computed scores for the same range
  const allComputed = await fetchComputedScores(supabase, userId, extendedFrom, toDate);
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

    // Sanitize NaN/Infinity and round integer columns
    const sanitized = sanitizeForDb(computed as unknown as Record<string, unknown>);

    // Map engine output field names to production column names
    if (sanitized.dynamic_sleep_need_h !== undefined && sanitized.dynamic_sleep_need_h !== null) {
      sanitized.dynamic_sleep_need_hours = sanitized.dynamic_sleep_need_h;
    }

    // Build payload: add user_id and computed_at, then filter to allowed columns LAST
    const payload = filterAllowedColumns({
      ...sanitized,
      user_id: userId,
      computed_at: new Date().toISOString(),
    });

    if (dryRun) {
      console.log(`[DRY RUN] ${logDate}: OK (${Object.keys(payload).length} columns)`);
      success++;
      continue;
    }

    // Upsert to computed_daily_scores
    // FIX: Production PK is log_date only (not user_id,log_date)
    const { error } = await supabase
      .from('computed_daily_scores')
      .upsert(payload, { onConflict: 'log_date' });

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