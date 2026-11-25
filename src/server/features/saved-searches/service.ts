import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DataExport } from '../../../shared/api';
import { isoDateSchema, searchQuerySchema } from '../../../shared/schemas';
import type { SavedSearch, SearchQuery } from '../../../shared/types';
import { parseJson } from '../../db';
import { ApiError, badRequest, notFound } from '../../errors';
import type { AppContext, SavedSearchService } from '../../services';
import { parse } from '../../validate';

export const SAVED_SEARCH_NAME_MAX = 120;
/** Counts also depend on the clock (postedWithinDays) and on hidden/tracked jobs, which raise no events. */
const COUNT_TTL_MS = 60_000;

interface SavedSearchRow {
  id: string;
  name: string;
  query: string;
  pinned: number;
  created_at: string;
  updated_at: string;
  last_viewed_at: string | null;
}

interface Counts {
  total: number;
  newCount: number;
  at: number;
}

export const savedSearchNameSchema = z.string().trim().min(1).max(SAVED_SEARCH_NAME_MAX);

const importItemSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: savedSearchNameSchema,
  query: searchQuerySchema,
  pinned: z.boolean().default(false),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema.optional(),
  lastViewedAt: isoDateSchema.nullish(),
});

const iso = (value: string): string => new Date(value).toISOString();

function parseQuery(json: string): SearchQuery {
  return { q: '', ...parseJson<Partial<SearchQuery>>(json, {}) };
}

/** Validate a query and drop paging, which a saved search must not remember. */
function storableQuery(query: unknown): SearchQuery {
  const parsed: SearchQuery = parse(searchQuerySchema, query);
  delete parsed.offset;
  delete parsed.limit;
  return parsed;
}

function checkedName(name: string): string {
  const result = savedSearchNameSchema.safeParse(name);
  if (!result.success) throw badRequest(`Name must be 1–${SAVED_SEARCH_NAME_MAX} characters`);
  return result.data;
}

export function createSavedSearchService(ctx: AppContext): SavedSearchService {
  const { db } = ctx;
  const counts = new Map<string, Counts>();

  ctx.events.subscribe((event) => {
    if (event.type === 'index-changed' || event.type === 'sync-finished') counts.clear();
  });

  function row(id: string): SavedSearchRow {
    const found = db.get<SavedSearchRow>('SELECT * FROM saved_searches WHERE id = ?', id);
    if (!found) throw notFound('Saved search');
    return found;
  }

  function countsFor(r: SavedSearchRow, query: SearchQuery): Counts {
    const cached = counts.get(r.id);
    const nowMs = ctx.now().getTime();
    if (cached && nowMs - cached.at < COUNT_TTL_MS) return cached;
    try {
      const search = ctx.services.search;
      const fresh: Counts = {
        total: search.count(query),
        newCount: search.count(query, { firstSeenAfter: r.last_viewed_at ?? r.created_at }),
        at: nowMs,
      };
      counts.set(r.id, fresh);
      return fresh;
    } catch (err) {
      // Not cached, so counts appear as soon as search works (e.g. after the first sync).
      ctx.log.debug('saved search count failed', { id: r.id, err: String(err) });
      return { total: 0, newCount: 0, at: nowMs };
    }
  }

  function toSavedSearch(r: SavedSearchRow): SavedSearch {
    const query = parseQuery(r.query);
    const { total, newCount } = countsFor(r, query);
    const item: SavedSearch = {
      id: r.id,
      name: r.name,
      query,
      pinned: r.pinned === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      total,
      newCount,
    };
    if (r.last_viewed_at) item.lastViewedAt = r.last_viewed_at;
    return item;
  }

  function listRows(): SavedSearchRow[] {
    return db.all<SavedSearchRow>('SELECT * FROM saved_searches ORDER BY pinned DESC, updated_at DESC, rowid DESC');
  }

  function list(): SavedSearch[] {
    return listRows().map(toSavedSearch);
  }

  return {
    list,

    create(input) {
      const now = ctx.now().toISOString();
      const id = randomUUID();
      db.run(
        'INSERT INTO saved_searches (id, name, query, pinned, created_at, updated_at, last_viewed_at) VALUES (?, ?, ?, 0, ?, ?, NULL)',
        id,
        checkedName(input.name),
        JSON.stringify(storableQuery(input.query)),
        now,
        now,
      );
      return toSavedSearch(row(id));
    },

    patch(id, patch) {
      const current = row(id);
      const name = patch.name === undefined ? current.name : checkedName(patch.name);
      const query = patch.query === undefined ? current.query : JSON.stringify(storableQuery(patch.query));
      const pinned = patch.pinned === undefined ? current.pinned : Number(patch.pinned);
      if (name === current.name && query === current.query && pinned === current.pinned) return toSavedSearch(current);
      if (query !== current.query) counts.delete(id);
      db.run(
        'UPDATE saved_searches SET name = ?, query = ?, pinned = ?, updated_at = ? WHERE id = ?',
        name,
        query,
        pinned,
        ctx.now().toISOString(),
        id,
      );
      return toSavedSearch(row(id));
    },

    markViewed(id) {
      row(id);
      db.run('UPDATE saved_searches SET last_viewed_at = ? WHERE id = ?', ctx.now().toISOString(), id);
      counts.delete(id);
      const item = toSavedSearch(row(id));
      // Postings first seen in the same instant would otherwise still count as new.
      counts.set(id, { total: item.total, newCount: 0, at: ctx.now().getTime() });
      return { ...item, newCount: 0 };
    },

    remove(id) {
      if (db.run('DELETE FROM saved_searches WHERE id = ?', id).changes === 0) throw notFound('Saved search');
      counts.delete(id);
    },

    totals() {
      const items = list();
      return { count: items.length, newResults: items.reduce((sum, s) => sum + s.newCount, 0) };
    },

    exportAll(): DataExport['savedSearches'] {
      return listRows().map((r) => {
        const item: DataExport['savedSearches'][number] = {
          id: r.id,
          name: r.name,
          query: parseQuery(r.query),
          pinned: r.pinned === 1,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
        if (r.last_viewed_at) item.lastViewedAt = r.last_viewed_at;
        return item;
      });
    },

    importAll(items) {
      let parsed: Array<z.infer<typeof importItemSchema>>;
      try {
        parsed = parse(z.array(importItemSchema), items);
      } catch (err) {
        if (err instanceof ApiError) throw badRequest(`savedSearches.${err.message}`, err.details);
        throw err;
      }
      db.tx(() => {
        for (const item of parsed) {
          const createdAt = iso(item.createdAt);
          db.run(
            `INSERT INTO saved_searches (id, name, query, pinned, created_at, updated_at, last_viewed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, query = excluded.query, pinned = excluded.pinned,
               created_at = excluded.created_at, updated_at = excluded.updated_at, last_viewed_at = excluded.last_viewed_at`,
            item.id,
            item.name,
            JSON.stringify(storableQuery(item.query)),
            item.pinned ? 1 : 0,
            createdAt,
            item.updatedAt ? iso(item.updatedAt) : createdAt,
            item.lastViewedAt ? iso(item.lastViewedAt) : null,
          );
        }
      });
      counts.clear();
      return parsed.length;
    },

    clear() {
      db.run('DELETE FROM saved_searches');
      counts.clear();
    },
  };
}
