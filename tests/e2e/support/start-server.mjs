// Starts the built app (as `npm start` does, building first if needed) for the end-to-end tests:
// a fresh data directory seeded from the fixtures, background syncing off, and no way to reach a
// real job site. Run by Playwright's webServer; stops the app and removes the data on SIGTERM/SIGINT.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const port = process.env.JSCOUT_E2E_PORT ?? '4319';
const dataDir = path.join(os.tmpdir(), `jscout-e2e-${port}`);

// node:sqlite and the proxy agent announce themselves as experimental; that is noise in test output.
const nodeOptions = [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning', '--disable-warning=UNDICI-EHPA'].filter(Boolean).join(' ');

fs.rmSync(dataDir, { recursive: true, force: true });
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const seed = spawnSync(process.execPath, [tsx, path.join(root, 'tests', 'e2e', 'support', 'seed-index.ts'), dataDir], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
if (seed.status !== 0) process.exit(seed.status ?? 1);

// Every outbound request goes through a proxy that is not there, so an action that would sync
// (the user can always press "Sync now") fails fast instead of downloading real postings.
const deadProxy = 'http://127.0.0.1:9';
const env = {
  ...process.env,
  JSCOUT_PORT: port,
  JSCOUT_DATA_DIR: dataDir,
  JSCOUT_NO_OPEN: '1',
  JSCOUT_DISABLE_SYNC: '1',
  JSCOUT_LOG_LEVEL: 'warn',
  NODE_OPTIONS: nodeOptions,
  NODE_USE_ENV_PROXY: '1',
  HTTPS_PROXY: deadProxy,
  https_proxy: deadProxy,
  HTTP_PROXY: deadProxy,
  http_proxy: deadProxy,
  NO_PROXY: 'localhost,127.0.0.1',
  no_proxy: 'localhost,127.0.0.1',
};
const app = spawn(process.execPath, [path.join(root, 'scripts', 'start.mjs')], { cwd: root, stdio: 'inherit', env });

const cleanUp = () => fs.rmSync(dataDir, { recursive: true, force: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.kill(signal));
app.on('exit', (code, signal) => {
  cleanUp();
  process.exit(code ?? (signal ? 0 : 1));
});
