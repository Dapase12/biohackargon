import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderRecovery } from '../../../src/components/dashboard/recovery.ts'

describe('Dashboard - Recovery Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = `
      <div id="ring-recovery"></div>
      <div id="val-recovery"></div>
      <div id="badge-recovery"></div>
      <div id="sub-recovery"></div>
    `
  })

  it('should render recovery ring with correct strokeDashoffset for 100%', () => {
    renderRecovery({ recovery_score: 100 })

    const ring = document.getElementById('ring-recovery') as SVGCircleElement
    expect(ring.style.strokeDashoffset).toBe('0')
  })

  it('should render recovery ring with correct strokeDashoffset for 50%', () => {
    renderRecovery({ recovery_score: 50 })

    const ring = document.getElementById('ring-recovery') as SVGCircleElement
    // CIRC = 251.2, 50% -> 251.2 - (50/100)*251.2 = 125.6
    expect(ring.style.strokeDashoffset).toBe('125.6')
  })

  it('should set green color for recovery >= 67', () => {
    renderRecovery({ recovery_score: 80 })

    const ring = document.getElementById('ring-recovery') as SVGCircleElement
    expect(ring.style.stroke).toBe('#10B981')
  })

  it('should set yellow color for recovery 34-66', () => {
    renderRecovery({ recovery_score: 50 })

    const ring = document.getElementById('ring-recovery') as SVGCircleElement
    expect(ring.style.stroke).toBe('#F59E0B')
  })

  it('should set red color for recovery < 34', () => {
    renderRecovery({ recovery_score: 20 })

    const ring = document.getElementById('ring-recovery') as SVGCircleElement
    expect(ring.style.stroke).toBe('#EF4444')
  })

  it('should display recovery percentage in val-recovery', () => {
    renderRecovery({ recovery_score: 75 })

    const val = document.getElementById('val-recovery')
    expect(val.textContent).toBe('75%')
  })

  it('should display --% when recovery_score is null', () => {
    renderRecovery({ recovery_score: null })

    const val = document.getElementById('val-recovery')
    expect(val.textContent).toBe('--%')
  })

  it('should show SIN SUEÑO badge when sleep_missing', () => {
    renderRecovery({ recovery_score: 50, sleep_missing: true })

    const badge = document.getElementById('badge-recovery')
    expect(badge.textContent).toBe('SIN SUEÑO')
  })

  it('should show SIN VFC badge when hrv_missing', () => {
    renderRecovery({ recovery_score: 50, hrv_missing: true })

    const badge = document.getElementById('badge-recovery')
    expect(badge.textContent).toBe('SIN VFC')
  })

  it('should show CALIBRANDO badge when calibrating', () => {
    renderRecovery({ recovery_score: 50, calibrating: true })

    const badge = document.getElementById('badge-recovery')
    expect(badge.textContent).toBe('CALIBRANDO')
  })

  it('should show ÓPTIMO badge for recovery >= 67', () => {
    renderRecovery({ recovery_score: 80 })

    const badge = document.getElementById('badge-recovery')
    expect(badge.textContent).toBe('ÓPTIMO')
  })

  it('should show MODERADO badge for recovery 34-66', () => {
    renderRecovery({ recovery_score: 50 })

    const badge = document.getElementById('badge-recovery')
    expect(badge.textContent).toBe('MODERADO')
  })

  it('should show FATIGA SNC badge for recovery < 34', () => {
    renderRecovery({ recovery_score: 20 })

    const badge = document.getElementById('badge-recovery')
    expect(badge.textContent).toBe('FATIGA SNC')
  })

  it('should set badge color to match ring color', () => {
    renderRecovery({ recovery_score: 80 })

    const badge = document.getElementById('badge-recovery')
    // Browser converts hex to rgb()
    expect(badge.style.color).toMatch(/rgb\(16,\s*185,\s*129\)|#10B981/)
  })

  it('should display RMSSD in sub-recovery', () => {
    renderRecovery({ rmssd_ms: 45.5 })

    const sub = document.getElementById('sub-recovery')
    expect(sub.textContent).toBe('VFC: 45.5 ms')
  })

  it('should handle missing elements gracefully', () => {
    document.body.innerHTML = ''
    expect(() => renderRecovery({ recovery_score: 50 })).not.toThrow()
  })
})