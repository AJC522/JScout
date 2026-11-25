import type { SourcePatch } from '../../../shared/api';
import { DEFAULT_AI_MODEL } from '../../../shared/constants';
import type { AppSettings, AppSettingsUpdate, ThemePreference } from '../../../shared/types';
import type { Db } from '../../db';
import { badRequest } from '../../errors';
import type { AppContext, SettingsService, SourceState } from '../../services';

const APP_KEY = 'settings.app';
const AI_KEY_KEY = 'settings.secret.aiApiKey';
const sourceKey = (id: string) => `settings.source.${id}`;

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const MAX_TTL_MINUTES = 60 * 24 * 30;
const MAX_CONFIG_VALUE = 2000;

/** What is stored under APP_KEY (the API key is stored separately so it is never echoed by accident). */
interface StoredApp {
  theme: ThemePreference;
  autoSync: boolean;
  closedRetentionDays: number;
  maxPostingAgeDays: number;
  aiModel: string;
}

const APP_DEFAULTS: StoredApp = {
  theme: 'system',
  autoSync: true,
  closedRetentionDays: 14,
  maxPostingAgeDays: 0,
  aiModel: DEFAULT_AI_MODEL,
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isDayCount = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const isModel = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 100;

/** Keep only well-formed stored values; anything else falls back to its default. */
function readStoredApp(value: unknown): StoredApp {
  const v = isRecord(value) ? value : {};
  return {
    theme: THEMES.includes(v.theme as ThemePreference) ? (v.theme as ThemePreference) : APP_DEFAULTS.theme,
    autoSync: typeof v.autoSync === 'boolean' ? v.autoSync : APP_DEFAULTS.autoSync,
    closedRetentionDays: isDayCount(v.closedRetentionDays, 3650) ? v.closedRetentionDays : APP_DEFAULTS.closedRetentionDays,
    maxPostingAgeDays: isDayCount(v.maxPostingAgeDays, 3650) ? v.maxPostingAgeDays : APP_DEFAULTS.maxPostingAgeDays,
    aiModel: isModel(v.aiModel) ? v.aiModel.trim() : APP_DEFAULTS.aiModel,
  };
}

function readSourceState(value: unknown): SourceState {
  const v = isRecord(value) ? value : {};
  const config: Record<string, string> = {};
  if (isRecord(v.config)) {
    for (const [k, val] of Object.entries(v.config)) if (typeof val === 'string' && val) config[k] = val;
  }
  const state: SourceState = { config };
  if (typeof v.enabled === 'boolean') state.enabled = v.enabled;
  if (typeof v.ttlMinutes === 'number' && Number.isFinite(v.ttlMinutes) && v.ttlMinutes > 0) state.ttlMinutes = v.ttlMinutes;
  return state;
}

/**
 * Values written inside a transaction must not be cached: it may still roll back. Node versions
 * without `isTransaction` are treated as always inside one (correct, just uncached).
 */
const inTransaction = (db: Db): boolean => db.raw.isTransaction ?? true;

/** Cache invalidators per database, so a data reset can wipe the table without leaving stale values in memory. */
const invalidators = new WeakMap<Db, () => void>();

/** Delete every setting (data reset) and drop the in-memory cache of the settings service using this database. */
export function clearAllSettings(ctx: Pick<AppContext, 'db'>): void {
  ctx.db.run('DELETE FROM settings');
  invalidators.get(ctx.db)?.();
}

export function createSettingsService(ctx: AppContext): SettingsService {
  const { db } = ctx;
  // Parsed values by key; `undefined` entries record "no row" so misses are cached too.
  const cache = new Map<string, unknown>();
  invalidators.set(db, () => cache.clear());

  function read(key: string): unknown {
    if (cache.has(key)) return cache.get(key);
    const raw = db.scalar<string>('SELECT value FROM settings WHERE key = ?', key);
    let value: unknown;
    if (raw !== undefined) {
      try {
        value = JSON.parse(raw);
      } catch {
        ctx.log.warn('Ignoring a malformed stored setting', { key });
      }
    }
    if (!inTransaction(db)) cache.set(key, value);
    return value;
  }

  function write(key: string, value: unknown): void {
    if (value === undefined) {
      remove(key);
      return;
    }
    const json = JSON.stringify(value);
    db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, json);
    // Cache a private copy so later mutation of `value` by the caller cannot leak in.
    if (inTransaction(db)) cache.delete(key);
    else cache.set(key, JSON.parse(json));
  }

  function remove(key: string): void {
    db.run('DELETE FROM settings WHERE key = ?', key);
    if (inTransaction(db)) cache.delete(key);
    else cache.set(key, undefined);
  }

  function getSecret(key: 'ai.apiKey'): string | undefined {
    if (key !== 'ai.apiKey') return undefined;
    const stored = read(AI_KEY_KEY);
    if (typeof stored === 'string' && stored) return stored;
    const env = process.env.ANTHROPIC_API_KEY?.trim();
    return env ? env : undefined;
  }

  function getApp(): AppSettings {
    const app = readStoredApp(read(APP_KEY));
    return {
      theme: app.theme,
      autoSync: app.autoSync,
      closedRetentionDays: app.closedRetentionDays,
      maxPostingAgeDays: app.maxPostingAgeDays,
      ai: { hasKey: getSecret('ai.apiKey') !== undefined, model: app.aiModel },
    };
  }

  function updateApp(patch: AppSettingsUpdate): AppSettings {
    const next = readStoredApp(read(APP_KEY));
    if (patch.theme !== undefined) {
      if (!THEMES.includes(patch.theme)) throw badRequest('theme must be system, light or dark');
      next.theme = patch.theme;
    }
    if (patch.autoSync !== undefined) {
      if (typeof patch.autoSync !== 'boolean') throw badRequest('autoSync must be true or false');
      next.autoSync = patch.autoSync;
    }
    if (patch.closedRetentionDays !== undefined) {
      if (!isDayCount(patch.closedRetentionDays, 3650)) throw badRequest('closedRetentionDays must be a whole number of days');
      next.closedRetentionDays = patch.closedRetentionDays;
    }
    if (patch.maxPostingAgeDays !== undefined) {
      if (!isDayCount(patch.maxPostingAgeDays, 3650)) throw badRequest('maxPostingAgeDays must be a whole number of days');
      next.maxPostingAgeDays = patch.maxPostingAgeDays;
    }
    let apiKey: string | null | undefined;
    if (patch.ai !== undefined) {
      if (patch.ai.model !== undefined) {
        if (!isModel(patch.ai.model)) throw badRequest('ai.model must be a model name');
        next.aiModel = patch.ai.model.trim();
      }
      if (patch.ai.apiKey !== undefined) {
        if (patch.ai.apiKey !== null && typeof patch.ai.apiKey !== 'string') throw badRequest('ai.apiKey must be a string or null');
        // An empty key is a request to clear it, not a key.
        apiKey = patch.ai.apiKey?.trim() || null;
      }
    }
    db.tx(() => {
      write(APP_KEY, next);
      if (apiKey === null) remove(AI_KEY_KEY);
      else if (apiKey !== undefined) write(AI_KEY_KEY, apiKey);
    });
    return getApp();
  }

  function getSourceState(sourceId: string): SourceState {
    const state = readSourceState(read(sourceKey(sourceId)));
    return { ...state, config: { ...state.config } };
  }

  function setSourceState(sourceId: string, patch: SourcePatch): SourceState {
    const next = getSourceState(sourceId);
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') throw badRequest('enabled must be true or false');
      next.enabled = patch.enabled;
    }
    if (patch.ttlMinutes !== undefined) {
      const ttl = patch.ttlMinutes;
      if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl < 1 || ttl > MAX_TTL_MINUTES) {
        throw badRequest(`ttlMinutes must be between 1 and ${MAX_TTL_MINUTES}`);
      }
      next.ttlMinutes = Math.round(ttl);
    }
    for (const [field, value] of Object.entries(patch.config ?? {})) {
      if (value !== null && typeof value !== 'string') throw badRequest(`config.${field} must be a string or null`);
      const trimmed = value?.trim() ?? '';
      if (trimmed.length > MAX_CONFIG_VALUE) throw badRequest(`config.${field} is too long`);
      if (trimmed) next.config[field] = trimmed;
      else delete next.config[field];
    }
    write(sourceKey(sourceId), next);
    return getSourceState(sourceId);
  }

  return {
    getApp,
    updateApp,
    getSecret,
    getSourceState,
    setSourceState,
    getJson<T>(key: string): T | undefined {
      const value = read(key);
      // Hand out a copy: cached values are shared between callers.
      return value === undefined ? undefined : (structuredClone(value) as T);
    },
    setJson: write,
    remove,
  };
}
