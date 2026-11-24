import './quiet-warnings';
import { spawn } from 'node:child_process';
import { buildApp } from './app';
import { loadConfig } from './config';

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

async function main(): Promise<void> {
  const config = loadConfig();
  const built = await buildApp({ config });

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
      console.error(
        `Port ${config.port} is already in use. JScout may already be running at http://${config.host}:${config.port} — ` +
          `or start it on another port with JSCOUT_PORT=4311.`,
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  }

  const url = `http://${config.host === '127.0.0.1' ? 'localhost' : config.host}:${config.port}`;
  built.ctx.services.companies.seedIfEmpty();
  built.ctx.services.sync.start();

  if (config.clientDir) {
    console.log(`\n  JScout is running at ${url}\n  Your data is stored in ${config.dataDir}\n  Press Ctrl+C to stop.\n`);
    if (config.openBrowser) openInBrowser(url);
  } else {
    console.log(`\n  JScout API listening at ${url} (web interface served by Vite in dev mode)\n`);
  }
}

void main();
