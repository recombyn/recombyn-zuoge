import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E — smoke + critical flows against the Vite web app.
 * Start web with `npm run dev:web` or let webServer boot it.
 */
const e2eWorkers = (() => {
  const raw = (process.env.E2E_WORKERS || '').trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  // Cap concurrency: auth rate limits + shared Vite/API make 8+ workers flaky.
  return process.env.CI ? 2 : 2;
})();

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 1,
  workers: e2eWorkers,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev --workspace=apps/web -- --host 127.0.0.1 --port 3000',
        cwd: '..',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
