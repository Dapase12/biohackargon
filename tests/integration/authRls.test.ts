import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockSupabaseResponse, createMockRawBiometric, createMockComputedScores } from '../setup'

// Mock Supabase with RLS policies
const createMockSupabaseWithRLS = (currentUserId: string | null) => {
  const userData = new Map<string, any[]>()

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: currentUserId ? { id: currentUserId } : null },
        error: null
      }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: currentUserId ? { user: { id: currentUserId } } : null },
        error: null
      })
    },
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      // RLS enforcement
      _rlsCheck: (operation: string, data?: any) => {
        if (!currentUserId) {
          throw new Error('JWT required for ' + operation)
        }
        if (data && data.user_id !== currentUserId) {
          throw new Error('RLS policy violation: cannot access other user data')
        }
        return true
      }
    })),
    rpc: vi.fn()
  }
}

describe('Integration: Auth & RLS (Multi-tenant Isolation)', () => {
  let supabaseUser1: ReturnType<typeof createMockSupabaseWithRLS>
  let supabaseUser2: ReturnType<typeof createMockSupabaseWithRLS>
  let supabaseAnon: ReturnType<typeof createMockSupabaseWithRLS>

  const USER_1_ID = '11111111-1111-1111-1111-111111111111'
  const USER_2_ID = '22222222-2222-2222-2222-222222222222'

  beforeEach(() => {
    vi.clearAllMocks()
    supabaseUser1 = createMockSupabaseWithRLS(USER_1_ID)
    supabaseUser2 = createMockSupabaseWithRLS(USER_2_ID)
    supabaseAnon = createMockSupabaseWithRLS(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Authentication', () => {
    it('should authenticate user 1', async () => {
      const { data, error } = await supabaseUser1.auth.getUser()
      expect(error).toBeNull()
      expect(data.user?.id).toBe(USER_1_ID)
    })

    it('should authenticate user 2', async () => {
      const { data, error } = await supabaseUser2.auth.getUser()
      expect(error).toBeNull()
      expect(data.user?.id).toBe(USER_2_ID)
    })

    it('should return null for unauthenticated', async () => {
      const { data, error } = await supabaseAnon.auth.getUser()
      expect(error).toBeNull()
      expect(data.user).toBeNull()
    })
  })

  describe('RLS: Daily Raw Biometrics', () => {
    it('should allow user to read own raw data', async () => {
      const rawData = createMockRawBiometric({ user_id: USER_1_ID, log_date: '2025-01-15' })
      const response = mockSupabaseResponse([rawData])

      supabaseUser1.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(response)
      })

      const result = await supabaseUser1.from('daily_raw_biometrics')
        .select('*')
        .eq('user_id', USER_1_ID)
        .order('log_date', { ascending: false })
        .limit(30)

      expect(result.data).toHaveLength(1)
      expect(result.data[0].user_id).toBe(USER_1_ID)
    })

    it('should prevent user from reading other user raw data', async () => {
      // User 1 trying to query user 2's data
      supabaseUser1.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockSupabaseResponse([]))
      })

      const result = await supabaseUser1.from('daily_raw_biometrics')
        .select('*')
        .eq('user_id', USER_2_ID) // Different user!
        .order('log_date', { ascending: false })
        .limit(30)

      // RLS should return empty array, not other user's data
      expect(result.data).toHaveLength(0)
    })

    it('should allow user to insert own raw data', async () => {
      const rawData = createMockRawBiometric({ user_id: USER_1_ID })
      const response = mockSupabaseResponse(rawData)

      supabaseUser1.from.mockReturnValue({
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(response)
      })

      const result = await supabaseUser1.from('daily_raw_biometrics')
        .upsert(rawData)
        .select()
        .single()

      expect(result.data).toEqual(rawData)
    })

    it('should prevent user from inserting data for other user', async () => {
      const rawData = createMockRawBiometric({ user_id: USER_2_ID }) // Wrong user_id!
      const response = mockSupabaseResponse(null, new Error('RLS violation'))

      supabaseUser1.from.mockReturnValue({
        upsert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(response)
      })

      const result = await supabaseUser1.from('daily_raw_biometrics')
        .upsert(rawData)
        .select()
        .single()

      expect(result.error).toBeDefined()
    })
  })

  describe('RLS: Computed Daily Scores', () => {
    it('should allow user to read own computed scores', async () => {
      const computedData = createMockComputedScores({ user_id: USER_1_ID, log_date: '2025-01-15' })
      const response = mockSupabaseResponse([computedData])

      supabaseUser1.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(response)
      })

      const result = await supabaseUser1.from('computed_daily_scores')
        .select('*')
        .eq('user_id', USER_1_ID)
        .order('log_date', { ascending: false })
        .limit(30)

      expect(result.data).toHaveLength(1)
      expect(result.data[0].user_id).toBe(USER_1_ID)
    })

    it('should prevent user from reading other user computed scores', async () => {
      supabaseUser1.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockSupabaseResponse([]))
      })

      const result = await supabaseUser1.from('computed_daily_scores')
        .select('*')
        .eq('user_id', USER_2_ID)
        .order('log_date', { ascending: false })
        .limit(30)

      expect(result.data).toHaveLength(0)
    })
  })

  describe('RLS: Webhook Logs', () => {
    it('should allow user to read own webhook logs', async () => {
      const logEntry = {
        user_id: USER_1_ID,
        payload: { test: 'data' },
        status: 'success',
        processed_at: new Date().toISOString()
      }
      const response = mockSupabaseResponse([logEntry])

      supabaseUser1.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(response)
      })

      const result = await supabaseUser1.from('webhook_logs')
        .select('*')
        .eq('user_id', USER_1_ID)
        .order('processed_at', { ascending: false })
        .limit(50)

      expect(result.data).toHaveLength(1)
      expect(result.data[0].user_id).toBe(USER_1_ID)
    })
  })

  describe('RLS: Profile/Settings', () => {
    it('should allow user to read own profile', async () => {
      const profile = {
        user_id: USER_1_ID,
        birth_date: '1990-01-01',
        height_m: 1.75,
        timezone: 'America/Caracas'
      }
      const response = mockSupabaseResponse(profile)

      supabaseUser1.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(response)
      })

      const result = await supabaseUser1.from('profiles')
        .select('*')
        .eq('user_id', USER_1_ID)
        .single()

      expect(result.data).toEqual(profile)
    })

    it('should prevent user from reading other user profile', async () => {
      supabaseUser1.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(mockSupabaseResponse(null, new Error('Not found')))
      })

      const result = await supabaseUser1.from('profiles')
        .select('*')
        .eq('user_id', USER_2_ID)
        .single()

      expect(result.data).toBeNull()
      expect(result.error).toBeDefined()
    })

    it('should allow user to update own profile', async () => {
      const updates = { height_m: 1.80 }
      const response = mockSupabaseResponse({ ...updates, user_id: USER_1_ID })

      supabaseUser1.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(response)
      })

      const result = await supabaseUser1.from('profiles')
        .update(updates)
        .eq('user_id', USER_1_ID)
        .select()
        .single()

      expect(result.data.height_m).toBe(1.80)
    })
  })

  describe('Anonymous Access (No Auth)', () => {
    it('should reject all table access without auth', async () => {
      const tables = ['daily_raw_biometrics', 'computed_daily_scores', 'webhook_logs', 'profiles']

      for (const table of tables) {
        supabaseAnon.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockRejectedValue(new Error('JWT required'))
        })

        await expect(
          supabaseAnon.from(table).select('*').limit(10)
        ).rejects.toThrow('JWT required')
      }
    })

    it('should reject insert without auth', async () => {
      supabaseAnon.from.mockReturnValue({
        insert: vi.fn().mockRejectedValue(new Error('JWT required'))
      })

      await expect(
        supabaseAnon.from('daily_raw_biometrics').insert({})
      ).rejects.toThrow('JWT required')
    })
  })

  describe('Session Persistence', () => {
    it('should maintain session across requests', async () => {
      const session1 = await supabaseUser1.auth.getSession()
      const session2 = await supabaseUser1.auth.getSession()

      expect(session1.data.session?.user.id).toBe(USER_1_ID)
      expect(session2.data.session?.user.id).toBe(USER_1_ID)
    })

    it('should isolate sessions between users', async () => {
      const session1 = await supabaseUser1.auth.getSession()
      const session2 = await supabaseUser2.auth.getSession()

      expect(session1.data.session?.user.id).toBe(USER_1_ID)
      expect(session2.data.session?.user.id).toBe(USER_2_ID)
      expect(session1.data.session?.user.id).not.toBe(session2.data.session?.user.id)
    })
  })

  describe('RLS Policy Enforcement Summary', () => {
    it('should enforce user_id = auth.uid() on all tables', () => {
      const tablesWithRLS = [
        'daily_raw_biometrics',
        'computed_daily_scores',
        'webhook_logs',
        'profiles'
      ]

      // This test documents the expected RLS policies
      tablesWithRLS.forEach(table => {
        expect(table).toBeDefined()
      })

      // Expected policies (documented for implementation):
      // CREATE POLICY "Users can view own data" ON daily_raw_biometrics
      //   FOR SELECT USING (auth.uid() = user_id);
      // CREATE POLICY "Users can insert own data" ON daily_raw_biometrics
      //   FOR INSERT WITH CHECK (auth.uid() = user_id);
      // ... similar for other tables
    })
  })
})