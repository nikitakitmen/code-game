import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3100);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
      args: ['--no-sandbox'],
    },
  },
  webServer: {
    command: `npm run start -w @prod/web -- -p ${PORT}`,
    cwd: '..',
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
