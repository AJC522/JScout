import type { JobPosting, JobSourceLink, LivenessResult, Place } from '../../shared/types';
import { parseJson } from '../db';
import { htmlToText, sanitizeHtml } from '../lib/html';
import type { AppContext, JobStore } from '../services';
import { makeSnippet, postingSkills } from './normalize';
import {
  CONTENT_COLUMNS,
  contentValues,
  ftsDoc,
  type FtsDoc,
  isAtsSource,
  placeRows,
  POSTING_SELECT,
  type PostingRow,
  rowToPosting,
  sourceName,
} from './store-rows';
import type { NormalizedPosting, UpsertStats } from './types';

interface Feed {
  feedKey: string;
  source: string;
}

/** What upserts need to know about a posting already in the index. */
interface ExistingRow {
  rid: number;
  external_id: string;
  content_hash: string;
  closed_at: string | null;
  last_seen_at: string;
  has_description: number;
}

const EXISTING_SELECT = `SELECT rid, external_id, content_hash, closed_at, last_seen_at,
  description_html != '' AS has_description FROM jobs`;

const INSERT_JOB = `INSERT INTO jobs (id, source, feed_key, external_id, first_seen_at, last_seen_at, ${CONTENT_COLUMNS.join(', ')})
  VALUES (${Array.from({ length: CONTENT_COLUMNS.length + 6 }, () => '?').join(', ')})`;
const UPDATE_JOB = `UPDATE jobs SET ${CONTENT_COLUMNS.map((c) => `${c} = ?`).join(', ')},
  last_seen_at = ?, closed_at = NULL WHERE rid = ?`;
const INSERT_PLACE = `INSERT INTO job_places (job_rid, kind, city, admin1, country, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)`;
const INSERT_FTS = `INSERT INTO jobs_fts (rowid, title, company, location, tags, body) VALUES (?, ?, ?, ?, ?, ?)`;
const DELETE_FTS = `DELETE FROM jobs_fts WHERE rowid = ?`;

/** Id lists are passed as one JSON array parameter, so each statement is prepared once whatever the list length. */
const IN_JSON = `IN (SELECT value FROM json_each(?))`;

const emptyStats = (): UpsertStats => ({ added: 0, updated: 0, unchanged: 0, closed: 0, reopened: 0 });

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createJobStore(ctx: AppContext): JobStore {
  const db = ctx.db;

  function writeFts(rid: number, doc: FtsDoc): void {
    db.run(INSERT_FTS, rid, doc.title, doc.company, doc.location, doc.tags, doc.body);
  }

  function writeRelated(rid: number, p: NormalizedPosting): void {
    for (const r of placeRows(p.location)) db.run(INSERT_PLACE, rid, r.kind, r.city, r.admin1, r.country, r.lat, r.lon);
    writeFts(rid, ftsDoc(p, p.descriptionText));
  }

  function insertPosting(feed: Feed, p: NormalizedPosting, nowIso: string): void {
    const { lastInsertRowid: rid } = db.run(INSERT_JOB, p.id, feed.source, feed.feedKey, p.externalId, nowIso, nowIso, ...contentValues(p));
    writeRelated(rid, p);
  }

  function updatePosting(ex: ExistingRow, incoming: NormalizedPosting, nowIso: string): void {
    const p = ex.has_description && incoming.descriptionHtml === '' ? keepStoredDescription(ex.rid, incoming) : incoming;
    db.run(UPDATE_JOB, ...contentValues(p), nowIso, ex.rid);
    db.run(`DELETE FROM job_places WHERE job_rid = ?`, ex.rid);
    db.run(DELETE_FTS, ex.rid);
    writeRelated(ex.rid, p);
  }

  /**
   * Feeds without descriptions are completed lazily (setDescription); a later change to
   * another field must not throw that fetched description away.
   */
  function keepStoredDescription(rid: number, p: NormalizedPosting): NormalizedPosting {
    const descriptionHtml = db.scalar<string>(`SELECT description_html FROM jobs WHERE rid = ?`, rid) ?? '';
    const descriptionText = htmlToText(descriptionHtml);
    return {
      ...p,
      descriptionHtml,
      descriptionText,
      snippet: makeSnippet(descriptionText),
      skills: postingSkills(p.title, p.tags, descriptionText),
    };
  }

  function loadExisting(feed: Feed, externalIds?: string[]): Map<string, ExistingRow> {
    const rows = externalIds
      ? db.all<ExistingRow>(
          `${EXISTING_SELECT} WHERE source = ? AND feed_key = ? AND external_id ${IN_JSON}`,
          feed.source,
          feed.feedKey,
          JSON.stringify(externalIds),
        )
      : db.all<ExistingRow>(`${EXISTING_SELECT} WHERE source = ? AND feed_key = ?`, feed.source, feed.feedKey);
    return new Map(rows.map((r) => [r.external_id, r]));
  }

  /** First occurrence wins when a source lists the same posting twice (overlapping pages). */
  function uniqueBatch(feed: Feed, postings: NormalizedPosting[]): NormalizedPosting[] {
    const seen = new Set<string>();
    const out: NormalizedPosting[] = [];
    for (const p of postings) {
      if (p.feedKey !== feed.feedKey || p.source !== feed.source) {
        throw new Error(`Posting ${p.id} belongs to ${p.source}/${p.feedKey}, not ${feed.source}/${feed.feedKey}`);
      }
      if (seen.has(p.externalId)) continue;
      seen.add(p.externalId);
      out.push(p);
    }
    return out;
  }

  function writeBatch(
    batch: NormalizedPosting[],
    feed: Feed,
    existing: Map<string, ExistingRow>,
    nowIso: string,
  ): UpsertStats {
    const stats = emptyStats();
    const unchanged: number[] = [];
    for (const p of batch) {
      const ex = existing.get(p.externalId);
      if (!ex) {
        insertPosting(feed, p, nowIso);
        stats.added++;
        continue;
      }
      if (ex.closed_at !== null) stats.reopened++;
      if (ex.content_hash === p.contentHash) {
        unchanged.push(ex.rid);
        stats.unchanged++;
      } else {
        updatePosting(ex, p, nowIso);
        stats.updated++;
      }
    }
    if (unchanged.length > 0) {
      db.run(`UPDATE jobs SET last_seen_at = ?, closed_at = NULL WHERE rid ${IN_JSON}`, nowIso, JSON.stringify(unchanged));
    }
    return stats;
  }

  function closeRids(rids: number[], nowIso: string): number {
    if (rids.length === 0) return 0;
    return db.run(`UPDATE jobs SET closed_at = ? WHERE closed_at IS NULL AND rid ${IN_JSON}`, nowIso, JSON.stringify(rids)).changes;
  }

  /** Deletes the FTS rows of the jobs matching `where`, then the jobs (job_places cascade). */
  function deleteJobs(where: string, ...params: Array<string>): number {
    db.run(`DELETE FROM jobs_fts WHERE rowid IN (SELECT rid FROM jobs WHERE ${where})`, ...params);
    return db.run(`DELETE FROM jobs WHERE ${where}`, ...params).changes;
  }

  return {
    upsertFeed(feed, postings, opts) {
      const nowIso = opts.now.toISOString();
      // Without a grace cut-off every absent posting closes.
      const cutoffIso = opts.closeUnseenBefore?.toISOString();
      return db.tx(() => {
        const batch = uniqueBatch(feed, postings);
        const existing = loadExisting(feed);
        const stats = writeBatch(batch, feed, existing, nowIso);
        if (opts.complete) {
          const present = new Set(batch.map((p) => p.externalId));
          const absent = [...existing.values()].filter(
            (ex) => !present.has(ex.external_id) && ex.closed_at === null && (cutoffIso === undefined || ex.last_seen_at < cutoffIso),
          );
          stats.closed = closeRids(absent.map((ex) => ex.rid), nowIso);
        }
        return stats;
      });
    },

    upsertPostings(feed, postings, now) {
      return db.tx(() => {
        const batch = uniqueBatch(feed, postings);
        if (batch.length === 0) return emptyStats();
        const existing = loadExisting(feed, batch.map((p) => p.externalId));
        return writeBatch(batch, feed, existing, now.toISOString());
      });
    },

    getPosting(id) {
      const row = db.get<PostingRow>(`SELECT ${POSTING_SELECT} FROM jobs WHERE id = ?`, id);
      return row ? rowToPosting(row) : undefined;
    },

    getPostings(ids) {
      if (ids.length === 0) return [];
      const rows = db.all<PostingRow>(`SELECT ${POSTING_SELECT} FROM jobs WHERE id ${IN_JSON}`, JSON.stringify(ids));
      const byId = new Map(rows.map((r) => [r.id, r]));
      const out: JobPosting[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (row) out.push(rowToPosting(row));
      }
      return out;
    },

    getDescriptionHtml(id) {
      return db.scalar<string>(`SELECT description_html FROM jobs WHERE id = ?`, id) ?? '';
    },

    setDescription(id, descriptionHtml, descriptionText) {
      const row = db.get<{
        rid: number;
        title: string;
        company: string;
        location_text: string;
        remote: string;
        remote_scope: string;
        places: string;
        tags: string;
        department: string | null;
      }>(
        `SELECT rid, title, company, location_text, remote, remote_scope, places, tags, department FROM jobs WHERE id = ?`,
        id,
      );
      // The posting can be purged or removed while its description is being fetched; nothing to store then.
      if (!row) return;
      // Re-sanitising is idempotent and cheap for one posting; it keeps unsafe markup out whatever the caller did.
      const html = sanitizeHtml(descriptionHtml);
      const text = descriptionText.trim() ? descriptionText : htmlToText(html);
      const tags = parseJson<string[]>(row.tags, []);
      const skills = postingSkills(row.title, tags, text);
      const doc = ftsDoc(
        {
          title: row.title,
          company: row.company,
          locationText: row.location_text,
          location: {
            places: parseJson<Place[]>(row.places, []),
            remote: row.remote as JobPosting['location']['remote'],
            remoteScope: parseJson<string[]>(row.remote_scope, []),
          },
          tags,
          skills,
          department: row.department ?? undefined,
        },
        text,
      );
      db.tx(() => {
        db.run(
          `UPDATE jobs SET description_html = ?, snippet = ?, skills = ? WHERE rid = ?`,
          html,
          makeSnippet(text),
          JSON.stringify(skills),
          row.rid,
        );
        db.run(DELETE_FTS, row.rid);
        writeFts(row.rid, doc);
      });
    },

    clusterLinks(clusterKey) {
      const rows = db.all<{
        id: string;
        source: string;
        url: string;
        apply_url: string | null;
        posted_at: string | null;
        closed_at: string | null;
      }>(`SELECT id, source, url, apply_url, posted_at, closed_at FROM jobs WHERE cluster_key = ?`, clusterKey);
      const rank = (r: (typeof rows)[number]): number => (r.closed_at === null ? 0 : 2) + (isAtsSource(r.source) ? 0 : 1);
      rows.sort((a, b) => rank(a) - rank(b) || (b.posted_at ?? '').localeCompare(a.posted_at ?? '') || a.id.localeCompare(b.id));
      return rows.map(
        (r): JobSourceLink => ({
          jobId: r.id,
          source: r.source,
          sourceName: sourceName(r.source),
          url: r.url,
          applyUrl: r.apply_url ?? undefined,
          postedAt: r.posted_at ?? undefined,
        }),
      );
    },

    setLiveness(id, result) {
      const closedAt = result.status === 'closed' ? 'COALESCE(closed_at, ?)' : result.status === 'open' ? 'NULL' : 'closed_at';
      const params = result.status === 'closed' ? [result.checkedAt] : [];
      db.run(
        `UPDATE jobs SET liveness_status = ?, liveness_at = ?, closed_at = ${closedAt} WHERE id = ?`,
        result.status,
        result.checkedAt,
        ...params,
        id,
      );
    },

    getLiveness(id) {
      const row = db.get<{ liveness_status: string | null; liveness_at: string | null }>(
        `SELECT liveness_status, liveness_at FROM jobs WHERE id = ?`,
        id,
      );
      if (!row?.liveness_status || !row.liveness_at) return undefined;
      return { status: row.liveness_status as LivenessResult['status'], checkedAt: row.liveness_at };
    },

    closePostings(feedKey, externalIds, now) {
      if (externalIds.length === 0) return 0;
      return db.run(
        `UPDATE jobs SET closed_at = ? WHERE feed_key = ? AND closed_at IS NULL AND external_id ${IN_JSON}`,
        now.toISOString(),
        feedKey,
        JSON.stringify(externalIds),
      ).changes;
    },

    unseenSince(feedKey, before, limit) {
      const max = limit === undefined ? -1 : Math.max(0, Math.floor(limit));
      return db
        .all<{ id: string; external_id: string; last_seen_at: string }>(
          `SELECT id, external_id, last_seen_at FROM jobs
           WHERE feed_key = ? AND closed_at IS NULL AND last_seen_at < ?
           ORDER BY last_seen_at, rid LIMIT ?`,
          feedKey,
          before.toISOString(),
          max,
        )
        .map((r) => ({ id: r.id, externalId: r.external_id, lastSeenAt: r.last_seen_at }));
    },

    removeFeed(feedKey) {
      return db.tx(() => deleteJobs('feed_key = ?', feedKey));
    },

    purgeClosed(olderThan) {
      return db.tx(() => deleteJobs('closed_at < ?', olderThan.toISOString()));
    },

    openCount() {
      return db.scalar<number>(`SELECT COUNT(*) FROM jobs WHERE closed_at IS NULL`) ?? 0;
    },

    openCountBySource() {
      const rows = db.all<{ source: string; n: number }>(
        `SELECT source, COUNT(*) AS n FROM jobs WHERE closed_at IS NULL GROUP BY source`,
      );
      return new Map(rows.map((r) => [r.source, r.n]));
    },

    openCountByFeed(feedKeys) {
      if (feedKeys === undefined) {
        const rows = db.all<{ feed_key: string; n: number }>(
          `SELECT feed_key, COUNT(*) AS n FROM jobs WHERE closed_at IS NULL GROUP BY feed_key`,
        );
        return new Map(rows.map((r) => [r.feed_key, r.n]));
      }
      // Every requested feed gets an entry, 0 when it has no open postings.
      const counts = new Map(feedKeys.map((k) => [k, 0]));
      if (feedKeys.length === 0) return counts;
      const rows = db.all<{ feed_key: string; n: number }>(
        `SELECT feed_key, COUNT(*) AS n FROM jobs WHERE closed_at IS NULL AND feed_key ${IN_JSON} GROUP BY feed_key`,
        JSON.stringify(feedKeys),
      );
      for (const r of rows) counts.set(r.feed_key, r.n);
      return counts;
    },

    companyCount() {
      return db.scalar<number>(`SELECT COUNT(DISTINCT company_key) FROM jobs WHERE closed_at IS NULL`) ?? 0;
    },

    clear() {
      db.tx(() => {
        db.run(`INSERT INTO jobs_fts (jobs_fts) VALUES ('delete-all')`);
        db.run(`DELETE FROM job_places`);
        db.run(`DELETE FROM jobs`);
      });
    },
  };
}
