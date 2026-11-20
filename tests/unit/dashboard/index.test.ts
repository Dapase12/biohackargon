import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderDashboard } from '../../../src/components/dashboard/index.ts'

describe('Dashboard - Main Entry Point (renderDashboard)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = `
      <div id="chrono-age-label"></div>
      <div id="ring-recovery"></div>
      <div id="val-recovery"></div>
      <div id="badge-recovery"></div>
      <div id="sub-recovery"></div>
      <div id="ring-strain"></div>
      <div id="val-strain"></div>
      <div id="badge-strain-target"></div>
      <div id="sub-strain"></div>
      <div id="ring-sleep"></div>
      <div id="val-sleep"></div>
      <div id="badge-sleep-eff"></div>
      <div id="sub-sleep"></div>
      <div id="clinical-coach-notes"></div>
      <div id="week-strip"></div>
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

  it('should call all sub-component render functions', () => {
    const record = {
      chronological_age: 30,
      recovery_score: 80,
      strain_score: 12.5,
      sleep_architecture_score: 85,
      sleep_efficiency_pct: 92,
      cumulative_sleep_debt_hours: 0.5,
      clinical_coach_notes: 'Bien',
      weight_kg: 75,
      body_fat_pct: 18,
      intake_kcal: 1800,
      target_kcal: 2200,
      dynamic_tdee_kcal: 2500,
      log_date: '2025-01-02',
    }
    const allRecords = [
      { log_date: '2025-01-01', recovery_score: 75 },
      { log_date: '2025-01-02', recovery_score: 80 },
    ]

    expect(() => renderDashboard(record, allRecords)).not.toThrow()

    // Verify chronological age rendered
    expect(document.getElementById('chrono-age-label').textContent).toBe('Edad Cronológica: 30.0a')

    // Verify recovery rendered
    expect(document.getElementById('val-recovery').textContent).toBe('80%')
    expect(document.getElementById('badge-recovery').textContent).toBe('ÓPTIMO')

    // Verify strain rendered
    expect(document.getElementById('val-strain').textContent).toBe('12.5')

    // Verify sleep rendered
    expect(document.getElementById('val-sleep').textContent).toBe('85%')

    // Verify clinical rendered
    expect(document.getElementById('clinical-coach-notes').textContent).toBe('Bien')

    // Verify week strip rendered (2 records)
    expect(document.getElementById('week-strip').children.length).toBe(2)

    // Verify body rendered
    expect(document.getElementById('weight-trend').textContent).toBe('75.00 kg')
    expect(document.getElementById('bf-trend').textContent).toBe('18.0%')

    // Verify nutrition rendered
    expect(document.getElementById('nutri-tdee').textContent).toBe('2500 kcal')
    expect(document.getElementById('nutri-target-kcal').textContent).toBe('2200 kcal')
  })

  it('should handle missing record gracefully', () => {
    expect(() => renderDashboard({}, [])).not.toThrow()
  })

  it('should handle missing allRecords gracefully', () => {
    expect(() => renderDashboard({ recovery_score: 50 }, undefined)).not.toThrow()
  })

  it('should compose all sub-components without errors', () => {
    const record = {
      chronological_age: 28,
      recovery_score: 65,
      strain_score: 15,
      sleep_architecture_score: 78,
      sleep_efficiency_pct: 88,
      cumulative_sleep_debt_hours: 1.2,
      clinical_coach_notes: 'Recuperación moderada',
      weight_kg: 80,
      body_fat_pct: 22,
      intake_kcal: 2000,
      target_kcal: 2400,
      dynamic_tdee_kcal: 2800,
      intake_protein_g: 130,
      target_protein_g: 160,
      intake_carbs_g: 220,
      target_carbs_g: 280,
      intake_fat_g: 80,
      target_fat_g: 90,
      log_date: '2025-01-07',
    }
    const allRecords = Array.from({ length: 7 }, (_, i) => ({
      log_date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      recovery_score: 50 + i * 3,
    }))

    expect(() => renderDashboard(record, allRecords)).not.toThrow()

    // All elements should have content
    expect(document.getElementById('chrono-age-label').textContent).toContain('Edad Cronológica')
    expect(document.getElementById('val-recovery').textContent).toBe('65%')
    expect(document.getElementById('val-strain').textContent).toBe('15.0')
    expect(document.getElementById('val-sleep').textContent).toBe('78%')
    expect(document.getElementById('clinical-coach-notes').textContent).toBe('Recuperación moderada')
    expect(document.getElementById('week-strip').children.length).toBe(7)
    expect(document.getElementById('weight-trend').textContent).toBe('80.00 kg')
    expect(document.getElementById('nutri-tdee').textContent).toBe('2800 kcal')
  })
})