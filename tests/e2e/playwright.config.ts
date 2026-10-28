import { defineConfig } from '@playwright/test'

if (!process.env.E2E_BASE_URL || !process.env.E2E_OUTPUT_DIR) throw new Error('Run browser tests with npm run test:e2e to isolate the database')
const browserName = process.env.E2E_BROWSER
if (browserName && !['chromium', 'firefox', 'webkit'].includes(browserName)) throw new Error('E2E_BROWSER must be chromium, firefox or webkit')
export default defineConfig({
  testDir: '.',
  testMatch: process.env.E2E_MUSIC3_MOCK ? 'music3.spec.ts' : process.env.E2E_PLANNING_MOCK ? 'ai-planning.spec.ts' : '*.spec.ts',
  testIgnore: process.env.E2E_MUSIC3_MOCK ? ['ai-planning.spec.ts'] : process.env.E2E_PLANNING_MOCK ? ['music3.spec.ts'] : ['ai-planning.spec.ts','music3.spec.ts'],
  workers: 1,
  timeout: 45000,
  // Preserve the draft suite's global budget and strict individual deadlines.
  globalTimeout: 900000,
  expect: { timeout: 7000 },
  reporter: [['list'], ['json']],
  outputDir: process.env.E2E_OUTPUT_DIR,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  // Keep E2E_BROWSER compatibility while exposing explicit CI project names.
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' as const, channel: process.env.E2E_CHROMIUM_CHANNEL || undefined, launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {} } },
    { name: 'firefox', use: { browserName: 'firefox' as const } },
    { name: 'webkit', use: { browserName: 'webkit' as const } },
  ].filter(project => !browserName || project.name === browserName),
})
