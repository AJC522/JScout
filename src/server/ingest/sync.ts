/**
 * The sync engine: keeps the local index fresh without hammering anyone's API.
 *
 * A feed is one sync unit: a feed-mode source (feed key = source id) or one company
 * board of an ATS source (feed key = "<source>:<token>"). Stale feeds are queued and a
 * small runner fetches them with bounded concurrency, normalises in chunks so the UI
 * stays responsive, writes them to the JobStore and records the outcome in sync_state.
 *
 * sync_state.status is the live state shared with the companies service:
 * queued -> running -> ok | error ('idle' = never attempted).
 */
import { createHash } from 'node:crypto';
import type { SourcePatch, SourceTestResult } from '../../shared/api';
import type { IndexSummary, LivenessResult, ServerEvent, SourceInfo, SourceSyncSummary, SyncStatus } from '../../shared/types';
import type { SqlValue } from '../db';
import { badRequest, notFound } from '../errors';
import type { AppContext, Logger, SourceState, SyncService } from '../services';
import { SOURCES } from '../sources/registry';
import {
  type BoardRef,
  type FeedCursor,
  type HttpClient,
  type HttpRequestOptions,
  type JobSource,
  type RawPosting,
  type SourceContext,
  type SourceDefinition,
  SourceError,
} from '../sources/types';
import { type NormalizeContext, feedKeyFor, normalizePosting } from './normalize';
import type { NormalizedPosting, UpsertStats } from './types';

const MAX_CONCURRENT = 4;
/** Company boards of one ATS live on one API host; the HTTP client paces that host as well. */
const ATS_FEEDS_PER_SOURCE = 2;
const CHUNK_SIZE = 200;
const FIRST_PASS_DELAY_MS = 2_000;
const TICK_MS = 5 * 60_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const BACKOFF_BASE_MS = 5 * MINUTE_MS;
const BACKOFF_MAX_MS = DAY_MS;
const SWEEP_MAX_IDS = 300;
/** Rolling-window feeds without checkOpen: a posting unseen this long has almost certainly closed. */
const UNSEEN_CLOSE_MS = 21 * DAY_MS;
const SEARCH_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 20_000;
const DETAIL_TIMEOUT_MS = 15_000;

/** settings keys (JSON) for state that must survive a restart. */
const HOLDS_KEY = 'sync.holds';
const SWEEPS_KEY = 'sync.sweeps';
const MAINTENANCE_KEY = 'sync.maintenanceAt';

/** The status a feed returns to when it leaves the queue without finishing. */
const SETTLED_STATUS = `CASE WHEN consecutive_failures > 0 THEN 'error' WHEN last_success_at IS NOT NULL THEN 'ok' ELSE 'idle' END`;
const STORED_STATUSES: ReadonlySet<string> = new Set<SyncStatus>(['idle', 'queued', 'running', 'ok', 'error']);

interface SyncRow {
  feed_key: string;
  source: string;
  status: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  error: string | null;
  etag: string | null;
  last_modified: string | null;
  job_count: number;
  duration_ms: number | null;
  consecutive_failures: number;
}

/**
 * Why a failing feed waits longer than the normal backoff. Persisted so a restart
 * does not retry early: a server's Retry-After, a company board that no longer
 * exists (retry daily), or rejected credentials (wait for the config to change).
 */
export interface FeedHold {
  kind: 'rate-limited' | 'not-found' | 'auth';
  until?: string;
  /** configFingerprint() of the source config that was rejected. */
  config?: string;
}

interface Feed {
  key: string;
  source: JobSource;
  board?: BoardRef;
}

interface QueueEntry {
  feed: Feed;
  /** Higher runs first: never-synced feeds, then the most stale. */
  priority: number;
  seq: number;
}

// --- pure helpers (exported for tests) ------------------------------------------------

/** Delay after `failures` consecutive failures: 5 min, doubling, capped at 24 h. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 30), BACKOFF_MAX_MS);
}

const epoch = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * When a feed next needs syncing, in epoch ms: 0 when it has never been attempted,
 * Infinity when it must wait for the user to change the source's config.
 */
export function feedDueAt(
  row: Pick<SyncRow, 'last_attempt_at' | 'last_success_at' | 'consecutive_failures'> | undefined,
  ttlMinutes: number,
  hold: FeedHold | undefined,
  configFingerprint: string,
): number {
  if (!row?.last_attempt_at) return 0;
  const fresh = row.last_success_at ? epoch(row.last_success_at) + ttlMinutes * MINUTE_MS : 0;
  if (row.consecutive_failures <= 0) return fresh;
  if (hold?.kind === 'auth' && hold.config === configFingerprint) return Number.POSITIVE_INFINITY;
  let retry = epoch(row.last_attempt_at) + backoffMs(row.consecutive_failures);
  if (hold?.until) retry = Math.max(retry, epoch(hold.until));
  return Math.max(fresh, retry);
}

/** Stable digest of a source's config, so a held auth failure is retried once the key changes. */
export function configFingerprint(config: Record<string, string>): string {
  const entries = Object.entries(config).sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);
}

/** A failure as one short human sentence (shown in Settings and the companies list). */
export function describeError(err: unknown, sourceName: string, board?: BoardRef): string {
  if (err instanceof SourceError) {
    switch (err.kind) {
      case 'rate-limited':
        return `${sourceName} is rate limiting requests; try again later`;
      case 'auth':
        return `${sourceName} did not accept the API key; check it in Settings`;
      case 'not-found':
        return board ? `${board.name} no longer has a ${sourceName} job board` : `${sourceName} could not find the job feed; it may have moved`;
      case 'blocked':
        return `${sourceName} blocked the request; try again later`;
      case 'network':
        return `Could not reach ${sourceName}; check your internet connection`;
      case 'parse':
        return `${sourceName} sent data JScout could not read`;
      case 'aborted':
        return `${sourceName} did not answer in time; try again later`;
      case 'http':
        return `${sourceName} answered with an error${err.status ? ` (HTTP ${err.status})` : ''}; try again later`;
    }
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `${sourceName} failed unexpectedly (${detail.slice(0, 120)})`;
}

function holdFor(err: unknown, feed: Feed, config: Record<string, string>, at: Date): FeedHold | undefined {
  if (!(err instanceof SourceError)) return undefined;
  if (err.kind === 'rate-limited' && err.retryAfter && err.retryAfter > 0) {
    return { kind: 'rate-limited', until: new Date(at.getTime() + err.retryAfter * 1000).toISOString() };
  }
  if (err.kind === 'not-found' && feed.board) return { kind: 'not-found', until: new Date(at.getTime() + DAY_MS).toISOString() };
  if (err.kind === 'auth') return { kind: 'auth', config: configFingerprint(config) };
  return undefined;
}

/** HTTP client that applies the source's pacing and abort signal to every request an adapter makes. */
function pacedHttp(http: HttpClient, minIntervalMs: number, signal: AbortSignal | undefined): HttpClient {
  const withDefaults = (o: HttpRequestOptions = {}): HttpRequestOptions => ({
    ...o,
    minIntervalMs: o.minIntervalMs ?? minIntervalMs,
    ...(o.signal ?? signal ? { signal: o.signal ?? signal } : {}),
  });
  return {
    getJson: <T>(url: string, o?: HttpRequestOptions) => http.getJson<T>(url, withDefaults(o)),
    getText: (url: string, o?: HttpRequestOptions) => http.getText(url, withDefaults(o)),
    postJson: <T>(url: string, body: unknown, o?: HttpRequestOptions) => http.postJson<T>(url, body, withDefaults(o)),
  };
}

/** The context an adapter call runs with. Also used by the companies service for board probes. */
export function sourceContext(
  ctx: Pick<AppContext, 'http' | 'log' | 'now'>,
  def: SourceDefinition,
  config: Record<string, string>,
  signal?: AbortSignal,
): SourceContext {
  return {
    http: pacedHttp(ctx.http, def.minRequestIntervalMs, signal),
    config: { ...config },
    log: ctx.log,
    ...(signal ? { signal } : {}),
    now: () => ctx.now(),
  };
}

/** Normalise in chunks, yielding to the event loop between them: normalisation is CPU-heavy. */
async function normalizeAll(raws: RawPosting[], nctx: NormalizeContext, signal: AbortSignal, log: Logger): Promise<NormalizedPosting[]> {
  const out: NormalizedPosting[] = [];
  let skipped = 0;
  for (let i = 0; i < raws.length; i += CHUNK_SIZE) {
    if (i > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      signal.throwIfAborted();
    }
    for (const raw of raws.slice(i, i + CHUNK_SIZE)) {
      let posting: NormalizedPosting | null = null;
      try {
        posting = normalizePosting(raw, nctx);
      } catch (err) {
        log.debug('sync: a posting could not be normalised', { feedKey: nctx.feedKey, err });
      }
      if (posting) out.push(posting);
      else skipped++;
    }
  }
  if (skipped > 0) log.info(`sync: skipped ${skipped} of ${raws.length} postings without the required fields`, { feedKey: nctx.feedKey });
  return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// --- the service ----------------------------------------------------------------------------

export interface SyncOptions {
  /** Adapters to use (tests pass fakes); defaults to the registry. */
  sources?: readonly JobSource[];
}

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 * stop() is final: a stopped engine queues nothing more.
 */
export function createSyncService(ctx: AppContext, options: SyncOptions = {}): SyncService {
  const { db, log } = ctx;
  const sources = options.sources ?? SOURCES;
  const services = () => ctx.services;

  const queue: QueueEntry[] = [];
  const queuedKeys = new Set<string>();
  const running = new Map<string, { feed: Feed; controller: AbortController; done: Promise<void> }>();
  /** Ad-hoc upstream work (tests, searches, detail fetches, sweeps) that stop() must wait for. */
  const adhoc = new Set<Promise<unknown>>();
  const descriptionFetches = new Map<string, Promise<string>>();
  const lastServed = new Map<string, number>();
  const lifecycle = new AbortController();
  let idleWaiters: Array<() => void> = [];
  let currentRun: { startedAt: number; added: number } | undefined;
  let firstPass: ReturnType<typeof setTimeout> | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let seq = 0;
  let served = 0;

  // --- sources and feeds ---------------------------------------------------------------------

  const findSource = (id: string) => sources.find((s) => s.def.id === id);
  const isEnabled = (def: SourceDefinition, state: SourceState) => state.enabled ?? def.defaultEnabled;
  const isConfigured = (def: SourceDefinition, state: SourceState) =>
    def.configFields.every((f) => !f.required || Boolean(state.config[f.key]?.trim()));
  const ttlOf = (def: SourceDefinition, state: SourceState) => state.ttlMinutes ?? def.defaultTtlMinutes;

  /** The source's state when it is enabled and configured; undefined otherwise. */
  function activeState(source: JobSource): SourceState | undefined {
    const state = services().settings.getSourceState(source.def.id);
    return isEnabled(source.def, state) && isConfigured(source.def, state) ? state : undefined;
  }

  function activeSources(): Array<{ source: JobSource; state: SourceState }> {
    return sources.flatMap((source) => {
      const state = activeState(source);
      return state ? [{ source, state }] : [];
    });
  }

  function feedsOf(source: JobSource): Feed[] {
    const def = source.def;
    if (def.mode !== 'feed' || !source.fetchFeed) return [];
    if (!def.perCompany) return [{ key: def.id, source }];
    if (!def.ats) return [];
    return services()
      .companies.enabledBoards(def.ats)
      .map((board) => ({ key: feedKeyFor(def.id, board), source, board }));
  }

  /** The source state when this feed should still be synced (source active and, for a board, still enabled). */
  function feedState(feed: Feed): SourceState | undefined {
    const state = activeState(feed.source);
    if (!state || !feed.board) return state;
    return services().companies.get(`${feed.board.ats}:${feed.board.token}`)?.enabled ? state : undefined;
  }

  // --- sync_state ---------------------------------------------------------------------------

  const getRow = (key: string) => db.get<SyncRow>('SELECT * FROM sync_state WHERE feed_key = ?', key);

  function rowsFor(keys: string[]): Map<string, SyncRow> {
    const rows = db.all<SyncRow>('SELECT * FROM sync_state WHERE feed_key IN (SELECT value FROM json_each(?))', JSON.stringify(keys));
    return new Map(rows.map((r) => [r.feed_key, r]));
  }

  function setStatus(feeds: Feed[], status: 'queued' | 'running'): void {
    db.tx(() => {
      for (const feed of feeds) {
        db.run(
          `INSERT INTO sync_state (feed_key, source, status) VALUES (?, ?, ?)
           ON CONFLICT (feed_key) DO UPDATE SET status = excluded.status`,
          feed.key,
          feed.source.def.id,
          status,
        );
      }
    });
  }

  function settle(keys: string[]): void {
    if (keys.length === 0) return;
    db.run(
      `UPDATE sync_state SET status = ${SETTLED_STATUS}
       WHERE status IN ('queued', 'running') AND feed_key IN (SELECT value FROM json_each(?))`,
      JSON.stringify(keys),
    );
  }

  function writeRow(r: {
    feedKey: string;
    source: string;
    ok: boolean;
    attemptAt: Date;
    successAt: string | null;
    error: string | null;
    cursor: FeedCursor | undefined;
    durationMs: number;
    failures: number;
  }): void {
    const jobCount = services().jobs.openCountByFeed([r.feedKey]).get(r.feedKey) ?? 0;
    const values: SqlValue[] = [
      r.feedKey,
      r.source,
      r.ok ? 'ok' : 'error',
      r.attemptAt.toISOString(),
      r.successAt,
      r.error,
      r.cursor?.etag ?? null,
      r.cursor?.lastModified ?? null,
      jobCount,
      r.durationMs,
      r.failures,
    ];
    db.run(
      `INSERT INTO sync_state (feed_key, source, status, last_attempt_at, last_success_at, error, etag, last_modified,
                               job_count, duration_ms, consecutive_failures)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (feed_key) DO UPDATE SET
         source = excluded.source, status = excluded.status, last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at, error = excluded.error, etag = excluded.etag,
         last_modified = excluded.last_modified, job_count = excluded.job_count, duration_ms = excluded.duration_ms,
         consecutive_failures = excluded.consecutive_failures`,
      ...values,
    );
  }

  const cursorOf = (row: SyncRow | undefined): FeedCursor | undefined =>
    row?.etag || row?.last_modified
      ? { ...(row.etag ? { etag: row.etag } : {}), ...(row.last_modified ? { lastModified: row.last_modified } : {}) }
      : undefined;

  // --- persisted maps (settings JSON) ---------------------------------------------------------

  function readMap<T>(key: string): Record<string, T> {
    return services().settings.getJson<Record<string, T>>(key) ?? {};
  }

  function updateMap<T>(key: string, change: (map: Record<string, T>) => boolean): void {
    const map = readMap<T>(key);
    if (change(map)) services().settings.setJson(key, map);
  }

  function setHold(feedKey: string, hold: FeedHold | undefined): void {
    updateMap<FeedHold>(HOLDS_KEY, (holds) => {
      if (hold) holds[feedKey] = hold;
      else if (feedKey in holds) delete holds[feedKey];
      else return false;
      return true;
    });
  }

  /** Forget holds and sweep times of a source's feeds (it was disabled or reconfigured). */
  function forgetSource(sourceId: string): void {
    const belongs = (key: string) => key === sourceId || key.startsWith(`${sourceId}:`);
    for (const mapKey of [HOLDS_KEY, SWEEPS_KEY]) {
      updateMap<unknown>(mapKey, (map) => {
        const keys = Object.keys(map).filter(belongs);
        for (const key of keys) delete map[key];
        return keys.length > 0;
      });
    }
  }

  // --- events -------------------------------------------------------------------------------

  function publish(make: () => ServerEvent): void {
    try {
      ctx.events.publish(make());
    } catch (err) {
      log.warn('sync: could not publish an event', { err });
    }
  }

  const indexChanged = () => publish(() => ({ type: 'index-changed', index: summary() }));
  const pendingCount = () => queue.length + running.size;

  // --- queue and runner ---------------------------------------------------------------------

  function enqueue(entries: Array<Omit<QueueEntry, 'seq'>>): void {
    if (entries.length === 0) return;
    setStatus(
      entries.map((e) => e.feed),
      'queued',
    );
    for (const entry of entries) {
      queue.push({ ...entry, seq: seq++ });
      queuedKeys.add(entry.feed.key);
    }
    if (!currentRun) {
      currentRun = { startedAt: performance.now(), added: 0 };
      publish(() => ({ type: 'sync-started', feeds: pendingCount() }));
    }
    pump();
  }

  /**
   * Index of the next feed to run, or -1. Respects the per-source limits, keeps one
   * slot free for aggregator feeds while any is waiting (so hundreds of company boards
   * cannot starve them), and otherwise picks the highest priority, rotating between
   * sources on ties.
   */
  function pickNext(): number {
    const perSource = new Map<string, number>();
    let boardsRunning = 0;
    for (const { feed } of running.values()) {
      perSource.set(feed.source.def.id, (perSource.get(feed.source.def.id) ?? 0) + 1);
      if (feed.board) boardsRunning++;
    }
    const hasRoom = (feed: Feed) =>
      (perSource.get(feed.source.def.id) ?? 0) < (feed.source.def.perCompany ? ATS_FEEDS_PER_SOURCE : 1);
    const aggregatorWaiting = queue.some((e) => !e.feed.board && hasRoom(e.feed));
    const lastServedOf = (e: QueueEntry) => lastServed.get(e.feed.source.def.id) ?? -1;

    let best = -1;
    queue.forEach((entry, index) => {
      if (!hasRoom(entry.feed)) return;
      if (entry.feed.board && aggregatorWaiting && boardsRunning >= MAX_CONCURRENT - 1) return;
      const current = best >= 0 ? queue[best] : undefined;
      if (
        !current ||
        entry.priority > current.priority ||
        (entry.priority === current.priority &&
          (lastServedOf(entry) < lastServedOf(current) || (lastServedOf(entry) === lastServedOf(current) && entry.seq < current.seq)))
      ) {
        best = index;
      }
    });
    return best;
  }

  function pump(): void {
    while (!stopped && running.size < MAX_CONCURRENT) {
      const index = pickNext();
      if (index < 0) break;
      const [entry] = queue.splice(index, 1);
      if (!entry) break;
      queuedKeys.delete(entry.feed.key);
      startFeed(entry.feed);
    }
    if (running.size === 0 && queue.length === 0) finishRun();
  }

  function startFeed(feed: Feed): void {
    lastServed.set(feed.source.def.id, served++);
    const controller = new AbortController();
    const done = runFeed(feed, AbortSignal.any([lifecycle.signal, controller.signal]))
      .catch((err: unknown) => {
        // runFeed records its own failures; this only guards against a bug leaving the runner stuck.
        log.error('sync: feed run crashed', { feedKey: feed.key, err });
        try {
          settle([feed.key]);
        } catch {
          /* the database may already be closed during shutdown */
        }
      })
      .finally(() => {
        running.delete(feed.key);
        pump();
      });
    running.set(feed.key, { feed, controller, done });
  }

  function finishRun(): void {
    if (currentRun) {
      const run = currentRun;
      currentRun = undefined;
      publish(() => ({ type: 'sync-finished', index: summary(), added: run.added, durationMs: Math.round(performance.now() - run.startedAt) }));
    }
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function runFeed(feed: Feed, signal: AbortSignal): Promise<void> {
    const state = feedState(feed);
    if (!state) return settle([feed.key]);
    const def = feed.source.def;
    const { jobs } = services();
    const startedAt = ctx.now();
    const t0 = performance.now();
    setStatus([feed], 'running');
    const prev = getRow(feed.key);

    let stats: UpsertStats | undefined;
    let closedLater = 0;
    let cursor = cursorOf(prev);
    let failure: unknown;
    try {
      const result = await feed.source.fetchFeed!(sourceContext(ctx, def, state.config, signal), feed.board, cursor);
      if (result.notModified) {
        cursor = result.cursor ?? cursor;
      } else {
        cursor = result.cursor;
        const postings = await normalizeAll(result.postings, { source: def, feedKey: feed.key, board: feed.board, now: startedAt }, signal, log);
        signal.throwIfAborted();
        // The source or board may have been switched off while this feed was fetching.
        if (!feedState(feed)) return settle([feed.key]);
        const complete = def.fullSnapshot && result.complete;
        stats = jobs.upsertFeed({ feedKey: feed.key, source: def.id }, postings, {
          complete,
          now: startedAt,
          closeUnseenBefore: new Date(startedAt.getTime() - (def.closeGraceMinutes ?? 0) * MINUTE_MS),
        });
        if (!complete) closedLater = await closeVanished(feed, state.config, startedAt, signal);
      }
    } catch (err) {
      if (signal.aborted) return settle([feed.key]);
      failure = err;
    }
    if (signal.aborted || !feedState(feed)) return settle([feed.key]);

    const durationMs = Math.round(performance.now() - t0);
    const error = failure === undefined ? undefined : describeError(failure, def.name, feed.board);
    if (failure === undefined) {
      writeRow({ feedKey: feed.key, source: def.id, ok: true, attemptAt: startedAt, successAt: ctx.now().toISOString(), error: null, cursor, durationMs, failures: 0 });
      setHold(feed.key, undefined);
    } else {
      const failures = (prev?.consecutive_failures ?? 0) + 1;
      writeRow({
        feedKey: feed.key,
        source: def.id,
        ok: false,
        attemptAt: startedAt,
        successAt: prev?.last_success_at ?? null,
        error: error ?? null,
        cursor: cursorOf(prev),
        durationMs,
        failures,
      });
      setHold(feed.key, holdFor(failure, feed, state.config, startedAt));
      log.warn(`sync: ${feed.key} failed (${failures} in a row)`, { reason: failure instanceof Error ? failure.message : String(failure) });
    }

    const added = stats?.added ?? 0;
    const closed = (stats?.closed ?? 0) + closedLater;
    if (currentRun) currentRun.added += added;
    publish(() => ({
      type: 'feed-finished',
      feedKey: feed.key,
      source: def.id,
      ok: failure === undefined,
      added,
      updated: stats?.updated ?? 0,
      closed,
      ...(error ? { error } : {}),
      // This feed still counts as running until the runner removes it.
      pendingFeeds: pendingCount() - 1,
    }));
    if (added + (stats?.updated ?? 0) + closed + (stats?.reopened ?? 0) > 0) indexChanged();
  }

  /**
   * Close postings that dropped out of an incomplete (rolling-window) feed. Postings
   * seen by this run have last_seen_at = `seenAt`, so anything older was not in it.
   * With checkOpen the source is asked (at most once a day per feed); without it,
   * postings unseen for 21 days are closed. Returns postings closed.
   */
  async function closeVanished(feed: Feed, config: Record<string, string>, seenAt: Date, signal: AbortSignal): Promise<number> {
    const { jobs } = services();
    const checkOpen = feed.source.checkOpen;
    if (!checkOpen) {
      const stale = jobs.unseenSince(feed.key, new Date(seenAt.getTime() - UNSEEN_CLOSE_MS));
      return stale.length > 0 ? jobs.closePostings(feed.key, stale.map((p) => p.externalId), ctx.now()) : 0;
    }
    const now = ctx.now();
    const lastSweep = readMap<string>(SWEEPS_KEY)[feed.key];
    if (lastSweep && now.getTime() - epoch(lastSweep) < DAY_MS) return 0;
    const candidates = jobs.unseenSince(feed.key, seenAt, SWEEP_MAX_IDS);
    if (candidates.length === 0) return 0;
    // Recorded before asking, so a failing or concurrent sweep is not repeated within the day.
    updateMap<string>(SWEEPS_KEY, (map) => {
      map[feed.key] = now.toISOString();
      return true;
    });
    try {
      const open = await checkOpen.call(
        feed.source,
        sourceContext(ctx, feed.source.def, config, signal),
        candidates.map((c) => c.externalId),
      );
      signal.throwIfAborted();
      if (!feedState(feed)) return 0;
      const closed = candidates.filter((c) => open.get(c.externalId) === false).map((c) => c.externalId);
      return closed.length > 0 ? jobs.closePostings(feed.key, closed, ctx.now()) : 0;
    } catch (err) {
      if (signal.aborted) throw err;
      log.warn(`sync: checking which ${feed.source.def.name} postings are still open failed`, { err });
      return 0;
    }
  }

  // --- requests ----------------------------------------------------------------------------

  function requestSync(opts: { sources?: string[]; feedKeys?: string[]; force?: boolean } = {}): number {
    if (stopped) return 0;
    const wantSources = opts.sources ? new Set(opts.sources) : undefined;
    const wantKeys = opts.feedKeys ? new Set(opts.feedKeys) : undefined;
    const candidates: Array<{ feed: Feed; state: SourceState }> = [];
    for (const { source, state } of activeSources()) {
      if (wantSources && !wantSources.has(source.def.id)) continue;
      for (const feed of feedsOf(source)) {
        if (wantKeys && !wantKeys.has(feed.key)) continue;
        if (queuedKeys.has(feed.key) || running.has(feed.key)) continue;
        candidates.push({ feed, state });
      }
    }
    if (candidates.length === 0) return 0;

    const now = ctx.now().getTime();
    const rows = rowsFor(candidates.map((c) => c.feed.key));
    const holds = readMap<FeedHold>(HOLDS_KEY);
    const fingerprints = new Map<SourceState, string>();
    const ready: Array<Omit<QueueEntry, 'seq'>> = [];
    for (const { feed, state } of candidates) {
      const row = rows.get(feed.key);
      const hold = holds[feed.key];
      if (opts.force) {
        // Even a forced sync honours a server's explicit request to wait.
        if (hold?.kind === 'rate-limited' && epoch(hold.until) > now) continue;
      } else {
        let fingerprint = fingerprints.get(state);
        if (fingerprint === undefined) {
          fingerprint = configFingerprint(state.config);
          fingerprints.set(state, fingerprint);
        }
        if (feedDueAt(row, ttlOf(feed.source.def, state), hold, fingerprint) > now) continue;
      }
      const priority = row?.last_success_at ? now - epoch(row.last_success_at) : Number.MAX_SAFE_INTEGER;
      ready.push({ feed, priority });
    }
    enqueue(ready);
    return ready.length;
  }

  /** Remove a source's postings and sync state so they disappear from results immediately. */
  function deactivate(sourceId: string): void {
    for (let i = queue.length - 1; i >= 0; i--) {
      const entry = queue[i]!;
      if (entry.feed.source.def.id !== sourceId) continue;
      queue.splice(i, 1);
      queuedKeys.delete(entry.feed.key);
    }
    for (const run of running.values()) if (run.feed.source.def.id === sourceId) run.controller.abort();
    // Every feed that ever ran has a sync_state row (it is written when the feed is queued).
    const feedKeys = new Set([sourceId, ...db.all<{ feed_key: string }>('SELECT feed_key FROM sync_state WHERE source = ?', sourceId).map((r) => r.feed_key)]);
    const removed = db.tx(() => {
      let n = 0;
      for (const key of feedKeys) n += services().jobs.removeFeed(key);
      db.run('DELETE FROM sync_state WHERE source = ?', sourceId);
      return n;
    });
    forgetSource(sourceId);
    if (removed > 0) indexChanged();
    pump();
  }

  async function withDeadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Racing a timer as well as aborting covers adapters that ignore the signal.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SourceError('aborted', `timed out after ${ms} ms`));
      }, ms);
    });
    try {
      return await Promise.race([work(AbortSignal.any([lifecycle.signal, controller.signal])), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  function track<T>(work: Promise<T>): Promise<T> {
    adhoc.add(work);
    const forget = () => adhoc.delete(work);
    work.then(forget, forget);
    return work;
  }

  async function searchOne(source: JobSource, state: SourceState, query: Parameters<SyncService['searchUpstream']>[0]): Promise<number> {
    const def = source.def;
    const startedAt = ctx.now();
    const t0 = performance.now();
    const prev = getRow(def.id);
    try {
      const raws = await withDeadline(SEARCH_TIMEOUT_MS, (signal) => source.search!(sourceContext(ctx, def, state.config, signal), query));
      const postings = await normalizeAll(raws, { source: def, feedKey: def.id, now: startedAt }, lifecycle.signal, log);
      if (!activeState(source)) return 0;
      const stats = services().jobs.upsertPostings({ feedKey: def.id, source: def.id }, postings, startedAt);
      writeRow({ feedKey: def.id, source: def.id, ok: true, attemptAt: startedAt, successAt: ctx.now().toISOString(), error: null, cursor: undefined, durationMs: Math.round(performance.now() - t0), failures: 0 });
      if (stats.added + stats.updated + stats.reopened > 0) indexChanged();
      return stats.added;
    } catch (err) {
      if (lifecycle.signal.aborted) return 0;
      log.warn(`sync: searching ${def.name} failed`, { reason: err instanceof Error ? err.message : String(err) });
      if (activeState(source)) {
        writeRow({
          feedKey: def.id,
          source: def.id,
          ok: false,
          attemptAt: startedAt,
          successAt: prev?.last_success_at ?? null,
          error: describeError(err, def.name),
          cursor: undefined,
          durationMs: Math.round(performance.now() - t0),
          failures: (prev?.consecutive_failures ?? 0) + 1,
        });
      }
      return 0;
    }
  }

  // --- posting details ------------------------------------------------------------------------

  interface DetailTarget {
    posting: { id: string; externalId: string; url: string; title: string; company: string; closedAt?: string };
    source: JobSource;
    board?: BoardRef;
  }

  function detailTarget(jobId: string): DetailTarget | undefined {
    const posting = services().jobs.getPosting(jobId);
    const source = posting ? findSource(posting.source) : undefined;
    if (!posting || !source) return undefined;
    if (!source.def.perCompany) return { posting, source };
    // JobPosting does not carry its feed key, and the board token is only in there.
    const feedKey = db.scalar<string>('SELECT feed_key FROM jobs WHERE id = ?', jobId);
    const prefix = `${source.def.id}:`;
    if (!source.def.ats || !feedKey?.startsWith(prefix)) return { posting, source };
    const token = feedKey.slice(prefix.length);
    const company = services().companies.get(`${source.def.ats}:${token}`);
    return { posting, source, board: { ats: source.def.ats, token, name: company?.name ?? posting.company } };
  }

  function fetchDetail(target: DetailTarget): Promise<Partial<RawPosting> | null> {
    const { source, posting, board } = target;
    const config = services().settings.getSourceState(source.def.id).config;
    return withDeadline(DETAIL_TIMEOUT_MS, (signal) =>
      source.fetchDetail!(sourceContext(ctx, source.def, config, signal), { externalId: posting.externalId, url: posting.url }, board),
    );
  }

  /** Store a fetched description, cleaned exactly like descriptions that arrive with the feed. */
  function storeDescription(target: DetailTarget, detail: Partial<RawPosting>): void {
    const { posting, source, board } = target;
    if (!detail.descriptionHtml && !detail.descriptionText) return;
    const normalized = normalizePosting(
      {
        externalId: posting.externalId,
        url: posting.url,
        title: posting.title,
        company: posting.company,
        locations: [],
        ...(detail.descriptionHtml ? { descriptionHtml: detail.descriptionHtml } : {}),
        ...(detail.descriptionText ? { descriptionText: detail.descriptionText } : {}),
      },
      { source: source.def, feedKey: feedKeyFor(source.def.id, board), ...(board ? { board } : {}), now: ctx.now() },
    );
    if (normalized?.descriptionText.trim()) services().jobs.setDescription(posting.id, normalized.descriptionHtml, normalized.descriptionText);
  }

  async function loadDescription(jobId: string): Promise<string> {
    const { jobs } = services();
    const existing = jobs.getDescriptionHtml(jobId);
    if (existing) return existing;
    const target = detailTarget(jobId);
    if (!target?.source.fetchDetail) return '';
    try {
      const detail = await fetchDetail(target);
      if (detail === null) {
        jobs.setLiveness(jobId, { status: 'closed', checkedAt: ctx.now().toISOString(), detail: `No longer listed on ${target.source.def.name}` });
        if (!target.posting.closedAt) indexChanged();
        return '';
      }
      storeDescription(target, detail);
      return jobs.getDescriptionHtml(jobId);
    } catch (err) {
      log.warn(`sync: fetching a ${target.source.def.name} description failed`, { jobId, reason: err instanceof Error ? err.message : String(err) });
      return '';
    }
  }

  // --- maintenance ----------------------------------------------------------------------------

  /** Once a day: purge long-closed postings and (with auto-sync on) ask rolling-window sources what closed. */
  function maintain(autoSync: boolean, closedRetentionDays: number): void {
    const { settings, jobs } = services();
    const now = ctx.now();
    const last = settings.getJson<string>(MAINTENANCE_KEY);
    if (last && now.getTime() - epoch(last) < DAY_MS) return;
    settings.setJson(MAINTENANCE_KEY, now.toISOString());
    const purged = jobs.purgeClosed(new Date(now.getTime() - Math.max(0, closedRetentionDays) * DAY_MS));
    if (purged > 0) {
      log.info(`sync: removed ${plural(purged, 'posting')} closed for more than ${closedRetentionDays} days`);
      indexChanged();
    }
    if (autoSync) void track(sweepRollingFeeds());
  }

  async function sweepRollingFeeds(): Promise<void> {
    for (const { source, state } of activeSources()) {
      const def = source.def;
      if (def.mode !== 'feed' || def.perCompany || def.fullSnapshot || !source.fetchFeed) continue;
      if (stopped) return;
      if (queuedKeys.has(def.id) || running.has(def.id)) continue;
      const row = getRow(def.id);
      // Only after a successful run: its start time is when its postings were last seen.
      if (!row?.last_attempt_at || row.consecutive_failures > 0) continue;
      try {
        const closed = await closeVanished({ key: def.id, source }, state.config, new Date(row.last_attempt_at), lifecycle.signal);
        if (closed > 0) indexChanged();
      } catch (err) {
        if (lifecycle.signal.aborted) return;
        log.warn(`sync: daily check of ${def.name} failed`, { err });
      }
    }
  }

  function tick(): void {
    try {
      const app = services().settings.getApp();
      maintain(app.autoSync, app.closedRetentionDays);
      if (app.autoSync) requestSync();
    } catch (err) {
      log.error('sync: scheduled pass failed', { err });
    }
  }

  // --- reporting ------------------------------------------------------------------------------

  function summary(): IndexSummary {
    const { jobs } = services();
    const feedSources = sources.filter((s) => s.def.mode === 'feed').map((s) => s.def.id);
    const lastSyncAt = db.scalar<string | null>(
      'SELECT MAX(last_success_at) FROM sync_state WHERE source IN (SELECT value FROM json_each(?))',
      JSON.stringify(feedSources),
    );
    return {
      openJobs: jobs.openCount(),
      sources: jobs.openCountBySource().size,
      companies: jobs.companyCount(),
      ...(lastSyncAt ? { lastSyncAt } : {}),
      syncing: currentRun !== undefined,
      pendingFeeds: pendingCount(),
    };
  }

  const statusOf = (row: SyncRow | undefined): SyncStatus =>
    row && STORED_STATUSES.has(row.status) ? (row.status as SyncStatus) : 'idle';

  function syncSummary(source: JobSource, rows: SyncRow[]): SourceSyncSummary {
    const def = source.def;
    if (!def.perCompany) {
      const row = rows.find((r) => r.feed_key === def.id);
      const status = statusOf(row);
      return {
        status,
        ...(row?.last_success_at ? { lastSuccessAt: row.last_success_at } : {}),
        ...(row?.last_attempt_at ? { lastAttemptAt: row.last_attempt_at } : {}),
        ...(row?.error && status === 'error' ? { error: row.error } : {}),
      };
    }
    const boards = new Set(feedsOf(source).map((f) => f.key));
    const feeds = { total: boards.size, ok: 0, error: 0, running: 0, queued: 0 };
    let lastSuccessAt = '';
    let lastAttemptAt = '';
    for (const row of rows) {
      if (!boards.has(row.feed_key)) continue;
      const status = statusOf(row);
      if (status === 'ok' || status === 'error' || status === 'running' || status === 'queued') feeds[status]++;
      if (row.last_success_at && row.last_success_at > lastSuccessAt) lastSuccessAt = row.last_success_at;
      if (row.last_attempt_at && row.last_attempt_at > lastAttemptAt) lastAttemptAt = row.last_attempt_at;
    }
    const status: SyncStatus =
      feeds.running > 0 ? 'running' : feeds.queued > 0 ? 'queued' : feeds.error > 0 && feeds.ok === 0 ? 'error' : feeds.ok > 0 ? 'ok' : 'idle';
    return {
      status,
      ...(lastSuccessAt ? { lastSuccessAt } : {}),
      ...(lastAttemptAt ? { lastAttemptAt } : {}),
      ...(feeds.error > 0 ? { error: `${feeds.error} of ${plural(feeds.total, 'company board')} could not be synced` } : {}),
      feeds,
    };
  }

  function infoFor(source: JobSource, rows: SyncRow[], jobCounts: Map<string, number>): SourceInfo {
    const def = source.def;
    const state = services().settings.getSourceState(def.id);
    const enabled = isEnabled(def, state);
    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      mode: def.mode,
      homepage: def.homepage,
      description: def.description,
      ...(def.attribution ? { attribution: def.attribution } : {}),
      perCompany: def.perCompany,
      configFields: def.configFields.map((f) => ({ ...f })),
      enabled,
      configured: isConfigured(def, state),
      configuredKeys: def.configFields.filter((f) => state.config[f.key]?.trim()).map((f) => f.key),
      ttlMinutes: ttlOf(def, state),
      jobCount: jobCounts.get(def.id) ?? 0,
      sync: enabled ? syncSummary(source, rows) : { status: 'disabled' },
    };
  }

  function sourceInfo(id: string): SourceInfo | undefined {
    const source = findSource(id);
    if (!source) return undefined;
    const rows = db.all<SyncRow>('SELECT * FROM sync_state WHERE source = ?', id);
    return infoFor(source, rows, services().jobs.openCountBySource());
  }

  // --- interface ------------------------------------------------------------------------------

  return {
    start() {
      if (stopped || firstPass || ticker) return;
      // A previous process may have exited mid-sync and left feeds marked queued/running.
      db.run(`UPDATE sync_state SET status = ${SETTLED_STATUS} WHERE status IN ('queued', 'running')`);
      if (ctx.config.disableSync) return;
      firstPass = setTimeout(tick, FIRST_PASS_DELAY_MS);
      ticker = setInterval(tick, TICK_MS);
      firstPass.unref();
      ticker.unref();
    },

    async stop() {
      stopped = true;
      clearTimeout(firstPass);
      clearInterval(ticker);
      const dropped = queue.splice(0).map((e) => e.feed.key);
      queuedKeys.clear();
      try {
        settle(dropped);
      } catch (err) {
        log.warn('sync: could not reset queued feeds', { err });
      }
      lifecycle.abort();
      await Promise.allSettled([...[...running.values()].map((r) => r.done), ...adhoc]);
      if (running.size === 0) finishRun();
    },

    summary,

    sourceInfos() {
      const rowsBySource = new Map<string, SyncRow[]>();
      for (const row of db.all<SyncRow>('SELECT * FROM sync_state')) {
        const list = rowsBySource.get(row.source);
        if (list) list.push(row);
        else rowsBySource.set(row.source, [row]);
      }
      const jobCounts = services().jobs.openCountBySource();
      return sources.map((source) => infoFor(source, rowsBySource.get(source.def.id) ?? [], jobCounts));
    },

    sourceInfo,

    updateSource(id: string, patch: SourcePatch) {
      const source = findSource(id);
      if (!source) throw notFound('Source');
      const def = source.def;
      const known = new Set(def.configFields.map((f) => f.key));
      const unknown = Object.keys(patch.config ?? {}).find((key) => !known.has(key));
      if (unknown !== undefined) throw badRequest(`${def.name} has no setting called "${unknown}"`);

      const { settings } = services();
      const before = settings.getSourceState(id);
      const after = settings.setSourceState(id, patch);
      const wasActive = isEnabled(def, before) && isConfigured(def, before);
      const isActive = isEnabled(def, after) && isConfigured(def, after);
      const configChanged = configFingerprint(before.config) !== configFingerprint(after.config);

      if (wasActive && !isActive) deactivate(id);
      else if (isActive) {
        if (configChanged) forgetSource(id);
        requestSync({ sources: [id], force: wasActive && configChanged });
      }
      return sourceInfo(id)!;
    },

    requestSync,

    testSource(id: string) {
      const source = findSource(id);
      if (!source) throw notFound('Source');
      const def = source.def;
      const state = services().settings.getSourceState(id);
      const missing = def.configFields.filter((f) => f.required && !state.config[f.key]?.trim());
      if (missing.length > 0) {
        return Promise.resolve<SourceTestResult>({ ok: false, message: `Enter your ${missing.map((f) => f.label).join(' and ')} first` });
      }
      const board = def.perCompany && def.ats ? services().companies.enabledBoards(def.ats)[0] : undefined;
      if (def.perCompany && !board) {
        return Promise.resolve<SourceTestResult>({ ok: false, message: `Enable at least one ${def.name} company board to test it` });
      }
      const work = async (): Promise<SourceTestResult> => {
        try {
          const count = await withDeadline(TEST_TIMEOUT_MS, async (signal) => {
            const sctx = sourceContext(ctx, def, state.config, signal);
            if (def.mode === 'search' && source.search) return (await source.search(sctx, { keywords: ['engineer'], limit: 5 })).length;
            if (def.mode === 'feed' && source.fetchFeed) return (await source.fetchFeed(sctx, board)).postings.length;
            throw new Error('this source has no way to fetch postings');
          });
          return { ok: true, message: `Connected: ${plural(count, 'posting')}${board ? ` from ${board.name}` : ''}`, sample: count };
        } catch (err) {
          return { ok: false, message: describeError(err, def.name, board) };
        }
      };
      return track(work());
    },

    searchUpstream(query) {
      if (stopped) return Promise.resolve({ added: 0 });
      const work = async () => {
        try {
          const targets = activeSources().filter(({ source }) => source.def.mode === 'search' && source.search);
          const added = await Promise.all(targets.map(({ source, state }) => searchOne(source, state, query)));
          return { added: added.reduce((sum, n) => sum + n, 0) };
        } catch (err) {
          log.error('sync: upstream search failed', { err });
          return { added: 0 };
        }
      };
      return track(work());
    },

    fetchDescription(jobId: string) {
      const pending = descriptionFetches.get(jobId);
      if (pending) return pending;
      const work = track(loadDescription(jobId)).finally(() => descriptionFetches.delete(jobId));
      descriptionFetches.set(jobId, work);
      return work;
    },

    checkLiveness(jobId: string) {
      const target = detailTarget(jobId);
      if (!target) {
        if (!services().jobs.getPosting(jobId)) throw notFound('Job');
      }
      const work = async (): Promise<LivenessResult> => {
        const { jobs } = services();
        const name = target?.source.def.name ?? 'its source';
        let result: LivenessResult;
        if (!target?.source.fetchDetail) {
          result = { status: 'unknown', checkedAt: ctx.now().toISOString(), detail: `Postings from ${name} cannot be checked automatically` };
        } else {
          try {
            const detail = await fetchDetail(target);
            result =
              detail === null
                ? { status: 'closed', checkedAt: ctx.now().toISOString(), detail: `No longer listed on ${name}` }
                : { status: 'open', checkedAt: ctx.now().toISOString(), detail: `Still listed on ${name}` };
            if (detail && !jobs.getDescriptionHtml(jobId)) storeDescription(target, detail);
          } catch (err) {
            result = { status: 'unknown', checkedAt: ctx.now().toISOString(), detail: describeError(err, name, target.board) };
          }
        }
        jobs.setLiveness(jobId, result);
        const wasClosed = target?.posting.closedAt !== undefined;
        if ((result.status === 'closed' && !wasClosed) || (result.status === 'open' && wasClosed)) indexChanged();
        return result;
      };
      return track(work());
    },

    idle() {
      if (!currentRun && running.size === 0 && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}
