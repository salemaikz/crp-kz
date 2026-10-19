import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// E2E на `next start` в демо-режиме: DEMO_MODE=1 (next start — это production, без флага
// приложение без DATABASE_URL не стартует), без DATABASE_URL — PGlite + сид.
const PORT = 3100;
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// Локально — предустановленный Chromium; в CI его нет, берётся из `npx playwright install`.
const executablePath = existsSync(chromiumPath) ? chromiumPath : undefined;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: {
    // PW_SKIP_BUILD=1 — сборка уже сделана отдельным шагом (CI)
    command: process.env.PW_SKIP_BUILD ? `npm run start -- -p ${PORT}` : `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/ru`,
    reuseExistingServer: !isCI,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // к process.env добавляется явный демо-режим; DATABASE_URL не передаём — PGlite в памяти
    env: { DEMO_MODE: '1', DATABASE_URL: '' },
  },
});
