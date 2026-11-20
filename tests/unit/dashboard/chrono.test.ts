import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderChrono } from '../../../src/components/dashboard/chrono.ts'

describe('Dashboard - Chronological Age Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('should render chronological age with default value when not provided', () => {
    const container = document.createElement('div')
    container.id = 'chrono-age-label'
    document.body.appendChild(container)

    renderChrono({})

    expect(container.textContent).toBe('Edad Cronológica: 28.9a')
  })

  it('should render chronological age from record', () => {
    const container = document.createElement('div')
    container.id = 'chrono-age-label'
    document.body.appendChild(container)

    renderChrono({ chronological_age: 35.5 })

    expect(container.textContent).toBe('Edad Cronológica: 35.5a')
  })

  it('should handle null chronological_age', () => {
    const container = document.createElement('div')
    container.id = 'chrono-age-label'
    document.body.appendChild(container)

    renderChrono({ chronological_age: null })

    expect(container.textContent).toBe('Edad Cronológica: 28.9a')
  })

  it('should handle missing element gracefully', () => {
    // No element in DOM
    expect(() => renderChrono({ chronological_age: 30 })).not.toThrow()
  })

  it('should format age to one decimal place', () => {
    const container = document.createElement('div')
    container.id = 'chrono-age-label'
    document.body.appendChild(container)

    renderChrono({ chronological_age: 42.12345 })

    expect(container.textContent).toBe('Edad Cronológica: 42.1a')
  })
})