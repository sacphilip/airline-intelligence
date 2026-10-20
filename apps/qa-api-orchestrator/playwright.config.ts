import { defineConfig } from '@playwright/test';
import { join } from 'path';

// Use process.cwd() so tests and reports land in the directory where the
// user runs the command, not inside the installed package directory.
const cwd = process.cwd();

export default defineConfig({
  testDir: join(cwd, 'tests/generated'),
  fullyParallel: false,
  retries: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: join(cwd, 'reports/results.json') }],
    ['html', { outputFolder: join(cwd, 'reports/playwright'), open: 'never' }],
  ],
  use: {
    baseURL: process.env.API_BASE_URL ?? 'http://localhost:3100',
    extraHTTPHeaders: { Accept: 'application/json' },
    trace: 'retain-on-failure',
  },
});
