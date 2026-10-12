import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/generated',
  fullyParallel: false,
  retries: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: './reports/results.json' }],
    ['html', { outputFolder: './reports/playwright', open: 'never' }],
  ],
  use: {
    baseURL: process.env.API_BASE_URL ?? 'http://localhost:3100',
    extraHTTPHeaders: { Accept: 'application/json' },
    trace: 'retain-on-failure',
  },
});
