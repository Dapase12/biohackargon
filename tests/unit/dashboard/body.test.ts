import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderBody } from '../../../src/components/dashboard/body.ts'

describe('Dashboard - Body Composition Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = `
      <div id="weight-trend"></div>
      <div id="ffm-label"></div>
      <div id="bf-trend"></div>
      <div id="fat-kg-label"></div>
      <div id="metric-muscle"></div>
      <div id="muscle-mass-sub"></div>
      <div id="metric-visceral"></div>
      <div id="metric-water"></div>
      <div id="water-prot-sub"></div>
      <div id="metric-tmb"></div>
      <div id="tmb-sub"></div>
    `
  })

  it('should display weight with 2 decimal places', () => {
    renderBody({ weight_kg: 75.5 })

    const weight = document.getElementById('weight-trend')
    expect(weight.textContent).toBe('75.50 kg')
  })

  it('should display FFM and trend weight', () => {
    renderBody({ ffm_kg: 60, trend_weight_kg: 74.8 })

    const ffm = document.getElementById('ffm-label')
    expect(ffm.textContent).toBe('Sin grasa: 60kg | EWMA: 74.8')
  })

  it('should display body fat percentage with 1 decimal', () => {
    renderBody({ body_fat_pct: 18.5 })

    const bf = document.getElementById('bf-trend')
    expect(bf.textContent).toBe('18.5%')
  })

  it('should display fat mass and BMI', () => {
    renderBody({ fat_mass_kg: 15.5, bmi: 24.3 })

    const fat = document.getElementById('fat-kg-label')
    expect(fat.textContent).toBe('Grasa: 15.5 kg | IMC: 24.3')
  })

  it('should display skeletal muscle percentage', () => {
    renderBody({ skeletal_muscle_pct: 42.1 })

    const muscle = document.getElementById('metric-muscle')
    expect(muscle.textContent).toBe('42.1%')
  })

  it('should display muscle mass in sub label', () => {
    renderBody({ muscle_mass_kg: 32 })

    const sub = document.getElementById('muscle-mass-sub')
    expect(sub.textContent).toBe('Muscular: 32 kg')
  })

  it('should display visceral fat index', () => {
    renderBody({ visceral_fat_index: 8 })

    const visceral = document.getElementById('metric-visceral')
    expect(visceral.textContent).toBe('8')
  })

  it('should display body water percentage', () => {
    renderBody({ body_water_pct: 58.3 })

    const water = document.getElementById('metric-water')
    expect(water.textContent).toBe('58.3%')
  })

  it('should display water mass in sub label', () => {
    renderBody({ water_mass_kg: 44 })

    const sub = document.getElementById('water-prot-sub')
    expect(sub.textContent).toBe('44 kg')
  })

  it('should display TMB', () => {
    renderBody({ tmb_kcal: 1750 })

    const tmb = document.getElementById('metric-tmb')
    expect(tmb.textContent).toBe('1750 kcal')
  })

  it('should display bone mass in sub label', () => {
    renderBody({ bone_mass_kg: 3.2 })

    const sub = document.getElementById('tmb-sub')
    expect(sub.textContent).toBe('Ósea: 3.2kg')
  })

  it('should handle missing elements gracefully', () => {
    document.body.innerHTML = ''
    expect(() => renderBody({ weight_kg: 75 })).not.toThrow()
  })

  it('should handle missing values with defaults', () => {
    renderBody({})

    const weight = document.getElementById('weight-trend')
    expect(weight.textContent).toBe('-- kg')
  })
})