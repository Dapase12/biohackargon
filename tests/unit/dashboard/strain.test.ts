import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderStrain } from '../../../src/components/dashboard/strain.ts'

describe('Dashboard - Strain Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = `
      <div id="ring-strain"></div>
      <div id="val-strain"></div>
      <div id="badge-strain-target"></div>
      <div id="sub-strain"></div>
    `
  })

  it('should render strain ring with correct strokeDashoffset for 0', () => {
    renderStrain({ strain_score: 0 })

    const ring = document.getElementById('ring-strain') as SVGCircleElement
    expect(ring.style.strokeDashoffset).toBe('251.2')
  })

  it('should render strain ring with correct strokeDashoffset for 10.5', () => {
    renderStrain({ strain_score: 10.5 })

    const ring = document.getElementById('ring-strain') as SVGCircleElement
    // CIRC = 251.2, max strain = 21
    // offset = 251.2 - (10.5/21)*251.2 = 251.2 - 125.6 = 125.6
    expect(ring.style.strokeDashoffset).toBe('125.6')
  })

  it('should cap strain at 21 for ring calculation', () => {
    renderStrain({ strain_score: 30 })

    const ring = document.getElementById('ring-strain') as SVGCircleElement
    // 30 is capped to 21, so offset should be 0
    expect(ring.style.strokeDashoffset).toBe('0')
  })

  it('should display formatted strain score', () => {
    renderStrain({ strain_score: 12.3 })

    const val = document.getElementById('val-strain')
    expect(val.textContent).toBe('12.3')
  })

  it('should set red color when strain exceeds recommended max', () => {
    renderStrain({ strain_score: 22, recommended_max_strain: 21 })

    const ring = document.getElementById('ring-strain') as SVGCircleElement
    expect(ring.style.stroke).toBe('#EF4444')
  })

  it('should set yellow color when strain >= 80% of recommended max', () => {
    renderStrain({ strain_score: 18, recommended_max_strain: 21 })

    const ring = document.getElementById('ring-strain') as SVGCircleElement
    // 18 >= 21 * 0.8 = 16.8
    expect(ring.style.stroke).toBe('#F59E0B')
  })

  it('should set cyan color when strain < 80% of recommended max', () => {
    renderStrain({ strain_score: 10, recommended_max_strain: 21 })

    const ring = document.getElementById('ring-strain') as SVGCircleElement
    // 10 < 16.8
    expect(ring.style.stroke).toBe('#06B6D4')
  })

  it('should display recommended max strain in badge', () => {
    renderStrain({ recommended_max_strain: 18 })

    const badge = document.getElementById('badge-strain-target')
    expect(badge.textContent).toBe('Meta: 18')
  })

  it('should display formatted steps count', () => {
    renderStrain({ steps_count: 12345 })

    const sub = document.getElementById('sub-strain')
    // Spanish locale uses . as thousands separator
    expect(sub.textContent).toBe('12.345 pasos')
  })

  it('should handle missing elements gracefully', () => {
    document.body.innerHTML = ''
    expect(() => renderStrain({ strain_score: 10 })).not.toThrow()
  })

  it('should default strain_score to 0 when not provided', () => {
    renderStrain({})

    const ring = document.getElementById('ring-strain') as SVGCircleElement
    expect(ring.style.strokeDashoffset).toBe('251.2')
  })

  it('should default recommended_max_strain to 21 when not provided', () => {
    renderStrain({ strain_score: 10 })

    const badge = document.getElementById('badge-strain-target')
    expect(badge.textContent).toBe('Meta: 21')
  })
})