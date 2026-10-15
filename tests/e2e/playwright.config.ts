import { defineConfig } from '@playwright/test'

if (!process.env.E2E_BASE_URL || !process.env.E2E_OUTPUT_DIR) throw new Error('Run browser tests with npm run test:e2e to isolate the database')
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 45000,
  globalTimeout: 240000,
  expect: { timeout: 7000 },
  reporter: 'list',
  outputDir: process.env.E2E_OUTPUT_DIR,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
})
