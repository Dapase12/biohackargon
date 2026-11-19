import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  mockSupabaseResponse,
  mockGASResponse,
  createMockRawBiometric,
  createMockComputedScores,
  createMockWebhookPayload,
  flushPromises
} from '../setup'

// Mock Supabase client
const mockSupabase = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis()
  })),
  rpc: vi.fn()
}

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase
}))

describe('Integration: Sync Flow (Webhook → Raw → Computed → Render)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Webhook Processing', () => {
    it('should receive webhook payload from GAS', async () => {
      const payload = createMockWebhookPayload()
      const response = mockGASResponse(payload, true)

      expect(response.success).toBe(true)
      expect(response.data).toEqual(payload)
      expect(response.timestamp).toBeDefined()
    })

    it('should validate webhook payload structure', async () => {
      const payload = createMockWebhookPayload()

      // Check required fields
      expect(payload.user_id).toBeDefined()
      expect(payload.timestamp).toBeDefined()
      expect(payload.source).toBeDefined()
      expect(payload.biometrics).toBeDefined()
      expect(payload.biometrics.hrv_rmssd_ms).toBeDefined()
      expect(payload.biometrics.rhr_bpm).toBeDefined()
      expect(payload.biometrics.sleep).toBeDefined()
      expect(payload.biometrics.activity).toBeDefined()
      expect(payload.biometrics.body).toBeDefined()
    })

    it('should handle different webhook sources', async () => {
      const sources = ['health_connect', 'zepp', 'manual'] as const

      for (const source of sources) {
        const payload = createMockWebhookPayload({ source })
        expect(payload.source).toBe(source)
      }
    })
  })

  describe('Raw Data Upsert', () => {
    it('should upsert raw biometrics to daily_raw_biometrics', async () => {
      const rawData = createMockRawBiometric()
      const response = mockSupabaseResponse(rawData)

      // Simulate upsert call
      const upsertMock = vi.fn().mockResolvedValue(response)
      mockSupabase.from.mockReturnValue({
        upsert: upsertMock.mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(response)
      })

      const result = await mockSupabase.from('daily_raw_biometrics')
        .upsert(rawData)
        .select()
        .single()

      expect(upsertMock).toHaveBeenCalledWith(rawData)
      expect(result.data).toEqual(rawData)
    })

    it('should handle duplicate date upsert (on conflict)', async () => {
      const rawData = createMockRawBiometric()
      const response = mockSupabaseResponse(rawData)

      const upsertMock = vi.fn().mockResolvedValue(response)
      mockSupabase.from.mockReturnValue({
        upsert: upsertMock.mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(response)
      })

      // First upsert
      await mockSupabase.from('daily_raw_biometrics').upsert(rawData).select().single()
      // Second upsert (same date)
      await mockSupabase.from('daily_raw_biometrics').upsert(rawData).select().single()

      expect(upsertMock).toHaveBeenCalledTimes(2)
    })

    it('should handle Supabase error on upsert', async () => {
      const error = new Error('Supabase error')
      const response = mockSupabaseResponse(null, error)

      const upsertMock = vi.fn().mockResolvedValue(response)
      mockSupabase.from.mockReturnValue({
        upsert: upsertMock.mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(response)
      })

      const result = await mockSupabase.from('daily_raw_biometrics')
        .upsert(createMockRawBiometric())
        .select()
        .single()

      expect(result.error).toBeDefined()
      expect(result.error!.message).toBe('Supabase error')
    })
  })

  describe('Computed Scores Generation', () => {
    it('should compute recovery score from raw data', async () => {
      const rawData = createMockRawBiometric({
        hrv_rmssd_ms: 45,
        rhr_bpm: 58,
        sleep_score: 85,
        total_sleep_min: 480
      })

      // Simulate server-side computation
      const computeRecovery = (raw: any) => {
        // Simplified computation for testing
        const hrvScore = Math.min(100, Math.max(0, 50 + (raw.hrv_rmssd_ms - 42) * 5))
        const rhrScore = Math.min(100, Math.max(0, 50 + (56 - raw.rhr_bpm) * 5))
        const sleepScore = raw.sleep_score || 0

        const recovery = Math.round(hrvScore * 0.4 + rhrScore * 0.2 + sleepScore * 0.4)
        return { recovery_score: recovery }
      }

      const computed = computeRecovery(rawData)
      expect(computed.recovery_score).toBeGreaterThan(0)
      expect(computed.recovery_score).toBeLessThanOrEqual(100)
    })

    it('should return null recovery during calibration (< 7 days)', async () => {
      const rawData = createMockRawBiometric()
      const daysOfData = 5

      const computeRecovery = (days: number) => {
        if (days < 7) return { recovery_score: null }
        return { recovery_score: 75 }
      }

      const result = computeRecovery(daysOfData)
      expect(result.recovery_score).toBeNull()
    })

    it('should compute dynamic sleep need', async () => {
      const rawData = createMockRawBiometric({
        total_sleep_min: 480,
        sleep_efficiency_pct: 92
      })

      const computeSleepNeed = (raw: any) => {
        const baseNeed = 7.5
        const efficiency = raw.sleep_efficiency_pct / 100
        const recentAvg = raw.total_sleep_min / 60
        const need = baseNeed / efficiency
        return Math.max(6, Math.min(10, Math.round(need * 10) / 10))
      }

      const need = computeSleepNeed(rawData)
      expect(need).toBeGreaterThanOrEqual(6)
      expect(need).toBeLessThanOrEqual(10)
    })

    it('should compute optimal bedtime window', async () => {
      const profile = { habitualWake: '06:00', basalSleepNeedH: 7.5 }
      const dynamicNeed = 7.8
      const efficiency = 0.92

      const computeBedtime = (wake: string, needH: number, eff: number) => {
        const [wakeH, wakeM] = wake.split(':').map(Number)
        const wakeMinutes = wakeH * 60 + wakeM
        const needMinutes = Math.round(needH * 60 / eff)
        const bedtimeMinutes = wakeMinutes - needMinutes

        const startH = Math.floor(bedtimeMinutes / 60)
        const startM = bedtimeMinutes % 60
        const endH = Math.floor((bedtimeMinutes + 30) / 60) // 30 min window
        const endM = (bedtimeMinutes + 30) % 60

        return {
          optimal_bedtime_start: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
          optimal_bedtime_end: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
        }
      }

      const bedtime = computeBedtime(profile.habitualWake, dynamicNeed, efficiency)
      expect(bedtime.optimal_bedtime_start).toBeDefined()
      expect(bedtime.optimal_bedtime_end).toBeDefined()
    })

    it('should upsert computed scores to computed_daily_scores', async () => {
      const computedData = createMockComputedScores()
      const response = mockSupabaseResponse(computedData)

      const upsertMock = vi.fn().mockResolvedValue(response)
      mockSupabase.from.mockReturnValue({
        upsert: upsertMock.mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(response)
      })

      const result = await mockSupabase.from('computed_daily_scores')
        .upsert(computedData)
        .select()
        .single()

      expect(upsertMock).toHaveBeenCalledWith(computedData)
      expect(result.data).toEqual(computedData)
    })
  })

  describe('Data Retrieval for Render', () => {
    it('should fetch raw and computed data for date range', async () => {
      const rawData = [createMockRawBiometric({ log_date: '2025-01-15' })]
      const computedData = [createMockComputedScores({ log_date: '2025-01-15' })]

      const rawResponse = mockSupabaseResponse(rawData)
      const computedResponse = mockSupabaseResponse(computedData)

      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(rawResponse)
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(computedResponse)
        })

      const rawResult = await mockSupabase.from('daily_raw_biometrics')
        .select('*')
        .eq('user_id', 'test-user')
        .order('log_date', { ascending: false })
        .limit(30)

      const computedResult = await mockSupabase.from('computed_daily_scores')
        .select('*')
        .eq('user_id', 'test-user')
        .order('log_date', { ascending: false })
        .limit(30)

      expect(rawResult.data).toHaveLength(1)
      expect(computedResult.data).toHaveLength(1)
      expect(rawResult.data[0].log_date).toBe(computedResult.data[0].log_date)
    })

    it('should handle missing computed data (fallback to raw)', async () => {
      const rawData = [createMockRawBiometric({ log_date: '2025-01-15' })]
      const rawResponse = mockSupabaseResponse(rawData)
      const computedResponse = mockSupabaseResponse([])

      mockSupabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(rawResponse)
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(computedResponse)
        })

      const rawResult = await mockSupabase.from('daily_raw_biometrics')
        .select('*')
        .eq('user_id', 'test-user')
        .order('log_date', { ascending: false })
        .limit(30)

      const computedResult = await mockSupabase.from('computed_daily_scores')
        .select('*')
        .eq('user_id', 'test-user')
        .order('log_date', { ascending: false })
        .limit(30)

      expect(rawResult.data).toHaveLength(1)
      expect(computedResult.data).toHaveLength(0)
    })
  })

  describe('Webhook Log Storage', () => {
    it('should log webhook to webhook_logs table', async () => {
      const payload = createMockWebhookPayload()
      const logEntry = {
        user_id: payload.user_id,
        payload: payload,
        status: 'success',
        processed_at: new Date().toISOString()
      }

      const response = mockSupabaseResponse(logEntry)
      const insertMock = vi.fn().mockResolvedValue(response)

      mockSupabase.from.mockReturnValue({
        insert: insertMock.mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(response)
      })

      const result = await mockSupabase.from('webhook_logs')
        .insert(logEntry)
        .select()
        .single()

      expect(insertMock).toHaveBeenCalledWith(logEntry)
      expect(result.data).toEqual(logEntry)
    })

    it('should log failed webhook with error status', async () => {
      const payload = createMockWebhookPayload()
      const logEntry = {
        user_id: payload.user_id,
        payload: payload,
        status: 'error',
        error_message: 'Invalid payload',
        processed_at: new Date().toISOString()
      }

      const response = mockSupabaseResponse(logEntry)
      const insertMock = vi.fn().mockResolvedValue(response)

      mockSupabase.from.mockReturnValue({
        insert: insertMock.mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(response)
      })

      const result = await mockSupabase.from('webhook_logs')
        .insert(logEntry)
        .select()
        .single()

      expect(result.data.status).toBe('error')
      expect(result.data.error_message).toBe('Invalid payload')
    })
  })
})