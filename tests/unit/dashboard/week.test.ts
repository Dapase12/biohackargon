import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWeek } from '../../../src/components/dashboard/week.ts'

describe('Dashboard - Week Strip Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = `
      <div id="week-strip"></div>
    `
  })

  it('should render 7 days of recovery scores', () => {
    const allRecords = [
      { log_date: '2025-01-01', recovery_score: 80 },
      { log_date: '2025-01-02', recovery_score: 75 },
      { log_date: '2025-01-03', recovery_score: 70 },
      { log_date: '2025-01-04', recovery_score: 65 },
      { log_date: '2025-01-05', recovery_score: 60 },
      { log_date: '2025-01-06', recovery_score: 55 },
      { log_date: '2025-01-07', recovery_score: 50 },
    ]

    renderWeek({ log_date: '2025-01-07' }, allRecords)

    const strip = document.getElementById('week-strip')
    expect(strip.innerHTML).toContain('80')
    expect(strip.innerHTML).toContain('50')
    expect(strip.children.length).toBe(7)
  })

  it('should show green color for recovery >= 67', () => {
    const allRecords = [
      { log_date: '2025-01-01', recovery_score: 80 },
    ]

    renderWeek({ log_date: '2025-01-01' }, allRecords)

    const strip = document.getElementById('week-strip')
    expect(strip.innerHTML).toContain('#10B981')
  })

  it('should show yellow color for recovery 34-66', () => {
    const allRecords = [
      { log_date: '2025-01-01', recovery_score: 50 },
    ]

    renderWeek({ log_date: '2025-01-01' }, allRecords)

    const strip = document.getElementById('week-strip')
    expect(strip.innerHTML).toContain('#F59E0B')
  })

  it('should show red color for recovery < 34', () => {
    const allRecords = [
      { log_date: '2025-01-01', recovery_score: 20 },
    ]

    renderWeek({ log_date: '2025-01-01' }, allRecords)

    const strip = document.getElementById('week-strip')
    expect(strip.innerHTML).toContain('#EF4444')
  })

  it('should highlight current day', () => {
    const allRecords = [
      { log_date: '2025-01-01', recovery_score: 80 },
      { log_date: '2025-01-02', recovery_score: 75 },
    ]

    renderWeek({ log_date: '2025-01-02' }, allRecords)

    const strip = document.getElementById('week-strip')
    expect(strip.innerHTML).toContain('text-cyan-300 font-bold')
  })

  it('should show day labels (D, L, M, M, J, V, S)', () => {
    const allRecords = [
      { log_date: '2025-01-01', recovery_score: 80 }, // Wednesday
      { log_date: '2025-01-02', recovery_score: 75 }, // Thursday
      { log_date: '2025-01-03', recovery_score: 70 }, // Friday
      { log_date: '2025-01-04', recovery_score: 65 }, // Saturday
      { log_date: '2025-01-05', recovery_score: 60 }, // Sunday
      { log_date: '2025-01-06', recovery_score: 55 }, // Monday
      { log_date: '2025-01-07', recovery_score: 50 }, // Tuesday
    ]

    renderWeek({ log_date: '2025-01-07' }, allRecords)

    const strip = document.getElementById('week-strip')
    expect(strip.innerHTML).toContain('M') // Miércoles
    expect(strip.innerHTML).toContain('J') // Jueves
    expect(strip.innerHTML).toContain('V') // Viernes
    expect(strip.innerHTML).toContain('S') // Sábado
    expect(strip.innerHTML).toContain('D') // Domingo
    expect(strip.innerHTML).toContain('L') // Lunes
    expect(strip.innerHTML).toContain('M') // Martes
  })

  it('should only show last 7 days when more records exist', () => {
    const allRecords = Array.from({ length: 10 }, (_, i) => ({
      log_date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      recovery_score: 50 + i,
    }))

    renderWeek({ log_date: '2025-01-10' }, allRecords)

    const strip = document.getElementById('week-strip')
    expect(strip.children.length).toBe(7)
  })

  it('should filter records up to current date', () => {
    const allRecords = [
      { log_date: '2025-01-01', recovery_score: 80 },
      { log_date: '2025-01-02', recovery_score: 75 },
      { log_date: '2025-01-03', recovery_score: 70 }, // future date
    ]

    renderWeek({ log_date: '2025-01-02' }, allRecords)

    const strip = document.getElementById('week-strip')
    expect(strip.children.length).toBe(2)
  })

  it('should handle missing elements gracefully', () => {
    document.body.innerHTML = ''
    expect(() => renderWeek({ log_date: '2025-01-01' }, [])).not.toThrow()
  })

  it('should handle empty records array', () => {
    renderWeek({ log_date: '2025-01-01' }, [])

    const strip = document.getElementById('week-strip')
    expect(strip.innerHTML).toBe('')
  })
})