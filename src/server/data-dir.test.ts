import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { adoptLegacyData, describeMove, legacyDataDir, userDataDir } from './data-dir';

describe('userDataDir', () => {
  it('uses the per-user application data folder of each platform', () => {
    expect(userDataDir({ LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local' }, 'win32', 'C:\\Users\\sam')).toBe('C:\\Users\\sam\\AppData\\Local\\JScout');
    expect(userDataDir({}, 'win32', 'C:\\Users\\sam')).toBe('C:\\Users\\sam\\AppData\\Local\\JScout');
    expect(userDataDir({}, 'darwin', '/Users/sam')).toBe('/Users/sam/Library/Application Support/JScout');
    expect(userDataDir({}, 'linux', '/home/sam')).toBe('/home/sam/.local/share/jscout');
    expect(userDataDir({ XDG_DATA_HOME: '/data/sam' }, 'linux', '/home/sam')).toBe('/data/sam/jscout');
  });

  it('ignores a relative XDG_DATA_HOME, as the spec says', () => {
    expect(userDataDir({ XDG_DATA_HOME: 'relative/dir' }, 'linux', '/home/sam')).toBe('/home/sam/.local/share/jscout');
  });
});

describe('loadConfig data folder', () => {
  it('defaults to the per-user folder and remembers the old app-folder location to move from', () => {
    const config = loadConfig({}, { XDG_DATA_HOME: '/xdg' });
    if (process.platform !== 'win32' && process.platform !== 'darwin') expect(config.dataDir).toBe('/xdg/jscout');
    expect(config.dbPath).toBe(path.join(config.dataDir, 'jscout.db'));
    expect(config.legacyDataDir).toMatch(/[\\/]data$/);
  });

  it('uses JSCOUT_DATA_DIR as given, with nothing to move', () => {
    const config = loadConfig({}, { JSCOUT_DATA_DIR: '/somewhere/else' });
    expect(config.dataDir).toBe(path.resolve('/somewhere/else'));
    expect(config.legacyDataDir).toBeUndefined();
  });

  it('treats an empty JSCOUT_DATA_DIR as unset', () => {
    const config = loadConfig({}, { JSCOUT_DATA_DIR: '', XDG_DATA_HOME: '/xdg' });
    expect(config.dataDir).not.toBe(process.cwd());
    expect(config.legacyDataDir).toBeDefined();
  });

  it('uses an explicit override (tests) with nothing to move', () => {
    expect(loadConfig({ dataDir: '/tmp/x' }, {}).legacyDataDir).toBeUndefined();
  });
});

describe('adoptLegacyData', () => {
  let root: string;
  let from: string;
  let to: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'jscout-datadir-'));
    from = legacyDataDir(path.join(root, 'app'));
    to = path.join(root, 'home', '.local', 'share', 'jscout');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function writeLegacy(): void {
    fs.mkdirSync(path.join(from, 'resume'), { recursive: true });
    fs.writeFileSync(path.join(from, 'jscout.db'), 'db');
    fs.writeFileSync(path.join(from, 'jscout.db-wal'), 'wal');
    fs.writeFileSync(path.join(from, 'resume', 'original'), 'résumé bytes');
  }

  it('does nothing when the old folder has no data', () => {
    expect(adoptLegacyData(from, to)).toEqual({ kind: 'none' });
    fs.mkdirSync(from, { recursive: true });
    expect(adoptLegacyData(from, to)).toEqual({ kind: 'none' });
    expect(fs.existsSync(to)).toBe(false);
  });

  it('moves the database, its log and the résumé into the per-user folder', () => {
    writeLegacy();
    expect(adoptLegacyData(from, to)).toEqual({ kind: 'moved', from, to });
    expect(fs.readFileSync(path.join(to, 'jscout.db'), 'utf8')).toBe('db');
    expect(fs.readFileSync(path.join(to, 'jscout.db-wal'), 'utf8')).toBe('wal');
    expect(fs.readFileSync(path.join(to, 'resume', 'original'), 'utf8')).toBe('résumé bytes');
    expect(fs.existsSync(from)).toBe(false);
    // Once moved, later starts have nothing to do.
    expect(adoptLegacyData(from, to)).toEqual({ kind: 'none' });
  });

  it('moves into an existing empty per-user folder', () => {
    writeLegacy();
    fs.mkdirSync(to, { recursive: true });
    expect(adoptLegacyData(from, to).kind).toBe('moved');
    expect(fs.existsSync(path.join(to, 'jscout.db'))).toBe(true);
  });

  it('leaves both folders alone when the per-user folder already has data', () => {
    writeLegacy();
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, 'jscout.db'), 'newer');
    expect(adoptLegacyData(from, to)).toEqual({ kind: 'both', from, to });
    expect(fs.readFileSync(path.join(to, 'jscout.db'), 'utf8')).toBe('newer');
    expect(fs.readFileSync(path.join(from, 'jscout.db'), 'utf8')).toBe('db');
  });

  it('refuses to overwrite a file already in the per-user folder, keeping the old folder in use', () => {
    writeLegacy();
    fs.mkdirSync(path.join(to, 'resume'), { recursive: true });
    const move = adoptLegacyData(from, to);
    expect(move.kind).toBe('failed');
    expect(fs.readFileSync(path.join(from, 'jscout.db'), 'utf8')).toBe('db');
    expect(fs.existsSync(path.join(to, 'jscout.db'))).toBe(false);
  });

  it('finishes a move that stopped half way: the database moves last, so the old folder is still used until then', () => {
    writeLegacy();
    // As if a previous start moved the log and résumé, then stopped before the database.
    fs.mkdirSync(to, { recursive: true });
    fs.renameSync(path.join(from, 'jscout.db-wal'), path.join(to, 'jscout.db-wal'));
    fs.renameSync(path.join(from, 'resume'), path.join(to, 'resume'));
    expect(adoptLegacyData(from, to).kind).toBe('moved');
    expect(fs.readdirSync(to).sort()).toEqual(['jscout.db', 'jscout.db-wal', 'resume']);
  });

  it('says what happened in plain words', () => {
    expect(describeMove({ kind: 'none' })).toBeUndefined();
    expect(describeMove({ kind: 'moved', from: '/a', to: '/b' })).toContain('Moved your data');
    expect(describeMove({ kind: 'both', from: '/a', to: '/b' })).toContain('/a is not used');
    expect(describeMove({ kind: 'failed', from: '/a', to: '/b', reason: 'busy' })).toContain('Using /a for now');
  });
});
