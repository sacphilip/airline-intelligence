/**
 * Playwright config for UI smoke tests.
 *
 * Key differences from playwright.config.ts:
 * - testDir points to tests/smoke/ only
 * - Only the Next.js frontend is started (no backend)
 * - All API calls are mocked via page.route() in the specs themselves
 * - Shorter timeouts — mocked responses are instant
 * - AERODATABOX_KEY and a running database are NOT required
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['html', { open: 'never', outputFolder: 'smoke-report' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    cwd: './frontend',
    timeout: 120_000,
    env: {
      // Point at a non-existent backend — all calls are mocked before they fire
      NEXT_PUBLIC_API_URL: 'http://localhost:3100',
    },
  },
});
