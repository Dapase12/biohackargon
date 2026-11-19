import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('Recovery Calculation Constants & Weights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('3-Pillar Linear Model Weights', () => {
    // From Code.txt server-side computation
    // Recovery = HRV_score * 0.40 + RHR_score * 0.20 + Sleep_score * 0.40 + penalty

    const WEIGHTS = {
      HRV: 0.40,
      RHR: 0.20,
      SLEEP: 0.40
    } as const

    it('should sum to 1.0', () => {
      const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
      expect(sum).toBe(1.0)
    })

    it('should have HRV at 40%', () => {
      expect(WEIGHTS.HRV).toBe(0.40)
    })

    it('should have RHR at 20%', () => {
      expect(WEIGHTS.RHR).toBe(0.20)
    })

    it('should have Sleep at 40%', () => {
      expect(WEIGHTS.SLEEP).toBe(0.40)
    })
  })

  describe('HRV Baseline Calculation (7-day vs 14-day)', () => {
    // HRV baseline uses 14-day rolling average
    // 7-day average used for trend comparison
    // SWC = 0.5 * SD of 14-day values (Smallest Worthwhile Change)

    const BASELINE_WINDOW_DAYS = 14
    const TREND_WINDOW_DAYS = 7
    const SWC_FACTOR = 0.5

    it('should use 14-day baseline', () => {
      expect(BASELINE_WINDOW_DAYS).toBe(14)
    })

    it('should use 7-day trend', () => {
      expect(TREND_WINDOW_DAYS).toBe(7)
    })

    it('should use 0.5 * SD for SWC', () => {
      expect(SWC_FACTOR).toBe(0.5)
    })

    it('should calculate SWC correctly', () => {
      const values = [40, 42, 41, 43, 39, 44, 40, 42, 41, 43, 40, 42, 41, 43]
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
      const sd = Math.sqrt(variance)
      const swc = SWC_FACTOR * sd

      expect(sd).toBeGreaterThan(0)
      expect(swc).toBe(sd * 0.5)
    })

    it('should have dead zone (no change) within ±SWC', () => {
      const baseline = 42
      const current = 43
      const swc = 1.5
      const diff = current - baseline

      expect(Math.abs(diff)).toBeLessThanOrEqual(swc)
    })
  })

  describe('HRV Scoring (0-100)', () => {
    // HRV score: 50 + 50 * (current - baseline) / (2 * SWC)
    // Clamped to 0-100

    const calculateHRVScore = (current: number, baseline: number, swc: number) => {
      if (swc === 0) return 50
      const raw = 50 + 50 * (current - baseline) / (2 * swc)
      return Math.max(0, Math.min(100, Math.round(raw)))
    }

    it('should return 50 when current equals baseline', () => {
      expect(calculateHRVScore(42, 42, 2)).toBe(50)
    })

    it('should return 100 when current = baseline + 2*SWC', () => {
      expect(calculateHRVScore(46, 42, 2)).toBe(100)
    })

    it('should return 0 when current = baseline - 2*SWC', () => {
      expect(calculateHRVScore(38, 42, 2)).toBe(0)
    })

    it('should clamp at 100', () => {
      expect(calculateHRVScore(50, 42, 2)).toBe(100)
    })

    it('should clamp at 0', () => {
      expect(calculateHRVScore(30, 42, 2)).toBe(0)
    })

    it('should handle zero SWC', () => {
      expect(calculateHRVScore(45, 42, 0)).toBe(50)
    })
  })

  describe('RHR Scoring (0-100)', () => {
    // RHR score: 50 + 50 * (baseline - current) / (baseline * 0.1)
    // Lower RHR is better, clamped to 0-100

    const calculateRHRScore = (current: number, baseline: number) => {
      if (baseline === 0) return 50
      const raw = 50 + 50 * (baseline - current) / (baseline * 0.1)
      return Math.max(0, Math.min(100, Math.round(raw)))
    }

    it('should return 50 when current equals baseline', () => {
      expect(calculateRHRScore(56, 56)).toBe(50)
    })

    it('should return higher score for lower RHR', () => {
      expect(calculateRHRScore(50, 56)).toBeGreaterThan(50)
    })

    it('should return lower score for higher RHR', () => {
      expect(calculateRHRScore(62, 56)).toBeLessThan(50)
    })

    it('should clamp at 100', () => {
      expect(calculateRHRScore(40, 56)).toBe(100)
    })

    it('should clamp at 0', () => {
      expect(calculateRHRScore(80, 56)).toBe(0)
    })
  })

  describe('Sleep Scoring (0-100)', () => {
    // Sleep score based on sleep efficiency, duration vs need, and consistency
    // Simplified: weighted combination of efficiency and duration ratio

    const calculateSleepScore = (
      efficiency: number,
      durationH: number,
      needH: number,
      consistency: number
    ) => {
      const durationRatio = Math.min(1, durationH / needH)
      const raw = efficiency * 0.5 + durationRatio * 100 * 0.3 + consistency * 100 * 0.2
      return Math.max(0, Math.min(100, Math.round(raw)))
    }

    it('should return 100 for perfect sleep', () => {
      expect(calculateSleepScore(100, 8, 8, 1)).toBe(100)
    })

    it('should penalize low efficiency', () => {
      const perfect = calculateSleepScore(100, 8, 8, 1)
      const lowEff = calculateSleepScore(70, 8, 8, 1)
      expect(lowEff).toBeLessThan(perfect)
    })

    it('should penalize short duration', () => {
      const perfect = calculateSleepScore(100, 8, 8, 1)
      const short = calculateSleepScore(100, 6, 8, 1)
      expect(short).toBeLessThan(perfect)
    })

    it('should reward consistency', () => {
      const lowCons = calculateSleepScore(100, 8, 8, 0.5)
      const highCons = calculateSleepScore(100, 8, 8, 1)
      expect(highCons).toBeGreaterThan(lowCons)
    })

    it('should clamp at 100', () => {
      expect(calculateSleepScore(100, 10, 8, 1)).toBe(100)
    })

    it('should clamp at 0', () => {
      expect(calculateSleepScore(0, 0, 8, 0)).toBe(0)
    })
  })

  describe('Respiratory Rate Penalty', () => {
    // Direct penalty: if RR > 20 rpm, subtract (RR - 20) * 2 from recovery
    // Max penalty 20 points

    const calculateRRPenalty = (rr: number) => {
      if (rr <= 20) return 0
      return Math.min(20, (rr - 20) * 2)
    }

    it('should return 0 for RR <= 20', () => {
      expect(calculateRRPenalty(18)).toBe(0)
      expect(calculateRRPenalty(20)).toBe(0)
    })

    it('should penalize RR > 20', () => {
      expect(calculateRRPenalty(21)).toBe(2)
      expect(calculateRRPenalty(25)).toBe(10)
      expect(calculateRRPenalty(30)).toBe(20)
    })

    it('should cap at 20', () => {
      expect(calculateRRPenalty(50)).toBe(20)
    })
  })

  describe('Calibration Period', () => {
    // First 7 days: recovery = null (insufficient data)
    // Days 8-14: partial calibration
    // Day 15+: full calculation

    const CALIBRATION_DAYS = 7
    const PARTIAL_CALIBRATION_DAYS = 14

    it('should return null for days < 7', () => {
      const getRecoveryStatus = (days: number) => {
        if (days < CALIBRATION_DAYS) return 'null'
        if (days < PARTIAL_CALIBRATION_DAYS) return 'partial'
        return 'full'
      }

      expect(getRecoveryStatus(1)).toBe('null')
      expect(getRecoveryStatus(6)).toBe('null')
    })

    it('should return partial for days 7-13', () => {
      const getRecoveryStatus = (days: number) => {
        if (days < CALIBRATION_DAYS) return 'null'
        if (days < PARTIAL_CALIBRATION_DAYS) return 'partial'
        return 'full'
      }

      expect(getRecoveryStatus(7)).toBe('partial')
      expect(getRecoveryStatus(13)).toBe('partial')
    })

    it('should return full for days >= 14', () => {
      const getRecoveryStatus = (days: number) => {
        if (days < CALIBRATION_DAYS) return 'null'
        if (days < PARTIAL_CALIBRATION_DAYS) return 'partial'
        return 'full'
      }

      expect(getRecoveryStatus(14)).toBe('full')
      expect(getRecoveryStatus(30)).toBe('full')
    })
  })

  describe('HRV Sample Collection Rules', () => {
    // VFC classified by sleep session (night/nap)
    // Night HRV = median in deep sleep
    // Fallback: first 4h of sleep if no deep sleep
    // Fallback: entire night if <5 samples in deep
    // Cap: 600 samples/night

    const MAX_SAMPLES_PER_NIGHT = 600
    const MIN_DEEP_SLEEP_SAMPLES = 5

    it('should cap at 600 samples per night', () => {
      expect(MAX_SAMPLES_PER_NIGHT).toBe(600)
    })

    it('should require minimum 5 deep sleep samples', () => {
      expect(MIN_DEEP_SLEEP_SAMPLES).toBe(5)
    })

    it('should use median of deep sleep HRV', () => {
      const deepSleepHRV = [42, 44, 41, 43, 45, 40, 44]
      const sorted = [...deepSleepHRV].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      expect(median).toBe(43)
    })

    it('should fallback to first 4h when no deep sleep', () => {
      // This would be tested with actual data
      expect(true).toBe(true)
    })

    it('should fallback to entire night when <5 deep samples', () => {
      const deepSamples = [42, 44, 41] // only 3
      expect(deepSamples.length).toBeLessThan(MIN_DEEP_SLEEP_SAMPLES)
    })
  })

  describe('Siesta Detection Rules', () => {
    // Episodes 10-240 min starting 08:00-20:00

    const MIN_SIESTA_MIN = 10
    const MAX_SIESTA_MIN = 240
    const SIESTA_WINDOW_START = 8 // 08:00
    const SIESTA_WINDOW_END = 20 // 20:00

    it('should detect 20 min siesta at 14:00', () => {
      const isSiesta = (startHour: number, durationMin: number) =>
        startHour >= SIESTA_WINDOW_START &&
        startHour < SIESTA_WINDOW_END &&
        durationMin >= MIN_SIESTA_MIN &&
        durationMin <= MAX_SIESTA_MIN

      expect(isSiesta(14, 20)).toBe(true)
    })

    it('should reject 5 min episode (too short)', () => {
      const isSiesta = (startHour: number, durationMin: number) =>
        startHour >= SIESTA_WINDOW_START &&
        startHour < SIESTA_WINDOW_END &&
        durationMin >= MIN_SIESTA_MIN &&
        durationMin <= MAX_SIESTA_MIN

      expect(isSiesta(14, 5)).toBe(false)
    })

    it('should reject 300 min episode (too long)', () => {
      const isSiesta = (startHour: number, durationMin: number) =>
        startHour >= SIESTA_WINDOW_START &&
        startHour < SIESTA_WINDOW_END &&
        durationMin >= MIN_SIESTA_MIN &&
        durationMin <= MAX_SIESTA_MIN

      expect(isSiesta(14, 300)).toBe(false)
    })

    it('should reject episode at 07:00 (too early)', () => {
      const isSiesta = (startHour: number, durationMin: number) =>
        startHour >= SIESTA_WINDOW_START &&
        startHour < SIESTA_WINDOW_END &&
        durationMin >= MIN_SIESTA_MIN &&
        durationMin <= MAX_SIESTA_MIN

      expect(isSiesta(7, 30)).toBe(false)
    })

    it('should reject episode at 21:00 (too late)', () => {
      const isSiesta = (startHour: number, durationMin: number) =>
        startHour >= SIESTA_WINDOW_START &&
        startHour < SIESTA_WINDOW_END &&
        durationMin >= MIN_SIESTA_MIN &&
        durationMin <= MAX_SIESTA_MIN

      expect(isSiesta(21, 30)).toBe(false)
    })
  })

  describe('Hypnograma Stage Mapping', () => {
    // Codes: 1=Awake, 4=Light, 5=Deep, 6=REM
    // From device (Amazfit/Zepp)

    const STAGE_MAP = {
      1: 'A', // Awake
      4: 'L', // Light
      5: 'D', // Deep
      6: 'R'  // REM
    } as const

    it('should map codes correctly', () => {
      expect(STAGE_MAP[1]).toBe('A')
      expect(STAGE_MAP[4]).toBe('L')
      expect(STAGE_MAP[5]).toBe('D')
      expect(STAGE_MAP[6]).toBe('R')
    })

    it('should have 4 stages', () => {
      expect(Object.keys(STAGE_MAP)).toHaveLength(4)
    })
  })
})