import { defineConfig } from '@playwright/test';

const port = Number(process.env.JSCOUT_E2E_PORT ?? 4319);

/**
 * End-to-end tests run against the built app (npm run build) on a throwaway
 * data directory. Syncing is disabled; tests seed the index through fixtures.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'off',
    viewport: { width: 1440, height: 900 },
  },
});
