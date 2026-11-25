import type { JobPosting, JobSourceLink, LivenessResult, Place } from '../../shared/types';
import { parseJson } from '../db';
import { htmlToText, sanitizeHtml } from '../lib/html';
import type { AppContext, JobStore } from '../services';
import { makeSnippet, postingClearance, postingSkills } from './normalize';
import {
  clearanceValues,
  CONTENT_COLUMNS,
  contentValues,
  ftsDoc,
  type FtsDoc,
  ftsWords,
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
  cluster_key: string;
  content_hash: string;
  closed_at: string | null;
  last_seen_at: string;
  has_description: number;
}

const EXISTING_SELECT = `SELECT rid, external_id, cluster_key, content_hash, closed_at, last_seen_at,
  description_html != '' AS has_description FROM jobs`;

const INSERT_JOB = `INSERT INTO jobs (id, source, feed_key, external_id, first_seen_at, last_seen_at, ${CONTENT_COLUMNS.join(', ')})
  VALUES (${Array.from({ length: CONTENT_COLUMNS.length + 6 }, () => '?').join(', ')})`;
const UPDATE_JOB = `UPDATE jobs SET ${CONTENT_COLUMNS.map((c) => `${c} = ?`).join(', ')},
  last_seen_at = ?, closed_at = NULL WHERE rid = ?`;
const INSERT_PLACE = `INSERT INTO job_places (job_rid, kind, city, admin1, country, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)`;
const INSERT_FTS = `INSERT INTO jobs_fts (rowid, title, company, location, tags, body) VALUES (?, ?, ?, ?, ?, ?)`;
const DELETE_FTS = `DELETE FROM jobs_fts WHERE rowid = ?`;
const INSERT_WORDS = `INSERT INTO jobs_words (rowid, text) VALUES (?, ?)`;
const DELETE_WORDS = `DELETE FROM jobs_words WHERE rowid = ?`;

/** Id lists are passed as one JSON array parameter, so each statement is prepared once whatever the list length. */
const IN_JSON = `IN (SELECT value FROM json_each(?))`;

const emptyStats = (): UpsertStats => ({ added: 0, updated: 0, unchanged: 0, closed: 0, reopened: 0 });

/** Postings the background removal deletes per transaction: each stays in the tens of milliseconds. */
const PURGE_BATCH = 250;
/** Postings the clearance backfill reads per transaction. */
const BACKFILL_BATCH = 200;
/**
 * Words detectClearance needs before it reads a posting (its own cheap gate), as SQL: postings
 * without any of them stay 'none' and are never loaded. LIKE is case-insensitive for ASCII.
 */
const CLEARANCE_HINT = ['clearance', 'secret', 'public trust', 'public-trust', 'ts/sci', 'ts-sci', 'ts / sci', 'cleared', 'classified', 'security investigation', 'sf86', 'sf-86', 'sf 86', 'eqip', 'e-qip']
  .map((w) => `title LIKE '%${w}%' OR tags LIKE '%${w}%' OR description_html LIKE '%${w}%'`)
  .join(' OR ');
const NOT_REMOVED = `feed_key NOT IN (SELECT feed_key FROM removed_feeds)`;

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createJobStore(ctx: AppContext): JobStore {
  const db = ctx.db;
  /** Hidden feeds still have postings to delete; counts and search filter them out meanwhile. */
  let removing = db.scalar('SELECT 1 FROM removed_feeds LIMIT 1') !== undefined;
  let purge: Promise<void> | undefined;
  /** ` AND <not in a removed feed>` while a removal is pending, else nothing (keeps queries on their indexes). */
  const visible = (): string => (removing ? ` AND ${NOT_REMOVED}` : '');

  /** Writing to a feed again (its source or board re-enabled) cancels its pending removal. */
  function keepFeed(feedKey: string): void {
    if (removing && db.run(`DELETE FROM removed_feeds WHERE feed_key = ?`, feedKey).changes > 0) {
      removing = db.scalar('SELECT 1 FROM removed_feeds LIMIT 1') !== undefined;
    }
  }

  /** Delete hidden feeds' postings a batch per event-loop turn, so requests keep being served. */
  function startPurge(): Promise<void> {
    purge ??= (async () => {
      try {
        for (;;) {
          await new Promise<void>((resolve) => setImmediate(resolve));
          const feedKey = db.scalar<string>('SELECT feed_key FROM removed_feeds LIMIT 1');
          if (feedKey === undefined) break;
          db.tx(() => {
            const rids = db.all<{ rid: number }>(`SELECT rid FROM jobs WHERE feed_key = ? LIMIT ${PURGE_BATCH}`, feedKey).map((r) => r.rid);
            if (rids.length > 0) deleteJobs(`rid ${IN_JSON}`, JSON.stringify(rids));
            else db.run(`DELETE FROM removed_feeds WHERE feed_key = ?`, feedKey);
          });
        }
        removing = false;
      } catch (err) {
        // Typically the database closing at shutdown; the next start resumes from removed_feeds.
        ctx.log?.debug('jobs: background removal stopped', { err });
      } finally {
        purge = undefined;
      }
    })();
    return purge;
  }
  if (removing) void startPurge();

  let backfill: Promise<void> | undefined;
  /**
   * Classify the clearance requirement of postings indexed before clearances were (migration 6), a
   * batch per event-loop turn. Progress is kept in backfills, so a restart resumes where it stopped.
   */
  function startBackfill(): Promise<void> {
    backfill ??= (async () => {
      let changed = 0;
      try {
        for (;;) {
          await new Promise<void>((resolve) => setImmediate(resolve));
          const after = db.scalar<number>(`SELECT after_rid FROM backfills WHERE name = 'clearance'`);
          if (after === undefined) break;
          const rows = db.all<{ rid: number; source: string; title: string; tags: string; description_html: string }>(
            `SELECT rid, source, title, tags, description_html FROM jobs WHERE rid > ? AND (${CLEARANCE_HINT}) ORDER BY rid LIMIT ${BACKFILL_BATCH}`,
            after,
          );
          db.tx(() => {
            for (const r of rows) {
              const clearance = postingClearance(r.source, r.title, parseJson<string[]>(r.tags, []), htmlToText(r.description_html));
              if (!clearance) continue;
              db.run(`UPDATE jobs SET clearance = ?, clearance_detail = ? WHERE rid = ?`, ...clearanceValues(clearance), r.rid);
              changed++;
            }
            if (rows.length < BACKFILL_BATCH) db.run(`DELETE FROM backfills WHERE name = 'clearance'`);
            else db.run(`UPDATE backfills SET after_rid = ? WHERE name = 'clearance'`, rows[rows.length - 1]!.rid);
          });
        }
        if (changed > 0) ctx.events?.publish({ type: 'index-changed', index: ctx.services.sync.summary() });
      } catch (err) {
        // Typically the database closing at shutdown; the next start resumes from backfills.
        ctx.log?.debug('jobs: clearance backfill stopped', { err });
      } finally {
        backfill = undefined;
      }
    })();
    return backfill;
  }
  if (db.scalar(`SELECT 1 FROM backfills LIMIT 1`) !== undefined) void startBackfill();

  function writeFts(rid: number, doc: FtsDoc): void {
    db.run(INSERT_FTS, rid, doc.title, doc.company, doc.location, doc.tags, doc.body);
    db.run(INSERT_WORDS, rid, ftsWords(doc));
  }

  function deleteFts(rid: number): void {
    db.run(DELETE_FTS, rid);
    db.run(DELETE_WORDS, rid);
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
    if (ex.cluster_key !== p.clusterKey) carryUserState(ex.cluster_key, p.clusterKey, p.id);
    db.run(`DELETE FROM job_places WHERE job_rid = ?`, ex.rid);
    deleteFts(ex.rid);
    writeRelated(ex.rid, p);
  }

  /**
   * User state is keyed by cluster. When a posting moves to another cluster (its title or place
   * changed, or the clustering rules did), what the user did with it moves along: hidden stays
   * hidden, viewed stays viewed, and its tracker card keeps pointing at it. The old cluster keeps its
   * state for any copies still in it.
   */
  function carryUserState(from: string, to: string, jobId: string): void {
    db.run(`INSERT OR IGNORE INTO hidden_jobs (cluster_key, job_id, hidden_at) SELECT ?, job_id, hidden_at FROM hidden_jobs WHERE cluster_key = ?`, to, from);
    db.run(`INSERT OR IGNORE INTO job_views (cluster_key, job_id, viewed_at) SELECT ?, job_id, viewed_at FROM job_views WHERE cluster_key = ?`, to, from);
    db.run(`UPDATE applications SET cluster_key = ? WHERE cluster_key = ? AND job_id = ?`, to, from, jobId);
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
      clearance: postingClearance(p.source, p.title, p.tags, descriptionText),
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
    db.run(`DELETE FROM jobs_words WHERE rowid IN (SELECT rid FROM jobs WHERE ${where})`, ...params);
    return db.run(`DELETE FROM jobs WHERE ${where}`, ...params).changes;
  }

  return {
    upsertFeed(feed, postings, opts) {
      const nowIso = opts.now.toISOString();
      // Without a grace cut-off every absent posting closes.
      const cutoffIso = opts.closeUnseenBefore?.toISOString();
      return db.tx(() => {
        keepFeed(feed.feedKey);
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
        keepFeed(feed.feedKey);
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
        source: string;
        title: string;
        company: string;
        location_text: string;
        remote: string;
        remote_scope: string;
        places: string;
        tags: string;
        department: string | null;
      }>(
        `SELECT rid, source, title, company, location_text, remote, remote_scope, places, tags, department FROM jobs WHERE id = ?`,
        id,
      );
      // The posting can be purged or removed while its description is being fetched; nothing to store then.
      if (!row) return;
      // Re-sanitising is idempotent and cheap for one posting; it keeps unsafe markup out whatever the caller did.
      const html = sanitizeHtml(descriptionHtml);
      const text = descriptionText.trim() ? descriptionText : htmlToText(html);
      const tags = parseJson<string[]>(row.tags, []);
      const skills = postingSkills(row.title, tags, text);
      const clearance = postingClearance(row.source, row.title, tags, text);
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
          `UPDATE jobs SET description_html = ?, snippet = ?, skills = ?, clearance = ?, clearance_detail = ? WHERE rid = ?`,
          html,
          makeSnippet(text),
          JSON.stringify(skills),
          ...clearanceValues(clearance),
          row.rid,
        );
        deleteFts(row.rid);
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
          ...(r.closed_at !== null ? { closedAt: r.closed_at } : {}),
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

    hideFeeds(feedKeys) {
      if (feedKeys.length === 0) return 0;
      const keys = JSON.stringify(feedKeys);
      const hidden = db.tx(() => {
        const n = db.scalar<number>(`SELECT COUNT(*) FROM jobs WHERE closed_at IS NULL AND feed_key ${IN_JSON}${visible()}`, keys) ?? 0;
        db.run(`INSERT OR IGNORE INTO removed_feeds (feed_key) SELECT value FROM json_each(?)`, keys);
        return n;
      });
      removing = true;
      void startPurge();
      return hidden;
    },

    removingFeeds: () => removing,

    purgePending: () => purge ?? Promise.resolve(),
    backfillPending: () => backfill ?? Promise.resolve(),

    closeUnseen(feed, seenExternalIds, opts) {
      // Without a grace cut-off every absent posting closes.
      const cutoff = opts.closeUnseenBefore?.toISOString() ?? '\uffff';
      return db.run(
        `UPDATE jobs SET closed_at = ? WHERE source = ? AND feed_key = ? AND closed_at IS NULL AND last_seen_at < ?
           AND external_id NOT ${IN_JSON}`,
        opts.now.toISOString(),
        feed.source,
        feed.feedKey,
        cutoff,
        JSON.stringify(seenExternalIds),
      ).changes;
    },

    purgeClosed(olderThan, limit) {
      if (limit === undefined) return db.tx(() => deleteJobs('closed_at < ?', olderThan.toISOString()));
      return db.tx(() => {
        const rids = db.all<{ rid: number }>(`SELECT rid FROM jobs WHERE closed_at < ? LIMIT ?`, olderThan.toISOString(), Math.max(0, Math.floor(limit)));
        return rids.length ? deleteJobs(`rid ${IN_JSON}`, JSON.stringify(rids.map((r) => r.rid))) : 0;
      });
    },

    openCount() {
      return db.scalar<number>(`SELECT COUNT(*) FROM jobs WHERE closed_at IS NULL${visible()}`) ?? 0;
    },

    openCountBySource() {
      const rows = db.all<{ source: string; n: number }>(
        `SELECT source, COUNT(*) AS n FROM jobs WHERE closed_at IS NULL${visible()} GROUP BY source`,
      );
      return new Map(rows.map((r) => [r.source, r.n]));
    },

    openCountByFeed(feedKeys) {
      if (feedKeys === undefined) {
        const rows = db.all<{ feed_key: string; n: number }>(
          `SELECT feed_key, COUNT(*) AS n FROM jobs WHERE closed_at IS NULL${visible()} GROUP BY feed_key`,
        );
        return new Map(rows.map((r) => [r.feed_key, r.n]));
      }
      // Every requested feed gets an entry, 0 when it has no open postings.
      const counts = new Map(feedKeys.map((k) => [k, 0]));
      if (feedKeys.length === 0) return counts;
      const rows = db.all<{ feed_key: string; n: number }>(
        `SELECT feed_key, COUNT(*) AS n FROM jobs WHERE closed_at IS NULL AND feed_key ${IN_JSON}${visible()} GROUP BY feed_key`,
        JSON.stringify(feedKeys),
      );
      for (const r of rows) counts.set(r.feed_key, r.n);
      return counts;
    },

    companyCount() {
      return db.scalar<number>(`SELECT COUNT(DISTINCT company_key) FROM jobs WHERE closed_at IS NULL${visible()}`) ?? 0;
    },

    clear() {
      db.tx(() => {
        db.run(`INSERT INTO jobs_fts (jobs_fts) VALUES ('delete-all')`);
        db.run(`INSERT INTO jobs_words (jobs_words) VALUES ('delete-all')`);
        db.run(`DELETE FROM job_places`);
        db.run(`DELETE FROM jobs`);
        db.run(`DELETE FROM removed_feeds`);
      });
      removing = false;
    },
  };
}
