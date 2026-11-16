import { defineConfig } from '@playwright/test';

// RESET is global: independent test files must never run against the same DB concurrently.
// Optional env: BASE_URL (default http://localhost:3000) · PW_CHROMIUM_PATH (use a preinstalled chromium binary)
// · PW_JSON (also write a JSON report to this file).
const reporter: any[] = [['list'], ['html', { open: 'never' }]];
if (process.env.PW_JSON) reporter.push(['json', { outputFile: process.env.PW_JSON }]);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  reporter,
});
