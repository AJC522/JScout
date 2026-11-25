import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../shared/constants';
import { legacyDataDir, userDataDir } from './data-dir';

export interface AppConfig {
  /** App version from package.json. */
  version: string;
  host: string;
  port: number;
  /** Directory holding the SQLite database and uploaded files. */
  dataDir: string;
  /**
   * The app-folder `data` directory older versions used, set only when dataDir is the default per-user
   * folder (not chosen with JSCOUT_DATA_DIR): its data is moved into dataDir at startup.
   */
  legacyDataDir?: string;
  dbPath: string;
  /** Built client assets (dist/client); undefined when not built (dev uses Vite). */
  clientDir?: string;
  /** Directory with bundled reference data (gazetteer, skills, roles, seed companies). */
  referenceDir: string;
  /** Sent as User-Agent on outbound requests to job sources. */
  userAgent: string;
  /** Open the browser on start. */
  openBrowser: boolean;
  /** Disable background syncing (tests). */
  disableSync: boolean;
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from this file to the directory containing package.json. */
export function findProjectRoot(start: string = here): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function readVersion(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function loadConfig(overrides: Partial<AppConfig> = {}, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const root = findProjectRoot();
  // A per-user folder (see data-dir.ts), so a new copy of the app still finds the saved profile and résumé.
  const chosen = overrides.dataDir ?? (env.JSCOUT_DATA_DIR || undefined);
  const dataDir = path.resolve(chosen ?? userDataDir(env));
  const clientCandidate = path.join(root, 'dist', 'client');
  const referenceCandidates = [path.join(here, 'data'), path.join(root, 'src', 'server', 'data')];
  const referenceDir = referenceCandidates.find((p) => fs.existsSync(p)) ?? referenceCandidates[0]!;
  const port = Number(env.JSCOUT_PORT ?? env.PORT ?? DEFAULT_PORT);
  return {
    version: readVersion(root),
    host: env.JSCOUT_HOST ?? '127.0.0.1',
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
    dataDir,
    ...(chosen === undefined ? { legacyDataDir: legacyDataDir(root) } : {}),
    dbPath: path.join(dataDir, 'jscout.db'),
    clientDir: fs.existsSync(path.join(clientCandidate, 'index.html')) ? clientCandidate : undefined,
    referenceDir,
    userAgent: env.JSCOUT_USER_AGENT ?? `Mozilla/5.0 (compatible; JobSearchClient/0.1; ${os.platform()})`,
    openBrowser: env.JSCOUT_NO_OPEN ? false : true,
    disableSync: env.JSCOUT_DISABLE_SYNC === '1',
    logLevel: (env.JSCOUT_LOG_LEVEL as AppConfig['logLevel'] | undefined) ?? 'info',
    ...overrides,
  };
}
