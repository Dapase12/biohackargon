import { vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// GLOBAL MOCKS
// ============================================================================

// Mock localStorage with in-memory store
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((index: number) => Object.keys(store)[index] || null)
  }
})()

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true
})

// Mock sessionStorage
const sessionStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()

Object.defineProperty(global, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true
})

// Mock fetch for Supabase/GAS calls
global.fetch = vi.fn()

// Mock window.CONFIG with test profile
Object.defineProperty(global, 'window', {
  value: {
    ...global.window,
    CONFIG: {
      profile: {
        timezone: 'America/Caracas',
        birthDate: '1990-01-01',
        heightM: 1.75,
        basalSleepNeedH: 7.5,
        habitualWake: '06:00',
        goalWeightKg: 75,
        goalDate: '2025-12-31',
        dailyDeficitKcal: 500,
        biologicalSex: 'male'
      },
      supabase: {
        url: 'https://test.supabase.co',
        key: 'test-anon-key'
      }
    },
    navigator: {
      vibrate: vi.fn(),
      share: vi.fn()
    },
    matchMedia: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })),
    requestAnimationFrame: vi.fn(cb => setTimeout(cb, 16)),
    cancelAnimationFrame: vi.fn(id => clearTimeout(id))
  },
  writable: true
})

// Mock navigator globally
Object.defineProperty(global, 'navigator', {
  value: {
    vibrate: vi.fn(),
    share: vi.fn(),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },
  writable: true
})

// Mock Intl.DateTimeFormat for timezone tests
const originalDateTimeFormat = Intl.DateTimeFormat
Intl.DateTimeFormat = vi.fn((locale, options) => {
  if (options?.timeZone === 'America/Caracas') {
    return new originalDateTimeFormat(locale, { ...options, timeZone: 'UTC' })
  }
  return new originalDateTimeFormat(locale, options)
}) as any

// Mock ApexCharts
global.ApexCharts = vi.fn().mockImplementation(() => ({
  render: vi.fn(),
  updateOptions: vi.fn(),
  updateSeries: vi.fn(),
  destroy: vi.fn()
}))

// Mock Swiper
global.Swiper = vi.fn().mockImplementation(() => ({
  init: vi.fn(),
  destroy: vi.fn(),
  slideTo: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
}))

// Mock Lucide icons
global.lucide = {
  createIcons: vi.fn()
}

// ============================================================================
// GLOBAL TEST UTILITIES
// ============================================================================

/**
 * Render the app for testing (mounts index.html or creates DOM)
 */
export function renderApp(html?: string): HTMLElement {
  const container = document.createElement('div')
  container.id = 'app'
  if (html) {
    container.innerHTML = html
  } else {
    // Create minimal DOM structure for tests
    container.innerHTML = `
      <div id="app">
        <header id="header"></header>
        <main id="main"></main>
        <div id="mbe-panel" class="hidden"></div>
      </div>
    `
  }
  document.body.appendChild(container)
  return container
}

/**
 * Clean up rendered app
 */
export function cleanupApp(container: HTMLElement) {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container)
  }
}

/**
 * Mock Supabase response - returns data directly (not wrapped)
 */
export function mockSupabaseResponse<T>(data: T | null, error: Error | null = null) {
  if (error) {
    return { data: null, error, status: 400, statusText: 'Bad Request' }
  }
  return { data, error: null, status: 200, statusText: 'OK' }
}

/**
 * Mock GAS (Google Apps Script) webhook response
 */
export function mockGASResponse<T>(data: T, success = true) {
  return {
    success,
    data,
    timestamp: new Date().toISOString()
  }
}

/**
 * Create mock raw biometric data (PRODUCTION SCHEMA)
 */
export function createMockRawBiometric(overrides: Partial<any> = {}) {
  return {
    user_id: 'test-user',
    log_date: new Date().toISOString().split('T')[0],
    // Sleep - PRODUCTION COLUMNS
    rmssd_ms: 45,
    time_in_bed_min: 540,
    total_sleep_min: 480,
    deep_sleep_min: 90,
    rem_sleep_min: 100,
    light_sleep_min: 250,
    nap_sleep_min: 20,
    sleep_onset_timestamp: '2025-01-14T22:30:00-04:00',
    wake_timestamp: '2025-01-15T06:30:00-04:00',
    // Exercise - PRODUCTION COLUMNS
    pickleball_or_gym_minutes: 60,
    active_calories_kcal: 450,
    hr_zones_minutes: { z1: 10, z2: 20, z3: 15, z4: 10, z5: 5 },
    // Body Composition - PRODUCTION COLUMNS
    weight_kg: 75.5,
    body_fat_pct: 18,
    // Manual fields (preserved)
    meals_log_json: [],
    session_rpe: null,
    intake_kcal: null,
    intake_protein_g: null,
    intake_carbs_g: null,
    intake_fat_g: null,
    is_hospital_shift: false,
    night_awake_shift_hours: null,
    // Metadata
    raw_payload_hash: 'abc123',
    source: 'health_connect',
    created_at: '2025-01-15T10:00:00Z',
    updated_at: '2025-01-15T10:00:00Z',
    ...overrides
  }
}

/**
 * Create mock computed daily scores
 */
export function createMockComputedScores(overrides: Partial<any> = {}) {
  return {
    user_id: 'test-user',
    log_date: new Date().toISOString().split('T')[0],
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
    body_comp_score: 75,
    ...overrides
  }
}

/**
 * Create mock webhook payload (matches GAS output format - may differ from DB)
 */
export function createMockWebhookPayload(overrides: Partial<any> = {}) {
  return {
    user_id: 'test-user',
    timestamp: new Date().toISOString(),
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
        naps: []
      },
      activity: {
        steps: 8500,
        active_calories: 450,
        exercise_min: 45,
        exercise_type: 'running'
      },
      body: {
        weight_kg: 75.5,
        body_fat_pct: 18,
        muscle_mass_kg: 58,
        hydration_ml: 2500
      }
    },
    ...overrides
  }
}

/**
 * Wait for microtasks to complete
 */
export async function flushPromises(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Advance timers by specified ms
 */
export function advanceTimers(ms: number): void {
  vi.advanceTimersByTime(ms)
}

// ============================================================================
// SETUP & TEARDOWN
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  localStorageMock.clear()
  sessionStorageMock.clear()
  document.body.innerHTML = ''
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

// Export types for global test utilities
declare global {
  namespace Vi {
    interface Jest {
      mockSupabaseResponse: typeof mockSupabaseResponse
      mockGASResponse: typeof mockGASResponse
      createMockRawBiometric: typeof createMockRawBiometric
      createMockComputedScores: typeof createMockComputedScores
      createMockWebhookPayload: typeof createMockWebhookPayload
      renderApp: typeof renderApp
      cleanupApp: typeof cleanupApp
      flushPromises: typeof flushPromises
      advanceTimers: typeof advanceTimers
    }
  }
}

// Make utilities globally available in tests
global.mockSupabaseResponse = mockSupabaseResponse
global.mockGASResponse = mockGASResponse
global.createMockRawBiometric = createMockRawBiometric
global.createMockComputedScores = createMockComputedScores
global.createMockWebhookPayload = createMockWebhookPayload
global.renderApp = renderApp
global.cleanupApp = cleanupApp
global.flushPromises = flushPromises
global.advanceTimers = advanceTimers