import { defineConfig } from '@playwright/test';

const port = Number(process.env.JSCOUT_E2E_PORT ?? 4319);
const baseURL = `http://localhost:${port}`;

/**
 * End-to-end tests run against the built app (built first when the sources are newer) on a
 * throwaway data directory. Syncing is disabled and the index is seeded from the source fixtures
 * (tests/e2e/support), so the tests need no network. Tests share one server and run in order.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'off',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'node tests/e2e/support/start-server.mjs',
    url: `${baseURL}/api/health`,
    env: { JSCOUT_E2E_PORT: String(port) },
    reuseExistingServer: false,
    // The first run builds the app.
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
