import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderClinical } from '../../../src/components/dashboard/clinical.ts'

describe('Dashboard - Clinical Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = `
      <div id="clinical-coach-notes"></div>
    `
  })

  it('should display clinical coach notes from record', () => {
    renderClinical({ clinical_coach_notes: 'Buena recuperación, mantener intensidad' })

    const notes = document.getElementById('clinical-coach-notes')
    expect(notes.textContent).toBe('Buena recuperación, mantener intensidad')
  })

  it('should display default text when clinical_coach_notes is missing', () => {
    renderClinical({})

    const notes = document.getElementById('clinical-coach-notes')
    expect(notes.textContent).toBe('Sin datos')
  })

  it('should display default text when clinical_coach_notes is null', () => {
    renderClinical({ clinical_coach_notes: null })

    const notes = document.getElementById('clinical-coach-notes')
    expect(notes.textContent).toBe('Sin datos')
  })

  it('should handle missing elements gracefully', () => {
    document.body.innerHTML = ''
    expect(() => renderClinical({ clinical_coach_notes: 'Test' })).not.toThrow()
  })

  it('should handle empty string clinical_coach_notes', () => {
    renderClinical({ clinical_coach_notes: '' })

    const notes = document.getElementById('clinical-coach-notes')
    expect(notes.textContent).toBe('')
  })
})