import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Lab 4 report run: same tests + video for every test, JSON + HTML report.
// npx playwright test -c playwright.report.config.ts   → test-report/index.html, $PW_JSON (results.json)
export default defineConfig({
  ...base,
  use: { ...base.use, video: { mode: 'on', size: { width: 1024, height: 640 } } },
  outputDir: process.env.PW_ARTIFACTS || '/tmp/pw-artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-report', open: 'never' }],
    ['json', { outputFile: process.env.PW_JSON || '/tmp/pw-results.json' }],
  ],
});
