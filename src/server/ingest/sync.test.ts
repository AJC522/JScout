import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourcePatch } from '../../shared/api';
import type { AppSettings, ServerEvent } from '../../shared/types';
import type { AppConfig } from '../config';
import { openDb } from '../db';
import { ApiError } from '../errors';
import { EventBus } from '../events';
import { createCompaniesService } from '../features/companies/service';
import type { AppContext, Logger, Services, SettingsService, SourceState } from '../services';
import { fakeHttp } from '../sources/testing';
import { type FeedCursor, type FeedResult, type JobSource, type RawPosting, type SourceContext, type SourceDefinition, SourceError } from '../sources/types';
import { jobIdFor } from './normalize';
import { createJobStore } from './store';
import { backoffMs, configFingerprint, createSyncService, feedDueAt } from './sync';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = new Date('2026-11-24T12:00:00.000Z');

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function fakeSettings(): SettingsService {
  const states = new Map<string, SourceState>();
  const json = new Map<string, unknown>();
  const app = { autoSync: true, closedRetentionDays: 30 } as AppSettings;
  const getSourceState = (id: string): SourceState => {
    const state = states.get(id) ?? { config: {} };
    return { ...state, config: { ...state.config } };
  };
  return {
    getApp: () => ({ ...app }),
    updateApp: (patch) => Object.assign(app, patch),
    getSecret: () => undefined,
    getSourceState,
    setSourceState(id, patch: SourcePatch) {
      const next = getSourceState(id);
      if (patch.enabled !== undefined) next.enabled = patch.enabled;
      if (patch.ttlMinutes !== undefined) next.ttlMinutes = patch.ttlMinutes;
      for (const [key, value] of Object.entries(patch.config ?? {})) {
        if (value) next.config[key] = value;
        else delete next.config[key];
      }
      states.set(id, next);
      return getSourceState(id);
    },
    getJson: <T>(key: string) => structuredClone(json.get(key)) as T | undefined,
    setJson: (key, value) => void json.set(key, structuredClone(value)),
    remove: (key) => void json.delete(key),
  };
}

function def(id: string, over: Partial<SourceDefinition> = {}): SourceDefinition {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    kind: 'aggregator',
    mode: 'feed',
    homepage: 'https://example.com',
    description: 'A test source',
    perCompany: false,
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 60,
    fullSnapshot: true,
    minRequestIntervalMs: 0,
    ...over,
  };
}

const atsDef = (ats: 'greenhouse' | 'lever', over: Partial<SourceDefinition> = {}) =>
  def(ats, { kind: 'ats', perCompany: true, ats, defaultTtlMinutes: 360, ...over });

function raw(id: string, extra: Partial<RawPosting> = {}): RawPosting {
  return {
    externalId: id,
    url: `https://example.com/jobs/${id}`,
    title: 'Software Engineer',
    company: 'Acme',
    locations: ['Berlin, Germany'],
    descriptionText: `Posting ${id}: build reliable systems.`,
    ...extra,
  };
}

const feedOf = (ids: string[], complete = true): FeedResult => ({ postings: ids.map((id) => raw(id)), complete });

/** A feed source whose next result is whatever `next` returns (a FeedResult, posting ids, or a thrown error). */
function feedSource(id: string, next: (cursor?: FeedCursor) => FeedResult | string[], over: Partial<SourceDefinition> = {}, extra: Partial<JobSource> = {}) {
  const calls: Array<{ cursor?: FeedCursor; config: Record<string, string> }> = [];
  const source: JobSource = {
    def: def(id, over),
    async fetchFeed(ctx, _board, cursor) {
      calls.push({ cursor, config: ctx.config });
      const result = next(cursor);
      return Array.isArray(result) ? feedOf(result, (over.fullSnapshot ?? true) !== false) : result;
    },
    ...extra,
  };
  return { source, calls };
}

function setup(sources: JobSource[], config: Partial<AppConfig> = {}) {
  const db = openDb(':memory:');
  let clock = T0.getTime();
  const events: ServerEvent[] = [];
  const ctx: AppContext = {
    config: { disableSync: false, ...config } as AppConfig,
    db,
    http: fakeHttp(),
    events: new EventBus(),
    log: silent,
    now: () => new Date(clock),
    services: {} as Services,
  };
  ctx.services.settings = fakeSettings();
  ctx.services.jobs = createJobStore(ctx);
  ctx.services.companies = createCompaniesService(ctx, { sources });
  const sync = createSyncService(ctx, { sources });
  ctx.services.sync = sync;
  ctx.events.subscribe((e) => events.push(e));
  const h = {
    db,
    ctx,
    sync,
    events,
    jobs: ctx.services.jobs,
    settings: ctx.services.settings,
    advance: (ms: number) => {
      clock += ms;
    },
    setClock: (date: Date) => {
      clock = date.getTime();
    },
    row: (feedKey: string) =>
      db.get<{ status: string; error: string | null; etag: string | null; last_modified: string | null; last_success_at: string | null; consecutive_failures: number; job_count: number; duration_ms: number | null }>(
        'SELECT * FROM sync_state WHERE feed_key = ?',
        feedKey,
      ),
    posting: (source: string, feedKey: string, externalId: string) => ctx.services.jobs.getPosting(jobIdFor(source, feedKey, externalId)),
    open: (feedKey: string) => ctx.services.jobs.openCountByFeed([feedKey]).get(feedKey) ?? 0,
    async syncNow(opts?: Parameters<typeof sync.requestSync>[0]) {
      const queued = sync.requestSync(opts);
      await sync.idle();
      return queued;
    },
    addBoards(ats: string, tokens: string[]) {
      for (const token of tokens) {
        db.run(
          `INSERT INTO companies (id, name, ats, token, origin, enabled, added_at) VALUES (?, ?, ?, ?, 'seed', 1, ?)`,
          `${ats}:${token}`,
          `${token.charAt(0).toUpperCase()}${token.slice(1)} Inc`,
          ats,
          token,
          T0.toISOString(),
        );
      }
    },
  };
  cleanups.push(async () => {
    await sync.stop();
    db.close();
  });
  return h;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('freshness and backoff math', () => {
  it('backs off from 5 minutes, doubling per failure, capped at a day', () => {
    expect([0, 1, 2, 3, 4].map(backoffMs)).toEqual([0, 5 * MIN, 10 * MIN, 20 * MIN, 40 * MIN]);
    expect(backoffMs(9)).toBe(1280 * MIN);
    expect(backoffMs(10)).toBe(DAY);
    expect(backoffMs(1000)).toBe(DAY);
  });

  it('works out when a feed is due', () => {
    const at = (min: number) => new Date(T0.getTime() + min * MIN).toISOString();
    const t = (min: number) => T0.getTime() + min * MIN;
    expect(feedDueAt(undefined, 60, undefined, 'fp')).toBe(0);
    expect(feedDueAt({ last_attempt_at: null, last_success_at: null, consecutive_failures: 0 }, 60, undefined, 'fp')).toBe(0);
    expect(feedDueAt({ last_attempt_at: at(0), last_success_at: at(1), consecutive_failures: 0 }, 60, undefined, 'fp')).toBe(t(61));
    // A failure right after a success does not make a fresh feed due early, and backoff applies on top.
    expect(feedDueAt({ last_attempt_at: at(50), last_success_at: at(0), consecutive_failures: 1 }, 60, undefined, 'fp')).toBe(t(60));
    expect(feedDueAt({ last_attempt_at: at(50), last_success_at: at(0), consecutive_failures: 3 }, 60, undefined, 'fp')).toBe(t(70));
    expect(feedDueAt({ last_attempt_at: at(0), last_success_at: null, consecutive_failures: 2 }, 60, undefined, 'fp')).toBe(t(10));
    const limited = { kind: 'rate-limited' as const, until: at(120) };
    expect(feedDueAt({ last_attempt_at: at(0), last_success_at: null, consecutive_failures: 1 }, 60, limited, 'fp')).toBe(t(120));
    const auth = { kind: 'auth' as const, config: 'fp' };
    expect(feedDueAt({ last_attempt_at: at(0), last_success_at: null, consecutive_failures: 1 }, 60, auth, 'fp')).toBe(Number.POSITIVE_INFINITY);
    expect(feedDueAt({ last_attempt_at: at(0), last_success_at: null, consecutive_failures: 1 }, 60, auth, 'other')).toBe(t(5));
  });

  it('fingerprints configs independently of key order', () => {
    expect(configFingerprint({ a: '1', b: '2' })).toBe(configFingerprint({ b: '2', a: '1' }));
    expect(configFingerprint({ a: '1' })).not.toBe(configFingerprint({ a: '2' }));
  });
});

describe('syncing feeds', () => {
  it('syncs stale feeds only, using the TTL from the source state', async () => {
    const { source, calls } = feedSource('alpha', () => ['1', '2']);
    const h = setup([source]);
    expect(await h.syncNow()).toBe(1);
    expect(h.open('alpha')).toBe(2);
    expect(h.row('alpha')).toMatchObject({ status: 'ok', error: null, job_count: 2, consecutive_failures: 0 });
    expect(h.row('alpha')?.duration_ms).toBeTypeOf('number');

    expect(h.sync.requestSync()).toBe(0);
    h.advance(59 * MIN);
    expect(h.sync.requestSync()).toBe(0);
    h.advance(2 * MIN);
    expect(await h.syncNow()).toBe(1);

    h.sync.updateSource('alpha', { ttlMinutes: 240 });
    h.advance(61 * MIN);
    expect(h.sync.requestSync()).toBe(0);
    expect(await h.syncNow({ force: true })).toBe(1);
    expect(calls).toHaveLength(3);
  });

  it('backs off after failures and recovers', async () => {
    let failures = 2;
    const { source } = feedSource('alpha', () => {
      if (failures-- > 0) throw new SourceError('network', 'ECONNRESET');
      return ['1'];
    });
    const h = setup([source]);
    await h.syncNow();
    expect(h.row('alpha')).toMatchObject({ status: 'error', error: 'Could not reach Alpha; check your internet connection', consecutive_failures: 1 });
    expect(h.events.find((e) => e.type === 'feed-finished')).toMatchObject({ ok: false, error: 'Could not reach Alpha; check your internet connection' });

    expect(h.sync.requestSync()).toBe(0);
    h.advance(5 * MIN);
    expect(await h.syncNow()).toBe(1);
    expect(h.row('alpha')?.consecutive_failures).toBe(2);
    h.advance(9 * MIN);
    expect(h.sync.requestSync()).toBe(0);
    h.advance(MIN);
    expect(await h.syncNow()).toBe(1);
    expect(h.row('alpha')).toMatchObject({ status: 'ok', error: null, consecutive_failures: 0 });
    expect(h.open('alpha')).toBe(1);
  });

  it('stops asking an ATS host for any board once it says to wait', async () => {
    let limited = true;
    const asked: string[] = [];
    const ats: JobSource = {
      def: atsDef('greenhouse'),
      fetchFeed: async (_ctx, board) => {
        asked.push(board!.token);
        if (limited) throw new SourceError('rate-limited', 'HTTP 429', { status: 429, retryAfter: 600 });
        return feedOf([`${board!.token}-1`]);
      },
    };
    const h = setup([ats]);
    h.addBoards('greenhouse', ['a', 'b', 'c', 'd', 'e', 'f']);
    await h.syncNow();
    // Only the boards already running when the host answered 429 were asked.
    expect(asked.length).toBeLessThanOrEqual(2);
    expect(['c', 'd', 'e', 'f'].map((t) => h.row(`greenhouse:${t}`)?.status)).toEqual(['idle', 'idle', 'idle', 'idle']);
    limited = false;
    h.advance(5 * MIN);
    expect(h.sync.requestSync({ force: true })).toBe(0);
    h.advance(6 * MIN);
    await h.syncNow();
    expect(h.jobs.openCount()).toBe(6);
  });

  it('waits as long as a Retry-After says, even when forced', async () => {
    let limited = true;
    const { source } = feedSource('alpha', () => {
      if (limited) throw new SourceError('rate-limited', 'HTTP 429', { status: 429, retryAfter: 3600 });
      return ['1'];
    });
    const h = setup([source]);
    await h.syncNow();
    expect(h.row('alpha')?.error).toBe('Alpha is rate limiting requests; try again later');
    limited = false;
    h.advance(10 * MIN);
    expect(h.sync.requestSync()).toBe(0);
    expect(h.sync.requestSync({ force: true })).toBe(0);
    h.advance(51 * MIN);
    expect(await h.syncNow()).toBe(1);
    expect(h.row('alpha')?.status).toBe('ok');
  });

  it('retries a company board that no longer exists only once a day', async () => {
    const ats: JobSource = {
      def: atsDef('greenhouse'),
      async fetchFeed(_ctx, board) {
        if (board?.token === 'gone') throw new SourceError('not-found', 'HTTP 404', { status: 404 });
        return feedOf([`${board?.token}-1`]);
      },
    };
    const h = setup([ats]);
    h.addBoards('greenhouse', ['gone', 'live']);
    expect(await h.syncNow()).toBe(2);
    expect(h.row('greenhouse:gone')).toMatchObject({ status: 'error', error: 'Gone Inc no longer has a Greenhouse job board' });
    expect(h.row('greenhouse:live')?.status).toBe('ok');
    h.advance(23 * 60 * MIN);
    expect(h.sync.requestSync({ feedKeys: ['greenhouse:gone'] })).toBe(0);
    h.advance(61 * MIN);
    expect(h.sync.requestSync({ feedKeys: ['greenhouse:gone'] })).toBe(1);
  });

  it('keeps an auth failure until the source config changes', async () => {
    const { source, calls } = feedSource(
      'beta',
      () => {
        throw new SourceError('auth', 'HTTP 401', { status: 401 });
      },
      { configFields: [{ key: 'apiKey', label: 'API key', secret: true, required: true }], defaultEnabled: false },
    );
    source.fetchFeed = async (ctx) => {
      calls.push({ config: ctx.config });
      if (ctx.config.apiKey !== 'good') throw new SourceError('auth', 'HTTP 401', { status: 401 });
      return feedOf(['1']);
    };
    const h = setup([source]);
    expect(h.sync.requestSync()).toBe(0); // disabled and unconfigured
    h.sync.updateSource('beta', { enabled: true, config: { apiKey: 'bad' } });
    await h.sync.idle();
    expect(h.row('beta')).toMatchObject({ status: 'error', error: 'Beta did not accept the API key; check it in Settings' });
    h.advance(3 * DAY);
    expect(h.sync.requestSync()).toBe(0);

    const info = h.sync.updateSource('beta', { config: { apiKey: 'good' } });
    expect(info.configuredKeys).toEqual(['apiKey']);
    expect(JSON.stringify(info)).not.toContain('good');
    await h.sync.idle();
    expect(h.row('beta')?.status).toBe('ok');
    expect(calls.map((c) => c.config.apiKey)).toEqual(['bad', 'good']);
  });

  it('sends the stored validators and treats 304 as a success', async () => {
    const results: FeedResult[] = [
      { postings: [raw('1')], complete: true, cursor: { etag: '"v1"', lastModified: 'Tue, 24 Nov 2026 12:00:00 GMT' } },
      { postings: [], complete: false, notModified: true },
      { postings: [raw('1')], complete: true, cursor: { etag: '"v2"' } },
    ];
    const { source, calls } = feedSource('alpha', () => results.shift()!);
    const h = setup([source]);
    await h.syncNow();
    expect(calls[0]?.cursor).toBeUndefined();
    const firstSuccess = h.row('alpha')?.last_success_at;

    h.advance(2 * 60 * MIN);
    await h.syncNow();
    expect(calls[1]?.cursor).toEqual({ etag: '"v1"', lastModified: 'Tue, 24 Nov 2026 12:00:00 GMT' });
    expect(h.row('alpha')).toMatchObject({ status: 'ok', etag: '"v1"', last_modified: 'Tue, 24 Nov 2026 12:00:00 GMT' });
    expect(h.row('alpha')?.last_success_at).not.toBe(firstSuccess);
    expect(h.open('alpha')).toBe(1);
    expect(h.events.filter((e) => e.type === 'feed-finished').at(-1)).toMatchObject({ ok: true, added: 0, closed: 0 });

    h.advance(2 * 60 * MIN);
    await h.syncNow();
    expect(calls[2]?.cursor?.etag).toBe('"v1"');
    expect(h.row('alpha')).toMatchObject({ etag: '"v2"', last_modified: null });
  });
});

describe('closing postings', () => {
  it('closes postings missing from a complete feed', async () => {
    const results = [['1', '2'], ['1']];
    const { source } = feedSource('alpha', () => results.shift()!);
    const h = setup([source]);
    await h.syncNow();
    await h.syncNow({ force: true });
    expect(h.posting('alpha', 'alpha', '2')?.closedAt).toBe(T0.toISOString());
    expect(h.posting('alpha', 'alpha', '1')?.closedAt).toBeUndefined();
    expect(h.events.filter((e) => e.type === 'feed-finished').at(-1)).toMatchObject({ closed: 1 });
  });

  it('waits for the grace period of sources whose complete fetches can miss a posting', async () => {
    const results = [['1', '2'], ['1'], ['1']];
    const { source } = feedSource('alpha', () => results.shift()!, { closeGraceMinutes: 60 });
    const h = setup([source]);
    await h.syncNow();
    h.advance(30 * MIN);
    await h.syncNow({ force: true });
    expect(h.posting('alpha', 'alpha', '2')?.closedAt).toBeUndefined();
    h.advance(31 * MIN);
    await h.syncNow({ force: true });
    expect(h.posting('alpha', 'alpha', '2')?.closedAt).toBeDefined();
  });

  it('closes postings of an incomplete feed only after 21 days unseen', async () => {
    const results = [['1', '2'], ['1'], ['1'], ['1']];
    const { source } = feedSource('alpha', () => results.shift()!, { fullSnapshot: false });
    const h = setup([source]);
    await h.syncNow();
    h.advance(DAY);
    await h.syncNow({ force: true });
    expect(h.posting('alpha', 'alpha', '2')?.closedAt).toBeUndefined();
    h.advance(19 * DAY);
    await h.syncNow({ force: true });
    expect(h.posting('alpha', 'alpha', '2')?.closedAt).toBeUndefined();
    h.advance(2 * DAY);
    await h.syncNow({ force: true });
    expect(h.posting('alpha', 'alpha', '2')?.closedAt).toBeDefined();
    expect(h.posting('alpha', 'alpha', '1')?.closedAt).toBeUndefined();
  });

  it('asks checkOpen about postings that left a rolling window, at most once a day', async () => {
    const results = [['1', '2', '3'], ['1'], ['1'], ['1']];
    const checkOpen = vi.fn(async (_ctx: unknown, ids: string[]) => new Map(ids.map((id) => [id, id !== '2'] as const)));
    const { source } = feedSource('alpha', () => results.shift()!, { fullSnapshot: false }, { checkOpen });
    const h = setup([source]);
    await h.syncNow();
    expect(checkOpen).not.toHaveBeenCalled(); // nothing left the window yet

    h.advance(2 * 60 * MIN);
    await h.syncNow({ force: true });
    expect([...(checkOpen.mock.calls[0]?.[1] ?? [])].sort()).toEqual(['2', '3']);
    expect(h.posting('alpha', 'alpha', '2')?.closedAt).toBeDefined();
    expect(h.posting('alpha', 'alpha', '3')?.closedAt).toBeUndefined();
    expect(h.events.filter((e) => e.type === 'feed-finished').at(-1)).toMatchObject({ closed: 1 });

    h.advance(2 * 60 * MIN);
    await h.syncNow({ force: true });
    expect(checkOpen).toHaveBeenCalledTimes(1);

    h.advance(DAY);
    await h.syncNow({ force: true });
    expect(checkOpen).toHaveBeenCalledTimes(2);
    expect(checkOpen.mock.calls[1]?.[1]).toEqual(['3']);
  });
});

describe('the runner', () => {
  it('normalises big feeds in chunks, letting the event loop run in between', async () => {
    let indexedWhenLoopRan = -1;
    const ids = Array.from({ length: 450 }, (_, i) => String(i));
    const { source } = feedSource('alpha', () => {
      // Runs at the first macrotask boundary after the fetch resolves.
      setImmediate(() => {
        indexedWhenLoopRan = h.jobs.openCount();
      });
      return ids;
    });
    const h = setup([source]);
    await h.syncNow();
    expect(indexedWhenLoopRan).toBe(0);
    expect(h.open('alpha')).toBe(450);
  });

  it('writes big feeds in batches, letting the event loop run while the index fills', async () => {
    const ids = Array.from({ length: 3000 }, (_, i) => String(i));
    const { source } = feedSource('alpha', () => ids);
    const h = setup([source]);
    const seenMidWrite = new Set<number>();
    let watching = true;
    const watch = () => {
      if (!watching) return;
      seenMidWrite.add(h.jobs.openCount());
      setImmediate(watch);
    };
    setImmediate(watch);
    await h.syncNow();
    watching = false;
    expect(h.open('alpha')).toBe(3000);
    // Some turns ran with part of the feed written.
    expect([...seenMidWrite].some((n) => n > 0 && n < 3000)).toBe(true);
  });

  it('respects the concurrency limits and does not starve aggregator feeds', async () => {
    const active = new Map<string, number>();
    const peak = new Map<string, number>();
    const starts: string[] = [];
    let total = 0;
    let peakTotal = 0;
    const slowFetch =
      (id: string): JobSource['fetchFeed'] =>
      async (_ctx, board) => {
        starts.push(board ? `${id}:${board.token}` : id);
        active.set(id, (active.get(id) ?? 0) + 1);
        peak.set(id, Math.max(peak.get(id) ?? 0, active.get(id)!));
        peakTotal = Math.max(peakTotal, ++total);
        await new Promise((resolve) => setTimeout(resolve, 3));
        active.set(id, active.get(id)! - 1);
        total--;
        return feedOf([`${board?.token ?? id}-1`]);
      };
    const greenhouse: JobSource = { def: atsDef('greenhouse'), fetchFeed: slowFetch('greenhouse') };
    const lever: JobSource = { def: atsDef('lever'), fetchFeed: slowFetch('lever') };
    const agg: JobSource = { def: def('agg'), fetchFeed: slowFetch('agg') };
    const h = setup([greenhouse, lever, agg]);

    // The aggregator has synced before, so every never-synced board outranks it.
    await h.syncNow({ sources: ['agg'] });
    starts.length = 0;
    h.advance(2 * 60 * MIN);
    h.addBoards('greenhouse', ['a', 'b', 'c', 'd', 'e', 'f']);
    h.addBoards('lever', ['g', 'h', 'i', 'j', 'k', 'l']);
    expect(await h.syncNow()).toBe(13);

    expect(peakTotal).toBeLessThanOrEqual(4);
    expect(peak.get('greenhouse')).toBe(2);
    expect(peak.get('lever')).toBe(2);
    expect(peak.get('agg')).toBe(1);
    expect(starts.slice(0, 4)).toContain('agg');
    expect(h.sync.summary().pendingFeeds).toBe(0);
  });

  it('stop() aborts in-flight fetches and leaves no failure behind', async () => {
    let sawAbort = false;
    const source: JobSource = {
      def: def('alpha'),
      fetchFeed: (ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal?.addEventListener('abort', () => {
            sawAbort = true;
            reject(new SourceError('aborted', 'aborted'));
          });
        }),
    };
    const h = setup([source]);
    expect(h.sync.requestSync()).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.row('alpha')?.status).toBe('running');
    await h.sync.stop();
    expect(sawAbort).toBe(true);
    expect(h.row('alpha')).toMatchObject({ status: 'idle', error: null, consecutive_failures: 0 });
    expect(h.sync.requestSync({ force: true })).toBe(0);
    await h.sync.idle();
  });

  it('emits progress events in order', async () => {
    const { source: alpha } = feedSource('alpha', () => ['1', '2']);
    const { source: beta } = feedSource('beta', () => ['3']);
    const h = setup([alpha, beta]);
    await h.syncNow();
    const types = h.events.map((e) => e.type);
    expect(types[0]).toBe('sync-started');
    expect(types.at(-1)).toBe('sync-finished');
    expect(types.filter((t) => t === 'feed-finished')).toHaveLength(2);
    // Each feed that changed the index is followed by an index-changed event.
    types.forEach((type, i) => {
      if (type === 'feed-finished') expect(types[i + 1]).toBe('index-changed');
    });
    expect(h.events[0]).toEqual({ type: 'sync-started', feeds: 2 });
    const finished = h.events.filter((e) => e.type === 'feed-finished');
    expect(finished.map((e) => e.pendingFeeds)).toEqual([1, 0]);
    expect(h.events.at(-1)).toMatchObject({ type: 'sync-finished', added: 3, index: { openJobs: 3, syncing: false, pendingFeeds: 0 } });

    h.events.length = 0;
    await h.syncNow({ force: true });
    expect(h.events.map((e) => e.type)).toEqual(['sync-started', 'feed-finished', 'feed-finished', 'sync-finished']);
  });
});

describe('sources', () => {
  it('removes a disabled source’s postings at once and brings them back when re-enabled', async () => {
    const { source } = feedSource('alpha', () => ['1', '2']);
    const ats: JobSource = { def: atsDef('greenhouse'), fetchFeed: async (_ctx, board) => feedOf([`${board?.token}-1`]) };
    const h = setup([source, ats]);
    h.addBoards('greenhouse', ['acme', 'globex']);
    await h.syncNow();
    expect(h.jobs.openCount()).toBe(4);

    h.events.length = 0;
    const info = h.sync.updateSource('alpha', { enabled: false });
    expect(info).toMatchObject({ enabled: false, jobCount: 0, sync: { status: 'disabled' } });
    expect(h.open('alpha')).toBe(0);
    expect(h.row('alpha')).toBeUndefined();
    expect(h.events.map((e) => e.type)).toEqual(['index-changed']);
    expect(h.sync.requestSync({ force: true })).toBe(2);
    await h.sync.idle();

    h.sync.updateSource('greenhouse', { enabled: false });
    expect(h.jobs.openCount()).toBe(0);
    expect(h.row('greenhouse:acme')).toBeUndefined();

    h.sync.updateSource('alpha', { enabled: true });
    await h.sync.idle();
    expect(h.open('alpha')).toBe(2);
  });

  it('syncs a source re-enabled while its cancelled run is still unwinding', async () => {
    let calls = 0;
    const slow: JobSource = {
      def: def('alpha'),
      async fetchFeed(ctx) {
        calls++;
        // Notices the abort only after a while, like a request already on the wire.
        await new Promise((resolve) => setTimeout(resolve, 50));
        ctx.signal?.throwIfAborted();
        return feedOf(['1', '2']);
      },
    };
    const h = setup([slow]);
    h.sync.requestSync();
    await new Promise((resolve) => setTimeout(resolve, 10));
    h.sync.updateSource('alpha', { enabled: false });
    h.sync.updateSource('alpha', { enabled: true });
    await vi.waitFor(() => expect(h.open('alpha')).toBe(2), { timeout: 2_000 });
    await h.sync.idle();
    expect(calls).toBe(2);
    expect(h.row('alpha')).toMatchObject({ status: 'ok' });
  });

  it('rejects unknown sources and config fields', () => {
    const { source } = feedSource('alpha', () => ['1']);
    const h = setup([source]);
    expect(() => h.sync.updateSource('nope', { enabled: true })).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => h.sync.updateSource('alpha', { config: { token: 'x' } })).toThrow(expect.objectContaining({ status: 400 }));
    expect(h.sync.sourceInfo('nope')).toBeUndefined();
  });

  it('describes each source without revealing config values', async () => {
    const keyed = feedSource('keyed', () => ['1'], {
      configFields: [
        { key: 'apiKey', label: 'API key', secret: true, required: true },
        { key: 'region', label: 'Region', secret: false, required: false },
      ],
    }).source;
    const ats: JobSource = {
      def: atsDef('greenhouse'),
      async fetchFeed(_ctx, board) {
        if (board?.token === 'broken') throw new SourceError('parse', 'bad payload');
        return feedOf(['1', '2']);
      },
    };
    const h = setup([keyed, ats]);
    h.addBoards('greenhouse', ['acme', 'broken']);
    expect(h.sync.sourceInfo('keyed')).toMatchObject({ enabled: true, configured: false, configuredKeys: [], ttlMinutes: 60 });
    h.sync.updateSource('keyed', { config: { apiKey: 'secret-value' } });
    await h.syncNow();

    const infos = h.sync.sourceInfos();
    expect(infos.map((i) => i.id)).toEqual(['keyed', 'greenhouse']);
    expect(JSON.stringify(infos)).not.toContain('secret-value');
    expect(infos[0]).toMatchObject({ configured: true, configuredKeys: ['apiKey'], jobCount: 1, sync: { status: 'ok' } });
    expect(infos[1]).toMatchObject({
      perCompany: true,
      jobCount: 2,
      sync: { status: 'ok', error: '1 of 2 company boards could not be synced', feeds: { total: 2, ok: 1, error: 1, running: 0, queued: 0 } },
    });
    expect(h.sync.summary()).toMatchObject({ openJobs: 3, sources: 2, syncing: false, pendingFeeds: 0 });
    expect(h.sync.summary().lastSyncAt).toBe(T0.toISOString());
  });

  it('tests a source with one small request and explains failures', async () => {
    const { source: alpha } = feedSource('alpha', () => ['1', '2']);
    const limited: JobSource = {
      def: def('remoteok', { name: 'Remote OK' }),
      fetchFeed: async () => {
        throw new SourceError('rate-limited', 'HTTP 429', { status: 429 });
      },
    };
    const search = vi.fn(async () => [raw('s1')]);
    const keyed: JobSource = {
      def: def('finder', { mode: 'search', fullSnapshot: false, configFields: [{ key: 'apiKey', label: 'API key', secret: true, required: true }] }),
      search,
    };
    const ats: JobSource = { def: atsDef('greenhouse', { name: 'Greenhouse' }), fetchFeed: async () => feedOf(['1']) };
    const h = setup([alpha, limited, keyed, ats]);

    expect(await h.sync.testSource('alpha')).toEqual({ ok: true, message: 'Connected: 2 postings', sample: 2 });
    expect(await h.sync.testSource('remoteok')).toEqual({ ok: false, message: 'Remote OK is rate limiting requests; try again later' });
    expect(await h.sync.testSource('finder')).toEqual({ ok: false, message: 'Enter your API key first' });
    h.settings.setSourceState('finder', { config: { apiKey: 'k' } });
    expect(await h.sync.testSource('finder')).toEqual({ ok: true, message: 'Connected: 1 posting', sample: 1 });
    expect(search).toHaveBeenCalledWith(expect.anything(), { keywords: ['engineer'], limit: 5 });
    expect(await h.sync.testSource('greenhouse')).toEqual({ ok: false, message: 'Enable at least one Greenhouse company board to test it' });
    h.addBoards('greenhouse', ['acme']);
    expect(await h.sync.testSource('greenhouse')).toEqual({ ok: true, message: 'Connected: 1 posting from Acme Inc', sample: 1 });
    await expect(h.sync.testSource('nope')).rejects.toBeInstanceOf(ApiError);
    // Testing does not touch the index.
    expect(h.jobs.openCount()).toBe(0);
  });
});

describe('upstream search', () => {
  it('ingests results from search sources, tolerating failures, hangs and quota-spending checks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const checkOpen = vi.fn(async () => new Map<string, boolean>());
    const good: JobSource = { def: def('finder', { mode: 'search', fullSnapshot: false }), search: async () => [raw('s1'), raw('s2')], checkOpen };
    const broken: JobSource = {
      def: def('broken', { mode: 'search', fullSnapshot: false }),
      search: async () => {
        throw new SourceError('network', 'down');
      },
    };
    const hanging: JobSource = { def: def('hanging', { mode: 'search', fullSnapshot: false }), search: () => new Promise(() => {}) };
    const h = setup([good, broken, hanging]);

    const first = h.sync.searchUpstream({ keywords: ['engineer'], limit: 20 });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await first).toEqual({ added: 2 });
    expect(h.open('finder')).toBe(2);
    expect(h.row('broken')).toMatchObject({ status: 'error', error: 'Could not reach Broken; check your internet connection' });
    expect(h.row('hanging')).toMatchObject({ status: 'error', error: 'Hanging did not answer in time; try again later' });

    const second = h.sync.searchUpstream({ keywords: ['engineer'], limit: 20 });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await second).toEqual({ added: 0 });
    expect(checkOpen).not.toHaveBeenCalled();
    // Search results never count as a feed sync.
    expect(h.sync.requestSync({ force: true })).toBe(0);
  });

  it('closes search results that closed upstream in the daily check', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const checkOpen = vi.fn(async (_ctx: unknown, ids: string[]) => new Map(ids.map((id) => [id, id !== 's1'] as const)));
    const finder: JobSource = { def: def('finder', { mode: 'search', fullSnapshot: false }), search: async () => [raw('s1'), raw('s2')], checkOpen };
    const h = setup([finder]);
    expect(await h.sync.searchUpstream({ keywords: ['engineer'], limit: 20 })).toEqual({ added: 2 });
    h.advance(2 * DAY);
    h.sync.start();
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() => expect(h.posting('finder', 'finder', 's1')?.closedAt).toBeDefined());
    expect([...(checkOpen.mock.calls[0]?.[1] ?? [])].sort()).toEqual(['s1', 's2']);
    expect(h.posting('finder', 'finder', 's2')?.closedAt).toBeUndefined();
  });

  it('stops asking a search source that is rate limiting or rejecting the key', async () => {
    const search = vi.fn(async (ctx: SourceContext): Promise<RawPosting[]> => {
      if (ctx.config.apiKey === 'bad') throw new SourceError('auth', 'HTTP 401', { status: 401 });
      throw new SourceError('rate-limited', 'HTTP 429', { status: 429, retryAfter: 600 });
    });
    const finder: JobSource = {
      def: def('finder', { mode: 'search', fullSnapshot: false, configFields: [{ key: 'apiKey', label: 'API key', secret: true, required: true }] }),
      search,
    };
    const h = setup([finder]);
    h.sync.updateSource('finder', { config: { apiKey: 'bad' } });
    const query = { keywords: ['engineer'], limit: 20 };
    await h.sync.searchUpstream(query);
    await h.sync.searchUpstream(query);
    expect(search).toHaveBeenCalledTimes(1);

    h.sync.updateSource('finder', { config: { apiKey: 'good' } });
    await h.sync.searchUpstream(query);
    await h.sync.searchUpstream(query);
    expect(search).toHaveBeenCalledTimes(2);
    h.advance(11 * MIN);
    await h.sync.searchUpstream(query);
    expect(search).toHaveBeenCalledTimes(3);
  });
});

describe('posting details', () => {
  function detailSetup(fetchDetail: JobSource['fetchDetail']) {
    const { source } = feedSource('alpha', () => ({ postings: [raw('1', { descriptionText: undefined }), raw('2')], complete: true }), {}, { fetchDetail });
    const h = setup([source]);
    return { h, id: jobIdFor('alpha', 'alpha', '1') };
  }

  it('fetches, sanitises and stores a missing description once', async () => {
    const fetchDetail = vi.fn(async () => ({ descriptionHtml: '<p>Full <b>details</b></p><script>alert(1)</script>' }));
    const { h, id } = detailSetup(fetchDetail);
    await h.syncNow();
    expect(h.jobs.getDescriptionHtml(id)).toBe('');
    const html = await h.sync.fetchDescription(id);
    expect(html).toContain('<b>details</b>');
    expect(html).not.toContain('script');
    expect(h.jobs.getDescriptionHtml(id)).toBe(html);
    expect(await h.sync.fetchDescription(id)).toBe(html);
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(fetchDetail).toHaveBeenCalledWith(expect.anything(), { externalId: '1', url: 'https://example.com/jobs/1' }, undefined);
    expect(await h.sync.fetchDescription('no-such-job')).toBe('');
  });

  it('returns nothing when the posting is gone or the source fails', async () => {
    let mode: 'gone' | 'fail' = 'fail';
    const { h, id } = detailSetup(async () => {
      if (mode === 'fail') throw new SourceError('network', 'down');
      return null;
    });
    await h.syncNow();
    expect(await h.sync.fetchDescription(id)).toBe('');
    expect(h.jobs.getPosting(id)?.closedAt).toBeUndefined();
    mode = 'gone';
    expect(await h.sync.fetchDescription(id)).toBe('');
    expect(h.jobs.getPosting(id)?.closedAt).toBeDefined();
  });

  it('passes the company board for ATS postings', async () => {
    const fetchDetail = vi.fn(async (_ctx: unknown, _posting: unknown, _board?: unknown) => ({ descriptionText: 'Plain text description.' }));
    const ats: JobSource = { def: atsDef('greenhouse'), fetchFeed: async () => ({ postings: [raw('9', { descriptionText: undefined })], complete: true }), fetchDetail };
    const h = setup([ats]);
    h.addBoards('greenhouse', ['acme']);
    await h.syncNow();
    const id = jobIdFor('greenhouse', 'greenhouse:acme', '9');
    expect(await h.sync.fetchDescription(id)).toContain('Plain text description.');
    expect(fetchDetail.mock.calls[0]?.[2]).toEqual({ ats: 'greenhouse', token: 'acme', name: 'Acme Inc' });
  });

  it('checks liveness without guessing', async () => {
    let answer: 'open' | 'closed' | 'fail' = 'open';
    const { h, id } = detailSetup(async () => {
      if (answer === 'fail') throw new SourceError('network', 'down');
      return answer === 'closed' ? null : {};
    });
    await h.syncNow();
    expect(await h.sync.checkLiveness(id)).toMatchObject({ status: 'open', checkedAt: T0.toISOString() });
    answer = 'fail';
    expect(await h.sync.checkLiveness(id)).toMatchObject({ status: 'unknown', detail: 'Could not reach Alpha; check your internet connection' });
    expect(h.jobs.getPosting(id)?.closedAt).toBeUndefined();
    answer = 'closed';
    expect(await h.sync.checkLiveness(id)).toMatchObject({ status: 'closed' });
    expect(h.jobs.getPosting(id)?.closedAt).toBeDefined();
    expect(h.jobs.getLiveness(id)?.status).toBe('closed');
    await expect(h.sync.checkLiveness('no-such-job')).rejects.toMatchObject({ status: 404 });
  });

  it('reports unknown liveness for sources that cannot check', async () => {
    const { source } = feedSource('alpha', () => ['1']);
    const h = setup([source]);
    await h.syncNow();
    expect(await h.sync.checkLiveness(jobIdFor('alpha', 'alpha', '1'))).toMatchObject({ status: 'unknown' });
  });
});

describe('scheduler', () => {
  it('syncs shortly after start, purges long-closed postings, and pauses when auto-sync is off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const results = [['1', '2'], ['1'], ['1'], ['1']];
    const { source, calls } = feedSource('alpha', () => results.shift()!);
    const h = setup([source]);
    // A posting that closed 40 days ago, past the 30-day retention.
    h.setClock(new Date(T0.getTime() - 40 * DAY));
    await h.syncNow();
    await h.syncNow({ force: true });
    expect(h.posting('alpha', 'alpha', '2')?.closedAt).toBeDefined();
    h.setClock(T0);

    h.sync.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    await h.sync.idle();
    expect(calls).toHaveLength(3);
    expect(h.posting('alpha', 'alpha', '2')).toBeUndefined();

    h.settings.updateApp({ autoSync: false });
    h.advance(2 * 60 * MIN);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await h.sync.idle();
    expect(calls).toHaveLength(3);

    h.settings.updateApp({ autoSync: true });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await h.sync.idle();
    expect(calls).toHaveLength(4);
  });

  it('does not schedule anything when syncing is disabled in config', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { source, calls } = feedSource('alpha', () => ['1']);
    const h = setup([source], { disableSync: true });
    h.sync.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toHaveLength(0);
  });
});
