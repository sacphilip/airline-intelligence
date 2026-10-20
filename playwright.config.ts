import { defineConfig, devices } from '@playwright/test';

// UI tests run against the real backend and live flight data: nothing is mocked.
// Playwright starts both servers below (or reuses ones already running locally).
// The backend needs Postgres and Redis (`docker compose up -d`) and AERODATABOX_KEY,
// read from backend/.env locally or from the environment in CI.
const API_PORT = 3100;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  // Real lookups (AeroDataBox, adsb.lol) can take several seconds when not yet cached.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Optional browsers — uncomment to include in a run
    // { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],

  webServer: [
    {
      // Build first so the tests always exercise the current backend code.
      command: 'npm run build && node dist/main',
      url: `http://localhost:${API_PORT}/api-docs-json`,
      reuseExistingServer: !process.env.CI,
      cwd: './backend',
      timeout: 180_000,
      env: {
        PORT: String(API_PORT),
        // Never run the background history collector during tests: it spends API quota.
        COLLECT_AIRPORTS: '',
      },
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      cwd: './frontend',
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
