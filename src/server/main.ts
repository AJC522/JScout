import './quiet-warnings';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildApp } from './app';
import { type AppConfig, loadConfig } from './config';
import { adoptLegacyData, describeMove } from './data-dir';
import { isJScoutRunning } from './running-instance';
import { databaseProblem } from './startup-errors';

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`JScout needs Node.js 22.13 or newer (you have ${process.versions.node}). Get it from https://nodejs.org/.`);
  process.exit(1);
}

function openInBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    /* no browser opener available; the URL is printed below */
  }
}

/**
 * Bring data from the app-folder `data` directory of an older version into the per-user folder, once.
 * If that cannot be done, keep using the old folder so nothing seems lost.
 */
function settleDataDir(config: AppConfig): AppConfig {
  if (!config.legacyDataDir) return config;
  const move = adoptLegacyData(config.legacyDataDir, config.dataDir);
  const message = describeMove(move);
  if (message) (move.kind === 'failed' ? console.warn : console.log)(`\n  ${message}`);
  if (move.kind !== 'failed') return config;
  return { ...config, dataDir: move.from, dbPath: path.join(move.from, 'jscout.db') };
}

async function main(): Promise<void> {
  const loaded = loadConfig();
  const url = `http://${loaded.host === '127.0.0.1' ? 'localhost' : loaded.host}:${loaded.port}`;
  // Started a second time (the launcher double-clicked again): show the copy that is running.
  if (await isJScoutRunning(loaded.host, loaded.port)) {
    console.log(`\n  JScout is already running at ${url}${loaded.openBrowser ? '; opening it in your browser.' : '.'}\n`);
    if (loaded.openBrowser) openInBrowser(url);
    return;
  }

  const config = settleDataDir(loaded);
  let built: Awaited<ReturnType<typeof buildApp>>;
  try {
    built = await buildApp({ config });
  } catch (err) {
    const problem = databaseProblem(err, config.dbPath);
    if (!problem) throw err;
    console.error(`\n  ${problem}\n`);
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    built.app.log.info(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(0), 5_000);
    force.unref();
    await built.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await built.app.listen({ host: config.host, port: config.port });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      // A running JScout was ruled out above, so it is something else.
      console.error(`Port ${config.port} is in use by another program. Start JScout on another port with JSCOUT_PORT=4311.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }

  built.ctx.services.companies.seedIfEmpty();
  built.ctx.services.sync.start();

  if (config.clientDir) {
    console.log(`\n  JScout is running at ${url}\n  Your data is stored in ${config.dataDir}\n  Press Ctrl+C or close this window to stop.\n`);
    if (config.openBrowser) openInBrowser(url);
  } else {
    console.log(`\n  JScout API listening at ${url} (web interface served by Vite in dev mode)\n`);
  }
}

void main();
