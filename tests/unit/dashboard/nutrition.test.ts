import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderNutrition } from '../../../src/components/dashboard/nutrition.ts'

describe('Dashboard - Nutrition Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = `
      <div id="remaining-kcal-pill"></div>
      <div id="nutri-tdee"></div>
      <div id="nutri-deficit"></div>
      <div id="fat-loss-rate"></div>
      <div id="nutri-target-kcal"></div>
      <div id="nutri-intake-kcal"></div>
      <div id="nutri-tef"></div>
      <div id="nutri-emp-sub"></div>
      <div id="macro-prot-text"></div>
      <div id="macro-carb-text"></div>
      <div id="macro-fat-text"></div>
      <div id="bar-prot" style="width: 0%"></div>
      <div id="bar-carb" style="width: 0%"></div>
      <div id="bar-fat" style="width: 0%"></div>
      <div id="protein-alert" class="hidden"></div>
    `
  })

  it('should display remaining kcal', () => {
    renderNutrition({ intake_kcal: 1500, target_kcal: 2000 })

    const pill = document.getElementById('remaining-kcal-pill')
    expect(pill.textContent).toBe('Restan: 500 kcal')
  })

  it('should display dynamic TDEE', () => {
    renderNutrition({ dynamic_tdee_kcal: 2500 })

    const tdee = document.getElementById('nutri-tdee')
    expect(tdee.textContent).toBe('2500 kcal')
  })

  it('should display deficit', () => {
    renderNutrition({ dynamic_tdee_kcal: 2500, target_kcal: 2000 })

    const deficit = document.getElementById('nutri-deficit')
    // deficit = max(250, 2500 - 2000) = 500
    expect(deficit.textContent).toBe('-500 kcal')
  })

  it('should display minimum deficit of 250', () => {
    renderNutrition({ dynamic_tdee_kcal: 2100, target_kcal: 2000 })

    const deficit = document.getElementById('nutri-deficit')
    // 2100 - 2000 = 100, but min is 250
    expect(deficit.textContent).toBe('-250 kcal')
  })

  it('should display weekly fat loss rate', () => {
    renderNutrition({ dynamic_tdee_kcal: 2500, target_kcal: 2000 })

    const fatLoss = document.getElementById('fat-loss-rate')
    // deficit = 500, weekly = 500*7/7700 = 0.45 kg
    expect(fatLoss.textContent).toBe('-0.45 kg/sem')
  })

  it('should display target kcal', () => {
    renderNutrition({ target_kcal: 2200 })

    const target = document.getElementById('nutri-target-kcal')
    expect(target.textContent).toBe('2200 kcal')
  })

  it('should display intake kcal', () => {
    renderNutrition({ intake_kcal: 1800 })

    const intake = document.getElementById('nutri-intake-kcal')
    expect(intake.textContent).toBe('Comido: 1800')
  })

  it('should display TEF', () => {
    renderNutrition({ tef_kcal: 200 })

    const tef = document.getElementById('nutri-tef')
    expect(tef.textContent).toBe('200 kcal')
  })

  it('should display empirical TDEE when available', () => {
    renderNutrition({ empirical_tdee_kcal: 2450 })

    const emp = document.getElementById('nutri-emp-sub')
    expect(emp.textContent).toBe('Empírico 14d: 2450')
  })

  it('should display default empirical text when not available', () => {
    renderNutrition({})

    const emp = document.getElementById('nutri-emp-sub')
    expect(emp.textContent).toBe('TMB+Pasos+Ej')
  })

  it('should display protein macro with target', () => {
    renderNutrition({ intake_protein_g: 120, target_protein_g: 150 })

    const macro = document.getElementById('macro-prot-text')
    expect(macro.textContent).toBe('120 / 150 g')
  })

  it('should display carb macro with target', () => {
    renderNutrition({ intake_carbs_g: 200, target_carbs_g: 250 })

    const macro = document.getElementById('macro-carb-text')
    expect(macro.textContent).toBe('200 / 250 g')
  })

  it('should display fat macro with target', () => {
    renderNutrition({ intake_fat_g: 70, target_fat_g: 80 })

    const macro = document.getElementById('macro-fat-text')
    expect(macro.textContent).toBe('70 / 80 g')
  })

  it('should set protein bar width based on intake/target', () => {
    renderNutrition({ intake_protein_g: 100, target_protein_g: 150 })

    const bar = document.getElementById('bar-prot')
    // 100/150 = 66.67%
    expect(bar.style.width).toBe('66.66666666666666%')
  })

  it('should cap protein bar at 100%', () => {
    renderNutrition({ intake_protein_g: 200, target_protein_g: 150 })

    const bar = document.getElementById('bar-prot')
    expect(bar.style.width).toBe('100%')
  })

  it('should show protein alert when gap >= 10g and kcal left < gap*4', () => {
    // target 150g, intake 100g -> gap 50g, gap*4 = 200 kcal
    // target_kcal 2000, intake 1500 -> remaining 500 kcal
    // 500 < 200 is false, so alert should NOT show
    renderNutrition({
      intake_protein_g: 100,
      target_protein_g: 150,
      intake_kcal: 1500,
      target_kcal: 2000
    })

    const alert = document.getElementById('protein-alert')
    expect(alert.classList.contains('hidden')).toBe(true)
  })

  it('should show protein alert when conditions met', () => {
    // target 150g, intake 100g -> gap 50g, gap*4 = 200 kcal
    // target_kcal 2000, intake 1900 -> remaining 100 kcal
    // 100 < 200 is true, so alert SHOULD show
    renderNutrition({
      intake_protein_g: 100,
      target_protein_g: 150,
      intake_kcal: 1900,
      target_kcal: 2000
    })

    const alert = document.getElementById('protein-alert')
    expect(alert.classList.contains('hidden')).toBe(false)
    expect(alert.textContent).toContain('Faltan 50 g de proteína')
    expect(alert.textContent).toContain('~200 kcal')
    expect(alert.textContent).toContain('quedan 100 kcal')
  })

  it('should hide protein alert when gap < 10g', () => {
    renderNutrition({
      intake_protein_g: 145,
      target_protein_g: 150,
      intake_kcal: 1900,
      target_kcal: 2000
    })

    const alert = document.getElementById('protein-alert')
    expect(alert.classList.contains('hidden')).toBe(true)
  })

  it('should handle missing elements gracefully', () => {
    document.body.innerHTML = ''
    expect(() => renderNutrition({ intake_kcal: 1500 })).not.toThrow()
  })

  it('should default values when not provided', () => {
    renderNutrition({})

    expect(document.getElementById('nutri-tdee').textContent).toBe('2400 kcal')
    expect(document.getElementById('nutri-target-kcal').textContent).toBe('2000 kcal')
  })
})