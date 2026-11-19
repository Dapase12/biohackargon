/**
 * ARGON v6.0 — Zod Validation Schemas
 * Single source of truth for all input validation boundaries.
 * Import from: import { ProfileSchema, RawBiometricSchema, ... } from '@/api/schemas';
 */

import { z } from 'zod';
import type { TablesInsert } from '@/types';

// ============================================================
// PRIMITIVE VALIDATORS
// ============================================================
const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD requerido');
const isoDateTimeString = z.string().datetime({ offset: true });
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const boundedNumber = (min: number, max: number) => z.number().min(min).max(max);

// ============================================================
// PROFILE / USER CONFIG
// ============================================================
export const ProfileSchema = z.object({
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()),
  heightCm: boundedNumber(100, 250),
  weightKg: boundedNumber(30, 200),
  bodyFatPct: boundedNumber(3, 55),
  biologicalSex: z.enum(['male', 'female']),
  basalSleepNeedH: boundedNumber(4, 12),
  habitualWake: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato HH:MM requerido'),
  timezone: z.string().min(1),  // IANA tz validated at runtime
  goalWeightKg: boundedNumber(30, 200).optional(),
  goalDate: isoDateString.optional().nullable(),
  dailyDeficitKcal: boundedNumber(-1000, 0),
  hydrationMlPerKg: boundedNumber(20, 50).optional(),
  lthrBpm: boundedNumber(100, 220).optional(),
  ftpWatts: boundedNumber(50, 500).optional(),
  // Computed targets (server-side, stored for offline access)
  targetKcal: boundedNumber(1000, 5000).optional(),
  targetProteinG: boundedNumber(50, 400).optional(),
  targetCarbsG: boundedNumber(50, 600).optional(),
  targetFatG: boundedNumber(30, 200).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;

// ============================================================
// RAW BIOMETRICS (daily_raw_biometrics insert)
// ============================================================
export const RawBiometricSchema = z.object({
  log_date: isoDateString,

  // Sleep
  time_in_bed_min: nonNegativeInt.optional().nullable(),
  total_sleep_min: nonNegativeInt.optional().nullable(),
  deep_sleep_min: nonNegativeInt.optional().nullable(),
  rem_sleep_min: nonNegativeInt.optional().nullable(),
  light_sleep_min: nonNegativeInt.optional().nullable(),
  sleep_onset_timestamp: isoDateTimeString.optional().nullable(),
  wake_timestamp: isoDateTimeString.optional().nullable(),
  nap_sleep_min: nonNegativeInt.optional().nullable(),

  // HRV / Cardio
  rmssd_ms: boundedNumber(5, 300).optional().nullable(),
  rhr_bpm: boundedNumber(30, 140).optional().nullable(),
  resp_rate_brpm: boundedNumber(8, 40).optional().nullable(),
  spo2_pct: boundedNumber(70, 100).optional().nullable(),
  hr_zones_minutes: z.record(z.string(), nonNegativeInt).optional().nullable(),

  // Activity
  steps_count: nonNegativeInt.optional().nullable(),
  active_calories_kcal: nonNegativeInt.optional().nullable(),
  pickleball_or_gym_minutes: nonNegativeInt.optional().nullable(),
  session_rpe: boundedNumber(1, 10).optional().nullable(),
  night_awake_shift_hours: boundedNumber(0, 24).optional().nullable(),
  is_hospital_shift: z.boolean().optional().nullable(),

  // Body composition (Feelfit)
  weight_kg: boundedNumber(30, 200).optional().nullable(),
  body_fat_pct: boundedNumber(3, 55).optional().nullable(),
  body_water_pct: boundedNumber(30, 80).optional().nullable(),
  skeletal_muscle_kg: boundedNumber(10, 100).optional().nullable(),
  skeletal_muscle_pct: boundedNumber(10, 60).optional().nullable(),
  visceral_fat_index: boundedNumber(1, 59).optional().nullable(),
  bone_mass_kg: boundedNumber(1, 10).optional().nullable(),
  muscle_mass_kg: boundedNumber(10, 100).optional().nullable(),
  tmb_kcal: nonNegativeInt.optional().nullable(),
  metabolic_age: nonNegativeInt.optional().nullable(),
  skin_temp_delta_c: z.number().optional().nullable(),

  // Nutrition
  intake_kcal: nonNegativeInt.optional().nullable(),
  intake_protein_g: boundedNumber(0, 500).optional().nullable(),
  intake_carbs_g: boundedNumber(0, 500).optional().nullable(),
  intake_fat_g: boundedNumber(0, 500).optional().nullable(),
  meals_log_json: z.array(z.unknown()).optional().nullable(),

  // Raw sensor data
  raw_rr_intervals_ms: z.array(z.number()).optional().nullable(),

  // Computed (from server)
  computed_at: isoDateTimeString.optional().nullable(),
});

export type RawBiometric = z.infer<typeof RawBiometricSchema>;

// ============================================================
// COMPUTED DAILY SCORES (computed_daily_scores insert)
// Server is source of truth - client only reads
// ============================================================
export const ComputedDailyScoresSchema = z.object({
  log_date: isoDateString,

  // Recovery
  recovery_score: boundedNumber(0, 100).optional().nullable(),
  recovery_status: z.string().optional().nullable(),
  recommended_max_strain: boundedNumber(0, 21).optional().nullable(),
  calibrating: z.boolean().optional().nullable(),
  sleep_missing: z.boolean().optional().nullable(),
  hrv_missing: z.boolean().optional().nullable(),

  // HRV details
  rmssd_ms: boundedNumber(5, 300).optional().nullable(),
  rmssd_14d_mean_ms: boundedNumber(5, 300).optional().nullable(),
  ln_rmssd: z.number().optional().nullable(),
  ln_rmssd_14d_mean: z.number().optional().nullable(),
  ln_rmssd_14d_sd: z.number().optional().nullable(),
  hrv_z_score: z.number().optional().nullable(),
  dynamic_rmssd_cap_ms: nonNegativeInt.optional().nullable(),
  cv_lnrmssd_7d_pct: z.number().optional().nullable(),
  swc_lnrmssd: z.number().optional().nullable(),

  // RHR details
  rhr_bpm: boundedNumber(30, 140).optional().nullable(),
  rhr_14d_mean_bpm: boundedNumber(30, 140).optional().nullable(),
  rhr_z_score: z.number().optional().nullable(),

  // Sleep details
  total_sleep_min: nonNegativeInt.optional().nullable(),
  deep_sleep_min: nonNegativeInt.optional().nullable(),
  rem_sleep_min: nonNegativeInt.optional().nullable(),
  light_sleep_min: nonNegativeInt.optional().nullable(),
  sleep_hours_vs_needed_pct: boundedNumber(0, 200).optional().nullable(),
  sleep_regularity_pct: boundedNumber(0, 100).optional().nullable(),
  high_sleep_stress_pct: boundedNumber(0, 100).optional().nullable(),
  sleep_efficiency_pct: boundedNumber(0, 100).optional().nullable(),
  sleep_architecture_score: boundedNumber(0, 100).optional().nullable(),
  nap_sleep_min: nonNegativeInt.optional().nullable(),

  // Strain breakdown
  strain_score: boundedNumber(0, 21).optional().nullable(),
  steps_net: nonNegativeInt.optional().nullable(),
  session_rpe: boundedNumber(1, 10).optional().nullable(),
  hr_zones_minutes: z.record(z.string(), nonNegativeInt).optional().nullable(),
  z13_minutes: nonNegativeInt.optional().nullable(),
  z45_minutes: nonNegativeInt.optional().nullable(),
  is_hospital_shift: z.boolean().optional().nullable(),
  night_awake_shift_hours: boundedNumber(0, 24).optional().nullable(),
  cardio_trimp_load: z.number().optional().nullable(),
  neuromuscular_load: z.number().optional().nullable(),
  shift_orthostatic_load: z.number().optional().nullable(),
  acwr_penalty_strain: z.number().optional().nullable(),

  // Physiological age
  chronological_age: z.number().optional().nullable(),
  argon_physiological_age: z.number().optional().nullable(),
  total_age_delta: z.number().optional().nullable(),
  pace_of_aging_x: z.number().optional().nullable(),
  delta_vo2_years: z.number().optional().nullable(),
  delta_rhr_years: z.number().optional().nullable(),
  delta_lnrmssd_years: z.number().optional().nullable(),
  delta_ffm_years: z.number().optional().nullable(),
  delta_sleep_years: z.number().optional().nullable(),
  delta_act_years: z.number().optional().nullable(),
  vo2_max_ml_kg_min: z.number().optional().nullable(),

  // Body composition
  weight_kg: boundedNumber(30, 200).optional().nullable(),
  body_fat_pct: boundedNumber(3, 55).optional().nullable(),
  fat_mass_kg: z.number().optional().nullable(),
  ffm_kg: z.number().optional().nullable(),
  ffm_pct: z.number().optional().nullable(),
  muscle_mass_kg: z.number().optional().nullable(),
  bone_mass_kg: z.number().optional().nullable(),
  skeletal_muscle_pct: z.number().optional().nullable(),
  visceral_fat_index: boundedNumber(1, 59).optional().nullable(),
  tmb_kcal: nonNegativeInt.optional().nullable(),
  body_water_pct: boundedNumber(30, 80).optional().nullable(),
  water_mass_kg: z.number().optional().nullable(),
  bmi: z.number().optional().nullable(),
  trend_body_fat_pct: z.number().optional().nullable(),

  // Nutrition targets & actuals
  target_kcal: nonNegativeInt.optional().nullable(),
  target_protein_g: nonNegativeInt.optional().nullable(),
  target_carbs_g: nonNegativeInt.optional().nullable(),
  target_fat_g: nonNegativeInt.optional().nullable(),
  intake_kcal: nonNegativeInt.optional().nullable(),
  intake_protein_g: boundedNumber(0, 500).optional().nullable(),
  intake_carbs_g: boundedNumber(0, 500).optional().nullable(),
  intake_fat_g: boundedNumber(0, 500).optional().nullable(),
  tef_kcal: nonNegativeInt.optional().nullable(),
  empirical_tdee_kcal: nonNegativeInt.optional().nullable(),

  // Sleep timing
  optimal_bedtime_start: z.string().optional().nullable(),
  optimal_bedtime_end: z.string().optional().nullable(),

  // Exercise
  pickleball_or_gym_minutes: nonNegativeInt.optional().nullable(),

  // Misc
  dynamic_sleep_need_hours: z.number().optional().nullable(),
  dynamic_tdee_kcal: z.number().optional().nullable(),
  resp_rate_brpm: boundedNumber(8, 40).optional().nullable(),
  resp_14d_mean_brpm: boundedNumber(8, 40).optional().nullable(),
  spo2_pct: boundedNumber(70, 100).optional().nullable(),
  steps_count: nonNegativeInt.optional().nullable(),
  time_in_bed_min: nonNegativeInt.optional().nullable(),
  clinical_coach_notes: z.string().optional().nullable(),
  cumulative_sleep_debt_hours: z.number().optional().nullable(),
  trend_weight_kg: z.number().optional().nullable(),
});

export type ComputedDailyScores = z.infer<typeof ComputedDailyScoresSchema>;

// ============================================================
// WEBHOOK PAYLOAD (Health Connect → GAS)
// ============================================================
export const WebhookPayloadSchema = z.object({
  // Top-level categories detected
  categories: z.array(z.string()).optional(),

  // Per-date raw data
  data: z.record(
    isoDateString,
    z.object({
      // Sleep sessions
      sleep: z.array(z.object({
        startTime: isoDateTimeString,
        endTime: isoDateTimeString,
        stages: z.array(z.object({
          stage: z.number().int().min(1).max(6),
          startTime: isoDateTimeString,
          endTime: isoDateTimeString,
        })).optional(),
        samples: z.array(z.object({
          timestamp: isoDateTimeString,
          value: z.number(),
          type: z.enum(['heart_rate', 'hrv', 'spo2', 'respiratory_rate']),
        })).optional(),
      })).optional(),

      // Steps
      steps: z.array(z.object({
        startTime: isoDateTimeString,
        endTime: isoDateTimeString,
        steps: nonNegativeInt,
      })).optional(),

      // Exercise sessions
      exercise: z.array(z.object({
        startTime: isoDateTimeString,
        endTime: isoDateTimeString,
        type: z.string(),
        calories: z.number().optional(),
        distance: z.number().optional(),
        heartRateSamples: z.array(z.object({
          timestamp: isoDateTimeString,
          bpm: z.number().int(),
        })).optional(),
      })).optional(),

      // Body composition (Feelfit)
      bodyComposition: z.object({
        weight: z.number().optional(),
        bodyFat: z.number().optional(),
        muscleMass: z.number().optional(),
        water: z.number().optional(),
        boneMass: z.number().optional(),
        visceralFat: z.number().optional(),
        bmi: z.number().optional(),
        metabolicAge: z.number().optional(),
      }).optional(),

      // Nutrition (manual entry)
      nutrition: z.object({
        calories: nonNegativeInt,
        protein: z.number().optional(),
        carbs: z.number().optional(),
        fat: z.number().optional(),
        meals: z.array(z.object({
          name: z.string(),
          time: isoDateTimeString,
          calories: nonNegativeInt,
          protein: z.number().optional(),
          carbs: z.number().optional(),
          fat: z.number().optional(),
        })).optional(),
      }).optional(),
    })
  ).optional(),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

// ============================================================
// COACH QUERY
// ============================================================
export const CoachQuerySchema = z.object({
  action: z.literal('ask_coach'),
  user_id: z.string().uuid(),
  question: z.string().min(1).max(2000),
  context: z.object({
    recentDays: z.number().int().min(1).max(30).default(14),
    includeSleep: z.boolean().default(true),
    includeRecovery: z.boolean().default(true),
    includeNutrition: z.boolean().default(true),
    includeActivity: z.boolean().default(true),
  }).optional(),
  chatHistory: z.array(z.object({
    role: z.enum(['user', 'model']),
    parts: z.array(z.object({ text: z.string() })),
  })).optional(),
});

export type CoachQuery = z.infer<typeof CoachQuerySchema>;

// ============================================================
// MEAL ESTIMATION (image)
// ============================================================
export const EstimateMealSchema = z.object({
  action: z.literal('estimate_meal'),
  user_id: z.string().uuid(),
  image_b64: z.string().min(1).max(2_000_000),  // Base64, max ~1.5MB
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  context: z.string().max(500).optional(),
});

export type EstimateMeal = z.infer<typeof EstimateMealSchema>;

// ============================================================
// SET PROFILE
// ============================================================
export const SetProfileSchema = z.object({
  action: z.literal('set_profile'),
  user_id: z.string().uuid(),
  profile: ProfileSchema,
});

export type SetProfile = z.infer<typeof SetProfileSchema>;

// ============================================================
// RECALC DAY
// ============================================================
export const RecalcDaySchema = z.object({
  action: z.literal('recalc_day'),
  user_id: z.string().uuid(),
  date: isoDateString,
});

export type RecalcDay = z.infer<typeof RecalcDaySchema>;

// ============================================================
// UNION: ALL GAS ACTIONS
// ============================================================
export const GasActionSchema = z.discriminatedUnion('action', [
  CoachQuerySchema,
  EstimateMealSchema,
  SetProfileSchema,
  RecalcDaySchema,
  z.object({ action: z.literal('sync'), user_id: z.string().uuid().optional() }),
]);

export type GasAction = z.infer<typeof GasActionSchema>;

// ============================================================
// VALIDATION HELPERS
// ============================================================
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Validation failed: ${errors}`);
  }
  return result.data;
}

export function validateOptional<T>(schema: z.ZodSchema<T>, data: unknown): T | null {
  if (data == null) return null;
  return validate(schema, data);
}