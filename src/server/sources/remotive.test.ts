import { type Mock, describe, expect, it, vi } from 'vitest';
import { remotiveSource } from './remotive';
import { fakeHttp, readFixture, readJsonFixture, testContext } from './testing';
import { type RawPosting, type SourceContext, SourceError } from './types';
import type { FakeHttp, FakeRoute } from './testing';

type LogFn = (msg: string, data?: unknown) => void;

const FEED_URL = 'https://remotive.com/api/remote-jobs';
const LAST_MODIFIED = 'Mon, 23 Nov 2026 16:15:02 GMT';

interface Envelope {
  'job-count': number;
  'total-job-count': number;
  jobs: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

function fixture(): Envelope {
  return readJsonFixture<Envelope>('remotive', 'list.json');
}

/** The fixture was trimmed from 15 to 7 postings without updating the counters; make them agree. */
function consistent(envelope = fixture()): Envelope {
  return { ...envelope, 'job-count': envelope.jobs.length, 'total-job-count': envelope.jobs.length };
}

function feedRoute(body: unknown, extra: Partial<FakeRoute> = {}): FakeRoute {
  return { match: (url) => url === FEED_URL, body, headers: { 'last-modified': LAST_MODIFIED }, ...extra };
}

function ctxWith(http: FakeHttp, signal?: AbortSignal): SourceContext & { log: { debug: Mock<LogFn>; info: Mock<LogFn>; warn: Mock<LogFn> } } {
  return { ...testContext(http), signal, log: { debug: vi.fn<LogFn>(), info: vi.fn<LogFn>(), warn: vi.fn<LogFn>() } };
}

async function fetchFeed(http: FakeHttp, cursor?: { lastModified?: string }) {
  return remotiveSource.fetchFeed!(ctxWith(http), undefined, cursor);
}

function byId(postings: RawPosting[], id: string): RawPosting {
  const p = postings.find((x) => x.externalId === id);
  if (!p) throw new Error(`posting ${id} missing`);
  return p;
}

describe('remotive definition', () => {
  it('describes a keyless, complete-snapshot feed with the credit Remotive asks for', () => {
    const def = remotiveSource.def;
    expect(def).toMatchObject({
      id: 'remotive',
      name: 'Remotive',
      kind: 'board',
      mode: 'feed',
      homepage: 'https://remotive.com',
      perCompany: false,
      configFields: [],
      defaultEnabled: true,
      defaultTtlMinutes: 720,
      fullSnapshot: true,
    });
    expect(def.minRequestIntervalMs).toBeGreaterThanOrEqual(1000);
    expect(def.attribution).toMatch(/Remotive/);
    expect(def.description).toMatch(/15 postings/);
    expect(def.description).toMatch(/24 hours/);
    expect(remotiveSource.search).toBeUndefined();
    expect(remotiveSource.checkOpen).toBeUndefined();
  });
});

describe('remotive fetchFeed', () => {
  it('requests the bare endpoint once, without filters, retries or validators on a first sync', async () => {
    const http = fakeHttp([feedRoute(readFixture('remotive', 'list.json'))]);
    await fetchFeed(http);
    expect(http.requests).toHaveLength(1);
    const [req] = http.requests;
    expect(req?.method).toBe('GET');
    expect(req?.url).toBe(FEED_URL);
    expect(req?.options.query).toBeUndefined();
    expect(req?.options.lastModified).toBeUndefined();
    expect(req?.options.etag).toBeUndefined();
    expect(req?.options.retries).toBe(0);
    expect(req?.options.minIntervalMs).toBe(remotiveSource.def.minRequestIntervalMs);
    expect(req?.options.headers?.Authorization).toBeUndefined();
  });

  it('maps every field of a posting from the real fixture', async () => {
    const raw = fixture().jobs.find((j) => j.id === 2091173)!;
    const http = fakeHttp([feedRoute(readFixture('remotive', 'list.json'))]);
    const result = await fetchFeed(http);
    expect(result.postings).toHaveLength(7);
    expect(byId(result.postings, '2091173')).toEqual({
      externalId: '2091173',
      url: 'https://remotive.com/remote-jobs/marketing/content-creator-youtube-2091173',
      title: 'Content Creator - YouTube',
      company: 'Metics Media',
      companyLogo: 'https://remotive.com/job/2091173/logo',
      locations: ['USA', 'Canada'],
      remote: 'remote',
      descriptionHtml: raw.description,
      postedAt: '2026-11-13T17:29:57Z',
      salary: { text: '$85k - $155k' },
      employmentType: 'full_time',
      tags: [
        'Marketing',
        'ecommerce',
        'shopify',
        'video',
        'AI/ML',
        'research',
        'digital marketing',
        'youtube',
        'editing',
        'video editing',
      ],
    });
  });

  it('leaves the description HTML exactly as given, tracking pixel included (the sanitiser drops it)', async () => {
    const http = fakeHttp([feedRoute(readFixture('remotive', 'list.json'))]);
    const p = byId((await fetchFeed(http)).postings, '1185979');
    expect(p.descriptionHtml).toContain('style="font-variant-numeric');
    expect(p.descriptionHtml?.endsWith('<img src="https://remotive.com/job/track/1185979/blank.gif?source=public_api" alt=""/>')).toBe(
      true,
    );
  });

  it('handles the awkward postings: trailing spaces, missing logo key, empty salary, many regions', async () => {
    const http = fakeHttp([feedRoute(readFixture('remotive', 'list.json'))]);
    const { postings } = await fetchFeed(http);

    const coalition = byId(postings, '1680495');
    expect(coalition.company).toBe('Coalition Technologies');
    expect(coalition.locations).toEqual(['Worldwide']);
    expect(coalition.salary).toEqual({ text: '$35,3k- $52k' });

    // company_logo_url is absent; company_logo would serve a placeholder, so no logo at all.
    const shyftoff = byId(postings, '2091171');
    expect(shyftoff.companyLogo).toBeUndefined();
    expect(shyftoff.employmentType).toBe('contract');
    expect(shyftoff.salary).toEqual({ text: '$14 - $20/hour' });
    expect(shyftoff.locations).toEqual(['USA']);

    const lemon = byId(postings, '2091137');
    expect(lemon.salary).toBeUndefined();
    expect(lemon.locations).toEqual(['LATAM', 'Europe', 'USA', 'Canada', 'APAC']);
    expect(lemon.tags?.[0]).toBe('Data and Analytics');
    expect(lemon.tags).toContain('Typescript');
    expect(lemon.tags).toContain('angular');
    expect(lemon.tags).not.toContain('Typescript ');
    expect(lemon.tags).toHaveLength(50);

    const backend = byId(postings, '2091135');
    expect(backend.title).toBe('Senior Back-end Developerusa'); // source typo kept
    expect(backend.locations).toEqual(['Europe', 'USA', 'Canada', 'Australia', 'Singapore', 'Mexico', 'Saudi Arabia']);
    expect(backend.postedAt).toBe('2026-10-27T12:56:13Z');

    expect(byId(postings, '1749306').employmentType).toBe('freelance');
    for (const p of postings) {
      expect(p.remote).toBe('remote');
      expect(p.applyUrl).toBeUndefined(); // terms: link back to the Remotive page
      expect(p.url.startsWith('https://remotive.com/remote-jobs/')).toBe(true);
    }
  });

  it('returns the Last-Modified validator and is complete only when the counters agree', async () => {
    const real = await fetchFeed(fakeHttp([feedRoute(readFixture('remotive', 'list.json'))]));
    // The trimmed fixture still says job-count 15 for 7 postings.
    expect(real.complete).toBe(false);
    expect(real.cursor).toEqual({ lastModified: LAST_MODIFIED });

    const agreeing = await fetchFeed(fakeHttp([feedRoute(consistent())]));
    expect(agreeing.complete).toBe(true);
    expect(agreeing.notModified).toBeUndefined();
    expect(agreeing.cursor).toEqual({ lastModified: LAST_MODIFIED });

    const empty = await fetchFeed(fakeHttp([feedRoute({ ...fixture(), 'job-count': 0, 'total-job-count': 0, jobs: [] })]));
    expect(empty.postings).toEqual([]);
    expect(empty.complete).toBe(false);
  });

  it('omits the cursor when the response has no Last-Modified', async () => {
    const result = await fetchFeed(fakeHttp([feedRoute(consistent(), { headers: {} })]));
    expect(result.cursor).toBeUndefined();
    expect(result.complete).toBe(true);
  });

  it('sends If-Modified-Since and reports a 304 as not modified', async () => {
    const http = fakeHttp([feedRoute(undefined, { status: 304, headers: {} })]);
    const result = await fetchFeed(http, { lastModified: LAST_MODIFIED });
    expect(http.requests[0]?.options.lastModified).toBe(LAST_MODIFIED);
    expect(result).toEqual({ postings: [], complete: false, notModified: true, cursor: { lastModified: LAST_MODIFIED } });
  });

  it('skips malformed postings with a warning and de-duplicates by id', async () => {
    const envelope = consistent();
    const good = envelope.jobs[0]!;
    envelope.jobs = [
      good,
      { ...good }, // duplicate id
      null as unknown as Record<string, unknown>,
      'not a posting' as unknown as Record<string, unknown>,
      { ...good, id: 1, title: '  ' },
      { ...good, id: 2, company_name: undefined },
      { ...good, id: 3, url: 'javascript:alert(1)' },
      { ...good, id: 4, url: '/remote-jobs/relative-4' },
      { ...good, id: null },
      { ...good, id: 5, title: 'Fine', salary: '', candidate_required_location: '', tags: 'oops', category: null },
    ];
    envelope['job-count'] = envelope.jobs.length;
    envelope['total-job-count'] = envelope.jobs.length;
    const http = fakeHttp([feedRoute(envelope)]);
    const ctx = ctxWith(http);
    const result = await remotiveSource.fetchFeed!(ctx);
    expect(result.postings.map((p) => p.externalId)).toEqual(['2091173', '5']);
    expect(ctx.log.warn).toHaveBeenCalledTimes(7);
    expect(result.postings[1]).toMatchObject({ title: 'Fine', locations: [], tags: [] });
    expect(result.postings[1]?.salary).toBeUndefined();
    expect(result.complete).toBe(true);
  });

  it.each([
    ['a list', []],
    ['an object without jobs', { 'job-count': 0 }],
    ['jobs that is not a list', { jobs: { a: 1 } }],
    ['a JSON string', 'oops'],
  ])('throws a parse error for %s', async (_label, body) => {
    const http = fakeHttp([feedRoute(typeof body === 'string' ? JSON.stringify(body) : body)]);
    await expect(fetchFeed(http)).rejects.toMatchObject({ name: 'SourceError', kind: 'parse' });
  });

  it('never retries a rate limit or a refusal (Remotive blocks excessive requests)', async () => {
    const limited = fakeHttp([feedRoute(undefined, { status: 429 })]);
    await expect(fetchFeed(limited)).rejects.toMatchObject({ kind: 'rate-limited', status: 429 });
    expect(limited.requests).toHaveLength(1);

    const blocked = fakeHttp([feedRoute(undefined, { status: 403 })]);
    await expect(fetchFeed(blocked)).rejects.toMatchObject({ kind: 'blocked' });
    expect(blocked.requests).toHaveLength(1);

    const gone = fakeHttp([]);
    await expect(fetchFeed(gone)).rejects.toMatchObject({ kind: 'not-found' });
    expect(gone.requests).toHaveLength(1);
  });

  it('tries once more after a 5xx or a network failure, then gives up', async () => {
    let calls = 0;
    const flaky = fakeHttp([
      { match: () => ++calls === 1, error: new SourceError('http', 'HTTP 503', { status: 503 }) },
      feedRoute(consistent()),
    ]);
    const result = await fetchFeed(flaky);
    expect(flaky.requests).toHaveLength(2);
    expect(result.postings).toHaveLength(7);

    const down = fakeHttp([{ match: () => true, error: new SourceError('network', 'Could not reach remotive.com') }]);
    await expect(fetchFeed(down)).rejects.toMatchObject({ kind: 'network' });
    expect(down.requests).toHaveLength(2);
  });

  it('honours an aborted signal before sending anything', async () => {
    const http = fakeHttp([feedRoute(consistent())]);
    const controller = new AbortController();
    controller.abort();
    await expect(remotiveSource.fetchFeed!(ctxWith(http, controller.signal))).rejects.toMatchObject({ kind: 'aborted' });
    expect(http.requests).toHaveLength(0);
  });

  it('passes the signal to the HTTP client', async () => {
    const http = fakeHttp([feedRoute(consistent())]);
    const controller = new AbortController();
    await remotiveSource.fetchFeed!(ctxWith(http, controller.signal));
    expect(http.requests[0]?.options.signal).toBe(controller.signal);
  });
});
