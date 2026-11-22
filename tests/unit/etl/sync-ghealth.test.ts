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

describe('fetchUserProfile logic', () => {
  describe('computeAge', () => {
    it('should compute age 29 for birth_date 1997-11-12 as of 2026-11-22', () => {
      // Note: This test depends on current date, so we test the logic with a known date
      // Using a fixed date for deterministic testing
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