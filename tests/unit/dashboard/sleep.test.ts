import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderSleep } from '../../../src/components/dashboard/sleep.ts'

describe('Dashboard - Sleep Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = `
      <div id="ring-sleep"></div>
      <div id="val-sleep"></div>
      <div id="badge-sleep-eff"></div>
      <div id="sub-sleep"></div>
    `
  })

  it('should render sleep ring with correct strokeDashoffset for 100%', () => {
    renderSleep({ sleep_architecture_score: 100 })

    const ring = document.getElementById('ring-sleep') as SVGCircleElement
    expect(ring.style.strokeDashoffset).toBe('0')
  })

  it('should render sleep ring with correct strokeDashoffset for 50%', () => {
    renderSleep({ sleep_architecture_score: 50 })

    const ring = document.getElementById('ring-sleep') as SVGCircleElement
    // CIRC = 251.2, 50% -> 251.2 - (50/100)*251.2 = 125.6
    expect(ring.style.strokeDashoffset).toBe('125.6')
  })

  it('should display sleep percentage when not missing', () => {
    renderSleep({ sleep_architecture_score: 85, sleep_missing: false })

    const val = document.getElementById('val-sleep')
    expect(val.textContent).toBe('85%')
  })

  it('should display -- when sleep_missing is true', () => {
    renderSleep({ sleep_architecture_score: 85, sleep_missing: true })

    const val = document.getElementById('val-sleep')
    expect(val.textContent).toBe('--')
  })

  it('should display sleep efficiency in badge', () => {
    renderSleep({ sleep_efficiency_pct: 92 })

    const badge = document.getElementById('badge-sleep-eff')
    expect(badge.textContent).toBe('Efic: 92%')
  })

  it('should round sleep efficiency', () => {
    renderSleep({ sleep_efficiency_pct: 92.7 })

    const badge = document.getElementById('badge-sleep-eff')
    expect(badge.textContent).toBe('Efic: 93%')
  })

  it('should display cumulative sleep debt in sub-sleep', () => {
    renderSleep({ cumulative_sleep_debt_hours: 1.5 })

    const sub = document.getElementById('sub-sleep')
    expect(sub.textContent).toBe('Deuda: 1.5h')
  })

  it('should handle missing elements gracefully', () => {
    document.body.innerHTML = ''
    expect(() => renderSleep({ sleep_architecture_score: 85 })).not.toThrow()
  })

  it('should default sleep_architecture_score to 0 when not provided', () => {
    renderSleep({})

    const ring = document.getElementById('ring-sleep') as SVGCircleElement
    expect(ring.style.strokeDashoffset).toBe('251.2')
  })
})