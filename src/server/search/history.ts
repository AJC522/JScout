/**
 * Recent searches. Identical searches collapse into one entry (the latest) by a signature of
 * the normalised query; only the latest HISTORY_LIMIT entries are kept.
 */
import type { SearchHistoryEntry } from '../../shared/api';
import { SEARCH_DEFAULTS } from '../../shared/constants';
import { searchQuerySchema } from '../../shared/schemas';
import type { SearchQuery } from '../../shared/types';
import { type Db, parseJson } from '../db';
import { stableHash } from '../lib/text';

export const HISTORY_LIMIT = 200;
const DEFAULT_LIST = 20;

/** Paging and fields equal to their defaults do not make a search different. */
const IGNORED = new Set<keyof SearchQuery>(['offset', 'limit']);

/**
 * The query as worth remembering: trimmed, without paging, empty values or defaults,
 * with list values sorted. Undefined when nothing was actually searched for.
 */
export function normalizeForHistory(query: SearchQuery): SearchQuery | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(query) as Array<[keyof SearchQuery, unknown]>) {
    if (IGNORED.has(key) || raw === undefined || raw === null) continue;
    const value = typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? [...new Set(raw as string[])].sort() : raw;
    if (value === '' || (Array.isArray(value) && value.length === 0)) continue;
    if ((SEARCH_DEFAULTS as Record<string, unknown>)[key] === value) continue;
    out[key] = value;
  }
  if (Object.keys(out).length === 0) return undefined;
  return { q: '', ...out } as SearchQuery;
}

export function historySignature(query: SearchQuery): string {
  const sorted = Object.fromEntries(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)));
  return stableHash('search', JSON.stringify(sorted));
}

export interface SearchHistory {
  list(limit?: number): SearchHistoryEntry[];
  record(query: SearchQuery, total: number): void;
  clear(): void;
}

export function createSearchHistory(db: Db, now: () => Date): SearchHistory {
  return {
    list(limit = DEFAULT_LIST) {
      const rows = db.all<{ query: string; ran_at: string; total: number }>(
        'SELECT query, ran_at, total FROM search_history ORDER BY id DESC LIMIT ?',
        Math.max(1, Math.min(HISTORY_LIMIT, Math.floor(limit))),
      );
      const entries: SearchHistoryEntry[] = [];
      for (const row of rows) {
        // Rows written by older versions may not match today's schema: skip rather than fail.
        const parsed = searchQuerySchema.safeParse(parseJson<unknown>(row.query, null));
        if (parsed.success) entries.push({ query: parsed.data, ranAt: row.ran_at, total: row.total });
      }
      return entries;
    },

    record(query, total) {
      const normalized = normalizeForHistory(query);
      if (!normalized) return;
      const sig = historySignature(normalized);
      db.tx(() => {
        db.run('DELETE FROM search_history WHERE sig = ?', sig);
        db.run('INSERT INTO search_history (query, sig, ran_at, total) VALUES (?, ?, ?, ?)', JSON.stringify(normalized), sig, now().toISOString(), Math.max(0, Math.floor(total)));
        db.run('DELETE FROM search_history WHERE id NOT IN (SELECT id FROM search_history ORDER BY id DESC LIMIT ?)', HISTORY_LIMIT);
      });
    },

    clear() {
      db.run('DELETE FROM search_history');
    },
  };
}
