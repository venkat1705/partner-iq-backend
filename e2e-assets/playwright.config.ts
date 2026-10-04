import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    headless: true,
    launchOptions: { executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' },
    viewport: { width: 1440, height: 900 },
  },
});
