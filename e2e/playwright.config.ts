import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './coupons',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_ADMIN_URL || 'http://localhost:3001',
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
    trace: 'off',
    screenshot: 'off',
  },
});
