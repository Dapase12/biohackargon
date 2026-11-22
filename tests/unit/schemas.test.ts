import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// Since the project doesn't have explicit Zod schemas yet,
// we'll define the expected schemas based on the data structures
// used in the codebase (Supabase tables, webhook payloads, etc.)

describe('Zod Validation Schemas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Profile Schema (config.js)', () => {
    const ProfileSchema = z.object({
      birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      heightM: z.number().positive().max(3),
      timezone: z.string().min(1),
      basalSleepNeedH: z.number().positive().max(12),
      habitualWake: z.string().regex(/^\d{2}:\d{2}$/),
      goalWeightKg: z.number().positive().max(300),
      goalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dailyDeficitKcal: z.number().int().min(-2000).max(2000),
      biologicalSex: z.enum(['male', 'female'])
    })

    it('should validate correct profile', () => {
      const validProfile = {
        birthDate: '1990-01-15',
        heightM: 1.75,
        timezone: 'America/Caracas',
        basalSleepNeedH: 7.5,
        habitualWake: '06:30',
        goalWeightKg: 75,
        goalDate: '2025-12-31',
        dailyDeficitKcal: 500,
        biologicalSex: 'male'
      }
      expect(() => ProfileSchema.parse(validProfile)).not.toThrow()
    })

    it('should reject invalid timezone', () => {
      const invalid = { ...validProfile, timezone: '' }
      expect(() => ProfileSchema.parse(invalid)).toThrow()
    })

    it('should reject invalid height', () => {
      const invalid = { ...validProfile, heightM: 0 }
      expect(() => ProfileSchema.parse(invalid)).toThrow()
    })

    it('should reject invalid sex', () => {
      const invalid = { ...validProfile, biologicalSex: 'other' }
      expect(() => ProfileSchema.parse(invalid)).toThrow()
    })

    it('should reject invalid wake time format', () => {
      const invalid = { ...validProfile, habitualWake: '6:30' }
      expect(() => ProfileSchema.parse(invalid)).toThrow()
    })

    const validProfile = {
      birthDate: '1990-01-15',
      heightM: 1.75,
      timezone: 'America/Caracas',
      basalSleepNeedH: 7.5,
      habitualWake: '06:30',
      goalWeightKg: 75,
      goalDate: '2025-12-31',
      dailyDeficitKcal: 500,
      biologicalSex: 'male' as const
    }
  })

  describe('Raw Biometrics Schema (daily_raw_biometrics table - PRODUCTION)', () => {
    const RawBiometricsSchema = z.object({
      user_id: z.string().uuid(),
      log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      // Sleep - PRODUCTION COLUMNS ONLY
      rmssd_ms: z.number().positive().max(300).nullable(),
      time_in_bed_min: z.number().int().min(0).max(1440).nullable(),
      total_sleep_min: z.number().int().min(0).max(1440).nullable(),
      deep_sleep_min: z.number().int().min(0).max(1440).nullable(),
      rem_sleep_min: z.number().int().min(0).max(1440).nullable(),
      light_sleep_min: z.number().int().min(0).max(1440).nullable(),
      nap_sleep_min: z.number().int().min(0).max(1440).nullable(),
      sleep_onset_timestamp: z.string().datetime().nullable(),
      wake_timestamp: z.string().datetime().nullable(),
      // Exercise - PRODUCTION COLUMNS ONLY
      pickleball_or_gym_minutes: z.number().int().min(0).nullable(),
      active_calories_kcal: z.number().int().min(0).nullable(),
      hr_zones_minutes: z.record(z.number()).nullable(),
      // Body Composition - PRODUCTION COLUMNS ONLY
      weight_kg: z.number().positive().max(300).nullable(),
      body_fat_pct: z.number().min(0).max(100).nullable(),
      // Manual fields (preserved)
      meals_log_json: z.any().nullable(),
      session_rpe: z.number().nullable(),
      intake_kcal: z.number().int().nullable(),
      intake_protein_g: z.number().nullable(),
      intake_carbs_g: z.number().nullable(),
      intake_fat_g: z.number().nullable(),
      is_hospital_shift: z.boolean().nullable(),
      night_awake_shift_hours: z.number().nullable(),
      // Metadata
      raw_payload_hash: z.string().nullable(),
      updated_at: z.string().datetime().nullable(),
    })

    it('should validate complete raw biometrics (production schema)', () => {
      const valid = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        log_date: '2025-01-15',
        rmssd_ms: 45,
        time_in_bed_min: 540,
        total_sleep_min: 480,
        deep_sleep_min: 90,
        rem_sleep_min: 100,
        light_sleep_min: 250,
        nap_sleep_min: 20,
        sleep_onset_timestamp: '2025-01-15T02:30:00Z',
        wake_timestamp: '2025-01-15T10:30:00Z',
        pickleball_or_gym_minutes: 60,
        active_calories_kcal: 450,
        hr_zones_minutes: { z1: 10, z2: 20, z3: 15, z4: 10, z5: 5 },
        weight_kg: 75.5,
        body_fat_pct: 18,
        meals_log_json: [],
        session_rpe: null,
        intake_kcal: null,
        intake_protein_g: null,
        intake_carbs_g: null,
        intake_fat_g: null,
        is_hospital_shift: false,
        night_awake_shift_hours: null,
        raw_payload_hash: 'abc123',
        updated_at: '2025-01-15T10:00:00Z',
      }
      expect(() => RawBiometricsSchema.parse(valid)).not.toThrow()
    })

    it('should allow nulls for optional fields', () => {
      const minimal = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        log_date: '2025-01-15',
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
        weight_kg: null,
        body_fat_pct: null,
        meals_log_json: null,
        session_rpe: null,
        intake_kcal: null,
        intake_protein_g: null,
        intake_carbs_g: null,
        intake_fat_g: null,
        is_hospital_shift: null,
        night_awake_shift_hours: null,
        raw_payload_hash: null,
        updated_at: null,
      }
      expect(() => RawBiometricsSchema.parse(minimal)).not.toThrow()
    })

    it('should reject invalid UUID', () => {
      const invalid = { ...validRaw, user_id: 'not-a-uuid' }
      expect(() => RawBiometricsSchema.parse(invalid)).toThrow()
    })

    it('should reject invalid date format', () => {
      const invalid = { ...validRaw, log_date: '15-01-2025' }
      expect(() => RawBiometricsSchema.parse(invalid)).toThrow()
    })

    it('should reject RMSSD out of range', () => {
      const invalid = { ...validRaw, rmssd_ms: 500 }
      expect(() => RawBiometricsSchema.parse(invalid)).toThrow()
    })

    const validRaw = {
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      log_date: '2025-01-15',
      rmssd_ms: 45,
      time_in_bed_min: 540,
      total_sleep_min: 480,
      deep_sleep_min: 90,
      rem_sleep_min: 100,
      light_sleep_min: 250,
      nap_sleep_min: 20,
      sleep_onset_timestamp: '2025-01-15T02:30:00Z',
      wake_timestamp: '2025-01-15T10:30:00Z',
      pickleball_or_gym_minutes: 60,
      active_calories_kcal: 450,
      hr_zones_minutes: { z1: 10, z2: 20, z3: 15, z4: 10, z5: 5 },
      weight_kg: 75.5,
      body_fat_pct: 18,
      meals_log_json: [],
      session_rpe: null,
      intake_kcal: null,
      intake_protein_g: null,
      intake_carbs_g: null,
      intake_fat_g: null,
      is_hospital_shift: false,
      night_awake_shift_hours: null,
      raw_payload_hash: 'abc123',
      updated_at: '2025-01-15T10:00:00Z',
    }
  })

  describe('Computed Scores Schema (computed_daily_scores table)', () => {
    const ComputedScoresSchema = z.object({
      user_id: z.string().uuid(),
      log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      recovery_score: z.number().min(0).max(100).nullable(),
      readiness_score: z.number().min(0).max(100).nullable(),
      sleep_debt_h: z.number().min(0).max(24).nullable(),
      dynamic_sleep_need_h: z.number().positive().max(12).nullable(),
      optimal_bedtime_start: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
      optimal_bedtime_end: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
      hrv_baseline_rmssd: z.number().positive().max(300).nullable(),
      hrv_7d_avg: z.number().positive().max(300).nullable(),
      hrv_14d_avg: z.number().positive().max(300).nullable(),
      hrv_swc: z.number().min(0).nullable(),
      rhr_baseline: z.number().positive().max(200).nullable(),
      rhr_7d_avg: z.number().positive().max(200).nullable(),
      strain_score: z.number().min(0).max(100).nullable(),
      training_load_7d: z.number().min(0).nullable(),
      acwr: z.number().min(0).nullable(),
      hydration_score: z.number().min(0).max(100).nullable(),
      body_comp_score: z.number().min(0).max(100).nullable()
    })

    it('should validate complete computed scores', () => {
      const valid = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        log_date: '2025-01-15',
        recovery_score: 78,
        readiness_score: 82,
        sleep_debt_h: 0.5,
        dynamic_sleep_need_h: 7.8,
        optimal_bedtime_start: '22:15',
        optimal_bedtime_end: '06:00',
        hrv_baseline_rmssd: 42,
        hrv_7d_avg: 44,
        hrv_14d_avg: 43,
        hrv_swc: 2.1,
        rhr_baseline: 56,
        rhr_7d_avg: 57,
        strain_score: 65,
        training_load_7d: 420,
        acwr: 1.1,
        hydration_score: 88,
        body_comp_score: 75
      }
      expect(() => ComputedScoresSchema.parse(valid)).not.toThrow()
    })

    it('should allow nulls during calibration', () => {
      const calibrating = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        log_date: '2025-01-10',
        recovery_score: null,
        readiness_score: null,
        sleep_debt_h: null,
        dynamic_sleep_need_h: null,
        optimal_bedtime_start: null,
        optimal_bedtime_end: null,
        hrv_baseline_rmssd: 42,
        hrv_7d_avg: 44,
        hrv_14d_avg: 43,
        hrv_swc: 2.1,
        rhr_baseline: 56,
        rhr_7d_avg: 57,
        strain_score: null,
        training_load_7d: null,
        acwr: null,
        hydration_score: null,
        body_comp_score: null
      }
      expect(() => ComputedScoresSchema.parse(calibrating)).not.toThrow()
    })

    it('should reject recovery score > 100', () => {
      const invalid = { ...validComputed, recovery_score: 101 }
      expect(() => ComputedScoresSchema.parse(invalid)).toThrow()
    })

    const validComputed = {
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      log_date: '2025-01-15',
      recovery_score: 78,
      readiness_score: 82,
      sleep_debt_h: 0.5,
      dynamic_sleep_need_h: 7.8,
      optimal_bedtime_start: '22:15',
      optimal_bedtime_end: '06:00',
      hrv_baseline_rmssd: 42,
      hrv_7d_avg: 44,
      hrv_14d_avg: 43,
      hrv_swc: 2.1,
      rhr_baseline: 56,
      rhr_7d_avg: 57,
      strain_score: 65,
      training_load_7d: 420,
      acwr: 1.1,
      hydration_score: 88,
      body_comp_score: 75
    }
  })

  describe('Webhook Payload Schema (GAS Health Connect)', () => {
    const WebhookPayloadSchema = z.object({
      user_id: z.string().uuid(),
      timestamp: z.string().datetime(),
      source: z.enum(['health_connect', 'zepp', 'manual']),
      biometrics: z.object({
        hrv_rmssd_ms: z.number().positive().max(300).nullable(),
        rhr_bpm: z.number().positive().max(200).nullable(),
        sleep: z.object({
          score: z.number().min(0).max(100).nullable(),
          total_min: z.number().int().min(0).max(1440).nullable(),
          deep_min: z.number().int().min(0).max(1440).nullable(),
          rem_min: z.number().int().min(0).max(1440).nullable(),
          light_min: z.number().int().min(0).max(1440).nullable(),
          awake_min: z.number().int().min(0).max(1440).nullable(),
          onset_latency_min: z.number().int().min(0).max(300).nullable(),
          efficiency_pct: z.number().min(0).max(100).nullable(),
          bedtime_start: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
          bedtime_end: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
          naps: z.array(z.object({
            start: z.string().regex(/^\d{2}:\d{2}$/),
            duration_min: z.number().int().min(10).max(240)
          })).default([])
        }).nullable(),
        activity: z.object({
          steps: z.number().int().min(0).default(0),
          active_calories: z.number().int().min(0).default(0),
          exercise_min: z.number().int().min(0).default(0),
          exercise_type: z.string().nullable(),
          hr_zones_minutes: z.record(z.number().int().min(0)).nullable()
        }).nullable(),
        body: z.object({
          weight_kg: z.number().positive().max(300).nullable(),
          body_fat_pct: z.number().min(0).max(100).nullable(),
          muscle_mass_kg: z.number().positive().max(200).nullable(),
          hydration_ml: z.number().int().min(0).default(0)
        }).nullable()
      })
    })

    it('should validate complete webhook payload', () => {
      const valid = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: '2025-01-15T10:30:00.000Z',
        source: 'health_connect',
        biometrics: {
          hrv_rmssd_ms: 45,
          rhr_bpm: 58,
          sleep: {
            score: 85,
            total_min: 480,
            deep_min: 90,
            rem_min: 100,
            light_min: 250,
            awake_min: 40,
            onset_latency_min: 15,
            efficiency_pct: 92,
            bedtime_start: '22:30',
            bedtime_end: '06:30',
            naps: [{ start: '14:00', duration_min: 20 }]
          },
          activity: {
            steps: 8500,
            active_calories: 450,
            exercise_min: 45,
            exercise_type: 'running',
            hr_zones_minutes: { '1': 10, '2': 20, '3': 15 }
          },
          body: {
            weight_kg: 75.5,
            body_fat_pct: 18,
            muscle_mass_kg: 58,
            hydration_ml: 2500
          }
        }
      }
      expect(() => WebhookPayloadSchema.parse(valid)).not.toThrow()
    })

    it('should reject invalid source', () => {
      const invalid = { ...validWebhook, source: 'invalid' }
      expect(() => WebhookPayloadSchema.parse(invalid)).toThrow()
    })

    it('should reject invalid timestamp', () => {
      const invalid = { ...validWebhook, timestamp: 'not-a-date' }
      expect(() => WebhookPayloadSchema.parse(invalid)).toThrow()
    })

    const validWebhook = {
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      timestamp: '2025-01-15T10:30:00.000Z',
      source: 'health_connect' as const,
      biometrics: {
        hrv_rmssd_ms: 45,
        rhr_bpm: 58,
        sleep: {
          score: 85,
          total_min: 480,
          deep_min: 90,
          rem_min: 100,
          light_min: 250,
          awake_min: 40,
          onset_latency_min: 15,
          efficiency_pct: 92,
          bedtime_start: '22:30',
          bedtime_end: '06:30',
          naps: [{ start: '14:00', duration_min: 20 }]
        },
        activity: {
          steps: 8500,
          active_calories: 450,
          exercise_min: 45,
          exercise_type: 'running',
          hr_zones_minutes: { '1': 10, '2': 20, '3': 15 }
        },
        body: {
          weight_kg: 75.5,
          body_fat_pct: 18,
          muscle_mass_kg: 58,
          hydration_ml: 2500
        }
      }
    }
  })

  describe('Coach Query Schema', () => {
    const CoachQuerySchema = z.object({
      user_id: z.string().uuid(),
      question: z.string().min(1).max(500),
      context_days: z.number().int().min(1).max(30).default(14)
    })

    it('should validate coach query', () => {
      const valid = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        question: '¿Cómo mejorar mi recuperación?',
        context_days: 14
      }
      expect(() => CoachQuerySchema.parse(valid)).not.toThrow()
    })

    it('should default context_days to 14', () => {
      const valid = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        question: 'Test question'
      }
      const parsed = CoachQuerySchema.parse(valid)
      expect(parsed.context_days).toBe(14)
    })

    it('should reject empty question', () => {
      const invalid = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        question: ''
      }
      expect(() => CoachQuerySchema.parse(invalid)).toThrow()
    })

    it('should reject question > 500 chars', () => {
      const invalid = {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        question: 'a'.repeat(501)
      }
      expect(() => CoachQuerySchema.parse(invalid)).toThrow()
    })
  })

  describe('Exercise Type Schema', () => {
    // From Zepp data: "0" = Entrenamiento (confirmed)
    const EXERCISE_TYPES = {
      '0': 'Entrenamiento',
      '1': 'Carrera',
      '2': 'Ciclismo',
      '3': 'Natación',
      '4': 'Caminata',
      '5': 'Elíptica',
      '6': 'Remo',
      '7': 'Yoga',
      '8': 'Fuerza',
      '9': 'HIIT'
    } as const

    const ExerciseTypeSchema = z.enum([
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
    ])

    it('should accept known exercise types', () => {
      expect(() => ExerciseTypeSchema.parse('0')).not.toThrow()
      expect(() => ExerciseTypeSchema.parse('1')).not.toThrow()
      expect(() => ExerciseTypeSchema.parse('8')).not.toThrow()
    })

    it('should reject unknown exercise types', () => {
      expect(() => ExerciseTypeSchema.parse('99')).toThrow()
    })
  })
})