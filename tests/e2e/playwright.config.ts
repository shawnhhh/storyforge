import { defineConfig } from '@playwright/test'

if (!process.env.E2E_BASE_URL || !process.env.E2E_OUTPUT_DIR) throw new Error('Run browser tests with npm run test:e2e to isolate the database')
const browserName = process.env.E2E_BROWSER ?? 'chromium'
if (browserName !== 'chromium' && browserName !== 'webkit') throw new Error('E2E_BROWSER must be chromium or webkit')
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 45000,
  // The expanded 69-case suite runs serially on one isolated database.
  // Keep individual deadlines strict while allowing the full regression to finish.
  globalTimeout: 900000,
  expect: { timeout: 7000 },
  reporter: 'list',
  outputDir: process.env.E2E_OUTPUT_DIR,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    browserName,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    launchOptions: browserName === 'chromium' && process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
})
