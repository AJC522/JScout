import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Place } from '../../shared/types';
import { sanitizeHtml } from '../lib/html';
import { greenhouseSource } from '../sources/greenhouse';
import { remotiveSource } from '../sources/remotive';
import type { BoardRef, JobSource, RawPosting } from '../sources/types';
import { clusterLocationKey, feedKeyFor, jobIdFor, makeSnippet, normalizePosting, type NormalizeContext } from './normalize';
import { FIXTURE_SOURCE_IDS, fetchFixtureFeeds, type FixtureFeed } from './testing';
import type { NormalizedPosting } from './types';

const NOW = new Date('2026-11-25T06:00:00.000Z');
const HOUR = 3_600_000;

const ACME: BoardRef = { ats: 'greenhouse', token: 'acme', name: 'Acme' };
const GH_CTX: NormalizeContext = { source: greenhouseSource.def, feedKey: feedKeyFor('greenhouse', ACME), board: ACME, now: NOW };
const RO_CTX: NormalizeContext = { source: remotiveSource.def, feedKey: feedKeyFor('remotive'), now: NOW };

function raw(o: Partial<RawPosting> = {}): RawPosting {
  return {
    externalId: '123',
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    title: 'Senior Backend Engineer',
    company: 'Acme',
    locations: ['Austin, TX'],
    descriptionHtml: '<p>Build our <b>Go</b> and PostgreSQL services.</p>',
    postedAt: '2026-11-20T09:30:00Z',
    ...o,
  };
}

function normalize(o: Partial<RawPosting> = {}, ctx: NormalizeContext = GH_CTX): NormalizedPosting {
  const p = normalizePosting(raw(o), ctx);
  if (!p) throw new Error('posting was rejected');
  return p;
}

describe('feedKeyFor / jobIdFor', () => {
  it('derives feed keys and stable ids', () => {
    expect(feedKeyFor('remotive')).toBe('remotive');
    expect(feedKeyFor('greenhouse', { token: 'stripe' })).toBe('greenhouse:stripe');
    expect(jobIdFor('greenhouse', 'greenhouse:stripe', '1')).toBe(jobIdFor('greenhouse', 'greenhouse:stripe', '1'));
    expect(jobIdFor('greenhouse', 'greenhouse:stripe', '1')).not.toBe(jobIdFor('greenhouse', 'greenhouse:stripe', '2'));
  });
});

describe('normalizePosting', () => {
  it('normalises every field of a typical ATS posting', () => {
    const p = normalize({
      title: '  Senior Backend Engineer &amp; Mentor ',
      company: 'Acme, Inc. (from the source)',
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/123',
      companyUrl: 'https://acme.example',
      descriptionHtml: '<p>Build our <b>Go</b> and PostgreSQL services.</p><script>alert(1)</script>',
      salary: { min: 150000, max: 180000, currency: 'USD', period: 'year' },
      employmentType: 'Full-time',
      department: 'Platform',
      tags: ['Backend', 'backend', ' ', 'Go'],
      postedAt: 1795500000,
    });
    expect(p).toMatchObject({
      id: jobIdFor('greenhouse', 'greenhouse:acme', '123'),
      source: 'greenhouse',
      feedKey: 'greenhouse:acme',
      externalId: '123',
      url: 'https://boards.greenhouse.io/acme/jobs/123',
      title: 'Senior Backend Engineer & Mentor',
      // A board's name is the company for all of its postings.
      company: 'Acme',
      companyKey: 'acme',
      companyUrl: 'https://acme.example/',
      seniority: 'senior',
      employmentType: 'full-time',
      department: 'Platform',
      tags: ['Backend', 'Go'],
      salary: { min: 150000, max: 180000, currency: 'USD', period: 'year', annualMin: 150000, annualMax: 180000 },
      postedAt: '2026-11-24T06:00:00.000Z',
    });
    // applyUrl equal to url is dropped.
    expect(p.applyUrl).toBeUndefined();
    expect(p.salary?.inferred).toBeFalsy();
    expect(p.descriptionHtml).toBe('<p>Build our <b>Go</b> and PostgreSQL services.</p>');
    expect(p.descriptionText).toBe('Build our Go and PostgreSQL services.');
    expect(p.snippet).toBe('Build our Go and PostgreSQL services.');
    expect(p.skills).toEqual(expect.arrayContaining(['Go', 'PostgreSQL']));
    expect(p.titleCore).not.toMatch(/senior/);
    expect(p.location.places[0]).toMatchObject({ kind: 'city', city: 'Austin', admin1: 'TX', country: 'US' });
    expect(p.locationText).toMatch(/^Austin, TX/);
    expect(p.contentHash).toMatch(/^[0-9a-f]{20}$/);
  });

  it('rejects unusable and expired postings', () => {
    const cases: Array<Partial<RawPosting>> = [
      { title: '   ' },
      { title: 'null' },
      { title: '<b></b>' },
      { externalId: ' ' },
      { url: 'javascript:alert(1)' },
      { url: '/jobs/123' },
      { url: 'mailto:jobs@acme.example' },
      { expiresAt: '2026-11-24T00:00:00Z' },
    ];
    for (const c of cases) expect(normalizePosting(raw(c), GH_CTX), JSON.stringify(c)).toBeNull();
    // Without a board the company comes from the posting and must be present.
    expect(normalizePosting(raw({ company: 'undefined' }), RO_CTX)).toBeNull();
    // A future or unreadable expiry does not drop the posting.
    expect(normalizePosting(raw({ expiresAt: '2027-01-31' }), GH_CTX)).not.toBeNull();
    expect(normalizePosting(raw({ expiresAt: 'soon' }), GH_CTX)).not.toBeNull();
  });

  it('accepts numeric external ids and trims them', () => {
    expect(normalize({ externalId: 42 as unknown as string }).externalId).toBe('42');
    expect(normalize({ externalId: ' 7 ' }).id).toBe(jobIdFor('greenhouse', 'greenhouse:acme', '7'));
  });

  it('drops literal placeholders, markup and unsafe urls from single-line fields', () => {
    const p = normalize(
      {
        company: 'Beta &amp; Sons',
        department: 'undefined',
        companyLogo: 'javascript:alert(1)',
        companyUrl: 'N/A',
        applyUrl: 'https://beta.example/apply?id=1',
        tags: ['null', '<i>React</i>', 'NaN'],
        seniority: 'None',
      },
      RO_CTX,
    );
    expect(p.company).toBe('Beta & Sons');
    expect(p.department).toBeUndefined();
    expect(p.companyLogo).toBeUndefined();
    expect(p.companyUrl).toBeUndefined();
    expect(p.applyUrl).toBe('https://beta.example/apply?id=1');
    expect(p.tags).toEqual(['React']);
  });

  it('builds the description from plain text, or leaves it empty', () => {
    const fromText = normalize({ descriptionHtml: undefined, descriptionText: 'Line one.\n\nLine <two> & more.' });
    expect(fromText.descriptionHtml).toBe('<p>Line one.</p><p>Line &lt;two&gt; &amp; more.</p>');
    expect(fromText.snippet).toBe('Line one. Line <two> & more.');
    // HTML without any text falls back to the plain text.
    expect(normalize({ descriptionHtml: '<div> </div>', descriptionText: 'Plain.' }).descriptionHtml).toBe('<p>Plain.</p>');
    const none = normalize({ descriptionHtml: '   ', descriptionText: undefined });
    expect(none).toMatchObject({ descriptionHtml: '', descriptionText: '', snippet: '' });
  });

  it('caps the snippet at about 300 characters on a word boundary', () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const p = normalize({ descriptionHtml: `<p>${long}</p>` });
    expect(p.snippet.length).toBeLessThanOrEqual(301);
    expect(p.snippet).toMatch(/word\d+…$/);
    expect(makeSnippet('  a \n\n b  ')).toBe('a b');
  });

  it('never dates a posting in the future and falls back to updatedAt', () => {
    expect(normalize({ postedAt: new Date(NOW.getTime() + HOUR).toISOString() }).postedAt).toBe(NOW.toISOString());
    expect(normalize({ postedAt: undefined, updatedAt: '2026-11-18' }).postedAt).toBe('2026-11-18T00:00:00.000Z');
    expect(normalize({ postedAt: 'whenever', updatedAt: undefined }).postedAt).toBeUndefined();
  });

  it('infers a salary from the description only when the source gives none', () => {
    const description = '<p>The base salary range for this role is $120,000 - $150,000 per year.</p>';
    const inferred = normalize({ descriptionHtml: description }).salary;
    expect(inferred).toMatchObject({ min: 120000, max: 150000, currency: 'USD', period: 'year', inferred: true });
    const structured = normalize({ descriptionHtml: description, salary: { min: 90, max: 110, currency: 'USD', period: 'hour' } }).salary;
    expect(structured).toMatchObject({ min: 90, max: 110, period: 'hour', annualMin: 187200 });
    expect(structured?.inferred).toBeFalsy();
    // Ambiguous "$" reads in the currency of the job's country.
    expect(normalize({ locations: ['Toronto, ON'], salary: { text: '$90,000 - $110,000 a year' } }).salary?.currency).toBe('CAD');
  });

  it('honours a structured remote flag', () => {
    const p = normalize({ locations: ['USA'], remote: 'remote' }, RO_CTX);
    expect(p.location.remote).toBe('remote');
    expect(p.location.remoteScope).toEqual(['US']);
  });

  describe('contentHash', () => {
    const base = raw({ salary: { min: 100000, max: 120000, currency: 'USD' }, tags: ['Go'], department: 'Platform' });
    const hash = (r: RawPosting, ctx: NormalizeContext = GH_CTX) => normalizePosting(r, ctx)!.contentHash;

    it('is unchanged by re-normalising later or by fields the user never sees', () => {
      const later = { ...GH_CTX, now: new Date(NOW.getTime() + 24 * HOUR) };
      expect(hash(base, later)).toBe(hash(base));
      expect(hash({ ...base, updatedAt: '2026-11-24T00:00:00Z' })).toBe(hash(base));
      expect(hash({ ...base, expiresAt: '2027-03-01' })).toBe(hash(base));
      expect(hash({ ...base, title: `  ${base.title}  ` })).toBe(hash(base));
    });

    it('changes whenever a visible field changes', () => {
      const changes: Array<Partial<RawPosting>> = [
        { title: 'Staff Backend Engineer' },
        { locations: ['Denver, CO'] },
        { remote: 'hybrid' },
        { salary: { min: 100000, max: 130000, currency: 'USD' } },
        { descriptionHtml: '<p>Something else entirely.</p>' },
        { applyUrl: 'https://acme.example/apply/123' },
        { url: 'https://boards.greenhouse.io/acme/jobs/123?gh_src=1' },
        { tags: ['Go', 'Rust'] },
        { department: 'Payments' },
        { employmentType: 'Contract' },
        { postedAt: '2026-11-21T09:30:00Z' },
        { companyLogo: 'https://cdn.acme.example/logo.png' },
      ];
      for (const c of changes) expect(hash({ ...base, ...c }), JSON.stringify(c)).not.toBe(hash(base));
      // Without a board the company is visible too.
      expect(hash({ ...base, company: 'Other Co' }, RO_CTX)).not.toBe(hash(base, RO_CTX));
    });
  });
});

describe('cluster keys', () => {
  it('gives the ATS copy and an aggregator copy of one remote job the same key', () => {
    const ats = normalize({ title: 'Senior Software Engineer - Payments', locations: ['Remote - US'] });
    const aggregator = normalize(
      { externalId: 'r-998', url: 'https://remotive.com/job/998', title: 'senior software engineer, payments', company: 'ACME Inc.', locations: ['USA'], remote: 'remote' },
      RO_CTX,
    );
    expect(ats.location.remote).toBe('remote');
    expect(aggregator.id).not.toBe(ats.id);
    expect(aggregator.clusterKey).toBe(ats.clusterKey);
  });

  it('matches the same on-site job however the city is written', () => {
    const a = normalize({ title: 'Registered Nurse', locations: ['Austin, TX'] });
    const b = normalize({ title: 'Registered Nurse (RN)', company: 'Acme LLC', locations: ['Austin, Texas, United States'] }, RO_CTX);
    expect(b.clusterKey).toBe(a.clusterKey);
  });

  it('keeps the same title at the same company in different cities, levels or teams apart', () => {
    const denver = normalize({ title: 'Registered Nurse', locations: ['Denver, CO'] });
    const others = [
      normalize({ title: 'Registered Nurse', locations: ['Boston, MA'] }),
      normalize({ title: 'Registered Nurse', locations: ['Denver, CO'], remote: 'remote' }),
      normalize({ title: 'Senior Registered Nurse', locations: ['Denver, CO'] }),
      normalize({ title: 'Registered Nurse - ICU', locations: ['Denver, CO'] }),
      normalize({ title: 'Registered Nurse', company: 'Other Health', locations: ['Denver, CO'] }, RO_CTX),
    ];
    for (const o of others) expect(o.clusterKey, `${o.title} ${o.locationText}`).not.toBe(denver.clusterKey);
  });

  it('keeps one board\'s per-country remote requisitions apart, and their re-listings together', () => {
    const japan = normalize({ title: 'Business Development Representative, Japan', locations: ['Remote'], remote: 'remote' });
    const germany = normalize({ title: 'Business Development Representative - Germany', locations: ['Remote'], remote: 'remote' });
    const brazil = normalize({ title: 'Business Development Representative (Brazil)', locations: ['Remote'], remote: 'remote' });
    expect(new Set([japan.clusterKey, germany.clusterKey, brazil.clusterKey]).size).toBe(3);
    const relisted = normalize({ title: 'Business Development Representative, Japan', company: 'Acme LLC', locations: ['Japan'], remote: 'remote' }, RO_CTX);
    expect(relisted.clusterKey).toBe(japan.clusterKey);
    // Titles without a place still merge whatever the scope says.
    const a = normalize({ title: 'Software Engineer', locations: ['Remote - US'], remote: 'remote' });
    const b = normalize({ title: 'Software Engineer', company: 'Acme LLC', locations: ['USA'], remote: 'remote' }, RO_CTX);
    expect(b.clusterKey).toBe(a.clusterKey);
  });

  it('builds the location part from the first usable place, then the raw text', () => {
    const smallville: Place = { kind: 'admin1', raw: 'Smallville, KS', city: 'Smallville', admin1: 'KS', country: 'US', label: 'Smallville, KS' };
    const kansas: Place = { kind: 'admin1', raw: 'Kansas', admin1: 'KS', country: 'US', label: 'Kansas' };
    const unknown: Place = { kind: 'unknown', raw: 'Moon Base', label: 'Moon Base' };
    const key = (places: Place[], rawLocations: string[] = [], remote: 'onsite' | 'remote' = 'onsite') =>
      clusterLocationKey({ places, remote, remoteScope: [] }, rawLocations);
    // A locality missing from the gazetteer is still a city, not its state.
    expect(key([smallville])).toBe('city:US:KS:smallville');
    expect(key([kansas])).toBe('admin1:US:KS');
    expect(key([unknown, kansas])).toBe('admin1:US:KS');
    expect(key([unknown], ['Moon Base, Sector 7'])).toBe('raw:moon base sector 7');
    expect(key([], [])).toBe('');
    expect(key([smallville], [], 'remote')).toBe('remote');
  });
});

// --- every adapter's fixtures --------------------------------------------------------------------

interface Normalised {
  feed: FixtureFeed;
  raw: RawPosting;
  posting: NormalizedPosting;
}

const nowFor = (feed: FixtureFeed): Date => (feed.now && feed.now > NOW ? feed.now : NOW);
const ctxFor = (feed: FixtureFeed, now = nowFor(feed)): NormalizeContext => ({ source: feed.source.def, feedKey: feed.feedKey, board: feed.board, now });

function normalizeAll(feeds: FixtureFeed[]): { kept: Normalised[]; rejected: number } {
  const kept: Normalised[] = [];
  let rejected = 0;
  for (const feed of feeds) {
    for (const r of feed.postings) {
      const posting = normalizePosting(r, ctxFor(feed));
      if (posting) kept.push({ feed, raw: r, posting });
      else rejected++;
    }
  }
  return { kept, rejected };
}

/** Values no user should ever see: serialisation accidents from upstream or from us. */
function junkValues(value: unknown, at: string, freeText: boolean, out: string[]): string[] {
  if (value === null) out.push(`${at} is null`);
  else if (typeof value === 'number' && !Number.isFinite(value)) out.push(`${at} is ${value}`);
  else if (typeof value === 'string') {
    if (/\[object Object\]/.test(value)) out.push(`${at} contains [object Object]`);
    // Descriptions may legitimately discuss "undefined" or "NaN" (programming jobs); short fields may not.
    if (!freeText && /^(?:null|nan)$|\bundefined\b|\bNaN\b/i.test(value)) out.push(`${at} = ${JSON.stringify(value)}`);
  } else if (Array.isArray(value)) value.forEach((v, i) => junkValues(v, `${at}[${i}]`, freeText, out));
  else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) junkValues(v, `${at}.${k}`, freeText || /^description|^snippet$/.test(k), out);
  }
  return out;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MARKUP = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>|&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;
const MAJOR_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'NZD', 'SGD']);

describe('normalising every adapter fixture', () => {
  let feeds: FixtureFeed[];
  let all: Normalised[];
  let rejected: number;

  beforeAll(async () => {
    feeds = await fetchFixtureFeeds();
    ({ kept: all, rejected } = normalizeAll(feeds));
  });

  const each = (check: (n: Normalised) => string[]) => {
    const problems = all.flatMap((n) => check(n).map((msg) => `${n.feed.feedKey} ${n.raw.externalId}: ${msg}`));
    expect(problems).toEqual([]);
  };

  it('covers every adapter that exports a JobSource', async () => {
    const dir = path.join(import.meta.dirname, '..', 'sources');
    const ids = new Set<string>();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const mod = (await import(path.join(dir, file))) as Record<string, unknown>;
      for (const value of Object.values(mod)) {
        const def = (value as Partial<JobSource> | null)?.def;
        if (def && typeof def.id === 'string' && (typeof (value as JobSource).fetchFeed === 'function' || typeof (value as JobSource).search === 'function')) {
          ids.add(def.id);
        }
      }
    }
    expect(ids.size).toBeGreaterThan(0);
    expect([...ids].filter((id) => !FIXTURE_SOURCE_IDS.has(id))).toEqual([]);
  });

  it('keeps nearly every posting', () => {
    expect(all.length).toBeGreaterThan(150);
    expect(rejected).toBeLessThanOrEqual(2);
  });

  it('produces no null, NaN or "undefined" values anywhere', () => {
    each(({ posting }) => junkValues(posting, 'posting', false, []));
  });

  it('derives ids from source, feed and external id, unique and stable across runs', async () => {
    const again = normalizeAll(await fetchFixtureFeeds()).kept;
    expect(again.map((n) => n.posting.id)).toEqual(all.map((n) => n.posting.id));
    expect(again.map((n) => n.posting.contentHash)).toEqual(all.map((n) => n.posting.contentHash));
    expect(new Set(all.map((n) => n.posting.id)).size).toBe(all.length);
    each(({ feed, posting }) =>
      posting.id === jobIdFor(feed.source.def.id, feed.feedKey, posting.externalId) && posting.feedKey === feed.feedKey ? [] : ['id mismatch'],
    );
  });

  it('stores already-sanitised descriptions and markup-free text fields', () => {
    each(({ posting: p }) => {
      const problems: string[] = [];
      if (sanitizeHtml(p.descriptionHtml) !== p.descriptionHtml) problems.push('descriptionHtml is not sanitised');
      if ((p.descriptionHtml === '') !== (p.descriptionText === '')) problems.push('description html/text disagree');
      for (const [field, value] of Object.entries({ title: p.title, company: p.company, snippet: p.snippet, location: p.locationText })) {
        if (MARKUP.test(value)) problems.push(`${field} has markup: ${value.slice(0, 80)}`);
        if (value !== value.trim() || /\s{2}/.test(value)) problems.push(`${field} has stray whitespace`);
      }
      if (p.snippet.length > 301) problems.push('snippet too long');
      return problems;
    });
  });

  it('keeps only http(s) urls', () => {
    each(({ posting: p }) =>
      [p.url, p.applyUrl, p.companyUrl, p.companyLogo].filter((u) => u !== undefined && !/^https?:\/\/[^/]/.test(u)).map((u) => `bad url ${u}`),
    );
  });

  it('dates postings in ISO-8601 UTC, never in the future', () => {
    each(({ feed, posting: p }) => (p.postedAt === undefined || (ISO.test(p.postedAt) && p.postedAt <= nowFor(feed).toISOString()) ? [] : [`postedAt ${p.postedAt}`]));
    expect(all.filter((n) => n.posting.postedAt).length / all.length).toBeGreaterThan(0.95);
  });

  it('keeps a monthly salary the source states, however small, and never reads it as hourly', () => {
    const fresh = all.find((n) => n.feed.source.def.id === 'jobicy' && n.raw.externalId === '156758');
    expect(fresh?.posting.salary).toMatchObject({ min: 400, max: 400, currency: 'USD', period: 'month', annualMin: 4_800 });
  });

  it('keeps salaries plausible', () => {
    each(({ posting: { salary: s } }) => {
      if (!s) return [];
      const problems: string[] = [];
      if (s.currency !== undefined && !/^[A-Z]{3}$/.test(s.currency)) problems.push(`currency ${s.currency}`);
      if (s.annualMin === undefined && s.annualMax === undefined && !s.text) problems.push('salary without amounts or text');
      if (s.annualMin !== undefined && s.annualMax !== undefined && s.annualMin > s.annualMax) problems.push('annualMin > annualMax');
      for (const v of [s.annualMin, s.annualMax]) {
        if (v === undefined) continue;
        // lib/salary's own plausibility bounds for these currencies; others vary too widely to bound here.
        // A period the source states itself may go lower ($400 a month in the Philippines).
        const [lo, hi] = s.currency && MAJOR_CURRENCIES.has(s.currency) ? [s.period === 'year' ? 5_000 : 1_000, 5_000_000] : [1, 1e10];
        if (!(v >= lo && v <= hi)) problems.push(`annual ${v} ${s.currency ?? ''} out of range`);
      }
      return problems;
    });
  });

  it('describes a location whenever the source gave one', () => {
    each(({ raw, posting: p }) => {
      const given = raw.locations.some((l) => l.trim() !== '');
      return given && p.locationText === '' ? [`no location text for ${JSON.stringify(raw.locations)}`] : [];
    });
  });

  it('keeps postings flagged remote by the source remote', () => {
    const remote = all.filter((n) => n.raw.remote === 'remote');
    expect(remote.length).toBeGreaterThan(50);
    each(({ raw, posting: p }) => (raw.remote === 'remote' && p.location.remote !== 'remote' ? [`remote became ${p.location.remote}`] : []));
  });

  it('fills the fields search depends on', () => {
    each(({ posting: p }) => {
      const problems: string[] = [];
      if (!p.titleCore) problems.push('empty titleCore');
      if (!p.companyKey) problems.push('empty companyKey');
      if (!/^[0-9a-f]{20}$/.test(p.clusterKey)) problems.push('bad clusterKey');
      if (p.skills.length > 40) problems.push('too many skills');
      if (new Set(p.tags.map((t) => t.toLowerCase())).size !== p.tags.length) problems.push('duplicate tags');
      return problems;
    });
  });

  it('changes contentHash with visible fields only', () => {
    each(({ feed, raw: r, posting: p }) => {
      const problems: string[] = [];
      const later = new Date(nowFor(feed).getTime() + 2 * HOUR);
      if (normalizePosting(r, ctxFor(feed, later))?.contentHash !== p.contentHash) problems.push('hash depends on the clock');
      if (normalizePosting({ ...r, title: `${r.title} Zebra` }, ctxFor(feed))?.contentHash === p.contentHash) problems.push('hash ignores the title');
      const longer = { ...r, descriptionHtml: `${r.descriptionHtml ?? ''}<p>Zebra crossing.</p>` };
      if (normalizePosting(longer, ctxFor(feed))?.contentHash === p.contentHash) problems.push('hash ignores the description');
      return problems;
    });
  });
});
