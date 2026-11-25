import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtsKind, ServerEvent } from '../../../shared/types';
import type { AppConfig } from '../../config';
import type { SeedCompany } from '../../data';
import { type Db, openDb } from '../../db';
import { EventBus } from '../../events';
import { feedKeyFor, normalizePosting } from '../../ingest/normalize';
import { createJobStore } from '../../ingest/store';
import type { AppContext, CompaniesService, Logger, Services, SyncService } from '../../services';
import { fakeHttp } from '../../sources/testing';
import { type JobSource, SourceError } from '../../sources/types';
import { createCompaniesService } from './service';

const data = vi.hoisted(() => ({ seed: [] as SeedCompany[], present: true }));
vi.mock('../../data', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../data')>();
  return {
    ...real,
    hasReference: (name: Parameters<typeof real.hasReference>[0]) => (name === 'companies.seed' ? data.present : real.hasReference(name)),
    loadReference: ((name: Parameters<typeof real.loadReference>[0]) =>
      name === 'companies.seed' ? data.seed : real.loadReference(name)) as typeof real.loadReference,
  };
});

const T0 = new Date('2026-11-24T12:00:00.000Z');
const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Fake ATS adapters whose probes answer from `boards` ("<ats>:<token>" -> result). */
function fakeAts(boards: Record<string, { jobs: number; name?: string } | Error>) {
  const probes: string[] = [];
  const make = (ats: AtsKind): JobSource => ({
    def: {
      id: ats,
      name: ats,
      kind: 'ats',
      mode: 'feed',
      homepage: 'https://example.com',
      description: 'Test ATS',
      perCompany: true,
      ats,
      configFields: [],
      defaultEnabled: true,
      defaultTtlMinutes: 360,
      fullSnapshot: true,
      minRequestIntervalMs: 0,
    },
    fetchFeed: async () => ({ postings: [], complete: true }),
    async probeBoard(_ctx, token) {
      probes.push(`${ats}:${token}`);
      const found = boards[`${ats}:${token}`];
      if (found instanceof Error) throw found;
      return found ?? null;
    },
  });
  return { sources: [make('greenhouse'), make('lever'), make('ashby')], probes };
}

let db: Db;
let ctx: AppContext;
let companies: CompaniesService;
let probes: string[];
let events: ServerEvent[];
const requestSync = vi.fn<SyncService['requestSync']>(() => 1);

function build(boards: Record<string, { jobs: number; name?: string } | Error> = {}) {
  db = openDb(':memory:');
  events = [];
  ctx = {
    config: { disableSync: true } as AppConfig,
    db,
    http: fakeHttp(),
    events: new EventBus(),
    log: silent,
    now: () => T0,
    services: {} as Services,
  };
  ctx.events.subscribe((e) => events.push(e));
  ctx.services.jobs = createJobStore(ctx);
  ctx.services.sync = { requestSync, summary: () => ({ openJobs: 0, sources: 0, companies: 0, syncing: false, pendingFeeds: 0 }) } as unknown as SyncService;
  const ats = fakeAts(boards);
  probes = ats.probes;
  companies = createCompaniesService(ctx, { sources: ats.sources });
  return ats.sources;
}

/** Index one open posting for a board and give it a sync_state row. */
function indexPosting(sources: JobSource[], ats: AtsKind, token: string, externalId = '1') {
  const source = sources.find((s) => s.def.ats === ats)!;
  const board = { ats, token, name: token };
  const feedKey = feedKeyFor(ats, board);
  const posting = normalizePosting(
    { externalId, url: `https://example.com/${token}/${externalId}`, title: 'Data Engineer', company: token, locations: ['Remote'] },
    { source: source.def, feedKey, board, now: T0 },
  )!;
  ctx.services.jobs.upsertFeed({ feedKey, source: ats }, [posting], { complete: false, now: T0 });
  db.run(`INSERT OR REPLACE INTO sync_state (feed_key, source, status, last_success_at) VALUES (?, ?, 'ok', ?)`, feedKey, ats, T0.toISOString());
}

/** Seed the bundled boards and follow all of them, as onboarding does when every industry is picked. */
function seedFollowed() {
  companies.seedIfEmpty();
  db.run(`UPDATE companies SET enabled = 1 WHERE origin = 'seed'`);
}

beforeEach(() => {
  requestSync.mockClear();
  data.present = true;
  data.seed = [
    { name: 'Globex', ats: 'greenhouse', token: 'globex', industry: 'fintech', jobs: 10 },
    { name: 'acme', ats: 'lever', token: 'acme', industry: 'ai', jobs: 5 },
    { name: 'Initech', ats: 'ashby', token: 'Initech', industry: 'fintech', jobs: 3 },
    { name: 'Bad', ats: 'greenhouse', token: 'bad token', industry: 'ai', jobs: 1 },
    { name: 'Hooli', ats: 'workable', token: 'hooli', industry: 'ai', jobs: 1 },
  ];
});

afterEach(() => db.close());

describe('seeding', () => {
  it('loads the bundled boards once, unfollowed, skipping ones that cannot be synced', () => {
    build();
    expect(companies.seedIfEmpty()).toBe(3);
    expect(companies.seedIfEmpty()).toBe(0);
    expect(companies.get('ashby:initech')).toMatchObject({ name: 'Initech', origin: 'seed', enabled: false, addedAt: T0.toISOString() });
    expect(companies.enabledBoards()).toEqual([]);
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('does nothing without the bundled file', () => {
    build();
    data.present = false;
    expect(companies.seedIfEmpty()).toBe(0);
    expect(companies.list({}).total).toBe(0);
  });
});

describe('listing', () => {
  it('filters, facets, orders and pages boards with job counts and sync status', () => {
    const sources = build();
    seedFollowed();
    companies.add({ ats: 'greenhouse', token: 'zeta', name: 'Zeta Labs', industry: 'ai' });
    companies.patch('greenhouse:globex', { enabled: false });
    indexPosting(sources, 'lever', 'acme');

    const all = companies.list({});
    expect(all.items.map((b) => b.name)).toEqual(['acme', 'Globex', 'Initech', 'Zeta Labs']);
    expect(all).toMatchObject({ total: 4, enabledTotal: 3 });
    expect(all.industries).toEqual([
      { value: 'ai', count: 2 },
      { value: 'fintech', count: 2 },
    ]);
    expect(all.items[0]).toMatchObject({ id: 'lever:acme', jobCount: 1, sync: { status: 'ok', lastSuccessAt: T0.toISOString() } });
    expect(all.items[1]?.sync.status).toBe('disabled');
    expect(all.items[3]?.sync.status).toBe('idle');

    expect(companies.list({ q: 'INIT' }).items.map((b) => b.id)).toEqual(['ashby:initech']);
    expect(companies.list({ q: 'zeta' }).items.map((b) => b.id)).toEqual(['greenhouse:zeta']);
    expect(companies.list({ ats: 'greenhouse' }).total).toBe(2);
    expect(companies.list({ enabled: false }).items.map((b) => b.id)).toEqual(['greenhouse:globex']);
    expect(companies.list({ origin: 'user' }).items.map((b) => b.id)).toEqual(['greenhouse:zeta']);
    const fintech = companies.list({ industry: 'fintech' });
    expect(fintech).toMatchObject({ total: 2, enabledTotal: 1 });
    // The facet ignores its own filter so the user can switch industries.
    expect(fintech.industries).toHaveLength(2);
    expect(companies.list({ limit: 2, offset: 1 }).items.map((b) => b.name)).toEqual(['Globex', 'Initech']);
    expect(companies.enabledBoards('greenhouse')).toEqual([{ ats: 'greenhouse', token: 'zeta', name: 'Zeta Labs' }]);
    expect(companies.enabledBoards().map((b) => b.token)).toEqual(['acme', 'initech', 'zeta']);
  });
});

describe('adding and editing', () => {
  it('validates input and queues a sync for new boards', () => {
    build();
    const board = companies.add({ ats: 'greenhouse', token: '  Stripe ', name: ' Stripe ', industry: 'fintech' });
    expect(board).toMatchObject({ id: 'greenhouse:stripe', token: 'stripe', name: 'Stripe', origin: 'user', enabled: true, jobCount: 0 });
    expect(requestSync).toHaveBeenCalledWith({ feedKeys: ['greenhouse:stripe'] });

    const bad = [
      { ats: 'greenhouse' as const, token: 'no spaces', name: 'X' },
      { ats: 'greenhouse' as const, token: '../etc', name: 'X' },
      { ats: 'lever' as const, token: 'x'.repeat(101), name: 'X' },
      { ats: 'greenhouse' as const, token: 'ok', name: '   ' },
      { ats: 'workable' as const, token: 'ok', name: 'X' },
    ];
    for (const input of bad) expect(() => companies.add(input), JSON.stringify(input)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => companies.add({ ats: 'workable', token: 'ok', name: 'X' })).toThrow('JScout cannot sync Workable boards yet');
  });

  it('re-enables a known board instead of duplicating it, keeping its origin', () => {
    build();
    seedFollowed();
    companies.patch('lever:acme', { enabled: false });
    requestSync.mockClear();
    const board = companies.add({ ats: 'lever', token: 'ACME', name: 'Acme Corp' });
    expect(board).toMatchObject({ id: 'lever:acme', origin: 'seed', enabled: true, name: 'Acme Corp', industry: 'ai' });
    expect(requestSync).toHaveBeenCalledWith({ feedKeys: ['lever:acme'] });
    expect(companies.list({}).total).toBe(3);
  });

  it('removes a disabled board’s postings and sync state, and queues it again when re-enabled', () => {
    const sources = build();
    seedFollowed();
    indexPosting(sources, 'greenhouse', 'globex');
    expect(ctx.services.jobs.openCount()).toBe(1);

    expect(companies.patch('greenhouse:globex', { enabled: false, name: 'Globex Corp' })).toMatchObject({ enabled: false, name: 'Globex Corp', jobCount: 0 });
    expect(ctx.services.jobs.openCount()).toBe(0);
    expect(db.get('SELECT * FROM sync_state WHERE feed_key = ?', 'greenhouse:globex')).toBeUndefined();
    expect(events.map((e) => e.type)).toEqual(['index-changed']);

    companies.patch('greenhouse:globex', { enabled: true });
    expect(requestSync).toHaveBeenLastCalledWith({ feedKeys: ['greenhouse:globex'] });
    expect(() => companies.patch('greenhouse:nope', { enabled: true })).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => companies.patch('greenhouse:globex', { name: ' ' })).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('updates many boards by id or by filter, counting only real changes', () => {
    const sources = build();
    seedFollowed();
    indexPosting(sources, 'ashby', 'initech');
    expect(companies.bulk({ enabled: false, industry: 'fintech' })).toBe(2);
    expect(ctx.services.jobs.openCount()).toBe(0);
    expect(companies.bulk({ enabled: false, industry: 'fintech' })).toBe(0);
    expect(companies.bulk({ enabled: true, ids: ['greenhouse:globex', 'lever:acme'] })).toBe(1);
    expect(requestSync).toHaveBeenLastCalledWith({ feedKeys: ['greenhouse:globex'] });
    expect(companies.bulk({ enabled: true, ids: [] })).toBe(0);
    expect(companies.bulk({ enabled: false, origin: 'user' })).toBe(0);
    expect(companies.bulk({ enabled: false })).toBe(2);
    expect(companies.list({}).enabledTotal).toBe(0);
  });

  it('removes a board with its postings and sync state', () => {
    const sources = build();
    companies.add({ ats: 'ashby', token: 'umbrella', name: 'Umbrella' });
    indexPosting(sources, 'ashby', 'umbrella');
    companies.remove('ashby:umbrella');
    expect(companies.get('ashby:umbrella')).toBeUndefined();
    expect(ctx.services.jobs.openCount()).toBe(0);
    expect(db.get('SELECT * FROM sync_state WHERE feed_key = ?', 'ashby:umbrella')).toBeUndefined();
    expect(() => companies.remove('ashby:umbrella')).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('detection', () => {
  it('confirms a pasted board URL with one probe', async () => {
    build({ 'greenhouse:stripe': { jobs: 120, name: 'Stripe' } });
    expect(await companies.detect('https://boards.greenhouse.io/stripe/jobs/123')).toEqual([{ ats: 'greenhouse', token: 'stripe', name: 'Stripe', jobs: 120 }]);
    expect(probes).toEqual(['greenhouse:stripe']);
    expect(await companies.detect('https://jobs.lever.co/nobody')).toEqual([]);
    // No adapter can probe this ATS.
    expect(await companies.detect('https://apply.workable.com/acme/')).toEqual([]);
    expect(probes).toEqual(['greenhouse:stripe', 'lever:nobody']);
  });

  it('probes likely tokens one at a time and stops after two hits', async () => {
    build({
      'lever:acmerobotics': { jobs: 4 },
      'ashby:acmerobotics': new SourceError('network', 'down'),
      'greenhouse:acme-robotics': { jobs: 9, name: 'ACME Robotics' },
      'ashby:acme': { jobs: 1 },
    });
    expect(await companies.detect('Acme Robotics, Inc.')).toEqual([
      { ats: 'lever', token: 'acmerobotics', name: 'Acme Robotics, Inc.', jobs: 4 },
      { ats: 'greenhouse', token: 'acme-robotics', name: 'ACME Robotics', jobs: 9 },
    ]);
    expect(probes).toEqual(['greenhouse:acmerobotics', 'lever:acmerobotics', 'ashby:acmerobotics', 'greenhouse:acme-robotics']);
  });

  it('gives up after twelve probes and never throws', async () => {
    build({ 'greenhouse:acmeroboticsinc': new Error('boom') });
    expect(await companies.detect('Acme Robotics, Inc.')).toEqual([]);
    expect(probes.length).toBeLessThanOrEqual(12);
    expect(new Set(probes).size).toBe(probes.length);
    expect(await companies.detect('   ')).toEqual([]);
  });

  it('reads a company website as a name', async () => {
    build({ 'ashby:initech': { jobs: 2 } });
    expect(await companies.detect('https://www.initech.com/careers')).toEqual([{ ats: 'ashby', token: 'initech', name: 'initech', jobs: 2 }]);
  });
});

describe('export and import', () => {
  it('round-trips the user’s boards and choices', () => {
    const sources = build();
    companies.seedIfEmpty();
    companies.add({ ats: 'greenhouse', token: 'zeta', name: 'Zeta', industry: 'ai' });
    companies.add({ ats: 'greenhouse', token: 'disabled', name: 'Disabled', industry: 'ai' });
    companies.patch('greenhouse:disabled', { enabled: false });
    companies.patch('lever:acme', { enabled: true });
    const exported = companies.exportUser();
    // Bundled boards left unfollowed are the default, so only the followed one is exported.
    expect(exported).toEqual([
      { name: 'acme', ats: 'lever', token: 'acme', industry: 'ai', enabled: true },
      { name: 'Disabled', ats: 'greenhouse', token: 'disabled', industry: 'ai', enabled: false },
      { name: 'Zeta', ats: 'greenhouse', token: 'zeta', industry: 'ai', enabled: true },
    ]);
    db.close();

    build();
    seedFollowed();
    companies.patch('lever:acme', { enabled: false });
    indexPosting(sources, 'greenhouse', 'globex');
    requestSync.mockClear();
    const imported = companies.importUser([
      ...exported,
      { name: 'Globex', ats: 'greenhouse', token: 'globex', enabled: false },
      { name: 'Nope', ats: 'workable', token: 'nope', enabled: true },
    ]);
    expect(imported).toBe(4);
    expect(companies.get('lever:acme')).toMatchObject({ enabled: true, origin: 'seed' });
    expect(companies.get('greenhouse:globex')).toMatchObject({ enabled: false, origin: 'seed' });
    expect(ctx.services.jobs.openCount()).toBe(0);
    expect(companies.get('greenhouse:zeta')).toMatchObject({ origin: 'user', enabled: true, industry: 'ai' });
    expect(companies.get('greenhouse:disabled')).toMatchObject({ origin: 'user', enabled: false });
    expect(requestSync).toHaveBeenCalledWith({ feedKeys: ['lever:acme', 'greenhouse:zeta'] });
  });
});
