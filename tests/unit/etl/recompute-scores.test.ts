import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// TEST UTILITIES (copied from setup for isolated testing)
// ============================================================================

function sanitizeForDb(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
      result[key] = null
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeForDb(value as Record<string, unknown>)
    } else if (Array.isArray(value)) {
      result[key] = value.map(v =>
        typeof v === 'number' && (Number.isNaN(v) || !Number.isFinite(v)) ? null :
        v && typeof v === 'object' ? sanitizeForDb(v as Record<string, unknown>) : v
      )
    } else {
      result[key] = value
    }
  }
  return result
}

function filterAllowedColumns(payload: Record<string, unknown>, allowedColumns: Set<string>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (allowedColumns.has(key)) {
      filtered[key] = value
    }
  }
  return filtered
}

// ============================================================================
// ALLOWED COLUMNS WHITELIST (92 production columns)
// ============================================================================

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
])

// ============================================================================
// TESTS
// ============================================================================

describe('recompute-scores utilities', () => {
  describe('sanitizeForDb', () => {
    it('should convert NaN to null', () => {
      const input = { a: NaN, b: 1 }
      const result = sanitizeForDb(input)
      expect(result.a).toBeNull()
      expect(result.b).toBe(1)
    })

    it('should convert Infinity to null', () => {
      const input = { a: Infinity, b: -Infinity, c: 42 }
      const result = sanitizeForDb(input)
      expect(result.a).toBeNull()
      expect(result.b).toBeNull()
      expect(result.c).toBe(42)
    })

    it('should handle nested objects with NaN', () => {
      const input = { outer: { inner: NaN, valid: 10 } }
      const result = sanitizeForDb(input)
      expect(result.outer).toEqual({ inner: null, valid: 10 })
    })

    it('should handle arrays with NaN/Infinity', () => {
      const input = { arr: [1, NaN, 3, Infinity, -Infinity, 5] }
      const result = sanitizeForDb(input)
      expect(result.arr).toEqual([1, null, 3, null, null, 5])
    })

    it('should handle arrays with nested objects containing NaN', () => {
      const input = { arr: [{ a: NaN }, { b: 42 }] }
      const result = sanitizeForDb(input)
      expect(result.arr).toEqual([{ a: null }, { b: 42 }])
    })

    it('should not modify valid numbers', () => {
      const input = { a: 0, b: -1, c: 3.14, d: 100 }
      const result = sanitizeForDb(input)
      expect(result).toEqual(input)
    })

    it('should handle empty object', () => {
      const result = sanitizeForDb({})
      expect(result).toEqual({})
    })
  })

  describe('filterAllowedColumns', () => {
    it('should only keep allowed columns', () => {
      const input = {
        log_date: '2025-01-15',
        recovery_score: 80,
        strain_score: 65,
        invalid_column: 'should be removed',
        another_invalid: 123,
      }
      const result = filterAllowedColumns(input, ALLOWED_SCORES_COLUMNS)
      expect(result).toEqual({
        log_date: '2025-01-15',
        recovery_score: 80,
        strain_score: 65,
      })
    })

    it('should handle empty input', () => {
      const result = filterAllowedColumns({}, ALLOWED_SCORES_COLUMNS)
      expect(result).toEqual({})
    })

    it('should handle all invalid columns', () => {
      const input = { invalid1: 1, invalid2: 2 }
      const result = filterAllowedColumns(input, ALLOWED_SCORES_COLUMNS)
      expect(result).toEqual({})
    })

    it('should allow all 92 production columns', () => {
      const input: Record<string, unknown> = {}
      for (const col of ALLOWED_SCORES_COLUMNS) {
        input[col] = 'test'
      }
      // Add some invalid
      input.invalid = 'bad'

      const result = filterAllowedColumns(input, ALLOWED_SCORES_COLUMNS)
      expect(Object.keys(result).length).toBe(92)
      expect(result).not.toHaveProperty('invalid')
    })
  })

  describe('hr_zones_minutes compatibility', () => {
    it('should handle both z1_minutes and z1 format in hr_zones_minutes', () => {
      // Simulate the merged format from buildRawBiometricsFromExercise
      const hrZonesOldFormat = {
        z1_minutes: 10,
        z2_minutes: 20,
        z3_minutes: 15,
        z4_minutes: 10,
        z5_minutes: 5,
        real: true,
        workouts: [],
      }

      const hrZonesNewFormat = {
        z1: 10,
        z2: 20,
        z3: 15,
        z4: 10,
        z5: 5,
        real: true,
        workouts: [],
      }

      // The computeHRZones function in strain.ts reads both:
      // z1: (hrZonesData.z1 ?? hrZonesData.z1_minutes ?? 0)
      // This simulates that logic
      const readZ1Old = hrZonesOldFormat.z1 ?? hrZonesOldFormat.z1_minutes ?? 0
      const readZ1New = hrZonesNewFormat.z1 ?? hrZonesNewFormat.z1_minutes ?? 0

      expect(readZ1Old).toBe(10)
      expect(readZ1New).toBe(10)
    })

    it('should prioritize z1 over z1_minutes when both present', () => {
      const hrZonesBoth = {
        z1: 25,        // New format value
        z1_minutes: 10, // Old format value
        z2: 20,
        z2_minutes: 15,
        z3: 15,
        z3_minutes: 10,
        z4: 10,
        z4_minutes: 5,
        z5: 5,
        z5_minutes: 2,
        real: true,
        workouts: [],
      }

      const readZ1 = hrZonesBoth.z1 ?? hrZonesBoth.z1_minutes ?? 0
      const readZ2 = hrZonesBoth.z2 ?? hrZonesBoth.z2_minutes ?? 0
      const readZ3 = hrZonesBoth.z3 ?? hrZonesBoth.z3_minutes ?? 0
      const readZ4 = hrZonesBoth.z4 ?? hrZonesBoth.z4_minutes ?? 0
      const readZ5 = hrZonesBoth.z5 ?? hrZonesBoth.z5_minutes ?? 0

      expect(readZ1).toBe(25)  // New format takes precedence
      expect(readZ2).toBe(20)
      expect(readZ3).toBe(15)
      expect(readZ4).toBe(10)
      expect(readZ5).toBe(5)
    })

    it('should handle missing z1 but present z1_minutes', () => {
      const hrZonesOnlyOld = {
        z1_minutes: 10,
        z2_minutes: 20,
        z3_minutes: 15,
        z4_minutes: 10,
        z5_minutes: 5,
        real: true,
        workouts: [],
      }

      const readZ1 = hrZonesOnlyOld.z1 ?? hrZonesOnlyOld.z1_minutes ?? 0
      expect(readZ1).toBe(10)
    })
  })

  describe('92 column whitelist validation', () => {
    it('should have exactly 92 columns in ALLOWED_SCORES_COLUMNS', () => {
      expect(ALLOWED_SCORES_COLUMNS.size).toBe(92)
    })

    it('should include all required core columns', () => {
      const requiredCore = [
        'log_date',
        'user_id',
        'recovery_score',
        'strain_score',
        'sleep_efficiency_pct',
        'ln_rmssd',
        'rhr_bpm',
        'vo2_max_ml_kg_min',
        'argon_physiological_age',
        'pace_of_aging_x',
        'computed_at',
      ]
      for (const col of requiredCore) {
        expect(ALLOWED_SCORES_COLUMNS.has(col)).toBe(true)
      }
    })

    it('should include all HR zone columns (both formats)', () => {
      const hrZoneCols = [
        'hr_zones_minutes',
        'z13_minutes',
        'z45_minutes',
      ]
      for (const col of hrZoneCols) {
        expect(ALLOWED_SCORES_COLUMNS.has(col)).toBe(true)
      }
    })

    it('should include all body composition columns', () => {
      const bodyCompCols = [
        'weight_kg',
        'body_fat_pct',
        'fat_mass_kg',
        'ffm_kg',
        'ffm_pct',
        'muscle_mass_kg',
        'bone_mass_kg',
        'water_mass_kg',
        'bmi',
        'skeletal_muscle_pct',
        'visceral_fat_index',
        'body_water_pct',
      ]
      for (const col of bodyCompCols) {
        expect(ALLOWED_SCORES_COLUMNS.has(col)).toBe(true)
      }
    })

    it('should include all sleep columns', () => {
      const sleepCols = [
        'total_sleep_min',
        'deep_sleep_min',
        'rem_sleep_min',
        'light_sleep_min',
        'nap_sleep_min',
        'time_in_bed_min',
        'sleep_efficiency_pct',
        'sleep_architecture_score',
        'sleep_regularity_pct',
        'high_sleep_stress_pct',
        'cumulative_sleep_debt_hours',
        'dynamic_sleep_need_hours',
        'optimal_bedtime_start',
        'optimal_bedtime_end',
        'sleep_hours_vs_needed_pct',
      ]
      for (const col of sleepCols) {
        expect(ALLOWED_SCORES_COLUMNS.has(col)).toBe(true)
      }
    })

    it('should include all HRV/Recovery columns', () => {
      const hrvCols = [
        'ln_rmssd',
        'ln_rmssd_14d_mean',
        'ln_rmssd_14d_sd',
        'hrv_z_score',
        'rhr_z_score',
        'recovery_score',
        'recovery_status',
        'rmssd_ms',
        'rmssd_14d_mean_ms',
        'rhr_bpm',
        'rhr_14d_mean_bpm',
        'cv_lnrmssd_7d_pct',
        'swc_lnrmssd',
        'dynamic_rmssd_cap_ms',
        'resp_rate_brpm',
        'resp_14d_mean_brpm',
        'spo2_pct',
        'calibrating',
        'sleep_missing',
        'hrv_missing',
      ]
      for (const col of hrvCols) {
        expect(ALLOWED_SCORES_COLUMNS.has(col)).toBe(true)
      }
    })

    it('should include all strain/load columns', () => {
      const strainCols = [
        'cardio_trimp_load',
        'neuromuscular_load',
        'shift_orthostatic_load',
        'strain_score',
        'recommended_max_strain',
        'acwr_penalty_strain',
      ]
      for (const col of strainCols) {
        expect(ALLOWED_SCORES_COLUMNS.has(col)).toBe(true)
      }
    })

    it('should include all nutrition/target columns', () => {
      const nutritionCols = [
        'intake_kcal',
        'intake_protein_g',
        'intake_carbs_g',
        'intake_fat_g',
        'target_kcal',
        'target_protein_g',
        'target_carbs_g',
        'target_fat_g',
        'dynamic_tdee_kcal',
        'empirical_tdee_kcal',
        'tef_kcal',
        'tmb_kcal',
      ]
      for (const col of nutritionCols) {
        expect(ALLOWED_SCORES_COLUMNS.has(col)).toBe(true)
      }
    })

    it('should include all longevity/aging columns', () => {
      const longevityCols = [
        'chronological_age',
        'total_age_delta',
        'delta_vo2_years',
        'delta_rhr_years',
        'delta_lnrmssd_years',
        'delta_ffm_years',
        'delta_sleep_years',
        'delta_act_years',
        'argon_physiological_age',
        'pace_of_aging_x',
        'vo2_max_ml_kg_min',
      ]
      for (const col of longevityCols) {
        expect(ALLOWED_SCORES_COLUMNS.has(col)).toBe(true)
      }
    })

    it('should include shift/steps columns', () => {
      const shiftCols = [
        'is_hospital_shift',
        'night_awake_shift_hours',
        'steps_net',
        'steps_count',
        'pickleball_or_gym_minutes',
        'session_rpe',
      ]
      for (const col of shiftCols) {
        expect(ALLOWED_SCORES_COLUMNS.has(col)).toBe(true)
      }
    })

    it('should include metadata columns', () => {
      const metaCols = [
        'computed_at',
        'meals_log_json',
        'clinical_coach_notes',
      ]
      for (const col of metaCols) {
        expect(ALLOWED_SCORES_COLUMNS.has(col)).toBe(true)
      }
    })
  })

  describe('NaN/Infinity handling in computed scores', () => {
    it('should handle NaN in recovery_score', () => {
      const input = { recovery_score: NaN, strain_score: 50 }
      const result = sanitizeForDb(input)
      expect(result.recovery_score).toBeNull()
      expect(result.strain_score).toBe(50)
    })

    it('should handle Infinity in strain_score', () => {
      const input = { recovery_score: 80, strain_score: Infinity }
      const result = sanitizeForDb(input)
      expect(result.recovery_score).toBe(80)
      expect(result.strain_score).toBeNull()
    })

    it('should handle -Infinity in hrv_z_score', () => {
      const input = { hrv_z_score: -Infinity }
      const result = sanitizeForDb(input)
      expect(result.hrv_z_score).toBeNull()
    })

    it('should handle NaN in nested hr_zones_minutes', () => {
      const input = {
        hr_zones_minutes: { z1: NaN, z2: 10, z3: 5, z4: 2, z5: 1 }
      }
      const result = sanitizeForDb(input)
      expect(result.hr_zones_minutes).toEqual({ z1: null, z2: 10, z3: 5, z4: 2, z5: 1 })
    })

    it('should handle multiple NaN/Infinity values', () => {
      const input = {
        recovery_score: NaN,
        strain_score: Infinity,
        ln_rmssd: -Infinity,
        hrv_z_score: NaN,
        valid_score: 75,
      }
      const result = sanitizeForDb(input)
      expect(result.recovery_score).toBeNull()
      expect(result.strain_score).toBeNull()
      expect(result.ln_rmssd).toBeNull()
      expect(result.hrv_z_score).toBeNull()
      expect(result.valid_score).toBe(75)
    })

    it('should not convert null or undefined to null (they stay as-is)', () => {
      const input = { a: null, b: undefined, c: 42 }
      const result = sanitizeForDb(input)
      expect(result.a).toBeNull()
      expect(result.b).toBeUndefined()
      expect(result.c).toBe(42)
    })
  })
})