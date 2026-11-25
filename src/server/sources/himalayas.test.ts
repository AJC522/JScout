import { type Mock, describe, expect, it, vi } from 'vitest';
import { himalayasSource } from './himalayas';
import { fakeHttp, readFixture, readJsonFixture, testContext } from './testing';
import { type RawPosting, type SourceContext, SourceError, type UpstreamQuery } from './types';
import type { FakeHttp, FakeRoute } from './testing';

type LogFn = (msg: string, data?: unknown) => void;

const SEARCH = 'https://himalayas.app/jobs/api/search';
const KEY = 'hml_test_0123456789';
const NOW = new Date('2026-11-24T12:00:00Z');

interface Envelope {
  jobs: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

const searchFixture = () => readJsonFixture<Envelope>('himalayas', 'search-python.json');
const listFixture = () => readJsonFixture<Envelope>('himalayas', 'list.json');
const emptyPage = () => ({ ...searchFixture(), jobs: [] });

type SpyCtx = SourceContext & { log: { debug: Mock<LogFn>; info: Mock<LogFn>; warn: Mock<LogFn> } };

function ctxWith(http: FakeHttp, config: Record<string, string> = { apiKey: KEY }, opts: { signal?: AbortSignal; now?: Date } = {}): SpyCtx {
  return { ...testContext(http, config, opts.now ?? NOW), signal: opts.signal, log: { debug: vi.fn<LogFn>(), info: vi.fn<LogFn>(), warn: vi.fn<LogFn>() } };
}

function query(q: Partial<UpstreamQuery> = {}): UpstreamQuery {
  return { keywords: ['python'], limit: 100, ...q };
}

/** Matches a search request by phrase and page. */
function searchPage(q: string | null, page: number, body: unknown, extra: Partial<FakeRoute> = {}): FakeRoute {
  return {
    match: (url) => {
      const u = new URL(url);
      return u.origin + u.pathname === SEARCH && u.searchParams.get('q') === q && u.searchParams.get('page') === String(page);
    },
    body,
    ...extra,
  };
}

function byTitle(postings: RawPosting[], title: string): RawPosting {
  const p = postings.find((x) => x.title === title);
  if (!p) throw new Error(`posting "${title}" missing`);
  return p;
}

function job(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...searchFixture().jobs[2]!, ...overrides };
}

describe('himalayas definition', () => {
  it('is a search-only source that needs a free API key and is off by default', () => {
    const def = himalayasSource.def;
    expect(def).toMatchObject({
      id: 'himalayas',
      name: 'Himalayas',
      kind: 'board',
      mode: 'search',
      homepage: 'https://himalayas.app',
      perCompany: false,
      defaultEnabled: false,
      fullSnapshot: false,
    });
    expect(def.configFields).toHaveLength(1);
    expect(def.configFields[0]).toMatchObject({ key: 'apiKey', secret: true, required: true });
    expect(def.configFields[0]?.help).toContain('https://himalayas.app/signup/developer');
    expect(def.minRequestIntervalMs).toBeGreaterThanOrEqual(1000);
    expect(def.defaultTtlMinutes).toBeGreaterThanOrEqual(60);
    expect(def.attribution).toMatch(/Himalayas/);
    expect(def.description).toMatch(/API key/);
    expect(himalayasSource.fetchFeed).toBeUndefined();
    expect(typeof himalayasSource.search).toBe('function');
  });
});

describe('himalayas search', () => {
  it('refuses to run without a key, with a message that says where to get one', async () => {
    const http = fakeHttp([]);
    const err = await himalayasSource.search!(ctxWith(http, {}), query()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ kind: 'auth' });
    expect((err as Error).message).toContain('https://himalayas.app/signup/developer');
    await expect(himalayasSource.search!(ctxWith(http, { apiKey: '   ' }), query())).rejects.toMatchObject({ kind: 'auth' });
    await expect(himalayasSource.search!(ctxWith(http, { apiKey: 'hml_a b' }), query())).rejects.toMatchObject({ kind: 'auth' });
    expect(http.requests).toHaveLength(0);
  });

  it('sends the key only as a Bearer header and builds the documented search URL', async () => {
    const http = fakeHttp([searchPage('python developer', 1, readFixture('himalayas', 'search-python.json')), searchPage('python developer', 2, emptyPage())]);
    await himalayasSource.search!(ctxWith(http, { apiKey: `  Bearer ${KEY} ` }), query({ keywords: ['python developer'], country: 'us', remoteOnly: true }));
    expect(http.requests.map((r) => r.url)).toEqual([
      `${SEARCH}?q=python+developer&country=US&sort=relevant&page=1`,
      `${SEARCH}?q=python+developer&country=US&sort=relevant&page=2`,
    ]);
    for (const req of http.requests) {
      expect(req.method).toBe('GET');
      expect(req.options.headers).toEqual({ Authorization: `Bearer ${KEY}` });
      expect(req.url).not.toContain(KEY);
      expect(req.options.minIntervalMs).toBeGreaterThanOrEqual(1000);
    }
  });

  it('only sends a country that is an ISO alpha-2 code', async () => {
    const http = fakeHttp([searchPage('python', 1, emptyPage())]);
    await himalayasSource.search!(ctxWith(http), query({ country: 'Germany' }));
    expect(new URL(http.requests[0]!.url).searchParams.has('country')).toBe(false);
  });

  it('maps every field of a posting from the real fixture', async () => {
    const raw = searchFixture().jobs.find((j) => j.title === 'Data Analyst (Dashboard Developer)')!;
    const http = fakeHttp([searchPage('python', 1, readFixture('himalayas', 'search-python.json')), searchPage('python', 2, emptyPage())]);
    const postings = await himalayasSource.search!(ctxWith(http), query());
    expect(postings).toHaveLength(6);
    expect(byTitle(postings, 'Data Analyst (Dashboard Developer)')).toEqual({
      externalId: 'companies/guidehouse/jobs/data-analyst-dashboard-developer-8255820469',
      url: 'https://himalayas.app/companies/guidehouse/jobs/data-analyst-dashboard-developer-8255820469',
      applyUrl: 'https://himalayas.app/companies/guidehouse/jobs/data-analyst-dashboard-developer-8255820469?utm_source=api',
      title: 'Data Analyst (Dashboard Developer)',
      company: 'Guidehouse',
      companyLogo: 'https://cdn-images.himalayas.app/ks5m3qmjuhimg4pvxi9rfgdnavoh',
      locations: ['United States'],
      remote: 'remote',
      descriptionHtml: raw.description,
      postedAt: 1795527367,
      updatedAt: 1795527367,
      salary: { min: 68000, max: 113000, currency: 'USD', period: 'year', text: undefined },
      employmentType: 'Full Time',
      seniority: 'Entry-level',
      tags: ['Data Science', 'Data Analyst', 'Business Intelligence Analyst', 'Dashboard Developer', 'Analytics Consultant'],
    });
  });

  it('handles the awkward postings in the search fixture', async () => {
    const http = fakeHttp([searchPage('python', 1, readFixture('himalayas', 'search-python.json')), searchPage('python', 2, emptyPage())]);
    const postings = await himalayasSource.search!(ctxWith(http), query());

    // Pinned posting: 35 countries, truncated job slug.
    const lemon = byTitle(postings, 'Senior Back-end Developer');
    expect(lemon.externalId).toBe('companies/lemon-io/jobs/senior-back-end-develope');
    expect(lemon.locations).toHaveLength(35);
    expect(lemon.locations.slice(0, 3)).toEqual(['Australia', 'Austria', 'Belgium']);
    expect(lemon.salary).toBeUndefined(); // currency USD but no amounts
    expect(lemon.tags).toContain('Backend Developer (Java Spring AWS)');

    // No country restriction, but limited to one timezone: not stated as worldwide.
    const alien = byTitle(postings, 'Senior Software Engineer');
    expect(alien.locations).toEqual([]);
    expect(alien.seniority).toBe('Senior, Manager');
    expect(alien.salary).toEqual({ min: 2000, max: 3000, currency: 'USD', period: 'month', text: undefined });

    const vetta = byTitle(postings, 'Cientista de Dados Especialista');
    expect(vetta.companyLogo).toBeUndefined(); // empty string upstream
    expect(vetta.tags).toEqual(['Cientista De Dados', 'Fraud Detection Data Scientist', 'Analista De Dados', 'Machine Learning Specialist']);

    const next = byTitle(postings, 'Next Academy');
    expect(next.salary).toEqual({ min: 1000, max: 1000, currency: 'EUR', period: 'month', text: undefined });
    expect(next.employmentType).toBe('Intern');
    expect(next.locations).toEqual(['Spain']);
    expect(next.tags?.slice(0, 2)).toEqual(['Data Science', 'Developer']);
  });

  it('handles the awkward postings in the browse fixtures (same posting shape)', async () => {
    const list = listFixture();
    const page2 = readJsonFixture<Envelope>('himalayas', 'list-page2.json');
    const page3 = readJsonFixture<Envelope>('himalayas', 'list-page3.json');
    const http = fakeHttp([
      searchPage('python', 1, list),
      searchPage('python', 2, page2),
      searchPage('python', 3, page3),
    ]);
    const postings = await himalayasSource.search!(ctxWith(http), query());
    expect(postings).toHaveLength(18);

    const gpm = byTitle(postings, 'Staff Accountant 1');
    expect(gpm.employmentType).toBe('Other');
    expect(gpm.salary).toBeUndefined();
    expect(gpm.company).toBe('GPM Investments, LLC');

    expect(byTitle(postings, 'Team Lead Product Design (Service)').company).toBe('Company'); // placeholder kept
    expect(byTitle(postings, 'SAP HCM Solution Architect').locations).toEqual(['Czechia', 'Hungary', 'Poland', 'Slovakia']);
    expect(byTitle(postings, 'SAP HCM Solution Architect').tags?.[0]).toBe('SAP Solution Architect');

    const santo = byTitle(postings, 'Медицинский представитель-1');
    expect(santo.externalId).toBe('companies/santo/jobs/1');
    expect(santo.applyUrl).toBe('https://himalayas.app/companies/santo/jobs/1?utm_source=api');

    expect(byTitle(postings, 'Temp-Project Manager, Product Operations').salary).toEqual({
      min: 50,
      max: 50,
      currency: 'USD',
      period: 'hour',
      text: undefined,
    });
    expect(byTitle(postings, 'Accounts Payable Officer — Property Management').salary).toMatchObject({ currency: 'PHP', period: 'month' });
    expect(byTitle(postings, 'Clear and Legible Reporting Services HIRMAC Support').salary).toMatchObject({ min: 39.29, max: 39.29 });
    expect(byTitle(postings, 'Coder, Auditing').salary).toMatchObject({ min: 28000, max: 207844.08, period: 'year' });
    expect(byTitle(postings, 'Coder, Auditing').company).toBe('QHR');
    expect(byTitle(postings, 'Client Implementation Engineer').salary).toBeUndefined(); // PHP without amounts
    expect(byTitle(postings, 'Vice President, Total Rewards').seniority).toBe('Executive');
    // Title with a trailing space upstream.
    expect(postings.some((p) => p.title === 'Traveller Support Agent - Trilingual French, English and Spanish Speaker Brazil')).toBe(true);

    for (const p of postings) {
      expect(p.remote).toBe('remote');
      expect(p.url).toMatch(/^https:\/\/himalayas\.app\/companies\/[^/]+\/jobs\/[^/]+$/);
      expect(p.applyUrl).toBe(`${p.url}?utm_source=api`); // applicationLink, unchanged
      expect(`https://himalayas.app/${p.externalId}`).toBe(p.url);
      expect(p.descriptionHtml).toMatch(/<p>Originally posted on <a href="https:\/\/himalayas\.app">Himalayas<\/a><\/p>$/);
    }
    // Page 3 was the cap: no fourth request.
    expect(http.requests).toHaveLength(3);
  });

  it('states worldwide only when neither countries nor timezones are restricted', async () => {
    const allOffsets = Array.from({ length: 38 }, (_, i) => i - 12);
    const http = fakeHttp([
      searchPage('python', 1, {
        ...emptyPage(),
        jobs: [
          job({ guid: 'https://himalayas.app/companies/a/jobs/one', locationRestrictions: [], timezoneRestrictions: [] }),
          job({ guid: 'https://himalayas.app/companies/a/jobs/two', locationRestrictions: [], timezoneRestrictions: allOffsets }),
          job({ guid: 'https://himalayas.app/companies/a/jobs/three', locationRestrictions: [], timezoneRestrictions: [-5, -6] }),
        ],
      }),
      searchPage('python', 2, emptyPage()),
    ]);
    const postings = await himalayasSource.search!(ctxWith(http), query());
    expect(postings.map((p) => p.locations)).toEqual([['Worldwide'], ['Worldwide'], []]);
  });

  it('passes salary amounts as given and words a fortnightly period instead of converting it', async () => {
    const http = fakeHttp([
      searchPage('python', 1, {
        ...emptyPage(),
        jobs: [
          job({ guid: 'https://himalayas.app/companies/a/jobs/f', minSalary: 3000, maxSalary: 3500, salaryPeriod: 'fortnightly', currency: 'AUD' }),
          job({ guid: 'https://himalayas.app/companies/a/jobs/w', minSalary: 900, maxSalary: null, salaryPeriod: 'weekly', currency: 'gbp' }),
          job({ guid: 'https://himalayas.app/companies/a/jobs/x', minSalary: 10, maxSalary: 12, salaryPeriod: 'per-shift', currency: '$' }),
        ],
      }),
      searchPage('python', 2, emptyPage()),
    ]);
    const postings = await himalayasSource.search!(ctxWith(http), query());
    expect(postings.map((p) => p.salary)).toEqual([
      { min: 3000, max: 3500, currency: 'AUD', period: undefined, text: 'per fortnight' },
      { min: 900, max: undefined, currency: 'GBP', period: 'week', text: undefined },
      { min: 10, max: 12, currency: undefined, period: undefined, text: undefined },
    ]);
  });

  it('runs one query per keyword phrase (first three only), page 1 of each before page 2, at most 3 pages', async () => {
    const pageOf = (tag: string, page: number) => ({
      ...emptyPage(),
      jobs: [job({ guid: `https://himalayas.app/companies/${tag}/jobs/p${page}` })],
    });
    const http = fakeHttp([
      searchPage('alpha', 1, pageOf('alpha', 1)),
      searchPage('alpha', 2, pageOf('alpha', 2)),
      searchPage('alpha', 3, pageOf('alpha', 3)),
      searchPage('beta', 1, pageOf('beta', 1)),
      searchPage('beta', 2, emptyPage()),
      searchPage('gamma', 1, emptyPage()),
    ]);
    const postings = await himalayasSource.search!(ctxWith(http), query({ keywords: ['alpha', ' beta ', 'gamma', 'delta'], limit: 50 }));
    expect(http.requests.map((r) => `${new URL(r.url).searchParams.get('q')}:${new URL(r.url).searchParams.get('page')}`)).toEqual([
      'alpha:1',
      'beta:1',
      'gamma:1',
      'alpha:2',
      'beta:2',
      'alpha:3',
    ]);
    expect(postings.map((p) => p.externalId)).toEqual([
      'companies/alpha/jobs/p1',
      'companies/beta/jobs/p1',
      'companies/alpha/jobs/p2',
      'companies/alpha/jobs/p3',
    ]);
  });

  it('stops as soon as query.limit postings are collected and never returns more', async () => {
    const http = fakeHttp([searchPage('python', 1, readFixture('himalayas', 'search-python.json'))]);
    const postings = await himalayasSource.search!(ctxWith(http), query({ keywords: ['python', 'django'], limit: 4 }));
    expect(postings).toHaveLength(4);
    expect(http.requests).toHaveLength(1);

    const none = fakeHttp([]);
    expect(await himalayasSource.search!(ctxWith(none), query({ limit: 0 }))).toEqual([]);
    expect(none.requests).toHaveLength(0);
  });

  it('runs a single filter-only query when there are no keywords', async () => {
    const http = fakeHttp([searchPage(null, 1, emptyPage())]);
    await himalayasSource.search!(ctxWith(http), query({ keywords: ['  '], country: 'DE' }));
    expect(http.requests.map((r) => r.url)).toEqual([`${SEARCH}?country=DE&sort=relevant&page=1`]);
  });

  it('de-duplicates on guid across pages and phrases', async () => {
    const fixture = readFixture('himalayas', 'search-python.json');
    const http = fakeHttp([
      searchPage('python', 1, fixture),
      searchPage('python', 2, fixture), // results shifted: same postings again
      searchPage('python', 3, emptyPage()),
      searchPage('data', 1, fixture),
      searchPage('data', 2, emptyPage()),
    ]);
    const postings = await himalayasSource.search!(ctxWith(http), query({ keywords: ['python', 'data'] }));
    expect(postings).toHaveLength(6);
    expect(new Set(postings.map((p) => p.externalId)).size).toBe(6);
  });

  it('drops postings past their expiryDate (terms: remove expired jobs)', async () => {
    // Alien Intellect expires at 1795605430 (2026-11-25T11:17:10Z).
    const http = fakeHttp([searchPage('python', 1, readFixture('himalayas', 'search-python.json')), searchPage('python', 2, emptyPage())]);
    const later = new Date('2026-11-26T00:00:00Z');
    const postings = await himalayasSource.search!(ctxWith(http, { apiKey: KEY }, { now: later }), query());
    expect(postings).toHaveLength(5);
    expect(postings.some((p) => p.company === 'Alien Intellect')).toBe(false);
  });

  it('skips malformed postings with a warning', async () => {
    const http = fakeHttp([
      searchPage('python', 1, {
        ...emptyPage(),
        jobs: [
          null,
          job({ guid: undefined }),
          job({ guid: 'himalayas.app/companies/x/jobs/y' }),
          job({ guid: 'https://himalayas.app/companies/x/jobs/no-title', title: ' ' }),
          job({ guid: 'https://himalayas.app/companies/x/jobs/no-company', companyName: null }),
          job({
            guid: 'https://himalayas.app/companies/x/jobs/sparse',
            applicationLink: 'mailto:jobs@example.com',
            companyLogo: null,
            locationRestrictions: 'United States',
            timezoneRestrictions: null,
            categories: null,
            parentCategories: undefined,
            seniority: 'Senior',
            pubDate: 'yesterday',
            expiryDate: null,
            description: '',
          }),
        ],
      }),
      searchPage('python', 2, emptyPage()),
    ]);
    const ctx = ctxWith(http);
    const postings = await himalayasSource.search!(ctx, query());
    expect(postings.map((p) => p.externalId)).toEqual(['companies/x/jobs/sparse']);
    expect(ctx.log.warn).toHaveBeenCalledTimes(5);
    // A malformed locationRestrictions is not taken to mean "worldwide".
    expect(postings[0]).toMatchObject({ locations: [], tags: [], seniority: 'Senior' });
    expect(postings[0]?.applyUrl).toBeUndefined();
    expect(postings[0]?.companyLogo).toBeUndefined();
    expect(postings[0]?.postedAt).toBeUndefined();
    expect(postings[0]?.descriptionHtml).toBeUndefined();
  });

  it.each([
    ['a list', []],
    ['an object without jobs', { totalCount: 0 }],
    ['jobs that is not a list', { jobs: {} }],
    ['an error envelope served with 200', { ok: false, errors: 'Invalid country' }],
  ])('throws a parse error for %s', async (_label, body) => {
    const http = fakeHttp([searchPage('python', 1, body)]);
    await expect(himalayasSource.search!(ctxWith(http), query())).rejects.toMatchObject({ name: 'SourceError', kind: 'parse' });
  });

  it('propagates a rate limit on the first page without looping', async () => {
    const http = fakeHttp([searchPage('python', 1, readFixture('himalayas', 'error-rate-limited-429.json'), { status: 429 })]);
    await expect(himalayasSource.search!(ctxWith(http), query())).rejects.toMatchObject({ kind: 'rate-limited', status: 429 });
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.options.retries).toBeLessThanOrEqual(1);
  });

  it('explains a rejected key', async () => {
    const http = fakeHttp([searchPage('python', 1, { ok: false, errors: 'Invalid API key' }, { status: 401 })]);
    const err = await himalayasSource.search!(ctxWith(http), query()).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'auth', status: 401 });
    expect((err as Error).message).toMatch(/rejected the API key/);
  });

  it('keeps the results read so far when a later page fails, but not after an auth failure', async () => {
    const http = fakeHttp([
      searchPage('python', 1, readFixture('himalayas', 'search-python.json')),
      searchPage('python', 2, undefined, { status: 503 }),
    ]);
    const ctx = ctxWith(http);
    expect(await himalayasSource.search!(ctx, query())).toHaveLength(6);
    expect(ctx.log.warn).toHaveBeenCalledOnce();

    const auth = fakeHttp([
      searchPage('python', 1, readFixture('himalayas', 'search-python.json')),
      searchPage('python', 2, undefined, { status: 401 }),
    ]);
    await expect(himalayasSource.search!(ctxWith(auth), query())).rejects.toMatchObject({ kind: 'auth' });
  });

  it('honours an aborted signal and passes the signal on', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const http = fakeHttp([searchPage('python', 1, emptyPage())]);
    await expect(himalayasSource.search!(ctxWith(http, { apiKey: KEY }, { signal: aborted.signal }), query())).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(http.requests).toHaveLength(0);

    const live = new AbortController();
    await himalayasSource.search!(ctxWith(http, { apiKey: KEY }, { signal: live.signal }), query());
    expect(http.requests[0]?.options.signal).toBe(live.signal);
  });
});

describe('himalayas checkOpen', () => {
  const JOB_API = 'https://himalayas.app/jobs/api/';

  it('asks the single-posting endpoint: 200 open, 410 closed, 404 left out', async () => {
    const http = fakeHttp([
      { match: (url) => url === `${JOB_API}companies/a/jobs/open`, body: { job: searchFixture().jobs[2] } },
      { match: (url) => url === `${JOB_API}companies/a/jobs/closed`, status: 410, body: { ok: false, errors: 'This job has expired.', expired: true } },
      { match: (url) => url === `${JOB_API}companies/a/jobs/missing`, status: 404, body: { ok: false, errors: 'Job not found.' } },
    ]);
    const result = await himalayasSource.checkOpen!(ctxWith(http), [
      'companies/a/jobs/open',
      'companies/a/jobs/closed',
      'companies/a/jobs/missing',
      'not-a-listing-path',
      'companies/a/jobs/open',
    ]);
    expect(result).toEqual(
      new Map([
        ['companies/a/jobs/open', true],
        ['companies/a/jobs/closed', false],
      ]),
    );
    expect(http.requests).toHaveLength(3);
    for (const req of http.requests) {
      expect(req.options.headers).toEqual({ Authorization: `Bearer ${KEY}` });
      expect(req.options.allowStatus).toEqual(expect.arrayContaining([404, 410]));
    }
  });

  it('checks at most 20 postings per call and needs the key', async () => {
    const http = fakeHttp([{ match: (url) => url.startsWith(JOB_API), body: { job: {} } }]);
    const ids = Array.from({ length: 30 }, (_, i) => `companies/c/jobs/j${i}`);
    expect((await himalayasSource.checkOpen!(ctxWith(http), ids)).size).toBe(20);
    expect(http.requests).toHaveLength(20);
    await expect(himalayasSource.checkOpen!(ctxWith(http, {}), ids)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('throws when the first check fails and keeps earlier answers when a later one fails', async () => {
    const limited = fakeHttp([{ match: () => true, status: 429 }]);
    await expect(himalayasSource.checkOpen!(ctxWith(limited), ['companies/a/jobs/x'])).rejects.toMatchObject({ kind: 'rate-limited' });

    let calls = 0;
    const later = fakeHttp([
      { match: () => ++calls === 2, error: new SourceError('rate-limited', 'HTTP 429', { status: 429 }) },
      { match: () => true, body: { job: {} } },
    ]);
    const result = await himalayasSource.checkOpen!(ctxWith(later), ['companies/a/jobs/x', 'companies/a/jobs/y', 'companies/a/jobs/z']);
    expect(result).toEqual(new Map([['companies/a/jobs/x', true]]));
    expect(later.requests).toHaveLength(2);
  });
});
