import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobLocation, Place } from '../../shared/types';
import { type Db, openDb } from '../db';
import { stableHash } from '../lib/text';
import type { AppContext, JobStore } from '../services';
import { jobIdFor } from './normalize';
import { createJobStore } from './store';
import type { NormalizedPosting } from './types';

// A fixed registry: Greenhouse has a display name, every other source falls back to its id.
vi.mock('../sources/registry', () => ({
  getSource: (id: string) => (id === 'greenhouse' ? { def: { id, name: 'Greenhouse' } } : undefined),
}));

const T0 = new Date('2026-11-20T10:00:00.000Z');
const T1 = new Date('2026-11-21T10:00:00.000Z');
const T2 = new Date('2026-11-22T10:00:00.000Z');

const AUSTIN: Place = {
  kind: 'city', raw: 'Austin, TX', city: 'Austin', admin1: 'TX', admin1Name: 'Texas', country: 'US',
  countryName: 'United States', lat: 30.27, lon: -97.74, label: 'Austin, TX, United States',
};
const BERLIN: Place = {
  kind: 'city', raw: 'Berlin', city: 'Berlin', admin1: '16', admin1Name: 'Berlin', country: 'DE',
  countryName: 'Germany', lat: 52.52, lon: 13.4, label: 'Berlin, Germany',
};

const GH = { feedKey: 'greenhouse:acme', source: 'greenhouse' };
const RO = { feedKey: 'remotive', source: 'remotive' };

type Overrides = Partial<Omit<NormalizedPosting, 'id' | 'contentHash'>> & { externalId: string };

/** A hand-built posting; the hash covers everything but the id, like the real normaliser's. */
function posting(o: Overrides, feed = GH): NormalizedPosting {
  const base: Omit<NormalizedPosting, 'id' | 'contentHash'> = {
    source: feed.source,
    feedKey: feed.feedKey,
    clusterKey: `cluster-${o.externalId}`,
    url: `https://boards.example.com/acme/jobs/${o.externalId}`,
    title: 'Senior Platform Engineer',
    titleCore: 'platform engineer',
    roleId: 'software-engineer',
    familyId: 'engineering',
    company: 'Acme',
    companyKey: 'acme',
    location: { places: [AUSTIN], remote: 'hybrid', remoteScope: [] },
    locationText: 'Austin, TX · Hybrid',
    salary: { min: 150000, max: 180000, currency: 'USD', period: 'year', annualMin: 150000, annualMax: 180000 },
    employmentType: 'full-time',
    seniority: 'senior',
    department: 'Infrastructure',
    tags: ['Backend'],
    skills: ['Kubernetes', 'Go'],
    snippet: 'Run our Kubernetes fleet.',
    descriptionHtml: '<p>Run our Kubernetes fleet.</p>',
    descriptionText: 'Run our Kubernetes fleet.',
    postedAt: '2026-11-19T00:00:00.000Z',
    ...o,
  };
  const { descriptionText: _text, snippet: _snippet, ...visible } = base;
  return { ...base, id: jobIdFor(feed.source, feed.feedKey, o.externalId), contentHash: stableHash(JSON.stringify(visible)) };
}

let db: Db;
let store: JobStore;

beforeEach(() => {
  db = openDb(':memory:');
  // The store only needs the database; the other context members are never touched.
  store = createJobStore({ db, now: () => T0 } as unknown as AppContext);
});
afterEach(() => db.close());

/** Rowids of postings the full-text index finds for a MATCH expression. */
const fts = (match: string): number[] =>
  db.all<{ rowid: number }>(`SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ? ORDER BY rowid`, match).map((r) => r.rowid);
const rid = (id: string): number => db.scalar<number>(`SELECT rid FROM jobs WHERE id = ?`, id)!;
const places = (id: string) =>
  db.all(`SELECT kind, city, admin1, country, lat, lon FROM job_places WHERE job_rid = ? ORDER BY kind, country, city`, rid(id));
const counts = () => ({
  jobs: db.scalar<number>(`SELECT COUNT(*) FROM jobs`),
  places: db.scalar<number>(`SELECT COUNT(*) FROM job_places`),
  fts: db.scalar<number>(`SELECT COUNT(*) FROM jobs_fts`),
});

describe('upsertFeed', () => {
  it('inserts new postings and maps them back to JobPosting', () => {
    const p = posting({ externalId: '1', applyUrl: 'https://boards.example.com/acme/jobs/1/apply' });
    expect(store.upsertFeed(GH, [p], { complete: true, now: T0 })).toEqual({ added: 1, updated: 0, unchanged: 0, closed: 0, reopened: 0 });
    expect(store.getPosting(p.id)).toEqual({
      id: p.id, clusterKey: 'cluster-1', source: 'greenhouse', sourceName: 'Greenhouse', externalId: '1',
      url: p.url, applyUrl: p.applyUrl, title: p.title, roleId: 'software-engineer', company: 'Acme',
      location: p.location, locationText: p.locationText, salary: p.salary, employmentType: 'full-time',
      seniority: 'senior', department: 'Infrastructure', tags: ['Backend'], skills: ['Kubernetes', 'Go'],
      snippet: p.snippet, hasDescription: true, postedAt: p.postedAt,
      firstSeenAt: T0.toISOString(), lastSeenAt: T0.toISOString(),
    });
    expect(store.getDescriptionHtml(p.id)).toBe('<p>Run our Kubernetes fleet.</p>');
    expect(store.getPosting('nope')).toBeUndefined();
    expect(store.getDescriptionHtml('nope')).toBe('');
  });

  it('round-trips optional fields: inferred salary, no salary, no description', () => {
    const inferred = posting({ externalId: '1', salary: { min: 50, currency: 'USD', period: 'hour', annualMin: 104000, text: '$50/hr', inferred: true } });
    const bare = posting({ externalId: '2', salary: undefined, department: undefined, postedAt: undefined, descriptionHtml: '', descriptionText: '', snippet: '' });
    store.upsertFeed(GH, [inferred, bare], { complete: true, now: T0 });
    expect(store.getPosting(inferred.id)?.salary).toEqual(inferred.salary);
    const got = store.getPosting(bare.id)!;
    expect(got.salary).toBeUndefined();
    expect(got.department).toBeUndefined();
    expect(got.postedAt).toBeUndefined();
    expect(got.hasDescription).toBe(false);
  });

  it('indexes title, company, every location name and code, tags, skills, department and body', () => {
    const p = posting({ externalId: '1', location: { places: [AUSTIN], remote: 'hybrid', remoteScope: ['CA'] } });
    store.upsertFeed(GH, [p], { complete: true, now: T0 });
    const r = rid(p.id);
    for (const q of ['title:platform', 'company:acme', 'location:texas', 'location:TX', 'location:"united states"',
      'location:US', 'location:austin', 'location:canada', 'tags:kubernetes', 'tags:backend',
      'tags:infrastructure', 'body:fleet']) {
      expect(fts(q), q).toEqual([r]);
    }
    // Numeric gazetteer admin1 codes are noise and are not indexed.
    store.upsertFeed(GH, [posting({ externalId: '2', location: { places: [BERLIN], remote: 'onsite', remoteScope: [] } })], { complete: false, now: T0 });
    expect(fts('location:16')).toEqual([]);
    expect(fts('location:germany')).toHaveLength(1);
  });

  it('only touches last_seen_at for unchanged postings', () => {
    const p = posting({ externalId: '1' });
    store.upsertFeed(GH, [p], { complete: true, now: T0 });
    expect(store.upsertFeed(GH, [p], { complete: true, now: T1 })).toEqual({ added: 0, updated: 0, unchanged: 1, closed: 0, reopened: 0 });
    const got = store.getPosting(p.id)!;
    expect(got.firstSeenAt).toBe(T0.toISOString());
    expect(got.lastSeenAt).toBe(T1.toISOString());
    expect(counts()).toEqual({ jobs: 1, places: 1, fts: 1 });
  });

  it('rewrites the row, its places and its FTS row when the content changes', () => {
    const p = posting({ externalId: '1' });
    store.upsertFeed(GH, [p], { complete: true, now: T0 });
    const moved = posting({
      externalId: '1', title: 'Staff Reliability Engineer', locationText: 'Berlin, Germany',
      location: { places: [BERLIN], remote: 'onsite', remoteScope: [] }, descriptionHtml: '<p>Keep the lights on.</p>',
      descriptionText: 'Keep the lights on.', snippet: 'Keep the lights on.',
    });
    expect(store.upsertFeed(GH, [moved], { complete: true, now: T1 })).toMatchObject({ updated: 1, added: 0, unchanged: 0 });
    const got = store.getPosting(p.id)!;
    expect(got.title).toBe('Staff Reliability Engineer');
    expect(got.firstSeenAt).toBe(T0.toISOString());
    expect(got.lastSeenAt).toBe(T1.toISOString());
    expect(places(p.id)).toEqual([{ kind: 'city', city: 'Berlin', admin1: '16', country: 'DE', lat: 52.52, lon: 13.4 }]);
    const r = rid(p.id);
    expect(fts('reliability')).toEqual([r]);
    expect(fts('lights')).toEqual([r]);
    expect(fts('platform')).toEqual([]);
    expect(fts('texas')).toEqual([]);
    expect(fts('fleet')).toEqual([]);
    expect(counts()).toEqual({ jobs: 1, places: 1, fts: 1 });
  });

  it('closes absent postings only for complete feeds, keeping them searchable', () => {
    const [a, b, c] = ['1', '2', '3'].map((externalId) => posting({ externalId }));
    store.upsertFeed(GH, [a!, b!, c!], { complete: true, now: T0 });
    expect(store.upsertFeed(GH, [a!], { complete: false, now: T1 }).closed).toBe(0);
    expect(store.openCount()).toBe(3);

    expect(store.upsertFeed(GH, [a!], { complete: true, now: T1 })).toEqual({ added: 0, updated: 0, unchanged: 1, closed: 2, reopened: 0 });
    expect(store.getPosting(b!.id)?.closedAt).toBe(T1.toISOString());
    expect(store.getPosting(a!.id)?.closedAt).toBeUndefined();
    expect(store.openCount()).toBe(1);
    // Closed postings stay in the index (search can include them on request).
    expect(fts('platform')).toHaveLength(3);
    // Already closed postings are not closed again.
    expect(store.upsertFeed(GH, [a!], { complete: true, now: T2 }).closed).toBe(0);
    expect(store.getPosting(b!.id)?.closedAt).toBe(T1.toISOString());
  });

  it('closes an absent posting only once it has been unseen since closeUnseenBefore', () => {
    const [a, b] = ['1', '2'].map((externalId) => posting({ externalId }));
    store.upsertFeed(GH, [a!], { complete: false, now: T0 });
    store.upsertFeed(GH, [b!], { complete: false, now: T1 });
    // Grace cut-off at T1: a (last seen T0) closes; b (seen at T1, not before the cut-off) stays open.
    expect(store.upsertFeed(GH, [], { complete: true, now: T2, closeUnseenBefore: T1 }).closed).toBe(1);
    expect(store.getPosting(a!.id)?.closedAt).toBe(T2.toISOString());
    expect(store.getPosting(b!.id)?.closedAt).toBeUndefined();
    // Without a cut-off every absent posting closes, even one seen earlier at the same instant.
    expect(store.upsertFeed(GH, [], { complete: true, now: T1 }).closed).toBe(1);
    expect(store.getPosting(b!.id)?.closedAt).toBe(T1.toISOString());
  });

  it('re-opens postings that reappear, changed or not', () => {
    const a = posting({ externalId: '1' });
    const b = posting({ externalId: '2' });
    store.upsertFeed(GH, [a, b], { complete: true, now: T0 });
    store.upsertFeed(GH, [], { complete: true, now: T1 });
    expect(store.openCount()).toBe(0);
    const b2 = posting({ externalId: '2', title: 'Principal Platform Engineer' });
    expect(store.upsertFeed(GH, [a, b2], { complete: true, now: T2 })).toEqual({ added: 0, updated: 1, unchanged: 1, closed: 0, reopened: 2 });
    expect(store.getPosting(a.id)?.closedAt).toBeUndefined();
    expect(store.getPosting(b.id)?.closedAt).toBeUndefined();
    expect(fts('principal')).toEqual([rid(b.id)]);
  });

  it('keeps the first of duplicate external ids and leaves other feeds alone', () => {
    const first = posting({ externalId: '1', title: 'First Title' });
    const dupe = posting({ externalId: '1', title: 'Second Title' });
    const other = posting({ externalId: '1' }, RO);
    store.upsertFeed(RO, [other], { complete: true, now: T0 });
    expect(store.upsertFeed(GH, [first, dupe], { complete: true, now: T0 }).added).toBe(1);
    expect(store.getPosting(first.id)?.title).toBe('First Title');
    expect(store.getPosting(other.id)?.closedAt).toBeUndefined();
  });

  it('rejects postings of another feed and rolls the whole batch back', () => {
    const ok = posting({ externalId: '1' });
    const foreign = posting({ externalId: '2' }, RO);
    expect(() => store.upsertFeed(GH, [ok, foreign], { complete: true, now: T0 })).toThrow(/belongs to remotive/);
    expect(counts()).toEqual({ jobs: 0, places: 0, fts: 0 });
  });

  it('keeps a lazily fetched description when a later feed update has none', () => {
    const p = posting({ externalId: '1', descriptionHtml: '', descriptionText: '', snippet: '', skills: [] });
    store.upsertFeed(GH, [p], { complete: true, now: T0 });
    store.setDescription(p.id, '<p>We use Terraform daily.</p>', 'We use Terraform daily.');
    store.upsertFeed(GH, [posting({ ...p, title: 'Senior Platform Engineer II' })], { complete: true, now: T1 });
    const got = store.getPosting(p.id)!;
    expect(got.title).toBe('Senior Platform Engineer II');
    expect(got.hasDescription).toBe(true);
    expect(got.snippet).toBe('We use Terraform daily.');
    expect(got.skills).toContain('Terraform');
    expect(fts('body:terraform')).toEqual([rid(p.id)]);
  });
});

describe('job_places', () => {
  const upsert = (location: JobLocation) => {
    const p = posting({ externalId: 'x', location });
    store.upsertFeed(GH, [p], { complete: false, now: T0 });
    return places(p.id);
  };

  it('writes city, admin1 and country rows, keeping city names of gazetteer-less localities', () => {
    const smallville: Place = { kind: 'admin1', raw: 'Smallville, KS', city: 'Smallville', admin1: 'KS', admin1Name: 'Kansas', country: 'US', label: 'Smallville, KS, United States' };
    const ontario: Place = { kind: 'admin1', raw: 'Ontario', admin1: 'ON', admin1Name: 'Ontario', country: 'CA', label: 'Ontario, Canada' };
    const uk: Place = { kind: 'country', raw: 'UK', country: 'GB', countryName: 'United Kingdom', label: 'United Kingdom' };
    expect(upsert({ places: [AUSTIN, smallville, ontario, uk, AUSTIN], remote: 'onsite', remoteScope: [] })).toEqual([
      { kind: 'admin1', city: null, admin1: 'ON', country: 'CA', lat: null, lon: null },
      { kind: 'city', city: 'Austin', admin1: 'TX', country: 'US', lat: 30.27, lon: -97.74 },
      { kind: 'city', city: 'Smallville', admin1: 'KS', country: 'US', lat: null, lon: null },
      { kind: 'country', city: null, admin1: null, country: 'GB', lat: null, lon: null },
    ]);
  });

  it('expands regions per member country and writes remote scope rows; anywhere/unknown write none', () => {
    const dach: Place = { kind: 'region', raw: 'DACH', region: 'DACH', countries: ['DE', 'AT', 'CH'], label: 'DACH' };
    const anywhere: Place = { kind: 'anywhere', raw: 'Worldwide', label: 'Anywhere' };
    const unknown: Place = { kind: 'unknown', raw: 'Atlantis', label: 'Atlantis' };
    const row = (kind: string, country: string) => ({ kind, city: null, admin1: null, country, lat: null, lon: null });
    expect(upsert({ places: [dach, anywhere, unknown], remote: 'hybrid', remoteScope: ['US', 'CA'] })).toEqual([
      row('region', 'AT'), row('region', 'CH'), row('region', 'DE'), row('scope', 'CA'), row('scope', 'US'),
    ]);
    expect(fts('location:dach')).toHaveLength(1);
  });

  it('writes nothing for an unrestricted remote job', () => {
    expect(upsert({ places: [], remote: 'remote', remoteScope: [] })).toEqual([]);
  });
});

describe('upsertPostings', () => {
  it('upserts search results without closing the rest of the feed', () => {
    const [a, b] = ['1', '2'].map((externalId) => posting({ externalId }, RO));
    expect(store.upsertPostings(RO, [a!], T0)).toEqual({ added: 1, updated: 0, unchanged: 0, closed: 0, reopened: 0 });
    expect(store.upsertPostings(RO, [b!], T1)).toMatchObject({ added: 1 });
    expect(store.upsertPostings(RO, [b!, posting({ externalId: '1', title: 'Changed' }, RO)], T2)).toEqual({
      added: 0, updated: 1, unchanged: 1, closed: 0, reopened: 0,
    });
    expect(store.openCount()).toBe(2);
    expect(store.upsertPostings(RO, [], T2)).toEqual({ added: 0, updated: 0, unchanged: 0, closed: 0, reopened: 0 });
  });

  it('re-opens a closed posting that shows up in results again', () => {
    const a = posting({ externalId: '1' }, RO);
    store.upsertPostings(RO, [a], T0);
    store.closePostings(RO.feedKey, ['1'], T1);
    expect(store.upsertPostings(RO, [a], T2)).toMatchObject({ unchanged: 1, reopened: 1 });
    expect(store.getPosting(a.id)?.closedAt).toBeUndefined();
  });
});

describe('reads', () => {
  it('getPostings preserves the requested order and skips unknown ids', () => {
    const ps = ['1', '2', '3'].map((externalId) => posting({ externalId }));
    store.upsertFeed(GH, ps, { complete: true, now: T0 });
    const ids = [ps[2]!.id, 'missing', ps[0]!.id, ps[1]!.id];
    expect(store.getPostings(ids).map((p) => p.id)).toEqual([ps[2]!.id, ps[0]!.id, ps[1]!.id]);
    expect(store.getPostings([])).toEqual([]);
  });

  it('clusterLinks puts open before closed, ATS before aggregators, then newest first', () => {
    const feeds = {
      lever: { feedKey: 'lever:acme', source: 'lever' },
      greenhouse: GH,
      remotive: RO,
      remoteok: { feedKey: 'remoteok', source: 'remoteok' },
    };
    const inCluster = (feed: { feedKey: string; source: string }, externalId: string, postedAt?: string) =>
      posting({ externalId, clusterKey: 'same-job', postedAt }, feed);
    const closedAts = inCluster(feeds.lever, 'l1', '2026-11-19T00:00:00.000Z');
    const ats = inCluster(feeds.greenhouse, 'g1', '2026-11-10T00:00:00.000Z');
    const aggOld = inCluster(feeds.remotive, 'r1', '2026-11-12T00:00:00.000Z');
    const aggNew = inCluster(feeds.remoteok, 'k1', '2026-11-18T00:00:00.000Z');
    const aggUndated = inCluster(feeds.remotive, 'r2');
    store.upsertFeed(feeds.lever, [closedAts], { complete: true, now: T0 });
    store.upsertFeed(feeds.greenhouse, [ats], { complete: true, now: T0 });
    store.upsertFeed(feeds.remotive, [aggOld, aggUndated], { complete: true, now: T0 });
    store.upsertFeed(feeds.remoteok, [aggNew], { complete: true, now: T0 });
    store.setLiveness(closedAts.id, { status: 'closed', checkedAt: T1.toISOString() });

    const links = store.clusterLinks('same-job');
    expect(links.map((l) => l.jobId)).toEqual([ats.id, aggNew.id, aggOld.id, aggUndated.id, closedAts.id]);
    expect(links[0]).toEqual({ jobId: ats.id, source: 'greenhouse', sourceName: 'Greenhouse', url: ats.url, applyUrl: undefined, postedAt: ats.postedAt });
    expect(store.clusterLinks('nothing')).toEqual([]);
  });

  it('counts open postings, by source, by feed and distinct companies', () => {
    store.upsertFeed(GH, [posting({ externalId: '1' }), posting({ externalId: '2' })], { complete: true, now: T0 });
    store.upsertFeed(RO, [posting({ externalId: 'a', company: 'Beta Inc', companyKey: 'beta' }, RO), posting({ externalId: 'b' }, RO)], { complete: true, now: T0 });
    store.closePostings(GH.feedKey, ['2'], T1);
    expect(store.openCount()).toBe(3);
    expect(store.openCountBySource()).toEqual(new Map([['greenhouse', 1], ['remotive', 2]]));
    expect(store.openCountByFeed()).toEqual(new Map([['greenhouse:acme', 1], ['remotive', 2]]));
    expect(store.openCountByFeed(['remotive', 'lever:none'])).toEqual(new Map([['remotive', 2], ['lever:none', 0]]));
    expect(store.openCountByFeed([])).toEqual(new Map());
    expect(store.companyCount()).toBe(2);
    // Sources missing from the registry are named by their id.
    expect(store.getPosting(jobIdFor('remotive', 'remotive', 'a'))?.sourceName).toBe('remotive');
  });
});

describe('descriptions and liveness', () => {
  it('setDescription stores sanitised HTML and refreshes snippet, skills and the FTS row', () => {
    const p = posting({ externalId: '1', descriptionHtml: '', descriptionText: '', snippet: '', skills: [] });
    store.upsertFeed(GH, [p], { complete: true, now: T0 });
    expect(store.getPosting(p.id)?.hasDescription).toBe(false);
    store.setDescription(p.id, '<p>Build with <b>PostgreSQL</b> and Python.</p><script>alert(1)</script>', 'Build with PostgreSQL and Python.');
    const got = store.getPosting(p.id)!;
    expect(got.hasDescription).toBe(true);
    expect(got.snippet).toBe('Build with PostgreSQL and Python.');
    expect(got.skills).toEqual(expect.arrayContaining(['PostgreSQL', 'Python']));
    const html = store.getDescriptionHtml(p.id);
    expect(html).toContain('<b>PostgreSQL</b>');
    expect(html).not.toContain('script');
    const r = rid(p.id);
    expect(fts('body:postgresql')).toEqual([r]);
    expect(fts('tags:python')).toEqual([r]);
    // The rest of the FTS row is re-derived from the stored posting.
    expect(fts('location:texas')).toEqual([r]);
    expect(fts('title:platform')).toEqual([r]);
    expect(counts().fts).toBe(1);
    // A posting removed meanwhile is ignored.
    expect(() => store.setDescription('gone', '<p>x</p>', 'x')).not.toThrow();
  });

  it('setLiveness records the check; closed closes once, open re-opens, unknown changes nothing', () => {
    const p = posting({ externalId: '1' });
    store.upsertFeed(GH, [p], { complete: true, now: T0 });
    expect(store.getLiveness(p.id)).toBeUndefined();
    store.setLiveness(p.id, { status: 'unknown', checkedAt: T0.toISOString(), detail: 'timeout' });
    expect(store.getLiveness(p.id)).toEqual({ status: 'unknown', checkedAt: T0.toISOString() });
    expect(store.getPosting(p.id)?.closedAt).toBeUndefined();
    store.setLiveness(p.id, { status: 'closed', checkedAt: T1.toISOString() });
    store.setLiveness(p.id, { status: 'closed', checkedAt: T2.toISOString() });
    expect(store.getPosting(p.id)?.closedAt).toBe(T1.toISOString());
    expect(store.getLiveness(p.id)).toEqual({ status: 'closed', checkedAt: T2.toISOString() });
    store.setLiveness(p.id, { status: 'unknown', checkedAt: T2.toISOString() });
    expect(store.getPosting(p.id)?.closedAt).toBe(T1.toISOString());
    store.setLiveness(p.id, { status: 'open', checkedAt: T2.toISOString() });
    expect(store.getPosting(p.id)?.closedAt).toBeUndefined();
    expect(store.getLiveness('missing')).toBeUndefined();
  });

  it('closePostings closes open postings of one feed by external id', () => {
    store.upsertFeed(GH, ['1', '2', '3'].map((externalId) => posting({ externalId })), { complete: true, now: T0 });
    store.upsertFeed(RO, [posting({ externalId: '1' }, RO)], { complete: true, now: T0 });
    expect(store.closePostings(GH.feedKey, ['1', '2', 'nope'], T1)).toBe(2);
    expect(store.closePostings(GH.feedKey, ['1', '3'], T2)).toBe(1);
    expect(store.closePostings(GH.feedKey, [], T2)).toBe(0);
    expect(store.openCountByFeed()).toEqual(new Map([['remotive', 1]]));
  });

  it('unseenSince lists open postings last seen before a date, oldest first', () => {
    const [a, b, c] = ['1', '2', '3'].map((externalId) => posting({ externalId }));
    store.upsertFeed(GH, [b!], { complete: false, now: T1 });
    store.upsertFeed(GH, [a!, c!], { complete: false, now: T0 });
    store.closePostings(GH.feedKey, ['3'], T1);
    store.upsertFeed(GH, [posting({ externalId: '4' })], { complete: false, now: T2 });
    expect(store.unseenSince(GH.feedKey, T2)).toEqual([
      { id: a!.id, externalId: '1', lastSeenAt: T0.toISOString() },
      { id: b!.id, externalId: '2', lastSeenAt: T1.toISOString() },
    ]);
    expect(store.unseenSince(GH.feedKey, T2, 1).map((r) => r.externalId)).toEqual(['1']);
    expect(store.unseenSince(GH.feedKey, T0)).toEqual([]);
    expect(store.unseenSince('other', T2)).toEqual([]);
  });
});

describe('removal', () => {
  it('removeFeed deletes the feed with its places and FTS rows', () => {
    store.upsertFeed(GH, [posting({ externalId: '1' }), posting({ externalId: '2' })], { complete: true, now: T0 });
    const other = posting({ externalId: '1', title: 'Remote Writer' }, RO);
    store.upsertFeed(RO, [other], { complete: true, now: T0 });
    expect(store.removeFeed(GH.feedKey)).toBe(2);
    expect(counts()).toEqual({ jobs: 1, places: 1, fts: 1 });
    expect(fts('platform')).toEqual([]);
    expect(fts('writer')).toEqual([rid(other.id)]);
    expect(store.removeFeed(GH.feedKey)).toBe(0);
  });

  it('purgeClosed removes only postings closed strictly before the cut-off', () => {
    const ps = ['1', '2', '3'].map((externalId) => posting({ externalId }));
    store.upsertFeed(GH, ps, { complete: true, now: T0 });
    store.closePostings(GH.feedKey, ['1'], T0);
    store.closePostings(GH.feedKey, ['2'], T1);
    expect(store.purgeClosed(T1)).toBe(1);
    expect(store.getPosting(ps[0]!.id)).toBeUndefined();
    expect(store.getPosting(ps[1]!.id)).toBeDefined();
    expect(counts()).toEqual({ jobs: 2, places: 2, fts: 2 });
    expect(fts('platform')).toEqual([rid(ps[1]!.id), rid(ps[2]!.id)]);
  });

  it('clear removes every posting from every table', () => {
    store.upsertFeed(GH, [posting({ externalId: '1' })], { complete: true, now: T0 });
    store.upsertFeed(RO, [posting({ externalId: '1' }, RO)], { complete: true, now: T0 });
    store.clear();
    expect(counts()).toEqual({ jobs: 0, places: 0, fts: 0 });
    expect(fts('platform')).toEqual([]);
    // Row ids are never reused, so stale FTS rowids can never point at a new job.
    const p = posting({ externalId: '9' });
    store.upsertFeed(GH, [p], { complete: true, now: T1 });
    expect(rid(p.id)).toBeGreaterThan(2);
    expect(fts('platform')).toEqual([rid(p.id)]);
  });
});
