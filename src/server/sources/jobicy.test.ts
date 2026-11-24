import { type Mock, describe, expect, it, vi } from 'vitest';
import { jobicySource } from './jobicy';
import { fakeHttp, readFixture, readJsonFixture, testContext } from './testing';
import { type FeedCursor, type RawPosting, type SourceContext, SourceError } from './types';
import type { FakeHttp, FakeRoute } from './testing';

type LogFn = (msg: string, data?: unknown) => void;

const FEED = 'https://jobicy.com/api/jobs';
const STATUS = 'https://jobicy.com/api/jobs/status';
const LAST_MODIFIED = 'Tue, 24 Nov 2026 14:40:19 GMT';

interface Envelope {
  nextCursor: string | null;
  hasMore: boolean;
  jobs: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

const page1 = () => readJsonFixture<Envelope>('jobicy', 'list.json');
const page2 = () => readJsonFixture<Envelope>('jobicy', 'list-page2.json');
const lastPage = () => readJsonFixture<Envelope>('jobicy', 'empty-no-match.json');
const CURSOR_2 = page1().nextCursor!;
const CURSOR_3 = page2().nextCursor!;

/** Matches a feed request by its cursor parameter (null = the first page). */
function feedPage(cursor: string | null, body: unknown, extra: Partial<FakeRoute> = {}): FakeRoute {
  return {
    match: (url) => {
      const u = new URL(url);
      return u.origin + u.pathname === FEED && u.searchParams.get('cursor') === cursor;
    },
    body,
    ...extra,
  };
}

/** The real fixtures chained into a three-page walk: list.json -> list-page2.json -> an empty last page. */
function threePages(): FakeHttp {
  return fakeHttp([
    feedPage(null, readFixture('jobicy', 'list.json'), { headers: { 'last-modified': LAST_MODIFIED } }),
    feedPage(CURSOR_2, readFixture('jobicy', 'list-page2.json'), { headers: { 'last-modified': 'Tue, 24 Nov 2026 14:41:00 GMT' } }),
    feedPage(CURSOR_3, readFixture('jobicy', 'empty-no-match.json')),
  ]);
}

type SpyCtx = SourceContext & { log: { debug: Mock<LogFn>; info: Mock<LogFn>; warn: Mock<LogFn> } };

function ctxWith(http: FakeHttp, signal?: AbortSignal): SpyCtx {
  return { ...testContext(http), signal, log: { debug: vi.fn<LogFn>(), info: vi.fn<LogFn>(), warn: vi.fn<LogFn>() } };
}

function fetchFeed(http: FakeHttp, cursor?: FeedCursor) {
  return jobicySource.fetchFeed!(ctxWith(http), undefined, cursor);
}

function byId(postings: RawPosting[], id: string): RawPosting {
  const p = postings.find((x) => x.externalId === id);
  if (!p) throw new Error(`posting ${id} missing`);
  return p;
}

describe('jobicy definition', () => {
  it('describes a keyless rolling-window feed', () => {
    expect(jobicySource.def).toMatchObject({
      id: 'jobicy',
      name: 'Jobicy',
      kind: 'board',
      mode: 'feed',
      homepage: 'https://jobicy.com',
      perCompany: false,
      configFields: [],
      defaultEnabled: true,
      defaultTtlMinutes: 360,
      fullSnapshot: false,
    });
    expect(jobicySource.def.minRequestIntervalMs).toBeGreaterThanOrEqual(1100);
    expect(jobicySource.def.attribution).toMatch(/Jobicy/);
    expect(jobicySource.def.description).toMatch(/7 days/);
    expect(typeof jobicySource.checkOpen).toBe('function');
    expect(jobicySource.search).toBeUndefined();
  });
});

describe('jobicy fetchFeed', () => {
  it('walks the cursor chain with the exact documented requests and never claims completeness', async () => {
    const http = threePages();
    const result = await fetchFeed(http);

    expect(http.requests.map((r) => r.url)).toEqual([
      `${FEED}?count=100`,
      `${FEED}?count=100&cursor=${CURSOR_2}`,
      `${FEED}?count=100&cursor=${CURSOR_3}`,
    ]);
    for (const req of http.requests) {
      expect(req.method).toBe('GET');
      expect(req.options.minIntervalMs).toBeGreaterThanOrEqual(1100);
      expect(req.options.lastModified).toBeUndefined();
      expect(req.options.headers?.Authorization).toBeUndefined();
    }
    expect(result.postings).toHaveLength(13);
    expect(result.complete).toBe(false);
    expect(result.notModified).toBeUndefined();
    // Page 1's validator, not a later page's.
    expect(result.cursor).toEqual({ lastModified: LAST_MODIFIED });
  });

  it('maps every field of a posting from the real fixture', async () => {
    const raw = page1().jobs.find((j) => j.id === 164073)!;
    const { postings } = await fetchFeed(threePages());
    expect(byId(postings, '164073')).toEqual({
      externalId: '164073',
      url: 'https://jobicy.com/jobs/164073-software-tester-freelance-test-att-u-verse-cox',
      title: 'Software Tester (Freelance) | Test AT&T U-verse & Cox',
      company: 'Testlio',
      companyLogo: 'https://jobicy.com/data/server-nyc0409/galaxy/mercury/2025/06/11024036-221.png',
      locations: ['USA'],
      remote: 'remote',
      descriptionHtml: raw.jobDescription,
      postedAt: '2026-11-24T11:25:51+00:00',
      salary: { min: 18, max: 18, currency: 'USD', period: 'hour' },
      employmentType: 'Contract',
      tags: ['QA & Testing'],
    });
  });

  it('handles the awkward postings', async () => {
    const { postings } = await fetchFeed(threePages());

    // Salary without currency; two-space geo separator; a level that is passed on as given.
    const forma = byId(postings, '164068');
    expect(forma.salary).toEqual({ min: 120000, max: 150000, currency: undefined, period: 'year' });
    expect(forma.locations).toEqual(['Canada', 'USA']);
    expect(forma.seniority).toBe('Director');
    expect(forma.employmentType).toBe('Full-Time');

    const apaleo = byId(postings, '164053');
    expect(apaleo.title).toBe('Business Development Representative – DACH (f/m/d)');
    expect(apaleo.salary).toBeUndefined();

    expect(byId(postings, '164041').salary).toEqual({ min: 70000, max: 70000, currency: 'PLN', period: 'year' });
    expect(byId(postings, '151333').seniority).toBe('Entry-Level, Junior');
    expect(byId(postings, '151333').descriptionHtml?.startsWith('<p><b>MAIN PURPOSE OF THE ROLE</b></p>\r\n')).toBe(true);
    expect(byId(postings, '156758').salary).toEqual({ min: 400, max: 400, currency: 'USD', period: 'month' });
    expect(byId(postings, '156738').locations).toEqual(['APAC', 'EMEA', 'LATAM', 'Canada', 'USA']);

    const anywhere = byId(postings, '153916');
    expect(anywhere.locations).toEqual(['Anywhere']);
    expect(anywhere.seniority).toBeUndefined(); // "Any"

    // Page 2 postings.
    expect(byId(postings, '156715').locations).toEqual(['Türkiye']);
    expect(byId(postings, '143990').seniority).toBe('Midweight');
    expect(byId(postings, '163997').salary).toEqual({ min: 47000, max: 65000, currency: 'EUR', period: 'year' });
    expect(byId(postings, '163972').employmentType).toBe('Internship');
    expect(byId(postings, '153850').employmentType).toBe('Part-Time');

    for (const p of postings) {
      expect(p.applyUrl).toBeUndefined(); // terms: apply goes to the feed's url
      expect(p.url).toMatch(new RegExp(`^https://jobicy\\.com/jobs/${p.externalId}-`));
      expect(p.remote).toBe('remote');
    }
  });

  it('decodes the stray numeric entity in a company name but leaves bare ampersands alone', async () => {
    const http = fakeHttp([feedPage(null, readFixture('jobicy', 'list-industry-engineering-tag-manager.json'))]);
    const { postings } = await fetchFeed(http);
    expect(byId(postings, '153823').company).toBe('Zone & Co');
    expect(byId(postings, '156571').title).toBe('Engineering Manager- Ceph & Distributed Storage');
    // That fixture is a single page whose nextCursor is not chained to anything here.
    expect(http.requests).toHaveLength(2);
  });

  it('sends If-Modified-Since on page 1 only and returns the new validator', async () => {
    const http = threePages();
    const result = await fetchFeed(http, { lastModified: 'Tue, 24 Nov 2026 08:00:00 GMT' });
    expect(http.requests.map((r) => r.options.lastModified)).toEqual(['Tue, 24 Nov 2026 08:00:00 GMT', undefined, undefined]);
    expect(result.cursor).toEqual({ lastModified: LAST_MODIFIED });
  });

  it('reports a 304 on page 1 as not modified without walking further', async () => {
    const http = fakeHttp([feedPage(null, undefined, { status: 304, headers: { 'last-modified': LAST_MODIFIED } })]);
    const result = await fetchFeed(http, { lastModified: LAST_MODIFIED });
    expect(http.requests).toHaveLength(1);
    expect(result).toEqual({ postings: [], complete: false, notModified: true, cursor: { lastModified: LAST_MODIFIED } });

    const bare = fakeHttp([feedPage(null, undefined, { status: 304 })]);
    expect((await fetchFeed(bare, { lastModified: LAST_MODIFIED })).cursor).toEqual({ lastModified: LAST_MODIFIED });
  });

  it('keeps the pages read when a later page fails, without validators so the next sync walks again', async () => {
    const http = fakeHttp([
      feedPage(null, readFixture('jobicy', 'list.json'), { headers: { 'last-modified': LAST_MODIFIED } }),
      feedPage(CURSOR_2, undefined, { status: 429 }),
    ]);
    const ctx = ctxWith(http);
    const result = await jobicySource.fetchFeed!(ctx);
    expect(result.postings).toHaveLength(8);
    expect(result.complete).toBe(false);
    expect(result.cursor).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledOnce();

    // An expired cursor (400) mid-walk is handled the same way.
    const expired = fakeHttp([
      feedPage(null, readFixture('jobicy', 'list.json')),
      feedPage(CURSOR_2, readFixture('jobicy', 'error-invalid-geo-400.json'), { status: 400 }),
    ]);
    expect((await fetchFeed(expired)).postings).toHaveLength(8);
  });

  it('propagates failures of the first page', async () => {
    await expect(fetchFeed(fakeHttp([feedPage(null, undefined, { status: 429 })]))).rejects.toMatchObject({ kind: 'rate-limited' });
    await expect(fetchFeed(fakeHttp([]))).rejects.toMatchObject({ kind: 'not-found' });
    await expect(
      fetchFeed(fakeHttp([feedPage(null, readFixture('jobicy', 'error-invalid-geo-400.json'), { status: 400 })])),
    ).rejects.toMatchObject({ kind: 'http', status: 400 });
  });

  it('stops at the 40-page cap', async () => {
    let n = 0;
    const endless = fakeHttp([
      {
        match: (url) => url.startsWith(FEED),
        get body() {
          n += 1;
          return { ...page2(), jobs: [{ ...page2().jobs[0], id: n }], nextCursor: `c${n}`, hasMore: true };
        },
      },
    ]);
    const ctx = ctxWith(endless);
    const result = await jobicySource.fetchFeed!(ctx);
    expect(endless.requests).toHaveLength(40);
    expect(result.postings).toHaveLength(40);
    expect(result.complete).toBe(false);
    expect(ctx.log.warn).toHaveBeenCalledWith(expect.stringContaining('page cap'), expect.anything());
  });

  it('stops when the API hands back a cursor it already gave', async () => {
    const loop = fakeHttp([
      feedPage(null, readFixture('jobicy', 'list.json')),
      feedPage(CURSOR_2, { ...page2(), nextCursor: CURSOR_2 }),
    ]);
    const result = await fetchFeed(loop);
    expect(loop.requests).toHaveLength(2);
    expect(result.postings).toHaveLength(13);
  });

  it('de-duplicates postings repeated across pages', async () => {
    const dup = page1().jobs[0]!;
    const http = fakeHttp([
      feedPage(null, readFixture('jobicy', 'list.json')),
      feedPage(CURSOR_2, { ...page2(), jobs: [dup, ...page2().jobs], nextCursor: null, hasMore: false }),
    ]);
    const result = await fetchFeed(http);
    expect(result.postings).toHaveLength(13);
    expect(result.postings.filter((p) => p.externalId === '164073')).toHaveLength(1);
  });

  it('skips malformed postings with a warning', async () => {
    const good = page1().jobs[0]!;
    const body = {
      ...lastPage(),
      jobs: [
        null,
        42,
        { ...good, id: undefined },
        { ...good, id: 1, jobTitle: '' },
        { ...good, id: 2, companyName: '   ' },
        { ...good, id: 3, url: 'ftp://jobicy.com/jobs/3' },
        { ...good, id: 4, url: undefined },
        {
          ...good,
          id: 5,
          jobGeo: undefined,
          jobType: 'Full-Time',
          jobIndustry: undefined,
          jobLevel: undefined,
          companyLogo: '',
          jobDescription: '  ',
          salaryMin: 0,
          salaryMax: '',
          salaryPeriod: 'fortnightly',
        },
        { ...good, id: 6, salaryMin: 50000, salaryMax: undefined, salaryCurrency: 'usd', salaryPeriod: 'Weekly' },
      ],
    };
    const http = fakeHttp([feedPage(null, body)]);
    const ctx = ctxWith(http);
    const result = await jobicySource.fetchFeed!(ctx);
    expect(result.postings.map((p) => p.externalId)).toEqual(['5', '6']);
    expect(ctx.log.warn).toHaveBeenCalledTimes(7);
    expect(result.postings[0]).toMatchObject({ locations: [], employmentType: 'Full-Time', tags: [] });
    expect(result.postings[0]?.salary).toBeUndefined();
    expect(result.postings[0]?.companyLogo).toBeUndefined();
    expect(result.postings[0]?.descriptionHtml).toBeUndefined();
    expect(result.postings[0]?.seniority).toBeUndefined();
    expect(result.postings[1]?.salary).toEqual({ min: 50000, max: undefined, currency: 'USD', period: 'week' });
  });

  it('treats the documented empty response as the end of the window', async () => {
    const http = fakeHttp([feedPage(null, readFixture('jobicy', 'empty-no-match.json'))]);
    const result = await fetchFeed(http);
    expect(result).toMatchObject({ postings: [], complete: false });
    expect(http.requests).toHaveLength(1);
  });

  it.each([
    ['a list', []],
    ['an envelope without jobs', { success: true, nextCursor: null }],
    ['jobs that is not a list', { jobs: 'none' }],
    ['an error envelope served with 200', { success: false, error: "Invalid 'geo' value." }],
  ])('throws a parse error for %s', async (_label, body) => {
    await expect(fetchFeed(fakeHttp([feedPage(null, body)]))).rejects.toMatchObject({ name: 'SourceError', kind: 'parse' });
  });

  it('honours an aborted signal and passes the signal on', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const http = threePages();
    await expect(jobicySource.fetchFeed!(ctxWith(http, aborted.signal))).rejects.toMatchObject({ kind: 'aborted' });
    expect(http.requests).toHaveLength(0);

    const live = new AbortController();
    const http2 = threePages();
    await jobicySource.fetchFeed!(ctxWith(http2, live.signal));
    expect(http2.requests.every((r) => r.options.signal === live.signal)).toBe(true);
  });

  it('stops walking when the signal fires mid-walk', async () => {
    const controller = new AbortController();
    const http = fakeHttp([
      {
        match: (url) => !url.includes('cursor='),
        get body() {
          controller.abort();
          return readFixture('jobicy', 'list.json');
        },
      },
    ]);
    await expect(jobicySource.fetchFeed!(ctxWith(http, controller.signal))).rejects.toMatchObject({ kind: 'aborted' });
    expect(http.requests).toHaveLength(1);
  });
});

describe('jobicy checkOpen', () => {
  function statusRoute(body: unknown, extra: Partial<FakeRoute> = {}): FakeRoute {
    return { match: (url) => url.startsWith(`${STATUS}?ids=`), body, ...extra };
  }

  it('asks the status endpoint with literal commas and maps active/unknown from the real fixture', async () => {
    const http = fakeHttp([statusRoute(readFixture('jobicy', 'status.json'))]);
    const result = await jobicySource.checkOpen!(ctxWith(http), ['164073', '153857', '1', '999999999']);
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.url).toBe(`${STATUS}?ids=164073,153857,1,999999999`);
    expect(http.requests[0]?.options.minIntervalMs).toBeGreaterThanOrEqual(1100);
    // "unknown" is not proof of closure: those ids are left out.
    expect([...result.entries()]).toEqual([
      ['164073', true],
      ['153857', true],
    ]);
  });

  it('reports closed postings as false and ignores ids it did not ask about', async () => {
    const http = fakeHttp([
      statusRoute({
        success: true,
        jobs: [
          { id: 164073, status: 'closed' },
          { id: 153857, status: 'Active' },
          { id: 777, status: 'closed' },
          { status: 'closed' },
          'junk',
        ],
      }),
    ]);
    const result = await jobicySource.checkOpen!(ctxWith(http), ['164073', '153857']);
    expect(result).toEqual(
      new Map([
        ['164073', false],
        ['153857', true],
      ]),
    );
  });

  it('batches up to 100 ids per request, dropping duplicates and ids that are not Jobicy ids', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(100000 + i));
    const http = fakeHttp([statusRoute({ success: true, jobs: [] })]);
    const result = await jobicySource.checkOpen!(ctxWith(http), [...ids, '100000', 'abc', '', '0', '12a', ' 100001 ']);
    expect(result.size).toBe(0);
    expect(http.requests).toHaveLength(3);
    const batches = http.requests.map((r) => new URL(r.url).searchParams.get('ids')!.split(','));
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(ids);
  });

  it('sends nothing for an empty or unusable id list', async () => {
    const http = fakeHttp([]);
    expect((await jobicySource.checkOpen!(ctxWith(http), ['x', ''])).size).toBe(0);
    expect(http.requests).toHaveLength(0);
  });

  it('throws when the first batch fails and keeps earlier batches when a later one fails', async () => {
    const first = fakeHttp([statusRoute(undefined, { status: 429 })]);
    await expect(jobicySource.checkOpen!(ctxWith(first), ['164073'])).rejects.toMatchObject({ kind: 'rate-limited' });

    const ids = Array.from({ length: 150 }, (_, i) => String(200000 + i));
    let calls = 0;
    const later = fakeHttp([
      { match: () => ++calls === 2, error: new SourceError('rate-limited', 'HTTP 429', { status: 429 }) },
      statusRoute({ success: true, jobs: [{ id: 200000, status: 'active' }] }),
    ]);
    const ctx = ctxWith(later);
    const result = await jobicySource.checkOpen!(ctx, ids);
    expect(result).toEqual(new Map([['200000', true]]));
    expect(later.requests).toHaveLength(2);
    expect(ctx.log.warn).toHaveBeenCalledOnce();
  });

  it('throws a parse error for a status payload of the wrong shape', async () => {
    const http = fakeHttp([statusRoute({ success: true, jobs: { 164073: 'active' } })]);
    await expect(jobicySource.checkOpen!(ctxWith(http), ['164073'])).rejects.toMatchObject({ kind: 'parse' });
  });
});
