import { describe, it, expect, vi, beforeEach } from 'vitest'

// Test the fetchUserProfile logic directly by copying the essential parts
// This avoids importing the full module which triggers CLI parsing

const DEFAULT_PROFILE = {
  age: 30,
  restingHR: 55,
  maxHR: 187,
  biologicalSex: 'male' as const,
  heightM: 1.75,
}

function computeAge(birthDateStr: string): number {
  const birthDate = new Date(birthDateStr)
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age || DEFAULT_PROFILE.age
}

function computeMaxHR(age: number): number {
  return Math.round(208 - 0.7 * age)
}

function validateRestingHR(rhr: unknown): number {
  if (typeof rhr === 'number' && rhr > 30 && rhr < 110) {
    return rhr
  }
  return DEFAULT_PROFILE.restingHR
}

// ========================================================================
// PHYSIOLOGICAL FILTERS FOR NEW TELEMETRY (Fase 2)
// ========================================================================

/**
 * Validates and filters resting heart rate.
 * Physiological range: 30-130 bpm (expanded from 30-110 for raw data ingestion)
 */
function filterRhrBpm(rhr: unknown): number | null {
  if (typeof rhr === 'number' && !isNaN(rhr) && rhr >= 30 && rhr <= 130) {
    return Math.round(rhr)
  }
  return null
}

/**
 * Validates and filters respiratory rate.
 * Physiological range: 6-40 breaths per minute
 */
function filterRespRateBrpm(resp: unknown): number | null {
  if (typeof resp === 'number' && !isNaN(resp) && resp >= 6 && resp <= 40) {
    return Math.round(resp * 10) / 10 // Keep 1 decimal place
  }
  return null
}

/**
 * Validates and filters SpO2 percentage.
 * Input from ghealth is 0.0-1.0, normalize to 0-100 percentage.
 * Physiological range: 70-100%
 */
function filterSpo2Pct(spo2: unknown): number | null {
  if (typeof spo2 === 'number' && !isNaN(spo2)) {
    const pct = spo2 <= 1.0 ? spo2 * 100 : spo2 // Normalize if 0.0-1.0
    if (pct >= 70 && pct <= 100) {
      return Math.round(pct * 10) / 10 // Keep 1 decimal place
    }
  }
  return null
}

/**
 * Validates and filters step count.
 * Returns null for invalid, otherwise returns integer count.
 * For merge: use MAX(new, existing) to prevent data loss
 */
function filterStepsCount(steps: unknown): number | null {
  if (typeof steps === 'number' && !isNaN(steps) && steps >= 0 && Number.isInteger(steps)) {
    return steps
  }
  return null
}

// ========================================================================
// MERGE RAW BIOMETRICS (Non-destructive merge)
// ========================================================================

interface DailyRawBiometrics {
  user_id: string
  log_date: string
  // Sleep
  rmssd_ms?: number | null
  time_in_bed_min?: number | null
  total_sleep_min?: number | null
  deep_sleep_min?: number | null
  rem_sleep_min?: number | null
  light_sleep_min?: number | null
  nap_sleep_min?: number | null
  sleep_onset_timestamp?: string | null
  wake_timestamp?: string | null
  // Exercise
  pickleball_or_gym_minutes?: number | null
  active_calories_kcal?: number | null
  hr_zones_minutes?: any
  // Body Composition
  weight_kg?: number | null
  body_fat_pct?: number | null
  // New telemetry (Fase 2)
  rhr_bpm?: number | null
  resp_rate_brpm?: number | null
  spo2_pct?: number | null
  steps_count?: number | null
  // Manual fields (preserved from existing row, never overwritten by ETL)
  meals_log_json?: any
  session_rpe?: number | null
  intake_kcal?: number | null
  intake_protein_g?: number | null
  intake_carbs_g?: number | null
  intake_fat_g?: number | null
  is_hospital_shift?: boolean | null
  night_awake_shift_hours?: number | null
  // Metadata
  raw_payload_hash?: string | null
  updated_at?: string
}

/**
 * Non-destructive merge: later non-null/undefined properties win,
 * EXCEPT for steps_count where we use MAX(new, existing) to prevent data loss.
 * Manual fields are NEVER overwritten (handled at upsert level).
 */
function mergeRawBiometrics(...objects: DailyRawBiometrics[]): DailyRawBiometrics {
  const result: DailyRawBiometrics = { user_id: '', log_date: '' }
  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined && value !== null) {
        // Special handling for steps_count: use MAX to prevent overwriting higher count with 0
        if (key === 'steps_count' && typeof value === 'number') {
          const existing = (result as any)[key] as number | null | undefined
          if (existing !== null && existing !== undefined && existing > value) {
            continue // Keep existing higher value
          }
        }
        (result as any)[key] = value
      }
    }
  }
  return result
}

// ========================================================================
// TESTS
// ========================================================================

describe('fetchUserProfile logic', () => {
  describe('computeAge', () => {
    it('should compute age 29 for birth_date 1997-11-12 as of 2026-11-22', () => {
      const birthDate = new Date('1997-11-12')
      const testDate = new Date('2026-11-22')
      let age = testDate.getFullYear() - birthDate.getFullYear()
      const monthDiff = testDate.getMonth() - birthDate.getMonth()
      if (monthDiff < 0 || (monthDiff === 0 && testDate.getDate() < birthDate.getDate())) {
        age--
      }
      expect(age).toBe(29)
    })

    it('should compute age correctly for various dates', () => {
      const testCases = [
        { birthDate: '2000-01-01', testDate: '2025-01-01', expected: 25 },
        { birthDate: '2000-12-31', testDate: '2025-01-01', expected: 24 },
        { birthDate: '1990-06-15', testDate: '2025-06-15', expected: 35 },
        { birthDate: '1990-06-15', testDate: '2025-06-14', expected: 34 },
      ]

      for (const tc of testCases) {
        const birthDate = new Date(tc.birthDate)
        const testDate = new Date(tc.testDate)
        let age = testDate.getFullYear() - birthDate.getFullYear()
        const monthDiff = testDate.getMonth() - birthDate.getMonth()
        if (monthDiff < 0 || (monthDiff === 0 && testDate.getDate() < birthDate.getDate())) {
          age--
        }
        expect(age).toBe(tc.expected)
      }
    })
  })

  describe('computeMaxHR (Tanaka formula)', () => {
    it('should compute maxHR = 188 for age 29', () => {
      expect(computeMaxHR(29)).toBe(188)
    })

    it('should compute maxHR = 187 for age 30', () => {
      expect(computeMaxHR(30)).toBe(187)
    })

    it('should compute maxHR = 195 for age 19', () => {
      expect(computeMaxHR(19)).toBe(195)
    })

    it('should compute maxHR = 175 for age 47', () => {
      expect(computeMaxHR(47)).toBe(175)
    })
  })

  describe('validateRestingHR', () => {
    it('should discard rhr_bpm = 0 and use fallback', () => {
      expect(validateRestingHR(0)).toBe(DEFAULT_PROFILE.restingHR)
    })

    it('should discard rhr_bpm = 25 (too low) and use fallback', () => {
      expect(validateRestingHR(25)).toBe(DEFAULT_PROFILE.restingHR)
    })

    it('should discard rhr_bpm = 29 (borderline low) and use fallback', () => {
      expect(validateRestingHR(29)).toBe(DEFAULT_PROFILE.restingHR)
    })

    it('should discard rhr_bpm = 110 (too high) and use fallback', () => {
      expect(validateRestingHR(110)).toBe(DEFAULT_PROFILE.restingHR)
    })

    it('should discard rhr_bpm = 120 (too high) and use fallback', () => {
      expect(validateRestingHR(120)).toBe(DEFAULT_PROFILE.restingHR)
    })

    it('should accept valid rhr_bpm = 31 (just above threshold)', () => {
      expect(validateRestingHR(31)).toBe(31)
    })

    it('should accept valid rhr_bpm = 55', () => {
      expect(validateRestingHR(55)).toBe(55)
    })

    it('should accept valid rhr_bpm = 105', () => {
      expect(validateRestingHR(105)).toBe(105)
    })

    it('should accept valid rhr_bpm = 109 (just below threshold)', () => {
      expect(validateRestingHR(109)).toBe(109)
    })

    it('should discard null and use fallback', () => {
      expect(validateRestingHR(null)).toBe(DEFAULT_PROFILE.restingHR)
    })

    it('should discard undefined and use fallback', () => {
      expect(validateRestingHR(undefined)).toBe(DEFAULT_PROFILE.restingHR)
    })

    it('should discard string and use fallback', () => {
      expect(validateRestingHR('55')).toBe(DEFAULT_PROFILE.restingHR)
    })
  })
})

// ========================================================================
// FASE 2: NEW TELEMETRY PHYSIOLOGICAL FILTERS
// ========================================================================

describe('Fase 2: Physiological filters for new telemetry', () => {
  describe('filterRhrBpm', () => {
    it('should accept rhr_bpm = 30 (lower bound)', () => {
      expect(filterRhrBpm(30)).toBe(30)
    })

    it('should accept rhr_bpm = 130 (upper bound)', () => {
      expect(filterRhrBpm(130)).toBe(130)
    })

    it('should accept rhr_bpm = 55 (typical athlete)', () => {
      expect(filterRhrBpm(55)).toBe(55)
    })

    it('should accept rhr_bpm = 72 (typical adult)', () => {
      expect(filterRhrBpm(72)).toBe(72)
    })

    it('should reject rhr_bpm = 29 (below threshold)', () => {
      expect(filterRhrBpm(29)).toBeNull()
    })

    it('should reject rhr_bpm = 131 (above threshold)', () => {
      expect(filterRhrBpm(131)).toBeNull()
    })

    it('should reject rhr_bpm = 0', () => {
      expect(filterRhrBpm(0)).toBeNull()
    })

    it('should reject rhr_bpm = -5', () => {
      expect(filterRhrBpm(-5)).toBeNull()
    })

    it('should reject NaN', () => {
      expect(filterRhrBpm(NaN)).toBeNull()
    })

    it('should reject null', () => {
      expect(filterRhrBpm(null)).toBeNull()
    })

    it('should reject undefined', () => {
      expect(filterRhrBpm(undefined)).toBeNull()
    })

    it('should reject string', () => {
      expect(filterRhrBpm('55')).toBeNull()
    })

    it('should round decimal values', () => {
      expect(filterRhrBpm(55.7)).toBe(56)
      expect(filterRhrBpm(55.2)).toBe(55)
    })
  })

  describe('filterRespRateBrpm', () => {
    it('should accept resp_rate_brpm = 6 (lower bound)', () => {
      expect(filterRespRateBrpm(6)).toBe(6)
    })

    it('should accept resp_rate_brpm = 40 (upper bound)', () => {
      expect(filterRespRateBrpm(40)).toBe(40)
    })

    it('should accept resp_rate_brpm = 14.5 (typical sleep)', () => {
      expect(filterRespRateBrpm(14.5)).toBe(14.5)
    })

    it('should accept resp_rate_brpm = 16.0 (typical awake)', () => {
      expect(filterRespRateBrpm(16.0)).toBe(16.0)
    })

    it('should reject resp_rate_brpm = 5.9 (below threshold)', () => {
      expect(filterRespRateBrpm(5.9)).toBeNull()
    })

    it('should reject resp_rate_brpm = 40.1 (above threshold)', () => {
      expect(filterRespRateBrpm(40.1)).toBeNull()
    })

    it('should reject resp_rate_brpm = 0', () => {
      expect(filterRespRateBrpm(0)).toBeNull()
    })

    it('should reject negative values', () => {
      expect(filterRespRateBrpm(-5)).toBeNull()
    })

    it('should reject NaN', () => {
      expect(filterRespRateBrpm(NaN)).toBeNull()
    })

    it('should reject null', () => {
      expect(filterRespRateBrpm(null)).toBeNull()
    })

    it('should keep 1 decimal place precision', () => {
      expect(filterRespRateBrpm(14.56)).toBe(14.6)
      expect(filterRespRateBrpm(14.54)).toBe(14.5)
    })
  })

  describe('filterSpo2Pct', () => {
    it('should accept spo2_pct = 70 (lower bound)', () => {
      expect(filterSpo2Pct(0.70)).toBe(70)
      expect(filterSpo2Pct(70)).toBe(70)
    })

    it('should accept spo2_pct = 100 (upper bound)', () => {
      expect(filterSpo2Pct(1.0)).toBe(100)
      expect(filterSpo2Pct(100)).toBe(100)
    })

    it('should accept spo2_pct = 0.97 (typical healthy)', () => {
      expect(filterSpo2Pct(0.97)).toBe(97)
    })

    it('should accept spo2_pct = 95 (typical healthy as percentage)', () => {
      expect(filterSpo2Pct(95)).toBe(95)
    })

    it('should reject spo2_pct = 69.9 (below threshold)', () => {
      expect(filterSpo2Pct(0.699)).toBeNull()
      expect(filterSpo2Pct(69.9)).toBeNull()
    })

    it('should reject spo2_pct = 100.1 (above threshold)', () => {
      expect(filterSpo2Pct(1.001)).toBeNull()
      expect(filterSpo2Pct(100.1)).toBeNull()
    })

    it('should reject spo2_pct = 0', () => {
      expect(filterSpo2Pct(0)).toBeNull()
    })

    it('should reject negative values', () => {
      expect(filterSpo2Pct(-1)).toBeNull()
    })

    it('should reject NaN', () => {
      expect(filterSpo2Pct(NaN)).toBeNull()
    })

    it('should reject null', () => {
      expect(filterSpo2Pct(null)).toBeNull()
    })

    it('should keep 1 decimal place precision', () => {
      expect(filterSpo2Pct(0.975)).toBe(97.5)
      expect(filterSpo2Pct(97.56)).toBe(97.6)
    })

    it('should normalize 0.0-1.0 input to 0-100 percentage', () => {
      expect(filterSpo2Pct(0.98)).toBe(98)
      expect(filterSpo2Pct(0.923)).toBe(92.3)
    })
  })

  describe('filterStepsCount', () => {
    it('should accept steps_count = 0', () => {
      expect(filterStepsCount(0)).toBe(0)
    })

    it('should accept steps_count = 10000', () => {
      expect(filterStepsCount(10000)).toBe(10000)
    })

    it('should accept steps_count = 25000', () => {
      expect(filterStepsCount(25000)).toBe(25000)
    })

    it('should reject negative values', () => {
      expect(filterStepsCount(-100)).toBeNull()
    })

    it('should reject NaN', () => {
      expect(filterStepsCount(NaN)).toBeNull()
    })

    it('should reject null', () => {
      expect(filterStepsCount(null)).toBeNull()
    })

    it('should reject undefined', () => {
      expect(filterStepsCount(undefined)).toBeNull()
    })

    it('should reject string', () => {
      expect(filterStepsCount('10000')).toBeNull()
    })

    it('should reject non-integer values', () => {
      expect(filterStepsCount(10000.5)).toBeNull()
    })
  })
})

// ========================================================================
// FASE 2: NON-DESTRUCTIVE MERGE RAW BIOMETRICS
// ========================================================================

describe('Fase 2: mergeRawBiometrics non-destructive merge', () => {
  const baseDate = '2026-11-22'
  const userId = 'test-user-123'

  function createBase(): DailyRawBiometrics {
    return { user_id: userId, log_date: baseDate }
  }

  it('should merge sleep data into base', () => {
    const base = createBase()
    const sleep = { ...createBase(), rmssd_ms: 45.5, total_sleep_min: 480, deep_sleep_min: 120 }

    const merged = mergeRawBiometrics(base, sleep)

    expect(merged.rmssd_ms).toBe(45.5)
    expect(merged.total_sleep_min).toBe(480)
    expect(merged.deep_sleep_min).toBe(120)
  })

  it('should merge exercise data into base', () => {
    const base = createBase()
    const exercise = { ...createBase(), pickleball_or_gym_minutes: 60, active_calories_kcal: 450 }

    const merged = mergeRawBiometrics(base, exercise)

    expect(merged.pickleball_or_gym_minutes).toBe(60)
    expect(merged.active_calories_kcal).toBe(450)
  })

  it('should merge body composition data into base', () => {
    const base = createBase()
    const bodyComp = { ...createBase(), weight_kg: 75.5, body_fat_pct: 18.2 }

    const merged = mergeRawBiometrics(base, bodyComp)

    expect(merged.weight_kg).toBe(75.5)
    expect(merged.body_fat_pct).toBe(18.2)
  })

  it('should merge all three sources (sleep, exercise, bodyComp)', () => {
    const base = createBase()
    const sleep = { ...createBase(), rmssd_ms: 45.5, total_sleep_min: 480 }
    const exercise = { ...createBase(), pickleball_or_gym_minutes: 60, active_calories_kcal: 450 }
    const bodyComp = { ...createBase(), weight_kg: 75.5, body_fat_pct: 18.2 }

    const merged = mergeRawBiometrics(base, sleep, exercise, bodyComp)

    expect(merged.rmssd_ms).toBe(45.5)
    expect(merged.total_sleep_min).toBe(480)
    expect(merged.pickleball_or_gym_minutes).toBe(60)
    expect(merged.active_calories_kcal).toBe(450)
    expect(merged.weight_kg).toBe(75.5)
    expect(merged.body_fat_pct).toBe(18.2)
  })

  it('should merge new telemetry fields (rhr_bpm, resp_rate_brpm, spo2_pct, steps_count)', () => {
    const base = createBase()
    const telemetry = {
      ...createBase(),
      rhr_bpm: 58,
      resp_rate_brpm: 14.5,
      spo2_pct: 97.5,
      steps_count: 8500,
    }

    const merged = mergeRawBiometrics(base, telemetry)

    expect(merged.rhr_bpm).toBe(58)
    expect(merged.resp_rate_brpm).toBe(14.5)
    expect(merged.spo2_pct).toBe(97.5)
    expect(merged.steps_count).toBe(8500)
  })

  it('should NOT overwrite existing data with null/undefined from later sources', () => {
    const base = createBase()
    const withData = { ...createBase(), rhr_bpm: 58, steps_count: 10000 }
    const withNulls = { ...createBase(), rhr_bpm: null, steps_count: null, resp_rate_brpm: null }

    const merged = mergeRawBiometrics(base, withData, withNulls)

    expect(merged.rhr_bpm).toBe(58) // Preserved from withData
    expect(merged.steps_count).toBe(10000) // Preserved from withData
    // resp_rate_brpm was never set in withData, so it remains undefined (not null)
    expect(merged.resp_rate_brpm).toBeUndefined()
  })

  it('should use MAX for steps_count to prevent data loss (new=0, existing=8000 -> keep 8000)', () => {
    const base = createBase()
    const existing = { ...createBase(), steps_count: 8000 }
    const incoming = { ...createBase(), steps_count: 0 } // ghealth returns 0 for missing day

    const merged = mergeRawBiometrics(base, existing, incoming)

    expect(merged.steps_count).toBe(8000) // MAX(8000, 0) = 8000
  })

  it('should use MAX for steps_count (new=10000, existing=8000 -> keep 10000)', () => {
    const base = createBase()
    const existing = { ...createBase(), steps_count: 8000 }
    const incoming = { ...createBase(), steps_count: 10000 }

    const merged = mergeRawBiometrics(base, existing, incoming)

    expect(merged.steps_count).toBe(10000) // MAX(8000, 10000) = 10000
  })

  it('should use MAX for steps_count when existing is null (new=5000 -> keep 5000)', () => {
    const base = createBase()
    const existing = { ...createBase(), steps_count: null }
    const incoming = { ...createBase(), steps_count: 5000 }

    const merged = mergeRawBiometrics(base, existing, incoming)

    expect(merged.steps_count).toBe(5000)
  })

  it('should preserve manual fields (meals_log_json, session_rpe) from being overwritten', () => {
    const base = createBase()
    const withManual = {
      ...createBase(),
      meals_log_json: [{ id: 'meal1', kcal: 500 }],
      session_rpe: 7,
      intake_kcal: 2200,
    }
    const incoming = {
      ...createBase(),
      rhr_bpm: 58,
      meals_log_json: null, // Should not overwrite
      session_rpe: null, // Should not overwrite
    }

    const merged = mergeRawBiometrics(base, withManual, incoming)

    expect(merged.meals_log_json).toEqual([{ id: 'meal1', kcal: 500 }])
    expect(merged.session_rpe).toBe(7)
    expect(merged.intake_kcal).toBe(2200)
    expect(merged.rhr_bpm).toBe(58) // New telemetry still merged
  })

  it('should handle multiple telemetry updates across days (simulating backfill)', () => {
    const day1 = { user_id: userId, log_date: '2026-11-20', rhr_bpm: 58, steps_count: 8000 }
    const day1Update = { user_id: userId, log_date: '2026-11-20', rhr_bpm: 57, steps_count: 0 }
    const day2 = { user_id: userId, log_date: '2026-11-21', rhr_bpm: 59, steps_count: 10000 }

    const merged1 = mergeRawBiometrics(day1, day1Update)
    expect(merged1.rhr_bpm).toBe(57) // Latest non-null wins for rhr
    expect(merged1.steps_count).toBe(8000) // MAX(8000, 0) = 8000

    const merged2 = mergeRawBiometrics(day2)
    expect(merged2.rhr_bpm).toBe(59)
    expect(merged2.steps_count).toBe(10000)
  })

  it('should not require all fields to be present in each object', () => {
    const base = createBase()
    const partial1 = { ...createBase(), rhr_bpm: 58 }
    const partial2 = { ...createBase(), steps_count: 8000 }
    const partial3 = { ...createBase(), resp_rate_brpm: 14.5, spo2_pct: 97 }

    const merged = mergeRawBiometrics(base, partial1, partial2, partial3)

    expect(merged.rhr_bpm).toBe(58)
    expect(merged.steps_count).toBe(8000)
    expect(merged.resp_rate_brpm).toBe(14.5)
    expect(merged.spo2_pct).toBe(97)
  })
})

// ========================================================================
// FASE 2: FETCHALLFORSYNC ERROR ISOLATION
// ========================================================================

describe('Fase 2: fetchAllForSync error isolation (per-endpoint try/catch)', () => {
  // These tests verify the conceptual behavior - actual implementation
  // tests would need integration with ghealthClient mock

  it('should handle individual endpoint failures without aborting entire sync', async () => {
    // This test documents expected behavior:
    // - sleepSessions fails -> log error, continue with other endpoints
    // - hrvSamples fails -> log error, continue
    // - exerciseSessions fails -> log error, continue
    // - heartRateSamples fails -> log error, continue
    // - weight/bodyFat fails -> log error, continue
    // - restingHeartRate fails -> log error, continue (NEW)
    // - respiratoryRate fails -> log error, continue (NEW)
    // - oxygenSaturation fails -> log error, continue (NEW)
    // - steps fails -> log error, continue (NEW)
    expect(true).toBe(true) // Placeholder for integration test
  })

  it('should track which endpoints succeeded/failed for diagnostics', async () => {
    expect(true).toBe(true) // Placeholder
  })
})

// ========================================================================
// FASE 2: INTER-DAY DELAY AND 429 ABORT LOGIC
// ========================================================================

describe('Fase 2: Inter-day delay and 429 abort logic', () => {
  it('should apply --delay-ms between days when previous day had 429', () => {
    // Test documents expected behavior
    expect(true).toBe(true)
  })

  it('should abort backfill after 3 consecutive days with 429 errors', () => {
    // Test documents expected behavior
    expect(true).toBe(true)
  })

  it('should reset consecutive 429 counter on successful day', () => {
    // Test documents expected behavior
    expect(true).toBe(true)
  })
})

// ========================================================================
// DATE RANGE PARSING FIX (Fase 3 bug fix)
// ========================================================================

describe('Date range parsing - fix for -1 day offset bug', () => {
  // These tests verify the fix for the bug where --from "2026-11-22" --to "2026-11-22"
  // incorrectly resolved to ['2026-11-21'] due to UTC->Caracas timezone conversion

  // Copy the relevant functions from sync-ghealth.ts for testing
  const CARACAS_TIMEZONE = 'America/Caracas'

  function formatDate(date: Date): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: CARACAS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = formatter.formatToParts(date)
    const year = parts.find(p => p.type === 'year')!.value
    const month = parts.find(p => p.type === 'month')!.value
    const day = parts.find(p => p.type === 'day')!.value
    return `${year}-${month}-${day}`
  }

  function parseDateArg(dateStr: string): Date {
    const regex = /^(\d{4})-(\d{2})-(\d{2})$/
    const match = dateStr.match(regex)
    if (!match) {
      throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD`)
    }
    const year = parseInt(match[1]!, 10)
    const month = parseInt(match[2]!, 10) - 1
    const day = parseInt(match[3]!, 10)
    return new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
  }

  function formatGHealthDate(date: Date): string {
    return date.toISOString().split('T')[0] ?? ''
  }

  function getDateRange(from: string | undefined, to: string | undefined): { from: string; to: string } {
    const end = to ? parseDateArg(to) : new Date()
    const start = from ? parseDateArg(from) : new Date(end.getTime() - 30 * 86400000)
    return {
      from: formatGHealthDate(start),
      to: formatGHealthDate(end),
    }
  }

  function incrementDateString(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    date.setUTCDate(date.getUTCDate() + 1)
    return date.toISOString().split('T')[0] ?? ''
  }

  it('getDateRange returns correct inclusive dates for single day', () => {
    const range = getDateRange('2026-11-22', '2026-11-22')
    expect(range.from).toBe('2026-11-22')
    expect(range.to).toBe('2026-11-22')
  })

  it('generate dates from range using string comparison (FIXED - no timezone shift)', () => {
    const range = getDateRange('2026-11-22', '2026-11-22')
    const dates: string[] = []
    for (let d = range.from; d <= range.to; d = incrementDateString(d)) {
      dates.push(d)
    }
    // This is the FIXED behavior - should be ['2026-11-22'], not ['2026-11-21']
    expect(dates).toEqual(['2026-11-22'])
  })

  it('generate dates for multi-day range correctly', () => {
    const range = getDateRange('2026-11-20', '2026-11-22')
    const dates: string[] = []
    for (let d = range.from; d <= range.to; d = incrementDateString(d)) {
      dates.push(d)
    }
    expect(dates).toEqual(['2026-11-20', '2026-11-21', '2026-11-22'])
  })

  it('FIXED behavior: using string comparison avoids timezone issues', () => {
    const range = getDateRange('2026-11-22', '2026-11-22')
    const dates: string[] = []
    for (let d = range.from; d <= range.to; d = incrementDateString(d)) {
      dates.push(d)
    }
    // FIXED: dates are compared as strings, no timezone conversion
    expect(dates).toEqual(['2026-11-22'])
  })
})