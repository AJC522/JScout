/**
 * Where JScout keeps the user's data (database, résumé), and the one-time move from the folder older
 * versions used.
 *
 * The data lives in a per-user folder, not in the app's own folder: downloading a new copy of JScout,
 * re-cloning it or running it from another folder then still finds the saved profile, résumé and
 * applications, so nothing has to be entered or uploaded again. JSCOUT_DATA_DIR overrides it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The database file whose presence means a folder holds JScout data. */
const DB_FILE = 'jscout.db';

/**
 * The per-user data folder for this platform:
 *   Windows  %LOCALAPPDATA%\JScout
 *   macOS    ~/Library/Application Support/JScout
 *   other    $XDG_DATA_HOME/jscout, else ~/.local/share/jscout
 */
export function userDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'JScout');
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'JScout');
  // The XDG spec says to ignore a relative XDG_DATA_HOME.
  const xdg = env.XDG_DATA_HOME && p.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : p.join(home, '.local', 'share');
  return p.join(xdg, 'jscout');
}

/** The folder versions before the per-user folder used: `data` next to package.json. */
export function legacyDataDir(projectRoot: string): string {
  return path.join(projectRoot, 'data');
}

const hasData = (dir: string) => fs.existsSync(path.join(dir, DB_FILE));

export type DataDirMove =
  /** Nothing to move: the old folder holds no data. */
  | { kind: 'none' }
  /** The old folder's contents are now in the new one. */
  | { kind: 'moved'; from: string; to: string }
  /** Both folders hold data; the new one is used and the old one is left alone. */
  | { kind: 'both'; from: string; to: string }
  /** The move could not be done; keep using the old folder. Nothing was lost. */
  | { kind: 'failed'; from: string; to: string; reason: string };

/** Move one entry, copying then removing it when it has to cross to another drive. */
function moveEntry(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    try {
      fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    } catch (copyErr) {
      // Leave no partial copy behind: the original is untouched, and the next try must not find a clash.
      fs.rmSync(to, { recursive: true, force: true });
      throw copyErr;
    }
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/**
 * Move the data of an older version (`from`, the app's own `data` folder) into the per-user folder
 * (`to`) when only the old folder has any. Runs before the database is opened.
 *
 * The database file goes last: if the move stops half way (a crash, a locked file), the old folder
 * still has its database, so the next start uses it and finishes the move, and the database is never
 * separated from its write-ahead log.
 */
export function adoptLegacyData(from: string, to: string): DataDirMove {
  if (path.resolve(from) === path.resolve(to) || !hasData(from)) return { kind: 'none' };
  if (hasData(to)) return { kind: 'both', from, to };
  try {
    const entries = fs.readdirSync(from).sort((a, b) => Number(a === DB_FILE) - Number(b === DB_FILE));
    // Refuse to overwrite anything: a clash means the folders need a person to look at them.
    const clash = entries.find((name) => fs.existsSync(path.join(to, name)));
    if (clash) return { kind: 'failed', from, to, reason: `${path.join(to, clash)} already exists` };
    fs.mkdirSync(to, { recursive: true, mode: 0o700 });
    for (const name of entries) moveEntry(path.join(from, name), path.join(to, name));
    try {
      fs.rmdirSync(from);
    } catch {
      /* not empty (something was added meanwhile) or not removable: harmless, it holds no database */
    }
    return { kind: 'moved', from, to };
  } catch (err) {
    return { kind: 'failed', from, to, reason: (err as Error).message };
  }
}

/** What to tell the user about a move, or undefined when there is nothing to say. */
export function describeMove(move: DataDirMove): string | undefined {
  switch (move.kind) {
    case 'none':
      return undefined;
    case 'moved':
      return `Moved your data (profile, résumé, applications) from ${move.from} to ${move.to}, so updates and new copies of JScout keep it.`;
    case 'both':
      return `An older JScout data folder at ${move.from} is not used: your data is in ${move.to}. Delete the old folder once you no longer need it.`;
    case 'failed':
      return `Could not move your data from ${move.from} to ${move.to} (${move.reason}). Using ${move.from} for now.`;
  }
}
