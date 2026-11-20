import { describe, it, expect, vi, beforeEach } from 'vitest'

// Recreate the types and functions from pipeline.ts for testing
interface AccelSample {
  tsMs: number
  x: number
  y: number
  z: number
  valid: boolean
}

interface HrSample {
  tsMs: number
  hr: number
  valid: boolean
}

interface RrSeries {
  tsMs: number[]
  rrMs: number[]
  length: number
  isEmpty: boolean
  beatTimesMs(t0Ms?: number): number[]
}

interface RawSleepData {
  user_id: string
  log_date: string
  accel: AccelSample[]
  hr: HrSample[]
  rr: RrSeries[]
  in_bed_start_s: number
  in_bed_end_s: number
  config: { epoch_sec: number }
}

interface WebhookPayload {
  user_id: string
  log_date: string
  accel: unknown[]
  hr: unknown[]
  rr: unknown[]
  in_bed_start_s: number
  in_bed_end_s: number
  config?: Record<string, unknown>
}

const DEFAULT_EPOCH_SEC = 30
const MAX_SAMPLES = 100000
const HR_MIN = 30
const HR_MAX = 250
const RR_MIN = 300
const RR_MAX = 2000
const TIMESTAMP_TOLERANCE_MS = 2 * 60 * 60 * 1000 // 2 hours in ms

function createAccelSample(tsMs: number, x: number, y: number, z: number, valid = true): AccelSample {
  return { tsMs, x, y, z, valid }
}

function createHrSample(tsMs: number, hr: number): HrSample {
  return { tsMs, hr, valid: hr > 0 }
}

function createRrSeries(tsMs: number[], rrMs: number[]): RrSeries {
  return {
    tsMs: [...tsMs],
    rrMs: [...rrMs],
    get length() { return this.rrMs.length; },
    get isEmpty() { return this.rrMs.length === 0; },
    beatTimesMs(t0Ms = 0.0): number[] {
      const out: number[] = []
      let t = t0Ms
      for (const rr of this.rrMs) {
        t += rr
        out.push(t)
      }
      return out
    },
  }
}

function parseAccelSamples(data: unknown[]): AccelSample[] {
  const samples: AccelSample[] = []
  for (const d of data) {
    if (typeof d !== 'object' || d === null) continue
    const obj = d as Record<string, unknown>
    try {
      const tsMs = Number(obj.ts_ms)
      const x = Number(obj.x)
      const y = Number(obj.y)
      const z = Number(obj.z)
      const valid = obj.valid !== undefined ? Boolean(obj.valid) : true
      if (Number.isFinite(tsMs) && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        samples.push(createAccelSample(tsMs, x, y, z, valid))
      }
    } catch {
      continue
    }
  }
  return samples
}

function parseHrSamples(data: unknown[]): HrSample[] {
  const samples: HrSample[] = []
  for (const d of data) {
    if (typeof d !== 'object' || d === null) continue
    const obj = d as Record<string, unknown>
    try {
      const tsMs = Number(obj.ts_ms)
      const hr = Number(obj.hr)
      if (Number.isFinite(tsMs) && Number.isFinite(hr)) {
        samples.push(createHrSample(tsMs, hr))
      }
    } catch {
      continue
    }
  }
  return samples
}

function parseRrSeries(data: unknown[]): RrSeries[] {
  const series: RrSeries[] = []
  for (const d of data) {
    if (typeof d !== 'object' || d === null) continue
    const obj = d as Record<string, unknown>
    try {
      const tsMs = obj.ts_ms as number[] | number
      const rrMs = obj.rr_ms as number[]
      if (!Array.isArray(rrMs) || rrMs.length === 0) continue

      if (typeof tsMs === 'number' && rrMs.length > 1) {
        const reconstructedTs: number[] = []
        let currentTime = tsMs
        for (const rr of [...rrMs].reverse()) {
          reconstructedTs.unshift(currentTime)
          currentTime -= rr
        }
        series.push(createRrSeries(reconstructedTs, rrMs))
      } else if (Array.isArray(tsMs) && tsMs.length === rrMs.length && tsMs.length > 0) {
        series.push(createRrSeries(tsMs, rrMs))
      }
    } catch {
      continue
    }
  }
  return series
}

// The function we're testing - this will be our implementation
function parseWebhookPayload(payload: WebhookPayload): RawSleepData {
  const config = payload.config ?? {}
  const epochSec = typeof config.epoch_sec === 'number' ? config.epoch_sec : DEFAULT_EPOCH_SEC

  return {
    user_id: payload.user_id,
    log_date: payload.log_date,
    accel: parseAccelSamples(payload.accel),
    hr: parseHrSamples(payload.hr),
    rr: parseRrSeries(payload.rr),
    in_bed_start_s: payload.in_bed_start_s,
    in_bed_end_s: payload.in_bed_end_s,
    config: { epoch_sec: epochSec },
  }
}

// Validation function we'll add
function validateWebhookPayload(payload: WebhookPayload): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // 1. Array size limits
  if (Array.isArray(payload.accel) && payload.accel.length > MAX_SAMPLES) {
    errors.push(`accel array exceeds maximum size of ${MAX_SAMPLES} samples (got ${payload.accel.length})`)
  }
  if (Array.isArray(payload.hr) && payload.hr.length > MAX_SAMPLES) {
    errors.push(`hr array exceeds maximum size of ${MAX_SAMPLES} samples (got ${payload.hr.length})`)
  }
  if (Array.isArray(payload.rr) && payload.rr.length > MAX_SAMPLES) {
    errors.push(`rr array exceeds maximum size of ${MAX_SAMPLES} samples (got ${payload.rr.length})`)
  }

  // 2. Required fields
  if (!payload.user_id || typeof payload.user_id !== 'string') {
    errors.push('user_id is required and must be a string')
  }
  if (!payload.log_date || typeof payload.log_date !== 'string') {
    errors.push('log_date is required and must be a string')
  }
  if (typeof payload.in_bed_start_s !== 'number' || !Number.isFinite(payload.in_bed_start_s)) {
    errors.push('in_bed_start_s is required and must be a finite number')
  }
  if (typeof payload.in_bed_end_s !== 'number' || !Number.isFinite(payload.in_bed_end_s)) {
    errors.push('in_bed_end_s is required and must be a finite number')
  }
  if (payload.in_bed_end_s <= payload.in_bed_start_s) {
    errors.push('in_bed_end_s must be greater than in_bed_start_s')
  }

  // 3. Epoch config validation
  if (payload.config && typeof payload.config.epoch_sec === 'number') {
    const epochSec = payload.config.epoch_sec
    if (!Number.isFinite(epochSec) || epochSec < 10 || epochSec > 120) {
      errors.push(`epoch_sec must be between 10 and 120 (got ${epochSec})`)
    }
  }

  // 4. Validate accel samples
  if (Array.isArray(payload.accel)) {
    for (let i = 0; i < payload.accel.length; i++) {
      const sample = payload.accel[i]
      if (typeof sample !== 'object' || sample === null) {
        errors.push(`accel[${i}]: must be an object`)
        continue
      }
      const obj = sample as Record<string, unknown>
      if (typeof obj.ts_ms !== 'number' || !Number.isFinite(obj.ts_ms)) {
        errors.push(`accel[${i}]: ts_ms must be a finite number`)
      }
      if (typeof obj.x !== 'number' || !Number.isFinite(obj.x)) {
        errors.push(`accel[${i}]: x must be a finite number`)
      }
      if (typeof obj.y !== 'number' || !Number.isFinite(obj.y)) {
        errors.push(`accel[${i}]: y must be a finite number`)
      }
      if (typeof obj.z !== 'number' || !Number.isFinite(obj.z)) {
        errors.push(`accel[${i}]: z must be a finite number`)
      }
      if (obj.valid !== undefined && typeof obj.valid !== 'boolean') {
        errors.push(`accel[${i}]: valid must be a boolean`)
      }
      // Timestamp range validation
      if (typeof obj.ts_ms === 'number' && Number.isFinite(obj.ts_ms)) {
        const tsMs = obj.ts_ms
        const inBedStartMs = payload.in_bed_start_s * 1000
        const inBedEndMs = payload.in_bed_end_s * 1000
        if (tsMs < inBedStartMs - TIMESTAMP_TOLERANCE_MS || tsMs > inBedEndMs + TIMESTAMP_TOLERANCE_MS) {
          errors.push(`accel[${i}]: ts_ms (${tsMs}) outside in_bed window ±2h`)
        }
      }
    }
  }

  // 5. Validate hr samples
  if (Array.isArray(payload.hr)) {
    for (let i = 0; i < payload.hr.length; i++) {
      const sample = payload.hr[i]
      if (typeof sample !== 'object' || sample === null) {
        errors.push(`hr[${i}]: must be an object`)
        continue
      }
      const obj = sample as Record<string, unknown>
      if (typeof obj.ts_ms !== 'number' || !Number.isFinite(obj.ts_ms)) {
        errors.push(`hr[${i}]: ts_ms must be a finite number`)
      }
      if (typeof obj.hr !== 'number' || !Number.isFinite(obj.hr)) {
        errors.push(`hr[${i}]: hr must be a finite number`)
      } else {
        const hr = obj.hr
        if (hr < HR_MIN || hr > HR_MAX) {
          errors.push(`hr[${i}]: hr (${hr}) out of valid range [${HR_MIN}, ${HR_MAX}] bpm`)
        }
      }
      // Timestamp range validation
      if (typeof obj.ts_ms === 'number' && Number.isFinite(obj.ts_ms)) {
        const tsMs = obj.ts_ms
        const inBedStartMs = payload.in_bed_start_s * 1000
        const inBedEndMs = payload.in_bed_end_s * 1000
        if (tsMs < inBedStartMs - TIMESTAMP_TOLERANCE_MS || tsMs > inBedEndMs + TIMESTAMP_TOLERANCE_MS) {
          errors.push(`hr[${i}]: ts_ms (${tsMs}) outside in_bed window ±2h`)
        }
      }
    }
  }

  // 6. Validate rr series
  if (Array.isArray(payload.rr)) {
    for (let i = 0; i < payload.rr.length; i++) {
      const sample = payload.rr[i]
      if (typeof sample !== 'object' || sample === null) {
        errors.push(`rr[${i}]: must be an object`)
        continue
      }
      const obj = sample as Record<string, unknown>
      if (!Array.isArray(obj.rr_ms) || obj.rr_ms.length === 0) {
        errors.push(`rr[${i}]: rr_ms must be a non-empty array`)
        continue
      }
      // Validate each RR interval
      for (let j = 0; j < obj.rr_ms.length; j++) {
        const rr = obj.rr_ms[j]
        if (typeof rr !== 'number' || !Number.isFinite(rr)) {
          errors.push(`rr[${i}].rr_ms[${j}]: must be a finite number`)
        } else if (rr < RR_MIN || rr > RR_MAX) {
          errors.push(`rr[${i}].rr_ms[${j}]: rr interval (${rr}) out of valid range [${RR_MIN}, ${RR_MAX}] ms`)
        }
      }
      // Validate ts_ms (can be number or number[])
      const tsMs = obj.ts_ms
      if (typeof tsMs === 'number') {
        if (!Number.isFinite(tsMs)) {
          errors.push(`rr[${i}]: ts_ms must be a finite number`)
        } else {
          // Timestamp range validation
          const inBedStartMs = payload.in_bed_start_s * 1000
          const inBedEndMs = payload.in_bed_end_s * 1000
          if (tsMs < inBedStartMs - TIMESTAMP_TOLERANCE_MS || tsMs > inBedEndMs + TIMESTAMP_TOLERANCE_MS) {
            errors.push(`rr[${i}]: ts_ms (${tsMs}) outside in_bed window ±2h`)
          }
        }
      } else if (Array.isArray(tsMs)) {
        for (let j = 0; j < tsMs.length; j++) {
          if (typeof tsMs[j] !== 'number' || !Number.isFinite(tsMs[j])) {
            errors.push(`rr[${i}].ts_ms[${j}]: must be a finite number`)
          } else {
            const inBedStartMs = payload.in_bed_start_s * 1000
            const inBedEndMs = payload.in_bed_end_s * 1000
            if (tsMs[j] < inBedStartMs - TIMESTAMP_TOLERANCE_MS || tsMs[j] > inBedEndMs + TIMESTAMP_TOLERANCE_MS) {
              errors.push(`rr[${i}].ts_ms[${j}]: (${tsMs[j]}) outside in_bed window ±2h`)
            }
          }
        }
      } else {
        errors.push(`rr[${i}]: ts_ms must be a number or number[]`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// Enhanced parseWebhookPayload with validation
function parseWebhookPayloadWithValidation(payload: WebhookPayload): RawSleepData {
  const validation = validateWebhookPayload(payload)
  if (!validation.valid) {
    throw new Error(`Payload validation failed: ${validation.errors.join('; ')}`)
  }

  const config = payload.config ?? {}
  const epochSec = typeof config.epoch_sec === 'number' ? config.epoch_sec : DEFAULT_EPOCH_SEC

  return {
    user_id: payload.user_id,
    log_date: payload.log_date,
    accel: parseAccelSamples(payload.accel),
    hr: parseHrSamples(payload.hr),
    rr: parseRrSeries(payload.rr),
    in_bed_start_s: payload.in_bed_start_s,
    in_bed_end_s: payload.in_bed_end_s,
    config: { epoch_sec: epochSec },
  }
}

describe('parseWebhookPayload validation', () => {
  const validBasePayload: WebhookPayload = {
    user_id: 'test-user-123',
    log_date: '2024-01-15',
    in_bed_start_s: 1705334400, // 2024-01-15T00:00:00Z
    in_bed_end_s: 1705341600,   // 2024-01-15T02:00:00Z
    config: { epoch_sec: 30 },
    accel: [
      { ts_ms: 1705334400000, x: 0.1, y: 0.2, z: 0.9, valid: true },
    ],
    hr: [
      { ts_ms: 1705334400000, hr: 60 },
    ],
    rr: [
      { ts_ms: 1705334400000, rr_ms: [800, 810, 805] },
    ],
  }

  describe('Array size limits', () => {
    it('should reject accel array exceeding 100k samples', () => {
      const payload = {
        ...validBasePayload,
        accel: new Array(MAX_SAMPLES + 1).fill({ ts_ms: 1705334400000, x: 0, y: 0, z: 1, valid: true }),
      }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(`accel array exceeds maximum size of ${MAX_SAMPLES} samples (got ${MAX_SAMPLES + 1})`)
    })

    it('should reject hr array exceeding 100k samples', () => {
      const payload = {
        ...validBasePayload,
        hr: new Array(MAX_SAMPLES + 1).fill({ ts_ms: 1705334400000, hr: 60 }),
      }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(`hr array exceeds maximum size of ${MAX_SAMPLES} samples (got ${MAX_SAMPLES + 1})`)
    })

    it('should reject rr array exceeding 100k samples', () => {
      const payload = {
        ...validBasePayload,
        rr: new Array(MAX_SAMPLES + 1).fill({ ts_ms: 1705334400000, rr_ms: [800] }),
      }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(`rr array exceeds maximum size of ${MAX_SAMPLES} samples (got ${MAX_SAMPLES + 1})`)
    })

    it('should accept arrays at exactly 100k samples', () => {
      const payload = {
        ...validBasePayload,
        accel: new Array(MAX_SAMPLES).fill({ ts_ms: 1705334400000, x: 0, y: 0, z: 1, valid: true }),
        hr: new Array(MAX_SAMPLES).fill({ ts_ms: 1705334400000, hr: 60 }),
        rr: new Array(MAX_SAMPLES).fill({ ts_ms: 1705334400000, rr_ms: [800] }),
      }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(true)
    })
  })

  describe('Required fields', () => {
    it('should reject missing user_id', () => {
      const payload = { ...validBasePayload, user_id: '' }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('user_id is required and must be a string')
    })

    it('should reject missing log_date', () => {
      const payload = { ...validBasePayload, log_date: '' }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('log_date is required and must be a string')
    })

    it('should reject invalid in_bed_start_s', () => {
      const payload = { ...validBasePayload, in_bed_start_s: NaN }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('in_bed_start_s is required and must be a finite number')
    })

    it('should reject invalid in_bed_end_s', () => {
      const payload = { ...validBasePayload, in_bed_end_s: Infinity }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('in_bed_end_s is required and must be a finite number')
    })

    it('should reject in_bed_end_s <= in_bed_start_s', () => {
      const payload = { ...validBasePayload, in_bed_end_s: 1705334400, in_bed_start_s: 1705341600 }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('in_bed_end_s must be greater than in_bed_start_s')
    })
  })

  describe('Epoch config validation', () => {
    it('should reject epoch_sec below 10', () => {
      const payload = { ...validBasePayload, config: { epoch_sec: 5 } }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('epoch_sec must be between 10 and 120 (got 5)')
    })

    it('should reject epoch_sec above 120', () => {
      const payload = { ...validBasePayload, config: { epoch_sec: 150 } }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('epoch_sec must be between 10 and 120 (got 150)')
    })

    it('should reject non-finite epoch_sec', () => {
      const payload = { ...validBasePayload, config: { epoch_sec: NaN } }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('epoch_sec must be between 10 and 120 (got NaN)')
    })

    it('should accept epoch_sec at boundaries (10 and 120)', () => {
      const payload1 = { ...validBasePayload, config: { epoch_sec: 10 } }
      const result1 = validateWebhookPayload(payload1)
      expect(result1.valid).toBe(true)

      const payload2 = { ...validBasePayload, config: { epoch_sec: 120 } }
      const result2 = validateWebhookPayload(payload2)
      expect(result2.valid).toBe(true)
    })

    it('should use default epoch_sec when not provided', () => {
      const payload = { ...validBasePayload, config: undefined }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(true)
    })
  })

  describe('Accel sample validation', () => {
    it('should reject non-object accel sample', () => {
      const payload = { ...validBasePayload, accel: ['not-an-object'] as unknown[] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('accel[0]: must be an object')
    })

    it('should reject null accel sample', () => {
      const payload = { ...validBasePayload, accel: [null] as unknown[] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('accel[0]: must be an object')
    })

    it('should reject missing ts_ms in accel', () => {
      const payload = { ...validBasePayload, accel: [{ x: 0.1, y: 0.2, z: 0.9 }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('accel[0]: ts_ms must be a finite number')
    })

    it('should reject non-finite ts_ms in accel', () => {
      const payload = { ...validBasePayload, accel: [{ ts_ms: NaN, x: 0.1, y: 0.2, z: 0.9 }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('accel[0]: ts_ms must be a finite number')
    })

    it('should reject non-finite x, y, or z in accel', () => {
      const payload = { ...validBasePayload, accel: [{ ts_ms: 1705334400000, x: NaN, y: 0.2, z: 0.9 }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('accel[0]: x must be a finite number')
    })

    it('should reject non-boolean valid in accel', () => {
      const payload = { ...validBasePayload, accel: [{ ts_ms: 1705334400000, x: 0.1, y: 0.2, z: 0.9, valid: 'yes' }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('accel[0]: valid must be a boolean')
    })

    it('should accept valid boolean in accel', () => {
      const payload = { ...validBasePayload, accel: [{ ts_ms: 1705334400000, x: 0.1, y: 0.2, z: 0.9, valid: false }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(true)
    })

    it('should reject accel ts_ms outside in_bed window ±2h', () => {
      // in_bed: 1705334400 to 1705341600 (2024-01-15T00:00:00Z to T02:00:00Z)
      // ±2h = 7200000ms, so valid range: 1705327200000 to 1705348800000
      const tooEarly = 1705327199999 // 1ms before window
      const tooLate = 1705348800001  // 1ms after window

      const payloadEarly = { ...validBasePayload, accel: [{ ts_ms: tooEarly, x: 0.1, y: 0.2, z: 0.9 }] }
      const resultEarly = validateWebhookPayload(payloadEarly)
      expect(resultEarly.valid).toBe(false)
      expect(resultEarly.errors.some(e => e.includes('outside in_bed window'))).toBe(true)

      const payloadLate = { ...validBasePayload, accel: [{ ts_ms: tooLate, x: 0.1, y: 0.2, z: 0.9 }] }
      const resultLate = validateWebhookPayload(payloadLate)
      expect(resultLate.valid).toBe(false)
      expect(resultLate.errors.some(e => e.includes('outside in_bed window'))).toBe(true)
    })

    it('should accept accel ts_ms at exact boundary of ±2h', () => {
      const inBedStartMs = 1705334400 * 1000
      const inBedEndMs = 1705341600 * 1000
      const atStartBoundary = inBedStartMs - TIMESTAMP_TOLERANCE_MS
      const atEndBoundary = inBedEndMs + TIMESTAMP_TOLERANCE_MS

      const payloadStart = { ...validBasePayload, accel: [{ ts_ms: atStartBoundary, x: 0.1, y: 0.2, z: 0.9 }] }
      const resultStart = validateWebhookPayload(payloadStart)
      expect(resultStart.valid).toBe(true)

      const payloadEnd = { ...validBasePayload, accel: [{ ts_ms: atEndBoundary, x: 0.1, y: 0.2, z: 0.9 }] }
      const resultEnd = validateWebhookPayload(payloadEnd)
      expect(resultEnd.valid).toBe(true)
    })
  })

  describe('HR sample validation', () => {
    it('should reject non-object hr sample', () => {
      const payload = { ...validBasePayload, hr: ['not-an-object'] as unknown[] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('hr[0]: must be an object')
    })

    it('should reject missing ts_ms in hr', () => {
      const payload = { ...validBasePayload, hr: [{ hr: 60 }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('hr[0]: ts_ms must be a finite number')
    })

    it('should reject missing hr in hr sample', () => {
      const payload = { ...validBasePayload, hr: [{ ts_ms: 1705334400000 }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('hr[0]: hr must be a finite number')
    })

    it('should reject hr below 30 bpm', () => {
      const payload = { ...validBasePayload, hr: [{ ts_ms: 1705334400000, hr: 29 }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('hr[0]: hr (29) out of valid range [30, 250] bpm')
    })

    it('should reject hr above 250 bpm', () => {
      const payload = { ...validBasePayload, hr: [{ ts_ms: 1705334400000, hr: 251 }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('hr[0]: hr (251) out of valid range [30, 250] bpm')
    })

    it('should accept hr at boundaries (30 and 250 bpm)', () => {
      const payload1 = { ...validBasePayload, hr: [{ ts_ms: 1705334400000, hr: 30 }] }
      const result1 = validateWebhookPayload(payload1)
      expect(result1.valid).toBe(true)

      const payload2 = { ...validBasePayload, hr: [{ ts_ms: 1705334400000, hr: 250 }] }
      const result2 = validateWebhookPayload(payload2)
      expect(result2.valid).toBe(true)
    })

    it('should reject hr ts_ms outside in_bed window ±2h', () => {
      const tooEarly = 1705334400 * 1000 - TIMESTAMP_TOLERANCE_MS - 1
      const payload = { ...validBasePayload, hr: [{ ts_ms: tooEarly, hr: 60 }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('outside in_bed window'))).toBe(true)
    })
  })

  describe('RR series validation', () => {
    it('should reject non-object rr sample', () => {
      const payload = { ...validBasePayload, rr: ['not-an-object'] as unknown[] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('rr[0]: must be an object')
    })

    it('should reject missing rr_ms in rr sample', () => {
      const payload = { ...validBasePayload, rr: [{ ts_ms: 1705334400000 }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('rr[0]: rr_ms must be a non-empty array')
    })

    it('should reject empty rr_ms array', () => {
      const payload = { ...validBasePayload, rr: [{ ts_ms: 1705334400000, rr_ms: [] }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('rr[0]: rr_ms must be a non-empty array')
    })

    it('should reject non-finite rr interval', () => {
      const payload = { ...validBasePayload, rr: [{ ts_ms: 1705334400000, rr_ms: [800, NaN] }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('rr[0].rr_ms[1]: must be a finite number')
    })

    it('should reject rr interval below 300 ms', () => {
      const payload = { ...validBasePayload, rr: [{ ts_ms: 1705334400000, rr_ms: [299] }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('rr[0].rr_ms[0]: rr interval (299) out of valid range [300, 2000] ms')
    })

    it('should reject rr interval above 2000 ms', () => {
      const payload = { ...validBasePayload, rr: [{ ts_ms: 1705334400000, rr_ms: [2001] }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('rr[0].rr_ms[0]: rr interval (2001) out of valid range [300, 2000] ms')
    })

    it('should accept rr interval at boundaries (300 and 2000 ms)', () => {
      const payload1 = { ...validBasePayload, rr: [{ ts_ms: 1705334400000, rr_ms: [300] }] }
      const result1 = validateWebhookPayload(payload1)
      expect(result1.valid).toBe(true)

      const payload2 = { ...validBasePayload, rr: [{ ts_ms: 1705334400000, rr_ms: [2000] }] }
      const result2 = validateWebhookPayload(payload2)
      expect(result2.valid).toBe(true)
    })

    it('should validate ts_ms as number in rr series', () => {
      const payload = { ...validBasePayload, rr: [{ ts_ms: 'invalid', rr_ms: [800] }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("rr[0]: ts_ms must be a number or number[]")
    })

    it('should validate ts_ms as number[] in rr series', () => {
      const payload = { ...validBasePayload, rr: [{ ts_ms: [1705334400000, 'invalid'], rr_ms: [800, 810] }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain("rr[0].ts_ms[1]: must be a finite number")
    })

    it('should reject rr ts_ms outside in_bed window ±2h', () => {
      const tooEarly = 1705334400 * 1000 - TIMESTAMP_TOLERANCE_MS - 1
      const payload = { ...validBasePayload, rr: [{ ts_ms: tooEarly, rr_ms: [800] }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('outside in_bed window'))).toBe(true)
    })

    it('should reject rr ts_ms array elements outside in_bed window ±2h', () => {
      const tooEarly = 1705334400 * 1000 - TIMESTAMP_TOLERANCE_MS - 1
      const payload = { ...validBasePayload, rr: [{ ts_ms: [tooEarly, 1705334400000], rr_ms: [800, 810] }] }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('outside in_bed window'))).toBe(true)
    })
  })

  describe('parseWebhookPayloadWithValidation integration', () => {
    it('should throw on validation failure', () => {
      const payload = { ...validBasePayload, hr: [{ ts_ms: 1705334400000, hr: 251 }] }
      expect(() => parseWebhookPayloadWithValidation(payload)).toThrow('Payload validation failed')
      expect(() => parseWebhookPayloadWithValidation(payload)).toThrow('hr (251) out of valid range')
    })

    it('should return valid RawSleepData on success', () => {
      const result = parseWebhookPayloadWithValidation(validBasePayload)
      expect(result.user_id).toBe('test-user-123')
      expect(result.log_date).toBe('2024-01-15')
      expect(result.accel).toHaveLength(1)
      expect(result.hr).toHaveLength(1)
      expect(result.rr).toHaveLength(1)
      expect(result.config.epoch_sec).toBe(30)
    })

    it('should collect multiple validation errors', () => {
      const payload: WebhookPayload = {
        user_id: '',
        log_date: '',
        in_bed_start_s: NaN,
        in_bed_end_s: NaN,
        config: { epoch_sec: 5 },
        accel: [{ ts_ms: NaN, x: NaN, y: NaN, z: NaN }],
        hr: [{ ts_ms: NaN, hr: 251 }],
        rr: [{ ts_ms: NaN, rr_ms: [299] }],
      }
      const result = validateWebhookPayload(payload)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(5)
    })
  })
})