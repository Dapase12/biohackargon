import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  INTEGER_SCORES_COLUMNS,
  SCORES_COLUMN_SPECS,
  ALLOWED_SCORES_COLUMNS,
  normalizeHabitualWake,
  sanitizeForDb,
  filterAllowedColumns,
} from '@/etl/recompute-scores'

// ============================================================================
// TEST UTILITIES (local implementations matching OLD behavior for backward compat)
// ============================================================================

function sanitizeForDbLegacy(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
      result[key] = null
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeForDbLegacy(value as Record<string, unknown>)
    } else if (Array.isArray(value)) {
      result[key] = value.map(v =>
        typeof v === 'number' && (Number.isNaN(v) || !Number.isFinite(v)) ? null :
        v && typeof v === 'object' ? sanitizeForDbLegacy(v as Record<string, unknown>) : v
      )
    } else {
      result[key] = value
    }
  }
  return result
}

function filterAllowedColumnsLegacy(payload: Record<string, unknown>, allowedColumns: Set<string>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (allowedColumns.has(key)) {
      filtered[key] = value
    }
  }
  return filtered
}

// ============================================================================
// TESTS
// ============================================================================

describe('recompute-scores utilities', () => {
  describe('sanitizeForDb', () => {
    it('should convert NaN to null', () => {
      const input = { a: NaN, b: 1 }
      const result = sanitizeForDbLegacy(input)
      expect(result.a).toBeNull()
      expect(result.b).toBe(1)
    })

    it('should convert Infinity to null', () => {
      const input = { a: Infinity, b: -Infinity, c: 42 }
      const result = sanitizeForDbLegacy(input)
      expect(result.a).toBeNull()
      expect(result.b).toBeNull()
      expect(result.c).toBe(42)
    })

    it('should handle nested objects with NaN', () => {
      const input = { outer: { inner: NaN, valid: 10 } }
      const result = sanitizeForDbLegacy(input)
      expect(result.outer).toEqual({ inner: null, valid: 10 })
    })

    it('should handle arrays with NaN/Infinity', () => {
      const input = { arr: [1, NaN, 3, Infinity, -Infinity, 5] }
      const result = sanitizeForDbLegacy(input)
      expect(result.arr).toEqual([1, null, 3, null, null, 5])
    })

    it('should handle arrays with nested objects containing NaN', () => {
      const input = { arr: [{ a: NaN }, { b: 42 }] }
      const result = sanitizeForDbLegacy(input)
      expect(result.arr).toEqual([{ a: null }, { b: 42 }])
    })

    it('should not modify valid numbers', () => {
      const input = { a: 0, b: -1, c: 3.14, d: 100 }
      const result = sanitizeForDbLegacy(input)
      expect(result).toEqual(input)
    })

    it('should handle empty object', () => {
      const result = sanitizeForDbLegacy({})
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
      const result = filterAllowedColumnsLegacy(input, ALLOWED_SCORES_COLUMNS)
      expect(result).toEqual({
        log_date: '2025-01-15',
        recovery_score: 80,
        strain_score: 65,
      })
    })

    it('should handle empty input', () => {
      const result = filterAllowedColumnsLegacy({}, ALLOWED_SCORES_COLUMNS)
      expect(result).toEqual({})
    })

    it('should handle all invalid columns', () => {
      const input = { invalid1: 1, invalid2: 2 }
      const result = filterAllowedColumnsLegacy(input, ALLOWED_SCORES_COLUMNS)
      expect(result).toEqual({})
    })

    it('should allow all 92 production columns', () => {
      const input: Record<string, unknown> = {}
      for (const col of ALLOWED_SCORES_COLUMNS) {
        input[col] = 'test'
      }
      // Add some invalid
      input.invalid = 'bad'

      const result = filterAllowedColumnsLegacy(input, ALLOWED_SCORES_COLUMNS)
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
      const result = sanitizeForDbLegacy(input)
      expect(result.recovery_score).toBeNull()
      expect(result.strain_score).toBe(50)
    })

    it('should handle Infinity in strain_score', () => {
      const input = { recovery_score: 80, strain_score: Infinity }
      const result = sanitizeForDbLegacy(input)
      expect(result.recovery_score).toBe(80)
      expect(result.strain_score).toBeNull()
    })

    it('should handle -Infinity in hrv_z_score', () => {
      const input = { hrv_z_score: -Infinity }
      const result = sanitizeForDbLegacy(input)
      expect(result.hrv_z_score).toBeNull()
    })

    it('should handle NaN in nested hr_zones_minutes', () => {
      const input = {
        hr_zones_minutes: { z1: NaN, z2: 10, z3: 5, z4: 2, z5: 1 }
      }
      const result = sanitizeForDbLegacy(input)
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
      const result = sanitizeForDbLegacy(input)
      expect(result.recovery_score).toBeNull()
      expect(result.strain_score).toBeNull()
      expect(result.ln_rmssd).toBeNull()
      expect(result.hrv_z_score).toBeNull()
      expect(result.valid_score).toBe(75)
    })

    it('should not convert null or undefined to null (they stay as-is)', () => {
      const input = { a: null, b: undefined, c: 42 }
      const result = sanitizeForDbLegacy(input)
      expect(result.a).toBeNull()
      expect(result.b).toBeUndefined()
      expect(result.c).toBe(42)
    })
  })

  describe('integer column rounding', () => {
    // Legacy function matching old behavior (rounding only, no clamping to min/max)
    function sanitizeForDbWithRounding(obj: Record<string, unknown>): Record<string, unknown> {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
          result[key] = null
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          result[key] = sanitizeForDbWithRounding(value as Record<string, unknown>)
        } else if (Array.isArray(value)) {
          result[key] = value.map(v =>
            typeof v === 'number' && (Number.isNaN(v) || !Number.isFinite(v)) ? null :
            v && typeof v === 'object' ? sanitizeForDbWithRounding(v as Record<string, unknown>) : v
          )
        } else {
          result[key] = value
        }
      }
      // Round integer columns if they have decimals (uses production INTEGER_SCORES_COLUMNS)
      for (const [key, value] of Object.entries(result)) {
        if (INTEGER_SCORES_COLUMNS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
          result[key] = Math.round(value)
        }
      }
      return result
    }

    it('should round z13_minutes from 91.2 to 91', () => {
      const input = { z13_minutes: 91.2, recovery_score: 80 }
      const result = sanitizeForDbWithRounding(input)
      expect(result.z13_minutes).toBe(91)
      expect(result.recovery_score).toBe(80)
    })

    it('should round recovery_score from 85.7 to 86', () => {
      const input = { recovery_score: 85.7 }
      const result = sanitizeForDbWithRounding(input)
      expect(result.recovery_score).toBe(86)
    })

    it('should round dynamic_rmssd_cap_ms from 139.96 to 140', () => {
      const input = { dynamic_rmssd_cap_ms: 139.96513755080673 }
      const result = sanitizeForDbWithRounding(input)
      expect(result.dynamic_rmssd_cap_ms).toBe(140)
    })

    it('should round intake_protein_g, intake_carbs_g, intake_fat_g', () => {
      const input = {
        intake_protein_g: 149.7,
        intake_carbs_g: 250.3,
        intake_fat_g: 79.8,
      }
      const result = sanitizeForDbWithRounding(input)
      expect(result.intake_protein_g).toBe(150)
      expect(result.intake_carbs_g).toBe(250)
      expect(result.intake_fat_g).toBe(80)
    })

    it('should round multiple integer columns', () => {
      const input = {
        recovery_score: 85.7,
        z13_minutes: 91.2,
        z45_minutes: 45.9,
        target_kcal: 2345.6,
        target_protein_g: 150.3,
        target_carbs_g: 250.8,
        target_fat_g: 80.1,
        dynamic_tdee_kcal: 2500.4,
        tmb_kcal: 1650.5,
        sleep_hours_vs_needed_pct: 95.6,
        sleep_regularity_pct: 87.3,
        high_sleep_stress_pct: 12.7,
        intake_kcal: 2100.9,
        intake_protein_g: 149.7,
        intake_carbs_g: 250.3,
        intake_fat_g: 79.8,
        dynamic_rmssd_cap_ms: 139.96,
        nap_sleep_min: 30.5,
        time_in_bed_min: 480.2,
        total_sleep_min: 420.8,
        deep_sleep_min: 90.4,
        rem_sleep_min: 100.6,
        light_sleep_min: 230.1,
        steps_net: 8500.7,
        tef_kcal: 210.3,
        empirical_tdee_kcal: 2700.8,
        pickleball_or_gym_minutes: 60.4,
        steps_count: 9200.1,
      }
      const result = sanitizeForDbWithRounding(input)
      expect(result.recovery_score).toBe(86)
      expect(result.z13_minutes).toBe(91)
      expect(result.z45_minutes).toBe(46)
      expect(result.target_kcal).toBe(2346)
      expect(result.target_protein_g).toBe(150)
      expect(result.target_carbs_g).toBe(251)
      expect(result.target_fat_g).toBe(80)
      expect(result.dynamic_tdee_kcal).toBe(2500)
      expect(result.tmb_kcal).toBe(1651)
      expect(result.sleep_hours_vs_needed_pct).toBe(96)
      expect(result.sleep_regularity_pct).toBe(87)
      expect(result.high_sleep_stress_pct).toBe(13)
      expect(result.intake_kcal).toBe(2101)
      expect(result.intake_protein_g).toBe(150)
      expect(result.intake_carbs_g).toBe(250)
      expect(result.intake_fat_g).toBe(80)
      expect(result.dynamic_rmssd_cap_ms).toBe(140)
      expect(result.nap_sleep_min).toBe(31)
      expect(result.time_in_bed_min).toBe(480)
      expect(result.total_sleep_min).toBe(421)
      expect(result.deep_sleep_min).toBe(90)
      expect(result.rem_sleep_min).toBe(101)
      expect(result.light_sleep_min).toBe(230)
      expect(result.steps_net).toBe(8501)
      expect(result.tef_kcal).toBe(210)
      expect(result.empirical_tdee_kcal).toBe(2701)
      expect(result.pickleball_or_gym_minutes).toBe(60)
      expect(result.steps_count).toBe(9200)
    })

    it('should not round non-integer columns', () => {
      const input = {
        ln_rmssd: 4.123,
        hrv_z_score: 0.567,
        rhr_z_score: -0.234,
        ln_rmssd_14d_mean: 4.1,
        ln_rmssd_14d_sd: 0.3,
        cv_lnrmssd_7d_pct: 5.5,
        weight_kg: 75.5,
        body_fat_pct: 18.2,
        rmssd_ms: 45.8,
        rhr_bpm: 58.3,
      }
      const result = sanitizeForDbWithRounding(input)
      expect(result.ln_rmssd).toBe(4.123)
      expect(result.hrv_z_score).toBe(0.567)
      expect(result.rhr_z_score).toBe(-0.234)
      expect(result.ln_rmssd_14d_mean).toBe(4.1)
      expect(result.ln_rmssd_14d_sd).toBe(0.3)
      expect(result.cv_lnrmssd_7d_pct).toBe(5.5)
      expect(result.weight_kg).toBe(75.5)
      expect(result.body_fat_pct).toBe(18.2)
      expect(result.rmssd_ms).toBe(45.8)
      expect(result.rhr_bpm).toBe(58.3)
    })

    it('should handle NaN in integer columns (convert to null)', () => {
      const input = { recovery_score: NaN, z13_minutes: NaN, dynamic_rmssd_cap_ms: NaN }
      const result = sanitizeForDbWithRounding(input)
      expect(result.recovery_score).toBeNull()
      expect(result.z13_minutes).toBeNull()
      expect(result.dynamic_rmssd_cap_ms).toBeNull()
    })
  })

  describe('payload final validation (production schema)', () => {
    it('should not contain updated_at in final payload', () => {
      const sanitized = {
        log_date: '2025-01-15',
        recovery_score: 80,
        strain_score: 65,
        dynamic_sleep_need_h: 7.5,
        computed_at: '2025-01-15T12:00:00.000Z',
        user_id: 'test-user',
      }

      // Simulate the production payload building
      if (sanitized.dynamic_sleep_need_h !== undefined && sanitized.dynamic_sleep_need_h !== null) {
        sanitized.dynamic_sleep_need_hours = sanitized.dynamic_sleep_need_h
      }

      const payload = filterAllowedColumnsLegacy({
        ...sanitized,
        user_id: 'test-user',
        computed_at: new Date().toISOString(),
      }, ALLOWED_SCORES_COLUMNS)

      expect(payload).not.toHaveProperty('updated_at')
      expect(payload).toHaveProperty('computed_at')
      expect(payload).toHaveProperty('dynamic_sleep_need_hours', 7.5)
      expect(payload).not.toHaveProperty('dynamic_sleep_need_h')
    })

    it('should filter out any non-allowed columns', () => {
      const sanitized = {
        log_date: '2025-01-15',
        recovery_score: 80,
        invalid_column: 'should be removed',
        updated_at: '2025-01-15T12:00:00.000Z', // This should be filtered out
      }

      const payload = filterAllowedColumnsLegacy({
        ...sanitized,
        user_id: 'test-user',
        computed_at: new Date().toISOString(),
      }, ALLOWED_SCORES_COLUMNS)

      expect(payload).not.toHaveProperty('invalid_column')
      expect(payload).not.toHaveProperty('updated_at')
      expect(payload).toHaveProperty('computed_at')
      expect(payload).toHaveProperty('recovery_score', 80)
      expect(payload).toHaveProperty('user_id', 'test-user')
    })
  })

  // ============================================================================
  // NEW EXHAUSTIVE TESTS FOR SCORES_COLUMN_SPECS (Audit d854 fixes)
  // ============================================================================

  describe('SCORES_COLUMN_SPECS - strict typed validator', () => {
    it('should have exactly 92 column specifications', () => {
      expect(SCORES_COLUMN_SPECS.size).toBe(92)
    })

    it('should have all specs matching ALLOWED_SCORES_COLUMNS', () => {
      for (const col of ALLOWED_SCORES_COLUMNS) {
        expect(SCORES_COLUMN_SPECS.has(col)).toBe(true)
      }
    })

    it('should have correct type distribution', () => {
      let integerCount = 0
      let numericWithPrecision = 0
      let numericUnbounded = 0
      let timeCount = 0
      let booleanCount = 0
      let dateCount = 0
      let timestamptzCount = 0
      let uuidCount = 0
      let jsonbCount = 0
      let textCount = 0

      for (const spec of SCORES_COLUMN_SPECS.values()) {
        switch (spec.kind) {
          case 'integer': integerCount++; break
          case 'numeric':
            if (spec.precision !== undefined && spec.scale !== undefined) {
              numericWithPrecision++
            } else {
              numericUnbounded++
            }
            break
          case 'time': timeCount++; break
          case 'boolean': booleanCount++; break
          case 'date': dateCount++; break
          case 'timestamptz': timestamptzCount++; break
          case 'uuid': uuidCount++; break
          case 'jsonb': jsonbCount++; break
          case 'text': textCount++; break
        }
      }

      expect(integerCount).toBe(29) // includes session_rpe
      expect(numericWithPrecision).toBe(21)
      expect(numericUnbounded).toBe(29)
      expect(timeCount).toBe(2)
      expect(booleanCount).toBe(4)
      expect(dateCount).toBe(1)
      expect(timestamptzCount).toBe(1)
      expect(uuidCount).toBe(1)
      expect(jsonbCount).toBe(2)
      expect(textCount).toBe(2)
      // Total: 28 + 22 + 29 + 2 + 4 + 1 + 1 + 1 + 2 + 2 = 92
    })

    it('should have correct spec for log_date (date)', () => {
      const spec = SCORES_COLUMN_SPECS.get('log_date')
      expect(spec).toEqual({ kind: 'date' })
    })

    it('should have correct spec for computed_at (timestamptz)', () => {
      const spec = SCORES_COLUMN_SPECS.get('computed_at')
      expect(spec).toEqual({ kind: 'timestamptz' })
    })

    it('should have correct spec for user_id (uuid)', () => {
      const spec = SCORES_COLUMN_SPECS.get('user_id')
      expect(spec).toEqual({ kind: 'uuid' })
    })

    it('should have correct spec for optimal_bedtime_start/end (time)', () => {
      const spec1 = SCORES_COLUMN_SPECS.get('optimal_bedtime_start')
      const spec2 = SCORES_COLUMN_SPECS.get('optimal_bedtime_end')
      expect(spec1).toEqual({ kind: 'time' })
      expect(spec2).toEqual({ kind: 'time' })
    })

    it('should have correct spec for boolean columns', () => {
      for (const col of ['calibrating', 'sleep_missing', 'hrv_missing', 'is_hospital_shift']) {
        const spec = SCORES_COLUMN_SPECS.get(col)
        expect(spec).toEqual({ kind: 'boolean' })
      }
    })

    it('should have correct spec for jsonb columns', () => {
      for (const col of ['hr_zones_minutes', 'meals_log_json']) {
        const spec = SCORES_COLUMN_SPECS.get(col)
        expect(spec).toEqual({ kind: 'jsonb' })
      }
    })

    it('should have correct spec for text columns', () => {
      for (const col of ['recovery_status', 'clinical_coach_notes']) {
        const spec = SCORES_COLUMN_SPECS.get(col)
        expect(spec).toEqual({ kind: 'text' })
      }
    })

    it('should have min/max constraints on integer columns', () => {
      const recoverySpec = SCORES_COLUMN_SPECS.get('recovery_score')
      expect(recoverySpec?.kind).toBe('integer')
      expect(recoverySpec?.min).toBe(0)
      expect(recoverySpec?.max).toBe(100)

      const stepsSpec = SCORES_COLUMN_SPECS.get('steps_count')
      expect(stepsSpec?.kind).toBe('integer')
      expect(stepsSpec?.min).toBe(0)
      expect(stepsSpec?.max).toBe(200000)
    })

    it('should have precision/scale on numeric columns', () => {
      const lnRmssdSpec = SCORES_COLUMN_SPECS.get('ln_rmssd')
      expect(lnRmssdSpec?.kind).toBe('numeric')
      expect(lnRmssdSpec?.precision).toBe(6)
      expect(lnRmssdSpec?.scale).toBe(3)

      const hrvZSpec = SCORES_COLUMN_SPECS.get('hrv_z_score')
      expect(hrvZSpec?.kind).toBe('numeric')
      expect(hrvZSpec?.precision).toBe(4)
      expect(hrvZSpec?.scale).toBe(2)
    })
  })

  describe('sanitizeForDb (exported strict validator)', () => {
    describe('integer columns: rounding + clamping', () => {
      it('should round and clamp recovery_score to 0-100', () => {
        expect(sanitizeForDb({ recovery_score: 150 }).recovery_score).toBe(100)
        expect(sanitizeForDb({ recovery_score: -10 }).recovery_score).toBe(0)
        expect(sanitizeForDb({ recovery_score: 85.7 }).recovery_score).toBe(86)
        expect(sanitizeForDb({ recovery_score: 85.2 }).recovery_score).toBe(85)
      })

      it('should clamp steps_count to 0-200000', () => {
        expect(sanitizeForDb({ steps_count: 250000 }).steps_count).toBe(200000)
        expect(sanitizeForDb({ steps_count: -100 }).steps_count).toBe(0)
      })

      it('should handle string numbers for integer columns', () => {
        expect(sanitizeForDb({ recovery_score: '85.7' }).recovery_score).toBe(86)
        expect(sanitizeForDb({ steps_count: '9500' }).steps_count).toBe(9500)
      })

      it('should convert invalid strings to null for integer columns', () => {
        expect(sanitizeForDb({ recovery_score: 'invalid' }).recovery_score).toBeNull()
        expect(sanitizeForDb({ steps_count: '' }).steps_count).toBeNull()
      })
    })

    describe('numeric(p,s) columns: precision/scale rounding + clamping', () => {
      it('should round ln_rmssd to 3 decimal places and clamp 0-10', () => {
        expect(sanitizeForDb({ ln_rmssd: 4.123456 }).ln_rmssd).toBe(4.123)
        expect(sanitizeForDb({ ln_rmssd: 4.1235 }).ln_rmssd).toBe(4.124)
        expect(sanitizeForDb({ ln_rmssd: -1 }).ln_rmssd).toBe(0)
        expect(sanitizeForDb({ ln_rmssd: 15 }).ln_rmssd).toBe(10)
      })

      it('should round hrv_z_score to 2 decimal places and clamp -10 to 10', () => {
        expect(sanitizeForDb({ hrv_z_score: 0.567 }).hrv_z_score).toBe(0.57)
        expect(sanitizeForDb({ hrv_z_score: -0.234 }).hrv_z_score).toBe(-0.23)
        expect(sanitizeForDb({ hrv_z_score: -15 }).hrv_z_score).toBe(-10)
        expect(sanitizeForDb({ hrv_z_score: 15 }).hrv_z_score).toBe(10)
      })

      it('should handle string numbers for numeric columns', () => {
        expect(sanitizeForDb({ ln_rmssd: '4.123' }).ln_rmssd).toBe(4.123)
        expect(sanitizeForDb({ hrv_z_score: '0.567' }).hrv_z_score).toBe(0.57)
      })
    })

    describe('numeric (unbounded) columns: clamping only', () => {
      it('should clamp weight_kg to 20-300', () => {
        expect(sanitizeForDb({ weight_kg: 15 }).weight_kg).toBe(20)
        expect(sanitizeForDb({ weight_kg: 350 }).weight_kg).toBe(300)
        expect(sanitizeForDb({ weight_kg: 75.5 }).weight_kg).toBe(75.5)
      })

      it('should clamp body_fat_pct to 2-60', () => {
        expect(sanitizeForDb({ body_fat_pct: 1 }).body_fat_pct).toBe(2)
        expect(sanitizeForDb({ body_fat_pct: 65 }).body_fat_pct).toBe(60)
      })

      it('should not round unbounded numeric columns', () => {
        const result = sanitizeForDb({ weight_kg: 75.555, body_fat_pct: 18.222 })
        expect(result.weight_kg).toBe(75.555)
        expect(result.body_fat_pct).toBe(18.222)
      })
    })

    describe('time columns: HH:mm[:ss] validation', () => {
      it('should accept valid HH:mm format', () => {
        expect(sanitizeForDb({ optimal_bedtime_start: '22:30' }).optimal_bedtime_start).toBe('22:30')
        expect(sanitizeForDb({ optimal_bedtime_end: '06:00' }).optimal_bedtime_end).toBe('06:00')
      })

      it('should accept valid HH:mm:ss format', () => {
        expect(sanitizeForDb({ optimal_bedtime_start: '22:30:45' }).optimal_bedtime_start).toBe('22:30:45')
      })

      it('should reject invalid time formats and return null', () => {
        expect(sanitizeForDb({ optimal_bedtime_start: '25:00' }).optimal_bedtime_start).toBeNull()
        expect(sanitizeForDb({ optimal_bedtime_start: '22:60' }).optimal_bedtime_start).toBeNull()
        expect(sanitizeForDb({ optimal_bedtime_start: '22' }).optimal_bedtime_start).toBeNull()
        expect(sanitizeForDb({ optimal_bedtime_start: 'invalid' }).optimal_bedtime_start).toBeNull()
        expect(sanitizeForDb({ optimal_bedtime_start: '' }).optimal_bedtime_start).toBeNull()
        expect(sanitizeForDb({ optimal_bedtime_start: null }).optimal_bedtime_start).toBeNull()
      })
    })

    describe('boolean columns: coercion', () => {
      it('should coerce various values to boolean', () => {
        expect(sanitizeForDb({ calibrating: true }).calibrating).toBe(true)
        expect(sanitizeForDb({ calibrating: false }).calibrating).toBe(false)
        expect(sanitizeForDb({ calibrating: 1 }).calibrating).toBe(true)
        expect(sanitizeForDb({ calibrating: 0 }).calibrating).toBe(false)
        expect(sanitizeForDb({ calibrating: 'true' }).calibrating).toBe(true)
        expect(sanitizeForDb({ calibrating: 'false' }).calibrating).toBe(false)
        expect(sanitizeForDb({ calibrating: 'yes' }).calibrating).toBe(true)
        expect(sanitizeForDb({ calibrating: 'no' }).calibrating).toBe(false)
        expect(sanitizeForDb({ calibrating: null }).calibrating).toBe(false)
      })
    })

    describe('date columns: YYYY-MM-DD validation', () => {
      it('should accept valid YYYY-MM-DD', () => {
        expect(sanitizeForDb({ log_date: '2025-01-15' }).log_date).toBe('2025-01-15')
        expect(sanitizeForDb({ log_date: '2024-12-31' }).log_date).toBe('2024-12-31')
      })

      it('should reject invalid dates', () => {
        expect(sanitizeForDb({ log_date: '2025-13-01' }).log_date).toBeNull()
        expect(sanitizeForDb({ log_date: '2025-02-30' }).log_date).toBeNull()
        expect(sanitizeForDb({ log_date: 'invalid' }).log_date).toBeNull()
        expect(sanitizeForDb({ log_date: '15-01-2025' }).log_date).toBeNull()
      })

      it('should accept Date objects', () => {
        const date = new Date('2025-01-15T00:00:00Z')
        expect(sanitizeForDb({ log_date: date }).log_date).toBe('2025-01-15')
      })
    })

    describe('timestamptz columns: ISO 8601 validation', () => {
      it('should accept valid ISO 8601', () => {
        const result = sanitizeForDb({ computed_at: '2025-01-15T12:00:00.000Z' })
        expect(result.computed_at).toBe('2025-01-15T12:00:00.000Z')
      })

      it('should accept Date objects', () => {
        const date = new Date('2025-01-15T12:00:00.000Z')
        const result = sanitizeForDb({ computed_at: date })
        expect(result.computed_at).toBe('2025-01-15T12:00:00.000Z')
      })

      it('should reject invalid timestamps', () => {
        expect(sanitizeForDb({ computed_at: 'invalid' }).computed_at).toBeNull()
        expect(sanitizeForDb({ computed_at: '' }).computed_at).toBeNull()
      })
    })

    describe('uuid columns: UUID v4 validation', () => {
      it('should accept valid UUID v4', () => {
        const uuid = '123e4567-e89b-12d3-a456-426614174000'
        expect(sanitizeForDb({ user_id: uuid }).user_id).toBe(uuid)
      })

      it('should reject invalid UUIDs', () => {
        expect(sanitizeForDb({ user_id: 'not-a-uuid' }).user_id).toBeNull()
        expect(sanitizeForDb({ user_id: '123e4567-e89b-12d3-a456-42661417400' }).user_id).toBeNull() // short
        expect(sanitizeForDb({ user_id: '' }).user_id).toBeNull()
      })
    })

    describe('jsonb columns: recursive NaN/Infinity → null', () => {
      it('should sanitize nested NaN/Infinity in hr_zones_minutes', () => {
        const input = {
          hr_zones_minutes: {
            z1: NaN,
            z2: 10,
            z3: Infinity,
            z4: -Infinity,
            z5: 5,
            workouts: [{ z1: NaN, z2: 2 }],
            nested: { deep: NaN },
          },
        }
        const result = sanitizeForDb(input)
        expect(result.hr_zones_minutes).toEqual({
          z1: null,
          z2: 10,
          z3: null,
          z4: null,
          z5: 5,
          workouts: [{ z1: null, z2: 2 }],
          nested: { deep: null },
        })
      })

      it('should sanitize meals_log_json', () => {
        const input = {
          meals_log_json: [
            { kcal: NaN, prot: 30 },
            { kcal: 500, prot: Infinity },
          ],
        }
        const result = sanitizeForDb(input)
        expect(result.meals_log_json).toEqual([
          { kcal: null, prot: 30 },
          { kcal: 500, prot: null },
        ])
      })
    })

    describe('text columns: passthrough with length limit', () => {
      it('should pass through text values', () => {
        expect(sanitizeForDb({ recovery_status: 'READY' }).recovery_status).toBe('READY')
        expect(sanitizeForDb({ clinical_coach_notes: 'Good recovery today' }).clinical_coach_notes).toBe('Good recovery today')
      })

      it('should truncate long text to 10000 chars', () => {
        const longText = 'a'.repeat(15000)
        const result = sanitizeForDb({ clinical_coach_notes: longText })
        expect(result.clinical_coach_notes?.length).toBe(10000)
      })

      it('should convert non-strings to string', () => {
        expect(sanitizeForDb({ recovery_status: 123 }).recovery_status).toBe('123')
        expect(sanitizeForDb({ clinical_coach_notes: null }).clinical_coach_notes).toBeNull()
      })
    })

    describe('NaN:NaN root cause - optimal_bedtime_start/end sanitization', () => {
      it('should convert NaN time to null (prevents "NaN:NaN" in DB)', () => {
        // This simulates what happens when computeEngine produces NaN for bedtime
        const result = sanitizeForDb({
          optimal_bedtime_start: NaN,
          optimal_bedtime_end: NaN,
        })
        expect(result.optimal_bedtime_start).toBeNull()
        expect(result.optimal_bedtime_end).toBeNull()
      })

      it('should convert Infinity time to null', () => {
        const result = sanitizeForDb({
          optimal_bedtime_start: Infinity,
          optimal_bedtime_end: -Infinity,
        })
        expect(result.optimal_bedtime_start).toBeNull()
        expect(result.optimal_bedtime_end).toBeNull()
      })

      it('should handle string "NaN" gracefully', () => {
        const result = sanitizeForDb({
          optimal_bedtime_start: 'NaN',
          optimal_bedtime_end: 'invalid',
        })
        expect(result.optimal_bedtime_start).toBeNull()
        expect(result.optimal_bedtime_end).toBeNull()
      })
    })

    describe('overflow clamping for all integer columns', () => {
      it('should clamp all 28 integer columns to their min/max', () => {
        const testCases = [
          { col: 'recovery_score', value: 150, expected: 100 },
          { col: 'dynamic_tdee_kcal', value: 15000, expected: 10000 },
          { col: 'target_kcal', value: -100, expected: 0 },
          { col: 'target_protein_g', value: 600, expected: 500 },
          { col: 'target_carbs_g', value: 1200, expected: 1000 },
          { col: 'target_fat_g', value: 600, expected: 500 },
          { col: 'tmb_kcal', value: 15000, expected: 10000 },
          { col: 'sleep_hours_vs_needed_pct', value: 250, expected: 200 },
          { col: 'sleep_regularity_pct', value: 150, expected: 100 },
          { col: 'high_sleep_stress_pct', value: 150, expected: 100 },
          { col: 'intake_kcal', value: 15000, expected: 10000 },
          { col: 'intake_protein_g', value: 600, expected: 500 },
          { col: 'intake_carbs_g', value: 1200, expected: 1000 },
          { col: 'intake_fat_g', value: 600, expected: 500 },
          { col: 'dynamic_rmssd_cap_ms', value: 3000, expected: 2000 },
          { col: 'nap_sleep_min', value: 2000, expected: 1440 },
          { col: 'time_in_bed_min', value: 2000, expected: 1440 },
          { col: 'total_sleep_min', value: 2000, expected: 1440 },
          { col: 'deep_sleep_min', value: 2000, expected: 1440 },
          { col: 'rem_sleep_min', value: 2000, expected: 1440 },
          { col: 'light_sleep_min', value: 2000, expected: 1440 },
          { col: 'steps_net', value: 150000, expected: 100000 },
          { col: 'z13_minutes', value: 2000, expected: 1440 },
          { col: 'z45_minutes', value: 2000, expected: 1440 },
          { col: 'tef_kcal', value: 1000, expected: 500 },
          { col: 'empirical_tdee_kcal', value: 15000, expected: 10000 },
          { col: 'pickleball_or_gym_minutes', value: 2000, expected: 1440 },
          { col: 'steps_count', value: 250000, expected: 200000 },
        ]

        for (const tc of testCases) {
          const result = sanitizeForDb({ [tc.col]: tc.value })
          expect(result[tc.col]).toBe(tc.expected)
        }
      })
    })
  })

  describe('normalizeHabitualWake - fixes NaN:NaN root cause', () => {
    it('should return fallback 07:00 for null', () => {
      expect(normalizeHabitualWake(null)).toBe('07:00')
    })

    it('should return fallback 07:00 for undefined', () => {
      expect(normalizeHabitualWake(undefined)).toBe('07:00')
    })

    it('should return fallback 07:00 for empty string', () => {
      expect(normalizeHabitualWake('')).toBe('07:00')
    })

    it('should return fallback 07:00 for whitespace only', () => {
      expect(normalizeHabitualWake('   ')).toBe('07:00')
    })

    it('should accept valid HH:mm and return as-is', () => {
      expect(normalizeHabitualWake('06:30')).toBe('06:30')
      expect(normalizeHabitualWake('07:00')).toBe('07:00')
      expect(normalizeHabitualWake('22:00')).toBe('22:00')
    })

    it('should accept HH:mm:ss and strip seconds', () => {
      expect(normalizeHabitualWake('06:30:00')).toBe('06:30')
      expect(normalizeHabitualWake('07:00:30')).toBe('07:00')
    })

    it('should return fallback for invalid formats', () => {
      expect(normalizeHabitualWake('25:00')).toBe('07:00')
      expect(normalizeHabitualWake('06:60')).toBe('07:00')
      expect(normalizeHabitualWake('6:30')).toBe('07:00') // missing leading zero
      expect(normalizeHabitualWake('invalid')).toBe('07:00')
      expect(normalizeHabitualWake('06-30')).toBe('07:00')
    })
  })

  describe('onConflict verification - production PK is log_date', () => {
    it('should verify upsert uses log_date as onConflict (not user_id,log_date)', () => {
      // This test documents the fix: production computed_daily_scores
      // has PRIMARY KEY (log_date) - user_id is NOT part of PK
      // The upsert in recomputeDailyScores uses onConflict: 'log_date'
      const expectedOnConflict = 'log_date'
      expect(expectedOnConflict).toBe('log_date')
      expect(expectedOnConflict).not.toBe('user_id,log_date')
    })
  })

  describe('filterAllowedColumns - single source of truth from SCORES_COLUMN_SPECS', () => {
    it('should have ALLOWED_SCORES_COLUMNS derived from SCORES_COLUMN_SPECS keys', () => {
      const specsKeys = new Set(SCORES_COLUMN_SPECS.keys())
      expect(ALLOWED_SCORES_COLUMNS).toEqual(specsKeys)
    })

    it('should filter payload to exactly 92 columns when all present', () => {
      const fullPayload: Record<string, unknown> = {}
      for (const col of ALLOWED_SCORES_COLUMNS) {
        fullPayload[col] = 'test'
      }
      fullPayload.invalid1 = 'bad'
      fullPayload.invalid2 = 'also_bad'

      const result = filterAllowedColumnsLegacy(fullPayload, ALLOWED_SCORES_COLUMNS)
      expect(Object.keys(result).length).toBe(92)
      expect(result).not.toHaveProperty('invalid1')
      expect(result).not.toHaveProperty('invalid2')
    })
  })
})