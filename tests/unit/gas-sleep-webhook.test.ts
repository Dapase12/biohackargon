import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock GAS globals
const mockPropertiesService = {
  getScriptProperties: vi.fn(() => ({
    getProperty: vi.fn((key: string) => {
      const props: Record<string, string> = {
        'SLEEP_WEBHOOK_URL': 'https://example.com/functions/v1/sleep-webhook',
        'SUPABASE_SERVICE_ROLE_KEY': 'test-service-role-key',
        'ARGON_USER_ID': 'test-user-id'
      }
      return props[key] || ''
    })
  }))
}

const mockUrlFetchApp = {
  fetch: vi.fn()
}

const mockLogger = {
  log: vi.fn()
}

// @ts-ignore - GAS globals
global.PropertiesService = mockPropertiesService
// @ts-ignore
global.UrlFetchApp = mockUrlFetchApp
// @ts-ignore
global.Logger = mockLogger

// Import the functions to test - we'll need to extract them or recreate them
// Since the GAS file can't be directly imported, we'll recreate the functions here for testing

describe('GAS Sleep Webhook Helper Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPropertiesService.getScriptProperties.mockReturnValue({
      getProperty: vi.fn((key: string) => {
        const props: Record<string, string> = {
          'SLEEP_WEBHOOK_URL': 'https://example.com/functions/v1/sleep-webhook',
          'SUPABASE_SERVICE_ROLE_KEY': 'test-service-role-key',
          'ARGON_USER_ID': 'test-user-id'
        }
        return props[key] || ''
      })
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  // Recreate the functions from gas_sleep_webhook_integration.js for testing
  const MIN_TIMESTAMP_MS = 1577836800000 // 2020-01-01T00:00:00.000Z
  const MAX_TIMESTAMP_MS = 1893455999000 // 2030-12-31T23:59:59.000Z

  function extractTimestamp_(rec: any): number | null {
    const candidates = [
      rec.start_time, rec.startTime, rec.time, rec.timestamp,
      rec.date_time, rec.dateTime, rec.end_time, rec.endTime,
      rec.metadata && (rec.metadata.start_time || rec.metadata.startTime || rec.metadata.time)
    ]

    for (const c of candidates) {
      if (c === undefined || c === null || c === '') continue
      let ms
      if (typeof c === 'number') {
        if (!isFinite(c)) continue
        ms = c < 1e11 ? c * 1000 : c
      } else if (typeof c === 'string') {
        // Try parsing as ISO date string first (contains 'T' or matches date pattern)
        const looksLikeIsoDate = c.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(c)
        if (looksLikeIsoDate) {
          const dt = new Date(c)
          const dtMs = dt.getTime()
          if (!isNaN(dtMs) && isFinite(dtMs)) {
            ms = dtMs
          }
        } else {
          // Fallback: try parsing as numeric string (seconds or ms since epoch)
          const num = parseFloat(c)
          if (!isNaN(num) && isFinite(num)) {
            ms = num < 1e11 ? num * 1000 : num
          }
        }
      }
      if (ms && isFinite(ms) && ms >= MIN_TIMESTAMP_MS && ms <= MAX_TIMESTAMP_MS && ms > 1e12) {
        return Math.round(ms)
      }
    }
    return null
  }

  function extractNumber_(rec: any, keys: (string | number)[], options: { min?: number; max?: number } = {}): number | null {
    const { min = -Infinity, max = Infinity } = options

    for (const k of keys) {
      let value
      if (rec === null) {
        value = k
      } else {
        if (rec[k] === undefined || rec[k] === null) continue
        value = rec[k]
      }
      const n = Number(value)
      if (!isNaN(n) && isFinite(n) && n >= min && n <= max) {
        return n
      }
    }
    return null
  }

  function extractHR_(rec: any, keys: string[]): number | null {
    return extractNumber_(rec, keys, { min: 30, max: 250 })
  }

  function extractAccel_(rec: any, keys: string[]): number | null {
    return extractNumber_(rec, keys, { min: -10, max: 10 })
  }

  function extractRR_(rec: any, keys: string[]): number | null {
    return extractNumber_(rec, keys, { min: 300, max: 2000 })
  }

  // Test extractTimestamp_
  describe('extractTimestamp_', () => {
    it('should return null for undefined input', () => {
      expect(extractTimestamp_({})).toBeNull()
    })

    it('should return null for null input', () => {
      expect(extractTimestamp_({ timestamp: null })).toBeNull()
    })

    it('should extract timestamp from start_time (ms)', () => {
      const ts = 1705334400000 // 2024-01-15T00:00:00.000Z
      expect(extractTimestamp_({ start_time: ts })).toBe(ts)
    })

    it('should extract timestamp from start_time (seconds) and convert to ms', () => {
      const tsSec = 1705334400 // 2024-01-15T00:00:00.000Z in seconds
      expect(extractTimestamp_({ start_time: tsSec })).toBe(tsSec * 1000)
    })

    it('should extract timestamp from timestamp field', () => {
      const ts = 1705334400000
      expect(extractTimestamp_({ timestamp: ts })).toBe(ts)
    })

    it('should extract timestamp from ISO string', () => {
      const iso = '2024-01-15T00:00:00.000Z'
      const expected = new Date(iso).getTime()
      expect(extractTimestamp_({ timestamp: iso })).toBe(expected)
    })

    it('should extract timestamp from metadata.start_time', () => {
      const ts = 1705334400000
      expect(extractTimestamp_({ metadata: { start_time: ts } })).toBe(ts)
    })

    it('should reject timestamps before 2020-01-01', () => {
      const ts = 1577836799999 // 2019-12-31T23:59:59.999Z
      expect(extractTimestamp_({ timestamp: ts })).toBeNull()
    })

    it('should reject timestamps after 2030-12-31', () => {
      const ts = 1893456000000 // 2031-01-01T00:00:00.000Z
      expect(extractTimestamp_({ timestamp: ts })).toBeNull()
    })

    it('should reject NaN', () => {
      expect(extractTimestamp_({ timestamp: NaN })).toBeNull()
    })

    it('should reject Infinity', () => {
      expect(extractTimestamp_({ timestamp: Infinity })).toBeNull()
    })

    it('should reject -Infinity', () => {
      expect(extractTimestamp_({ timestamp: -Infinity })).toBeNull()
    })

    it('should reject invalid string that parses to NaN', () => {
      expect(extractTimestamp_({ timestamp: 'invalid' })).toBeNull()
    })

    it('should reject timestamp < 1e12 (too small for ms)', () => {
      // 1e11 is 100 billion, which in ms would be year 1973
      expect(extractTimestamp_({ timestamp: 1e11 })).toBeNull()
    })

    it('should accept timestamp at exactly 2020-01-01', () => {
      expect(extractTimestamp_({ timestamp: MIN_TIMESTAMP_MS })).toBe(MIN_TIMESTAMP_MS)
    })

    it('should accept timestamp at exactly 2030-12-31', () => {
      expect(extractTimestamp_({ timestamp: MAX_TIMESTAMP_MS })).toBe(MAX_TIMESTAMP_MS)
    })

    it('should try multiple candidate fields in order', () => {
      // start_time should be preferred over timestamp
      const rec = {
        start_time: 1705334400000,
        timestamp: 1800000000000
      }
      expect(extractTimestamp_(rec)).toBe(1705334400000)
    })
  })

  // Test extractNumber_
  describe('extractNumber_', () => {
    it('should return null for undefined input', () => {
      expect(extractNumber_({}, ['value'])).toBeNull()
    })

    it('should return null for null input', () => {
      expect(extractNumber_({ value: null }, ['value'])).toBeNull()
    })

    it('should extract number from object property', () => {
      expect(extractNumber_({ value: 42 }, ['value'])).toBe(42)
    })

    it('should extract number from string property', () => {
      expect(extractNumber_({ value: '42' }, ['value'])).toBe(42)
    })

    it('should try multiple keys in order', () => {
      expect(extractNumber_({ bpm: 70, hr: 75 }, ['bpm', 'hr'])).toBe(70)
    })

    it('should skip undefined keys and try next', () => {
      expect(extractNumber_({ hr: 75 }, ['bpm', 'hr'])).toBe(75)
    })

    it('should handle rec === null (direct values)', () => {
      expect(extractNumber_(null, [42], {})).toBe(42)
      expect(extractNumber_(null, ['42'], {})).toBe(42)
    })

    it('should respect min bound', () => {
      expect(extractNumber_({ value: 5 }, ['value'], { min: 10 })).toBeNull()
      expect(extractNumber_({ value: 10 }, ['value'], { min: 10 })).toBe(10)
      expect(extractNumber_({ value: 15 }, ['value'], { min: 10 })).toBe(15)
    })

    it('should respect max bound', () => {
      expect(extractNumber_({ value: 15 }, ['value'], { max: 10 })).toBeNull()
      expect(extractNumber_({ value: 10 }, ['value'], { max: 10 })).toBe(10)
      expect(extractNumber_({ value: 5 }, ['value'], { max: 10 })).toBe(5)
    })

    it('should reject NaN', () => {
      expect(extractNumber_({ value: NaN }, ['value'])).toBeNull()
    })

    it('should reject Infinity', () => {
      expect(extractNumber_({ value: Infinity }, ['value'])).toBeNull()
    })

    it('should reject -Infinity', () => {
      expect(extractNumber_({ value: -Infinity }, ['value'])).toBeNull()
    })

    it('should reject non-numeric string', () => {
      expect(extractNumber_({ value: 'abc' }, ['value'])).toBeNull()
    })

    it('should return null for empty options', () => {
      expect(extractNumber_({}, ['value'])).toBeNull()
    })
  })

  // Test extractHR_
  describe('extractHR_', () => {
    it('should extract valid HR (30-250 bpm)', () => {
      expect(extractHR_({ bpm: 60 }, ['bpm'])).toBe(60)
      expect(extractHR_({ hr: 75 }, ['hr'])).toBe(75)
      expect(extractHR_({ heart_rate: 80 }, ['heart_rate'])).toBe(80)
      expect(extractHR_({ value: 120 }, ['value'])).toBe(120)
    })

    it('should reject HR below 30 bpm', () => {
      expect(extractHR_({ bpm: 29 }, ['bpm'])).toBeNull()
      expect(extractHR_({ bpm: 0 }, ['bpm'])).toBeNull()
      expect(extractHR_({ bpm: -10 }, ['bpm'])).toBeNull()
    })

    it('should reject HR above 250 bpm', () => {
      expect(extractHR_({ bpm: 251 }, ['bpm'])).toBeNull()
      expect(extractHR_({ bpm: 300 }, ['bpm'])).toBeNull()
    })

    it('should accept boundary values', () => {
      expect(extractHR_({ bpm: 30 }, ['bpm'])).toBe(30)
      expect(extractHR_({ bpm: 250 }, ['bpm'])).toBe(250)
    })

    it('should reject NaN and Infinity', () => {
      expect(extractHR_({ bpm: NaN }, ['bpm'])).toBeNull()
      expect(extractHR_({ bpm: Infinity }, ['bpm'])).toBeNull()
    })
  })

  // Test extractAccel_
  describe('extractAccel_', () => {
    it('should extract valid acceleration (-10 to 10 g)', () => {
      expect(extractAccel_({ x: 0.5 }, ['x'])).toBe(0.5)
      expect(extractAccel_({ X: -0.3 }, ['X'])).toBe(-0.3)
      expect(extractAccel_({ y: 1.0 }, ['y'])).toBe(1.0)
      expect(extractAccel_({ z: -1.0 }, ['z'])).toBe(-1.0)
    })

    it('should reject acceleration below -10 g', () => {
      expect(extractAccel_({ x: -10.1 }, ['x'])).toBeNull()
      expect(extractAccel_({ x: -20 }, ['x'])).toBeNull()
    })

    it('should reject acceleration above 10 g', () => {
      expect(extractAccel_({ x: 10.1 }, ['x'])).toBeNull()
      expect(extractAccel_({ x: 20 }, ['x'])).toBeNull()
    })

    it('should accept boundary values', () => {
      expect(extractAccel_({ x: -10 }, ['x'])).toBe(-10)
      expect(extractAccel_({ x: 10 }, ['x'])).toBe(10)
    })

    it('should reject NaN and Infinity', () => {
      expect(extractAccel_({ x: NaN }, ['x'])).toBeNull()
      expect(extractAccel_({ x: Infinity }, ['x'])).toBeNull()
    })
  })

  // Test extractRR_
  describe('extractRR_', () => {
    it('should extract valid RR intervals (300-2000 ms)', () => {
      expect(extractRR_({ rr_ms: 800 }, ['rr_ms'])).toBe(800)
      expect(extractRR_({ rmssd_ms: 50 }, ['rmssd_ms'])).toBeNull() // rmssd typically < 300
      expect(extractRR_({ rr: 1000 }, ['rr'])).toBe(1000)
    })

    it('should reject RR below 300 ms', () => {
      expect(extractRR_({ rr_ms: 299 }, ['rr_ms'])).toBeNull()
      expect(extractRR_({ rr_ms: 200 }, ['rr_ms'])).toBeNull()
    })

    it('should reject RR above 2000 ms', () => {
      expect(extractRR_({ rr_ms: 2001 }, ['rr_ms'])).toBeNull()
      expect(extractRR_({ rr_ms: 3000 }, ['rr_ms'])).toBeNull()
    })

    it('should accept boundary values', () => {
      expect(extractRR_({ rr_ms: 300 }, ['rr_ms'])).toBe(300)
      expect(extractRR_({ rr_ms: 2000 }, ['rr_ms'])).toBe(2000)
    })

    it('should reject NaN and Infinity', () => {
      expect(extractRR_({ rr_ms: NaN }, ['rr_ms'])).toBeNull()
      expect(extractRR_({ rr_ms: Infinity }, ['rr_ms'])).toBeNull()
    })
  })

  // Test callSleepWebhook_ error handling
  describe('callSleepWebhook_ error handling', () => {
    const validPayload = {
      user_id: 'test-user-id',
      log_date: '2024-01-15',
      in_bed_start_s: 1705334400,
      in_bed_end_s: 1705341600,
      config: { epoch_sec: 30 },
      accel: [{ ts_ms: 1705334400000, x: 0, y: 0, z: 1, valid: true }],
      hr: [{ ts_ms: 1705334400000, hr: 60 }],
      rr: []
    }

    it('should return success false with error for invalid URL', async () => {
      mockPropertiesService.getScriptProperties.mockReturnValue({
        getProperty: vi.fn((key: string) => {
          const props: Record<string, string> = {
            'SLEEP_WEBHOOK_URL': 'not-a-valid-url',
            'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
            'ARGON_USER_ID': 'test-user-id'
          }
          return props[key] || ''
        })
      })

      // We'll test the validateSleepWebhookConfig_ function directly
      const configValidation = validateSleepWebhookConfig_()
      expect(configValidation.valid).toBe(false)
      expect(configValidation.error).toContain('formato inválido')
    })

    it('should return success false with error for missing URL', async () => {
      mockPropertiesService.getScriptProperties.mockReturnValue({
        getProperty: vi.fn((key: string) => {
          const props: Record<string, string> = {
            'SLEEP_WEBHOOK_URL': '',
            'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
            'ARGON_USER_ID': 'test-user-id'
          }
          return props[key] || ''
        })
      })

      const configValidation = validateSleepWebhookConfig_()
      expect(configValidation.valid).toBe(false)
      expect(configValidation.error).toContain('SLEEP_WEBHOOK_URL no configurado')
    })

    it('should return success false with error for missing API key', async () => {
      mockPropertiesService.getScriptProperties.mockReturnValue({
        getProperty: vi.fn((key: string) => {
          const props: Record<string, string> = {
            'SLEEP_WEBHOOK_URL': 'https://example.com/webhook',
            'SUPABASE_SERVICE_ROLE_KEY': '',
            'ARGON_USER_ID': 'test-user-id'
          }
          return props[key] || ''
        })
      })

      const configValidation = validateSleepWebhookConfig_()
      expect(configValidation.valid).toBe(false)
      expect(configValidation.error).toContain('SUPABASE_SERVICE_ROLE_KEY no configurado')
    })

    it('should return success false with error for missing user ID', async () => {
      mockPropertiesService.getScriptProperties.mockReturnValue({
        getProperty: vi.fn((key: string) => {
          const props: Record<string, string> = {
            'SLEEP_WEBHOOK_URL': 'https://example.com/webhook',
            'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
            'ARGON_USER_ID': ''
          }
          return props[key] || ''
        })
      })

      const configValidation = validateSleepWebhookConfig_()
      expect(configValidation.valid).toBe(false)
      expect(configValidation.error).toContain('ARGON_USER_ID no configurado')
    })

    it('should return success false for HTTP error (non-2xx)', async () => {
      mockUrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 500,
        getContentText: () => 'Internal Server Error'
      })

      const result = await callSleepWebhook_(validPayload)
      expect(result.success).toBe(false)
      expect(result.error).toContain('HTTP 500')
    })

    it('should return success false for 401 Unauthorized', async () => {
      mockUrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 401,
        getContentText: () => 'Unauthorized'
      })

      const result = await callSleepWebhook_(validPayload)
      expect(result.success).toBe(false)
      expect(result.error).toContain('HTTP 401')
    })

    it('should return success false for 404 Not Found', async () => {
      mockUrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 404,
        getContentText: () => 'Not Found'
      })

      const result = await callSleepWebhook_(validPayload)
      expect(result.success).toBe(false)
      expect(result.error).toContain('HTTP 404')
    })

    it('should return success false for network error (timeout)', async () => {
      mockUrlFetchApp.fetch.mockImplementation(() => {
        throw new Error('Timeout')
      })

      const result = await callSleepWebhook_(validPayload)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Error de red')
    })

    it('should return success false for network error (DNS)', async () => {
      mockUrlFetchApp.fetch.mockImplementation(() => {
        throw new Error('DNS lookup failed')
      })

      const result = await callSleepWebhook_(validPayload)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Error de red')
    })

    it('should return success false for network error (connection refused)', async () => {
      mockUrlFetchApp.fetch.mockImplementation(() => {
        throw new Error('Connection refused')
      })

      const result = await callSleepWebhook_(validPayload)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Error de red')
    })

    it('should return success false for JSON parse error on response', async () => {
      mockUrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 200,
        getContentText: () => 'not valid json{'
      })

      const result = await callSleepWebhook_(validPayload)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Respuesta inválida')
    })

    it('should return success true for valid 200 response', async () => {
      mockUrlFetchApp.fetch.mockReturnValue({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          success: true,
          data: {
            segmentation: { stages: [{ stage: 'light' }] },
            stored: true
          }
        })
      })

      const result = await callSleepWebhook_(validPayload)
      expect(result.success).toBe(true)
      expect(result.data.segmentation.stages).toHaveLength(1)
      expect(result.data.stored).toBe(true)
    })
  })
})

// Recreate validateSleepWebhookConfig_ and callSleepWebhook_ for testing
function validateSleepWebhookConfig_(): { valid: boolean; error?: string } {
  const url = 'https://example.com/functions/v1/sleep-webhook'
  const apiKey = 'test-service-role-key'
  const userId = 'test-user-id'

  // Use mocked PropertiesService
  const scriptProps = global.PropertiesService.getScriptProperties()
  const actualUrl = scriptProps.getProperty('SLEEP_WEBHOOK_URL')
  const actualApiKey = scriptProps.getProperty('SUPABASE_SERVICE_ROLE_KEY')
  const actualUserId = scriptProps.getProperty('ARGON_USER_ID')

  if (!actualUrl) {
    return { valid: false, error: 'SLEEP_WEBHOOK_URL no configurado en Script Properties' }
  }
  if (!actualApiKey) {
    return { valid: false, error: 'SUPABASE_SERVICE_ROLE_KEY no configurado en Script Properties' }
  }
  if (!actualUserId) {
    return { valid: false, error: 'ARGON_USER_ID no configurado en Script Properties' }
  }
  try {
    new URL(actualUrl)
  } catch (e) {
    return { valid: false, error: 'SLEEP_WEBHOOK_URL tiene formato inválido' }
  }
  return { valid: true }
}

async function callSleepWebhook_(webhookPayload: any): Promise<any> {
  const configValidation = validateSleepWebhookConfig_()
  if (!configValidation.valid) {
    global.Logger.log('Sleep webhook: Config inválida - ' + configValidation.error)
    return { success: false, error: configValidation.error }
  }

  const scriptProps = global.PropertiesService.getScriptProperties()
  const url = scriptProps.getProperty('SLEEP_WEBHOOK_URL')
  const apiKey = scriptProps.getProperty('SUPABASE_SERVICE_ROLE_KEY')

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    payload: JSON.stringify(webhookPayload),
    muteHttpExceptions: true
  }

  try {
    const response = global.UrlFetchApp.fetch(url, options)
    const code = response.getResponseCode()
    const text = response.getContentText()

    if (code === 200) {
      try {
        return JSON.parse(text)
      } catch (parseError) {
        global.Logger.log('Sleep webhook: Error parseando respuesta - ' + parseError.message)
        return { success: false, error: 'Respuesta inválida del servidor' }
      }
    } else {
      global.Logger.log('Sleep webhook HTTP ' + code + ': ' + text)
      return { success: false, error: 'HTTP ' + code + ': ' + text }
    }
  } catch (e) {
    global.Logger.log('Sleep webhook: Error de red - ' + e.message)
    return { success: false, error: 'Error de red: ' + e.message }
  }
}