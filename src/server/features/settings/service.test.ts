import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_MODEL } from '../../../shared/constants';
import { type Db, openDb } from '../../db';
import type { AppContext, SettingsService } from '../../services';
import { clearAllSettings, createSettingsService } from './service';

let db: Db;
let ctx: AppContext;
let settings: SettingsService;

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  db = openDb(':memory:');
  ctx = { db, log: { debug() {}, info() {}, warn() {}, error() {} } } as unknown as AppContext;
  settings = createSettingsService(ctx);
});

afterEach(() => {
  vi.unstubAllEnvs();
  db.close();
});

describe('app settings', () => {
  it('returns defaults on a fresh database', () => {
    expect(settings.getApp()).toEqual({
      theme: 'system',
      autoSync: true,
      closedRetentionDays: 14,
      maxPostingAgeDays: 0,
      ai: { hasKey: false, keySource: null, model: DEFAULT_AI_MODEL },
    });
  });

  it('merges updates and persists them across service instances', () => {
    settings.updateApp({ theme: 'dark', closedRetentionDays: 30 });
    const updated = settings.updateApp({ autoSync: false, ai: { model: ' claude-sonnet-x ' } });
    expect(updated).toMatchObject({ theme: 'dark', autoSync: false, closedRetentionDays: 30, maxPostingAgeDays: 0 });
    expect(updated.ai.model).toBe('claude-sonnet-x');
    expect(createSettingsService(ctx).getApp()).toEqual(updated);
  });

  it('stores the API key trimmed, never returns it, and clears it with null or an empty string', () => {
    const withKey = settings.updateApp({ ai: { apiKey: '  sk-test-123  ' } });
    expect(withKey.ai).toEqual({ hasKey: true, keySource: 'saved', model: DEFAULT_AI_MODEL });
    expect(JSON.stringify(withKey)).not.toContain('sk-test');
    expect(settings.getSecret('ai.apiKey')).toBe('sk-test-123');

    settings.updateApp({ theme: 'light' });
    expect(settings.getSecret('ai.apiKey')).toBe('sk-test-123');

    expect(settings.updateApp({ ai: { apiKey: null } }).ai.hasKey).toBe(false);
    settings.updateApp({ ai: { apiKey: 'sk-again' } });
    expect(settings.updateApp({ ai: { apiKey: '   ' } }).ai.hasKey).toBe(false);
    expect(settings.getSecret('ai.apiKey')).toBeUndefined();
  });

  it('falls back to ANTHROPIC_API_KEY from the environment', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env');
    expect(settings.getSecret('ai.apiKey')).toBe('sk-env');
    expect(settings.getApp().ai).toMatchObject({ hasKey: true, keySource: 'environment' });
    settings.updateApp({ ai: { apiKey: 'sk-stored' } });
    expect(settings.getSecret('ai.apiKey')).toBe('sk-stored');
  });

  it('refuses to store garbage', () => {
    const bad: unknown[] = [
      { theme: 'neon' },
      { closedRetentionDays: -1 },
      { closedRetentionDays: 1.5 },
      { maxPostingAgeDays: Number.NaN },
      { autoSync: 'yes' },
      { ai: { model: '   ' } },
      { ai: { apiKey: 42 } },
    ];
    for (const patch of bad) {
      expect(() => settings.updateApp(patch as never), JSON.stringify(patch)).toThrow(/must/);
    }
    expect(settings.getApp().theme).toBe('system');
  });

  it('ignores malformed stored values field by field', () => {
    db.run("INSERT INTO settings (key, value) VALUES ('settings.app', ?)", JSON.stringify({ theme: 'dark', closedRetentionDays: 'x' }));
    const fresh = createSettingsService(ctx);
    expect(fresh.getApp()).toMatchObject({ theme: 'dark', closedRetentionDays: 14 });
    db.run("UPDATE settings SET value = '{not json' WHERE key = 'settings.app'");
    expect(createSettingsService(ctx).getApp().theme).toBe('system');
  });
});

describe('source state', () => {
  it('merges patches, trims values and deletes keys set to null or empty', () => {
    expect(settings.getSourceState('adzuna')).toEqual({ config: {} });
    settings.setSourceState('adzuna', { enabled: true, config: { appId: ' abc ', appKey: 'k1' }, ttlMinutes: 90 });
    const next = settings.setSourceState('adzuna', { config: { appKey: null, region: '  ' } });
    expect(next).toEqual({ enabled: true, config: { appId: 'abc' }, ttlMinutes: 90 });
    expect(settings.setSourceState('adzuna', { config: { appId: '' } }).config).toEqual({});
    expect(settings.getSourceState('other')).toEqual({ config: {} });
  });

  it('validates ttl and value types', () => {
    expect(() => settings.setSourceState('x', { ttlMinutes: 0 })).toThrow(/ttlMinutes/);
    expect(() => settings.setSourceState('x', { config: { a: 5 as never } })).toThrow(/config.a/);
  });

  it('returns copies that callers cannot use to corrupt the cache', () => {
    settings.setSourceState('s', { config: { a: '1' } });
    settings.getSourceState('s').config.a = 'changed';
    expect(settings.getSourceState('s').config.a).toBe('1');
  });
});

describe('generic JSON storage', () => {
  it('round-trips values, removes them and hands out copies', () => {
    expect(settings.getJson('ai.lastError')).toBeUndefined();
    const value = { message: 'boom', at: 1 };
    settings.setJson('ai.lastError', value);
    value.message = 'mutated after write';
    const read = settings.getJson<{ message: string }>('ai.lastError');
    expect(read).toEqual({ message: 'boom', at: 1 });
    read!.message = 'mutated after read';
    expect(settings.getJson('ai.lastError')).toEqual({ message: 'boom', at: 1 });
    settings.remove('ai.lastError');
    expect(settings.getJson('ai.lastError')).toBeUndefined();
    expect(createSettingsService(ctx).getJson('ai.lastError')).toBeUndefined();
  });

  it('serves repeated reads from memory', () => {
    settings.setJson('k', [1, 2]);
    const spy = vi.spyOn(db, 'scalar');
    settings.getJson('k');
    settings.getApp();
    settings.getApp();
    expect(spy).toHaveBeenCalledTimes(2); // settings.app and the stored API key, once each
  });

  it('does not keep values from a transaction that rolled back', () => {
    settings.setJson('k', 'before');
    expect(() =>
      db.tx(() => {
        settings.setJson('k', 'during');
        expect(settings.getJson('k')).toBe('during');
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(settings.getJson('k')).toBe('before');
  });

  it('clearAllSettings wipes the table and the cache', () => {
    settings.updateApp({ theme: 'dark', ai: { apiKey: 'sk' } });
    settings.setJson('x', 1);
    clearAllSettings(ctx);
    expect(settings.getApp()).toMatchObject({ theme: 'system', ai: { hasKey: false } });
    expect(settings.getJson('x')).toBeUndefined();
    expect(db.scalar('SELECT COUNT(*) FROM settings')).toBe(0);
  });
});

describe('removed keys', () => {
  it('do not stay readable in the database files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jscout-settings-'));
    const file = path.join(dir, 'jscout.db');
    const fileDb = openDb(file);
    try {
      const fileSettings = createSettingsService({ ...ctx, db: fileDb });
      const onDisk = () => ['', '-wal'].map((s) => (fs.existsSync(file + s) ? fs.readFileSync(file + s).toString('latin1') : '')).join('');
      fileSettings.updateApp({ ai: { apiKey: 'sk-ant-REMOVEDKEY42' } });
      fileSettings.setSourceState('adzuna', { config: { appKey: 'adz-REMOVEDKEY77' } });
      expect(onDisk()).toContain('sk-ant-REMOVEDKEY42');
      fileSettings.updateApp({ ai: { apiKey: null } });
      fileSettings.setSourceState('adzuna', { config: { appKey: null } });
      expect(onDisk()).not.toContain('sk-ant-REMOVEDKEY42');
      expect(onDisk()).not.toContain('adz-REMOVEDKEY77');
    } finally {
      fileDb.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
