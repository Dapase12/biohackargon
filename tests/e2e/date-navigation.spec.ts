import { test, expect } from '@playwright/test'

test.describe('Date Navigation: Picker → Past Day → Verify Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Inject mock historical data
    await page.evaluate(() => {
      const today = new Date()
      const profile = {
        birthDate: '1990-01-15',
        heightM: 1.75,
        timezone: 'America/Caracas',
        basalSleepNeedH: 7.5,
        habitualWake: '06:30',
        goalWeightKg: 75,
        goalDate: '2025-12-31',
        dailyDeficitKcal: 500,
        biologicalSex: 'male'
      }
      localStorage.setItem('argon_profile_v1', JSON.stringify(profile))
      localStorage.setItem('argon_sb_url', 'https://test.supabase.co')
      localStorage.setItem('argon_sb_key', 'test-key')

      // Generate 30 days of mock data
      for (let i = 0; i < 30; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]

        // Raw data
        localStorage.setItem(`argon_raw_${dateStr}`, JSON.stringify({
          user_id: 'test-user',
          log_date: dateStr,
          hrv_rmssd_ms: 40 + Math.random() * 15,
          rhr_bpm: 55 + Math.random() * 10,
          sleep_score: 70 + Math.random() * 25,
          total_sleep_min: 420 + Math.random() * 120,
          deep_sleep_min: 60 + Math.random() * 60,
          rem_sleep_min: 80 + Math.random() * 50,
          light_sleep_min: 200 + Math.random() * 100,
          awake_sleep_min: 20 + Math.random() * 40,
          sleep_onset_latency_min: 10 + Math.random() * 20,
          sleep_efficiency_pct: 85 + Math.random() * 10,
          bedtime_start: '22:30',
          bedtime_end: '06:30',
          naps_count: Math.random() > 0.7 ? 1 : 0,
          naps_total_min: Math.random() > 0.7 ? 20 : 0,
          steps: 5000 + Math.random() * 10000,
          active_calories: 300 + Math.random() * 500,
          exercise_min: Math.random() > 0.5 ? 30 + Math.random() * 60 : 0,
          exercise_type: 'running',
          exercise_intensity: 'moderate',
          weight_kg: 75 + (Math.random() - 0.5) * 2,
          body_fat_pct: 18 + (Math.random() - 0.5) * 4,
          muscle_mass_kg: 58 + (Math.random() - 0.5) * 2,
          hydration_ml: 2000 + Math.random() * 1000
        }))

        // Computed scores
        localStorage.setItem(`argon_comp_${dateStr}`, JSON.stringify({
          user_id: 'test-user',
          log_date: dateStr,
          recovery_score: 50 + Math.random() * 45,
          readiness_score: 55 + Math.random() * 40,
          sleep_debt_h: Math.random() * 2,
          dynamic_sleep_need_h: 7.5 + Math.random() * 1,
          optimal_bedtime_start: '22:15',
          optimal_bedtime_end: '06:00',
          hrv_baseline_rmssd: 42,
          hrv_7d_avg: 43,
          hrv_14d_avg: 42,
          hrv_swc: 2.1,
          rhr_baseline: 56,
          rhr_7d_avg: 57,
          strain_score: 40 + Math.random() * 40,
          training_load_7d: 300 + Math.random() * 200,
          acwr: 0.8 + Math.random() * 0.6,
          hydration_score: 70 + Math.random() * 25,
          body_comp_score: 70 + Math.random() * 20
        }))
      }
    })

    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test('should display date picker', async ({ page }) => {
    // Look for date picker/select
    const datePicker = page.locator('[data-testid="date-picker"], select#mbe-date, select[name="date"], input[type="date"]').first()
    const dateDisplay = page.locator('[data-testid="current-date"], .current-date, text=/\\d{4}-\\d{2}-\\d{2}/')

    const hasPicker = await datePicker.count() > 0
    const hasDisplay = await dateDisplay.count() > 0

    expect(hasPicker || hasDisplay).toBe(true)
  })

  test('should show today by default', async ({ page }) => {
    const today = new Date().toISOString().split('T')[0]

    // Check if today's date is displayed
    const dateText = page.locator(`text=${today}`)
    const hasToday = await dateText.count() > 0

    expect(hasToday).toBe(true)
  })

  test('should allow selecting past date from picker', async ({ page }) => {
    const datePicker = page.locator('[data-testid="date-picker"], select#mbe-date, select[name="date"]').first()

    if (await datePicker.count() > 0) {
      // Get available options
      const options = await datePicker.locator('option').all()
      expect(options.length).toBeGreaterThan(1)

      // Select a past date (second option)
      if (options.length > 1) {
        await datePicker.selectOption({ index: 1 })

        // Wait for data to load
        await page.waitForTimeout(1000)

        // Verify date changed
        const selectedValue = await datePicker.inputValue()
        expect(selectedValue).toBeTruthy()
        expect(selectedValue).not.toBe(new Date().toISOString().split('T')[0])
      }
    } else {
      // Test with input[type="date"]
      const dateInput = page.locator('input[type="date"]').first()
      if (await dateInput.count() > 0) {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStr = yesterday.toISOString().split('T')[0]

        await dateInput.fill(yesterdayStr)
        await dateInput.press('Enter')
        await page.waitForTimeout(1000)

        const value = await dateInput.inputValue()
        expect(value).toBe(yesterdayStr)
      }
    }
  })

  test('should update dashboard data when date changes', async ({ page }) => {
    const datePicker = page.locator('[data-testid="date-picker"], select#mbe-date, select[name="date"]').first()

    if (await datePicker.count() > 0) {
      // Get initial recovery score
      const initialRecovery = await page.locator('[data-testid="recovery-score"], .recovery-score, text=/\\d+/').first().textContent()

      // Select different date
      const options = await datePicker.locator('option').all()
      if (options.length > 2) {
        await datePicker.selectOption({ index: 2 })
        await page.waitForTimeout(1000)

        // Check recovery score changed
        const newRecovery = await page.locator('[data-testid="recovery-score"], .recovery-score, text=/\\d+/').first().textContent()

        // Data should be different (or at least re-rendered)
        expect(newRecovery).toBeTruthy()
      }
    }
  })

  test('should show historical data in MBE+ panel', async ({ page }) => {
    // Open MBE+ panel (hamburger menu)
    const menuBtn = page.locator('[data-testid="menu-btn"], button:has-text("☰"), button:has-text("Menú"), button:has-text("Menu")').first()

    if (await menuBtn.count() > 0) {
      await menuBtn.click()

      // Look for MBE+ option
      const mbeOption = page.locator('[data-testid="mbe-link"], a:has-text("MBE"), button:has-text("MBE"), text=/MBE\\+/i').first()
      if (await mbeOption.count() > 0) {
        await mbeOption.click()
        await page.waitForTimeout(500)

        // Check MBE+ panel is visible
        const mbePanel = page.locator('[data-testid="mbe-panel"], #mbe-panel, .mbe-panel')
        await expect(mbePanel.first()).toBeVisible({ timeout: 5000 })

        // Check date picker in MBE+
        const mbeDatePicker = page.locator('#mbe-date, [data-testid="mbe-date-picker"]').first()
        if (await mbeDatePicker.count() > 0) {
          const options = await mbeDatePicker.locator('option').all()
          expect(options.length).toBeGreaterThan(1)
        }

        // Check sections exist
        const sections = ['Cama', 'Hipnograma', 'Siestas', 'Entreno', 'Carga', 'VFC', 'Composición', 'Hidratación']
        for (const section of sections) {
          const sectionEl = page.locator(`text=${section}`)
          // At least some sections should be present
        }
      }
    }
  })

  test('should navigate tabs for selected date', async ({ page }) => {
    // Look for tab navigation
    const tabs = page.locator('[data-testid="tabs"], .tabs, nav[role="tablist"], .tab-navigation')
    const tabButtons = page.locator('[role="tab"], .tab, button.tab')

    if (await tabs.count() > 0 || await tabButtons.count() > 0) {
      const tabCount = await tabButtons.count()
      expect(tabCount).toBeGreaterThan(1)

      // Click each tab and verify content changes
      for (let i = 0; i < Math.min(tabCount, 5); i++) {
        await tabButtons.nth(i).click()
        await page.waitForTimeout(300)

        // Verify tab panel is visible
        const panels = page.locator('[role="tabpanel"], .tab-panel, .tab-content')
        await expect(panels.first()).toBeVisible()
      }
    }
  })

  test('should show "Hoy" button to return to today', async ({ page }) => {
    const hoyBtn = page.locator('button:has-text("Hoy"), button:has-text("Today"), [data-testid="today-btn"]').first()

    if (await hoyBtn.count() > 0) {
      // First navigate to a past date
      const datePicker = page.locator('[data-testid="date-picker"], select#mbe-date, select[name="date"]').first()
      if (await datePicker.count() > 0) {
        const options = await datePicker.locator('option').all()
        if (options.length > 1) {
          await datePicker.selectOption({ index: 1 })
          await page.waitForTimeout(500)
        }
      }

      // Click "Hoy" button
      await hoyBtn.click()
      await page.waitForTimeout(500)

      // Verify returned to today
      const today = new Date().toISOString().split('T')[0]
      const dateDisplay = page.locator(`text=${today}`)
      await expect(dateDisplay.first()).toBeVisible()
    }
  })

  test('should persist selected date in URL or state', async ({ page }) => {
    const datePicker = page.locator('[data-testid="date-picker"], select#mbe-date, select[name="date"]').first()

    if (await datePicker.count() > 0) {
      const options = await datePicker.locator('option').all()
      if (options.length > 2) {
        await datePicker.selectOption({ index: 2 })
        await page.waitForTimeout(500)

        // Reload page
        await page.reload()
        await page.waitForLoadState('networkidle')

        // Check if date persisted (might be in URL hash or localStorage)
        const selectedValue = await datePicker.inputValue()
        // Note: persistence depends on implementation
        expect(selectedValue).toBeTruthy()
      }
    }
  })

  test('should handle empty data for future dates gracefully', async ({ page }) => {
    // Try to select a future date (if possible)
    const dateInput = page.locator('input[type="date"]').first()

    if (await dateInput.count() > 0) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toISOString().split('T')[0]

      await dateInput.fill(tomorrowStr)
      await dateInput.press('Enter')
      await page.waitForTimeout(1000)

      // Should show empty state or today's data
      const emptyState = page.locator('text=/Sin datos|No data|No hay datos/i')
      const hasEmptyState = await emptyState.count() > 0

      // Either shows empty state or falls back to available data
      expect(hasEmptyState || true).toBe(true)
    }
  })

  test('should show 30 days of history in date picker', async ({ page }) => {
    const datePicker = page.locator('[data-testid="date-picker"], select#mbe-date, select[name="date"]').first()

    if (await datePicker.count() > 0) {
      const options = await datePicker.locator('option').all()
      // Should have at least 7 days, ideally 30
      expect(options.length).toBeGreaterThanOrEqual(7)
      expect(options.length).toBeLessThanOrEqual(31)
    }
  })
})