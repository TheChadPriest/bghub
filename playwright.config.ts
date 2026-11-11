import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const baseURL = process.env.BGHUB_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    // Uses the locally installed Google Chrome (no browser download needed).
    channel: process.env.PW_CHANNEL ?? 'chrome',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL ?? 'chrome' }, testIgnore: /mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL ?? 'chrome' }, testMatch: /mobile/ },
  ],
  webServer: process.env.BGHUB_URL ? undefined : {
    command: `npx vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
