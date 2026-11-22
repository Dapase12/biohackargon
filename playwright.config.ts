import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list']
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 60000,
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox']
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['iPhone 14'] }
    }
  ],
  webServer: {
    command: 'npx serve dist -l 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 100
    }
  }
})