import type { CompanyBulkUpdate, CompanyList, CompanyListQuery, DataExport } from '../../../shared/api';
import type { AtsKind, CompanyBoard, SyncStatus } from '../../../shared/types';
import { hasReference, loadReference } from '../../data';
import type { SqlValue } from '../../db';
import { badRequest, notFound } from '../../errors';
import { feedKeyFor } from '../../ingest/normalize';
import { sourceContext } from '../../ingest/sync';
import { foldText } from '../../lib/text';
import type { AppContext, CompaniesService } from '../../services';
import { SOURCES } from '../../sources/registry';
import type { BoardRef, JobSource } from '../../sources/types';
import { type BoardInput, normalizeBoardInput } from './board-input';
import { detectBoards } from './detect';

interface CompanyRow {
  id: string;
  name: string;
  ats: AtsKind;
  token: string;
  industry: string | null;
  origin: 'seed' | 'user';
  enabled: number;
  added_at: string;
}

interface SyncRow {
  feed_key: string;
  status: string;
  last_success_at: string | null;
  error: string | null;
}

const DEFAULT_LIMIT = 200;
const MAX_NAME = 200;
const PROBE_TIMEOUT_MS = 10_000;
const SYNC_STATUSES: ReadonlySet<string> = new Set<SyncStatus>(['idle', 'queued', 'running', 'ok', 'error']);

export interface CompaniesOptions {
  /** Adapters to use (tests pass fakes); defaults to the registry. */
  sources?: readonly JobSource[];
}

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createCompaniesService(ctx: AppContext, options: CompaniesOptions = {}): CompaniesService {
  const { db } = ctx;
  const sources = options.sources ?? SOURCES;
  const atsSource = (ats: AtsKind) => sources.find((s) => s.def.perCompany && s.def.ats === ats);
  const syncable = new Set(sources.flatMap((s) => (s.def.perCompany && s.def.ats ? [s.def.ats] : [])));
  const feedKey = (row: Pick<CompanyRow, 'ats' | 'token'>) => feedKeyFor(atsSource(row.ats)?.def.id ?? row.ats, row);

  const getRow = (id: string) => db.get<CompanyRow>('SELECT * FROM companies WHERE id = ?', id);

  function syncRows(feedKeys?: string[]): Map<string, SyncRow> {
    const rows =
      feedKeys === undefined
        ? db.all<SyncRow>(`SELECT feed_key, status, last_success_at, error FROM sync_state WHERE feed_key LIKE '%:%'`)
        : db.all<SyncRow>(
            'SELECT feed_key, status, last_success_at, error FROM sync_state WHERE feed_key IN (SELECT value FROM json_each(?))',
            JSON.stringify(feedKeys),
          );
    return new Map(rows.map((r) => [r.feed_key, r]));
  }

  function toBoard(row: CompanyRow, jobCounts: Map<string, number>, syncs: Map<string, SyncRow>): CompanyBoard {
    const key = feedKey(row);
    const sync = syncs.get(key);
    const enabled = row.enabled === 1;
    const status: SyncStatus = !enabled ? 'disabled' : sync && SYNC_STATUSES.has(sync.status) ? (sync.status as SyncStatus) : 'idle';
    return {
      id: row.id,
      name: row.name,
      ats: row.ats,
      token: row.token,
      ...(row.industry ? { industry: row.industry } : {}),
      origin: row.origin,
      enabled,
      addedAt: row.added_at,
      jobCount: jobCounts.get(key) ?? 0,
      sync: {
        status,
        ...(sync?.last_success_at ? { lastSuccessAt: sync.last_success_at } : {}),
        ...(sync?.error && status === 'error' ? { error: sync.error } : {}),
      },
    };
  }

  function boardFor(row: CompanyRow): CompanyBoard {
    const key = feedKey(row);
    return toBoard(row, ctx.services.jobs.openCountByFeed([key]), syncRows([key]));
  }

  /** Remove the postings and sync state of boards that stop being synced (inside the caller's transaction). */
  function dropFeeds(rows: CompanyRow[]): number {
    let removed = 0;
    for (const row of rows) {
      const key = feedKey(row);
      removed += ctx.services.jobs.removeFeed(key);
      db.run('DELETE FROM sync_state WHERE feed_key = ?', key);
    }
    return removed;
  }

  function queueSync(feedKeys: string[]): void {
    if (feedKeys.length === 0) return;
    try {
      ctx.services.sync.requestSync({ feedKeys });
    } catch (err) {
      // The board is saved either way; the scheduler picks it up on its next pass.
      ctx.log.warn('companies: could not queue a sync', { err });
    }
  }

  function announceIndexChange(): void {
    try {
      ctx.events.publish({ type: 'index-changed', index: ctx.services.sync.summary() });
    } catch (err) {
      ctx.log.warn('companies: could not announce an index change', { err });
    }
  }

  function cleanName(name: string): string {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) throw badRequest('Enter the company name');
    if (clean.length > MAX_NAME) throw badRequest(`The company name must be at most ${MAX_NAME} characters`);
    return clean;
  }

  function tryNormalize(input: BoardInput): BoardInput | undefined {
    try {
      return normalizeBoardInput(input, syncable);
    } catch {
      return undefined;
    }
  }

  return {
    seedIfEmpty() {
      if (db.scalar(`SELECT 1 FROM companies WHERE origin = 'seed' LIMIT 1`) !== undefined) return 0;
      if (!hasReference('companies.seed')) return 0;
      let seed: unknown;
      try {
        seed = loadReference('companies.seed');
      } catch (err) {
        ctx.log.warn('companies: the bundled company list could not be read', { err });
        return 0;
      }
      if (!Array.isArray(seed)) return 0;
      const entries = seed as BoardInput[];
      const now = ctx.now().toISOString();
      // Bundled boards start unfollowed: all of them together are ~38k postings and hundreds of MB,
      // too much to download before the user has said what they want. Onboarding (or the Companies
      // page) follows the industries they pick; the aggregator sources keep search useful meanwhile.
      return db.tx(() => {
        let inserted = 0;
        for (const entry of entries) {
          const board = tryNormalize(entry);
          if (!board) continue;
          inserted += db.run(
            `INSERT OR IGNORE INTO companies (id, name, ats, token, industry, origin, enabled, added_at)
             VALUES (?, ?, ?, ?, ?, 'seed', 0, ?)`,
            `${board.ats}:${board.token}`,
            board.name,
            board.ats,
            board.token,
            board.industry ?? null,
            now,
          ).changes;
        }
        return inserted;
      });
    },

    list(query: CompanyListQuery): CompanyList {
      const q = query.q ? foldText(query.q.trim()) : '';
      const base = db.all<CompanyRow>('SELECT * FROM companies').filter(
        (r) =>
          (!q || foldText(r.name).includes(q) || r.token.toLowerCase().includes(q)) &&
          (!query.ats || r.ats === query.ats) &&
          (query.enabled === undefined || (r.enabled === 1) === query.enabled) &&
          (!query.origin || r.origin === query.origin),
      );

      // Facet counts ignore the industry filter itself, so the other industries stay selectable.
      const facet = new Map<string, number>();
      for (const r of base) if (r.industry) facet.set(r.industry, (facet.get(r.industry) ?? 0) + 1);
      const industries = [...facet]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

      const matching = query.industry ? base.filter((r) => r.industry === query.industry) : base;
      matching.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
      const offset = query.offset ?? 0;
      const page = matching.slice(offset, offset + (query.limit ?? DEFAULT_LIMIT));

      const jobCounts = page.length > 0 ? ctx.services.jobs.openCountByFeed() : new Map<string, number>();
      const syncs = page.length > 0 ? syncRows() : new Map<string, SyncRow>();
      return {
        total: matching.length,
        enabledTotal: matching.filter((r) => r.enabled === 1).length,
        items: page.map((r) => toBoard(r, jobCounts, syncs)),
        industries,
      };
    },

    get(id) {
      const row = getRow(id);
      return row ? boardFor(row) : undefined;
    },

    enabledBoards(ats?: AtsKind): BoardRef[] {
      const rows =
        ats === undefined
          ? db.all<CompanyRow>('SELECT ats, token, name FROM companies WHERE enabled = 1 ORDER BY name COLLATE NOCASE, id')
          : db.all<CompanyRow>('SELECT ats, token, name FROM companies WHERE enabled = 1 AND ats = ? ORDER BY name COLLATE NOCASE, id', ats);
      return rows.map((r) => ({ ats: r.ats, token: r.token, name: r.name }));
    },

    detect(input) {
      return detectBoards(input, {
        sourceFor: atsSource,
        context: (source) => sourceContext(ctx, source.def, {}, AbortSignal.timeout(PROBE_TIMEOUT_MS)),
        knownName: (ats, token) => getRow(`${ats}:${token}`)?.name,
        log: ctx.log,
      });
    },

    add(input) {
      const board = normalizeBoardInput(input, syncable);
      const id = `${board.ats}:${board.token}`;
      const existing = getRow(id);
      // Re-adding a known board re-enables it; a seed board stays a seed board.
      db.run(
        `INSERT INTO companies (id, name, ats, token, industry, origin, enabled, added_at)
         VALUES (?, ?, ?, ?, ?, 'user', 1, ?)
         ON CONFLICT (id) DO UPDATE SET enabled = 1, name = excluded.name, industry = COALESCE(excluded.industry, companies.industry)`,
        id,
        board.name,
        board.ats,
        board.token,
        board.industry ?? null,
        ctx.now().toISOString(),
      );
      if (!existing || existing.enabled !== 1) queueSync([feedKey(board)]);
      return boardFor(getRow(id)!);
    },

    patch(id, patch) {
      const row = getRow(id);
      if (!row) throw notFound('Company');
      const name = patch.name === undefined ? undefined : cleanName(patch.name);
      const enabling = patch.enabled === true && row.enabled !== 1;
      const disabling = patch.enabled === false && row.enabled === 1;
      const removed = db.tx(() => {
        if (name !== undefined) db.run('UPDATE companies SET name = ? WHERE id = ?', name, id);
        if (enabling || disabling) db.run('UPDATE companies SET enabled = ? WHERE id = ?', enabling ? 1 : 0, id);
        return disabling ? dropFeeds([row]) : 0;
      });
      if (enabling) queueSync([feedKey(row)]);
      if (removed > 0) announceIndexChange();
      return boardFor(getRow(id)!);
    },

    bulk(update: CompanyBulkUpdate) {
      // Only boards whose state actually changes.
      const where = ['enabled = ?'];
      const params: SqlValue[] = [update.enabled ? 0 : 1];
      if (update.ids !== undefined) {
        where.push('id IN (SELECT value FROM json_each(?))');
        params.push(JSON.stringify(update.ids));
      }
      if (update.industry !== undefined) {
        where.push('industry = ?');
        params.push(update.industry);
      }
      if (update.origin !== undefined) {
        where.push('origin = ?');
        params.push(update.origin);
      }
      const rows = db.all<CompanyRow>(`SELECT * FROM companies WHERE ${where.join(' AND ')}`, ...params);
      if (rows.length === 0) return 0;
      const removed = db.tx(() => {
        db.run(
          'UPDATE companies SET enabled = ? WHERE id IN (SELECT value FROM json_each(?))',
          update.enabled ? 1 : 0,
          JSON.stringify(rows.map((r) => r.id)),
        );
        return update.enabled ? 0 : dropFeeds(rows);
      });
      if (update.enabled) queueSync(rows.map(feedKey));
      if (removed > 0) announceIndexChange();
      return rows.length;
    },

    remove(id) {
      const row = getRow(id);
      if (!row) throw notFound('Company');
      const removed = db.tx(() => {
        db.run('DELETE FROM companies WHERE id = ?', id);
        return dropFeeds([row]);
      });
      if (removed > 0) announceIndexChange();
    },

    exportUser() {
      // Boards the user added, plus bundled boards they chose to follow (bundled ones start unfollowed).
      return db
        .all<CompanyRow>(`SELECT * FROM companies WHERE origin = 'user' OR enabled = 1 ORDER BY name COLLATE NOCASE, id`)
        .map((r) => ({ name: r.name, ats: r.ats, token: r.token, ...(r.industry ? { industry: r.industry } : {}), enabled: r.enabled === 1 }));
    },

    importUser(items) {
      const toSync: string[] = [];
      const now = ctx.now().toISOString();
      const imported = db.tx(() => {
        let count = 0;
        for (const item of items) {
          const board = tryNormalize(item);
          if (!board) {
            ctx.log.warn('companies: skipped an imported board that cannot be synced', { ats: item.ats, token: item.token });
            continue;
          }
          const id = `${board.ats}:${board.token}`;
          const enabled = item.enabled !== false;
          const existing = getRow(id);
          if (existing) {
            db.run('UPDATE companies SET enabled = ?, industry = COALESCE(industry, ?) WHERE id = ?', enabled ? 1 : 0, board.industry ?? null, id);
            if (existing.enabled === 1 && !enabled) dropFeeds([existing]);
            if (existing.enabled !== 1 && enabled) toSync.push(feedKey(board));
          } else {
            db.run(
              `INSERT INTO companies (id, name, ats, token, industry, origin, enabled, added_at) VALUES (?, ?, ?, ?, ?, 'user', ?, ?)`,
              id,
              board.name,
              board.ats,
              board.token,
              board.industry ?? null,
              enabled ? 1 : 0,
              now,
            );
            if (enabled) toSync.push(feedKey(board));
          }
          count++;
        }
        return count;
      });
      queueSync(toSync);
      return imported;
    },
  };
}
