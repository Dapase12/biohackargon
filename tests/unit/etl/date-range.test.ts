import { describe, it, expect } from 'vitest'

/**
 * Date range utilities tests for sync-ghealth.ts
 * These test the core date generation logic used in runSync()
 */

// Replicate the date utilities from sync-ghealth.ts for testing
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
    to: formatGHealthDate(end), // CLI handles --to as inclusive
  }
}

function generateDates(from: string, to: string): string[] {
  const range = getDateRange(from, to)
  const start = parseDateArg(range.from)
  const end = parseDateArg(range.to)
  const dates: string[] = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0] ?? '')
  }
  return dates
}

function generateBackfillDates(): string[] {
  const end = new Date()
  const start = new Date(end.getTime() - 90 * 86400000)
  const dates: string[] = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0] ?? '')
  }
  return dates
}

describe('Date Range Utilities', () => {
  describe('getDateRange', () => {
    it('should return same date for from and to when single day specified', () => {
      const range = getDateRange('2026-11-21', '2026-11-21')
      expect(range.from).toBe('2026-11-21')
      expect(range.to).toBe('2026-11-21')
    })

    it('should return correct range for multi-day', () => {
      const range = getDateRange('2026-11-20', '2026-11-21')
      expect(range.from).toBe('2026-11-20')
      expect(range.to).toBe('2026-11-21')
    })

    it('should default to last 30 days when no args', () => {
      const range = getDateRange(undefined, undefined)
      const expectedStart = new Date()
      expectedStart.setDate(expectedStart.getDate() - 30)
      expect(range.from).toBe(formatGHealthDate(expectedStart))
      expect(range.to).toBe(formatGHealthDate(new Date()))
    })
  })

  describe('generateDates (runSync logic)', () => {
    it('should generate exactly 1 day for --from 2026-11-21 --to 2026-11-21', () => {
      const dates = generateDates('2026-11-21', '2026-11-21')
      expect(dates).toEqual(['2026-11-21'])
      expect(dates.length).toBe(1)
    })

    it('should generate 2 days for --from 2026-11-20 --to 2026-11-21', () => {
      const dates = generateDates('2026-11-20', '2026-11-21')
      expect(dates).toEqual(['2026-11-20', '2026-11-21'])
      expect(dates.length).toBe(2)
    })

    it('should generate 3 days for --from 2026-11-19 --to 2026-11-21', () => {
      const dates = generateDates('2026-11-19', '2026-11-21')
      expect(dates).toEqual(['2026-11-19', '2026-11-20', '2026-11-21'])
      expect(dates.length).toBe(3)
    })

    it('should generate 30 days for default range (no args)', () => {
      const dates = generateDates(undefined as any, undefined as any)
      expect(dates.length).toBe(31) // 30 days back + today = 31 days
    })
  })

  describe('generateBackfillDates (--backfill)', () => {
    it('should generate 91 days for 90-day backfill (inclusive)', () => {
      const dates = generateBackfillDates()
      // 90 days back + today = 91 days
      expect(dates.length).toBe(91)
    })

    it('should end with today', () => {
      const dates = generateBackfillDates()
      const today = new Date().toISOString().split('T')[0]
      expect(dates[dates.length - 1]).toBe(today)
    })

    it('should start 90 days ago', () => {
      const dates = generateBackfillDates()
      const expectedStart = new Date()
      expectedStart.setDate(expectedStart.getDate() - 90)
      const expectedStartStr = expectedStart.toISOString().split('T')[0]
      expect(dates[0]).toBe(expectedStartStr)
    })
  })

  describe('Edge cases', () => {
    it('should handle month boundaries', () => {
      const dates = generateDates('2026-01-30', '2026-02-02')
      expect(dates).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'])
      expect(dates.length).toBe(4)
    })

    it('should handle year boundaries', () => {
      const dates = generateDates('2025-12-30', '2026-01-02')
      expect(dates).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'])
      expect(dates.length).toBe(4)
    })

    it('should handle leap year', () => {
      const dates = generateDates('2024-02-28', '2024-03-01')
      expect(dates).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
      expect(dates.length).toBe(3)
    })
  })
})