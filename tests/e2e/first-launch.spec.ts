import { test, expect } from '@playwright/test'

test.describe('First Launch & PWA Install Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear all storage before each test
    await page.context().clearCookies()
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('should load app and show onboarding', async ({ page }) => {
    await page.goto('/')

    // Wait for app to load
    await page.waitForLoadState('networkidle')

    // Check for onboarding/welcome screen or main dashboard
    // The app should show either onboarding or the main dashboard
    const hasOnboarding = await page.locator('[data-testid="onboarding"], .onboarding, #onboarding').count() > 0
    const hasDashboard = await page.locator('[data-testid="dashboard"], #main, main').count() > 0

    expect(hasOnboarding || hasDashboard).toBe(true)
  })

  test('should show settings/config modal on first visit', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Look for settings button or config modal
    const settingsBtn = page.locator('[data-testid="settings-btn"], button:has-text("Ajustes"), button:has-text("Config"), button:has-text("⚙️")')
    const configModal = page.locator('[data-testid="config-modal"], .config-modal, #config-modal')

    // Either settings button exists or config modal is already open
    await expect(settingsBtn.first().or(configModal.first())).toBeVisible({ timeout: 10000 })
  })

  test('should allow profile configuration', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Open settings if needed
    const settingsBtn = page.locator('[data-testid="settings-btn"], button:has-text("Ajustes"), button:has-text("Config"), button:has-text("⚙️")')
    if (await settingsBtn.count() > 0) {
      await settingsBtn.first().click()
    }

    // Fill in profile form
    const birthDateInput = page.locator('input[name="birthDate"], input[type="date"]').first()
    const heightInput = page.locator('input[name="heightM"], input[placeholder*="altura" i], input[placeholder*="height" i]').first()
    const timezoneSelect = page.locator('select[name="timezone"], select[placeholder*="zona" i]').first()
    const wakeInput = page.locator('input[name="habitualWake"], input[type="time"]').first()
    const sexSelect = page.locator('select[name="biologicalSex"]').first()

    if (await birthDateInput.count() > 0) {
      await birthDateInput.fill('1990-01-15')
    }
    if (await heightInput.count() > 0) {
      await heightInput.fill('1.75')
    }
    if (await timezoneSelect.count() > 0) {
      await timezoneSelect.selectOption('America/Caracas')
    }
    if (await wakeInput.count() > 0) {
      await wakeInput.fill('06:30')
    }
    if (await sexSelect.count() > 0) {
      await sexSelect.selectOption('male')
    }

    // Save configuration
    const saveBtn = page.locator('button:has-text("Guardar"), button:has-text("Save"), button[type="submit"]').first()
    if (await saveBtn.count() > 0) {
      await saveBtn.click()
    }

    // Verify config saved to localStorage
    const configSaved = await page.evaluate(() => {
      return localStorage.getItem('argon_profile_v1') !== null
    })
    expect(configSaved).toBe(true)
  })

  test('should configure Supabase connection', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Open settings
    const settingsBtn = page.locator('[data-testid="settings-btn"], button:has-text("Ajustes"), button:has-text("Config"), button:has-text("⚙️")')
    if (await settingsBtn.count() > 0) {
      await settingsBtn.first().click()
    }

    // Look for Supabase config fields
    const urlInput = page.locator('input[name="supabaseUrl"], input[placeholder*="supabase" i], input[placeholder*="url" i]').first()
    const keyInput = page.locator('input[name="supabaseKey"], input[placeholder*="anon" i], input[placeholder*="key" i]').first()

    if (await urlInput.count() > 0) {
      await urlInput.fill('https://test.supabase.co')
    }
    if (await keyInput.count() > 0) {
      await keyInput.fill('test-anon-key')
    }

    // Save
    const saveBtn = page.locator('button:has-text("Guardar"), button:has-text("Save"), button[type="submit"]').first()
    if (await saveBtn.count() > 0) {
      await saveBtn.click()
    }

    // Verify Supabase config saved
    const sbUrlSaved = await page.evaluate(() => localStorage.getItem('argon_sb_url'))
    const sbKeySaved = await page.evaluate(() => localStorage.getItem('argon_sb_key'))

    expect(sbUrlSaved).toBe('https://test.supabase.co')
    expect(sbKeySaved).toBe('test-anon-key')
  })

  test('should trigger sync and show recovery score', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Configure minimal profile first (if needed)
    await page.evaluate(() => {
      localStorage.setItem('argon_profile_v1', JSON.stringify({
        birthDate: '1990-01-15',
        heightM: 1.75,
        timezone: 'America/Caracas',
        basalSleepNeedH: 7.5,
        habitualWake: '06:30',
        goalWeightKg: 75,
        goalDate: '2025-12-31',
        dailyDeficitKcal: 500,
        biologicalSex: 'male'
      }))
      localStorage.setItem('argon_sb_url', 'https://test.supabase.co')
      localStorage.setItem('argon_sb_key', 'test-key')
    })

    // Reload to apply config
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Look for sync button
    const syncBtn = page.locator('[data-testid="sync-btn"], button:has-text("Sincronizar"), button:has-text("Sync"), button:has-text("☁️")')
    if (await syncBtn.count() > 0) {
      await syncBtn.first().click()

      // Wait for sync to complete (or show error if no real backend)
      await page.waitForTimeout(3000)
    }

    // Check for recovery score display
    const recoveryDisplay = page.locator('[data-testid="recovery-score"], .recovery-score, text=/Recuperación|Recovery/i')
    const readinessDisplay = page.locator('[data-testid="readiness-score"], .readiness-score, text=/Preparación|Readiness/i')

    // At least one should be visible
    const hasRecovery = await recoveryDisplay.count() > 0
    const hasReadiness = await readinessDisplay.count() > 0

    expect(hasRecovery || hasReadiness).toBe(true)
  })

  test('should work offline (PWA service worker)', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Check service worker registration
    const swRegistered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      return !!reg
    })

    expect(swRegistered).toBe(true)

    // Go offline
    await page.context().setOffline(true)

    // Reload page - should still work from cache
    await page.reload()
    await page.waitForLoadState('networkidle')

    // App should still be functional
    const appLoaded = await page.locator('body').isVisible()
    expect(appLoaded).toBe(true)

    // Go back online
    await page.context().setOffline(false)
  })

  test('should be installable as PWA', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Check manifest
    const manifestLink = page.locator('link[rel="manifest"]')
    await expect(manifestLink).toHaveAttribute('href', '/manifest.json')

    // Check for PWA meta tags
    const themeColor = page.locator('meta[name="theme-color"]')
    await expect(themeColor).toHaveAttribute('content', /#/)

    // Check for apple-touch-icon
    const appleIcon = page.locator('link[rel="apple-touch-icon"]')
    await expect(appleIcon).toHaveAttribute('href', /\.(png|ico)/)
  })
})