/**
 * Playwright config for API smoke tests.
 *
 * Runs tests/smoke/ only — health check + validation-error 400s.
 * These tests need the backend running but no flight data.
 */
import { defineConfig } from '@playwright/test';
import { join } from 'path';

const cwd = process.cwd();

export default defineConfig({
  testDir: join(cwd, 'tests/smoke'),
  fullyParallel: true,
  retries: 1,
  timeout: 20_000,
  reporter: [
    ['list'],
    ['json', { outputFile: join(cwd, 'reports/smoke-results.json') }],
  ],
  use: {
    baseURL: process.env.API_BASE_URL ?? 'http://localhost:3100',
    extraHTTPHeaders: { Accept: 'application/json' },
  },
});
