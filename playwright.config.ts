import { defineConfig } from '@playwright/test';

/** E2E against the built Electron app (`npm run e2e` builds first). */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1,
  maxFailures: process.env.CI ? 5 : 0,
  reporter: 'list',
  // a failed test keeps a trace of each window: on GitHub's computers nobody is there to look
  use: { trace: 'retain-on-failure' },
});
