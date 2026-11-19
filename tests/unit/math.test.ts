import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('Math Utilities (from argon-mbe.js and simulate-recovery.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Mean calculation', () => {
    const mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0

    it('should return 0 for empty array', () => {
      expect(mean([])).toBe(0)
    })

    it('should calculate mean correctly', () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3)
    })

    it('should handle single element', () => {
      expect(mean([42])).toBe(42)
    })

    it('should handle negative numbers', () => {
      expect(mean([-10, 0, 10])).toBe(0)
    })

    it('should handle decimal numbers', () => {
      expect(mean([1.5, 2.5, 3.0])).toBeCloseTo(2.333, 2)
    })
  })

  describe('Standard Deviation calculation', () => {
    const mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0
    const sd = (a: number[], m?: number) => {
      const avg = m ?? mean(a)
      return a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - avg) ** 2, 0) / a.length) : 0
    }

    it('should return 0 for empty array', () => {
      expect(sd([])).toBe(0)
    })

    it('should return 0 for single element', () => {
      expect(sd([5])).toBe(0)
    })

    it('should calculate population SD correctly', () => {
      // For [2, 4, 4, 4, 5, 5, 7, 9], mean = 5, variance = 4, SD = 2
      expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2)
    })

    it('should accept pre-calculated mean', () => {
      expect(sd([2, 4, 4, 4, 5, 5, 7, 9], 5)).toBe(2)
    })

    it('should handle identical values (SD = 0)', () => {
      expect(sd([5, 5, 5, 5])).toBe(0)
    })
  })

  describe('Median calculation', () => {
    const median = (a: number[]) => {
      if (!a.length) return 0
      const sorted = [...a].sort((x, y) => x - y)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }

    it('should return 0 for empty array', () => {
      expect(median([])).toBe(0)
    })

    it('should return the middle element for odd length', () => {
      expect(median([1, 3, 5])).toBe(3)
      expect(median([5, 1, 3])).toBe(3)
    })

    it('should return average of two middle elements for even length', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5)
      expect(median([4, 1, 3, 2])).toBe(2.5)
    })

    it('should handle single element', () => {
      expect(median([42])).toBe(42)
    })

    it('should handle negative numbers', () => {
      expect(median([-5, -1, 3])).toBe(-1)
    })
  })

  describe('Clamp utility', () => {
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

    it('should return value within bounds', () => {
      expect(clamp(5, 0, 10)).toBe(5)
    })

    it('should return min when value below', () => {
      expect(clamp(-5, 0, 10)).toBe(0)
    })

    it('should return max when value above', () => {
      expect(clamp(15, 0, 10)).toBe(10)
    })

    it('should handle equal min/max', () => {
      expect(clamp(5, 5, 5)).toBe(5)
    })

    it('should handle negative bounds', () => {
      expect(clamp(-5, -10, -1)).toBe(-5)
      expect(clamp(-15, -10, -1)).toBe(-10)
      expect(clamp(0, -10, -1)).toBe(-1)
    })
  })

  describe('LTHR / Zone calculation (Friel method)', () => {
    const ltCalc = (km: number, hr: number) => {
      const p30 = 30 / km
      const zs = [
        ['Z1 Recuperación', 0, .85],
        ['Z2 Aeróbica', .85, .89],
        ['Z3 Tempo', .90, .94],
        ['Z4 Sub-umbral', .95, .99],
        ['Z5a Super-umbral', 1, 1.02],
        ['Z5b Capacidad aeróbica', 1.03, 1.06]
      ]
      return {
        lthr: Math.round(hr),
        p30,
        pThr: p30 * 1.04,
        zones: zs.map(z => [z[0], z[1] ? Math.round(hr * z[1]) : 0, Math.round(hr * z[2])])
      }
    }

    it('should calculate zones correctly for 40 min 10k at 170 bpm', () => {
      const result = ltCalc(10, 170) // 10km in 40 min = 4:00/km, but this uses 30/km
      // p30 = 30/10 = 3 min/km = 3:00/km
      expect(result.lthr).toBe(170)
      expect(result.p30).toBe(3)
      expect(result.pThr).toBeCloseTo(3.12, 2)
    })

    it('should generate 6 zones', () => {
      const result = ltCalc(10, 170)
      expect(result.zones).toHaveLength(6)
    })

    it('should have Z1 starting at 0', () => {
      const result = ltCalc(10, 170)
      expect(result.zones[0][1]).toBe(0)
    })

    it('should calculate zone boundaries as percentages of LTHR', () => {
      const result = ltCalc(10, 170)
      // Z2: 85%-89% of 170 = Math.round(144.5)=145 to Math.round(151.3)=151
      expect(result.zones[1][1]).toBe(145)
      expect(result.zones[1][2]).toBe(151)
      // Z5b: 103%-106% of 170 = Math.round(175.1)=175 to Math.round(180.2)=180
      expect(result.zones[5][1]).toBe(175)
      expect(result.zones[5][2]).toBe(180)
    })
  })

  describe('ACWR (Acute:Chronic Workload Ratio)', () => {
    const calculateACWR = (acuteLoad: number, chronicLoad: number) => {
      return chronicLoad > 0 ? acuteLoad / chronicLoad : 1
    }

    it('should return ratio of acute to chronic', () => {
      expect(calculateACWR(500, 400)).toBe(1.25)
    })

    it('should return 1 when chronic load is 0', () => {
      expect(calculateACWR(500, 0)).toBe(1)
    })

    it('should indicate high risk when >1.5', () => {
      expect(calculateACWR(600, 350)).toBeGreaterThan(1.5)
    })

    it('should indicate sweet spot 0.8-1.3', () => {
      const ratio = calculateACWR(400, 400)
      expect(ratio).toBeGreaterThanOrEqual(0.8)
      expect(ratio).toBeLessThanOrEqual(1.3)
    })
  })

  describe('Hydration calculation (35 ml/kg)', () => {
    const calculateHydrationTarget = (weightKg: number) => weightKg * 35
    const calculateHydrationScore = (consumedMl: number, targetMl: number) => {
      const ratio = consumedMl / targetMl
      return Math.round(Math.min(100, ratio * 100))
    }

    it('should calculate 35 ml per kg', () => {
      expect(calculateHydrationTarget(75)).toBe(2625)
      expect(calculateHydrationTarget(80)).toBe(2800)
    })

    it('should score 100 at target', () => {
      expect(calculateHydrationScore(2625, 2625)).toBe(100)
    })

    it('should score proportionally below target', () => {
      expect(calculateHydrationScore(1312.5, 2625)).toBe(50)
    })

    it('should cap at 100 above target', () => {
      expect(calculateHydrationScore(5000, 2625)).toBe(100)
    })

    it('should allow ±25% range around TDEE for calories', () => {
      const tdee = 2500
      const min = tdee * 0.75
      const max = tdee * 1.25
      expect(min).toBe(1875)
      expect(max).toBe(3125)
    })
  })

  describe('Body composition calculations', () => {
    const calculateLBM = (weightKg: number, bodyFatPct: number) => weightKg * (1 - bodyFatPct / 100)
    const calculateFFMI = (lbmKg: number, heightM: number) => lbmKg / (heightM * heightM)

    it('should calculate lean body mass', () => {
      expect(calculateLBM(75, 20)).toBe(60)
      expect(calculateLBM(80, 15)).toBe(68)
    })

    it('should calculate FFMI', () => {
      const lbm = calculateLBM(75, 20) // 60
      expect(calculateFFMI(lbm, 1.75)).toBeCloseTo(19.59, 1)
    })
  })

  describe('Kcal estimation (Keytel 2005)', () => {
    // Keytel formula for HR-based kcal estimation
    // Men: kcal/min = (-55.0969 + 0.6309*HR + 0.1988*W + 0.2017*A) / 4.184
    // Women: kcal/min = (-20.4022 + 0.4472*HR - 0.1263*W + 0.074*A) / 4.184
    const estimateKcalKeytel = (
      hrAvg: number,
      weightKg: number,
      age: number,
      sex: 'male' | 'female',
      durationMin: number
    ) => {
      let kcalPerMin: number
      if (sex === 'male') {
        kcalPerMin = (-55.0969 + 0.6309 * hrAvg + 0.1988 * weightKg + 0.2017 * age) / 4.184
      } else {
        kcalPerMin = (-20.4022 + 0.4472 * hrAvg - 0.1263 * weightKg + 0.074 * age) / 4.184
      }
      return Math.max(0, Math.round(kcalPerMin * durationMin))
    }

    it('should estimate kcal for male runner', () => {
      // 35yo male, 75kg, 160 bpm avg, 45 min
      const kcal = estimateKcalKeytel(160, 75, 35, 'male', 45)
      expect(kcal).toBeGreaterThan(300)
      expect(kcal).toBeLessThan(800)
    })

    it('should estimate kcal for female runner', () => {
      // 30yo female, 60kg, 155 bpm avg, 40 min
      const kcal = estimateKcalKeytel(155, 60, 30, 'female', 40)
      expect(kcal).toBeGreaterThan(200)
      expect(kcal).toBeLessThan(600)
    })

    it('should return 0 for negative result', () => {
      // Very low HR should give negative kcal/min
      const kcal = estimateKcalKeytel(40, 75, 35, 'male', 45)
      expect(kcal).toBe(0)
    })
  })
})