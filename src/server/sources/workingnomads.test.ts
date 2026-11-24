import { describe, expect, it } from 'vitest';
import { workingnomadsSource } from './workingnomads';
import { fakeHttp, readFixture, readJsonFixture, testContext } from './testing';
import { type RawPosting, type SourceContext, SourceError } from './types';

const FEED = 'https://www.workingnomads.com/api/exposed_jobs/';

function serve(body: unknown, status = 200) {
  return fakeHttp([{ match: (url) => url === FEED, body, status }]);
}

function recordingContext(http: ReturnType<typeof fakeHttp>): SourceContext & { warnings: unknown[][] } {
  const warnings: unknown[][] = [];
  const ctx = testContext(http);
  return { ...ctx, log: { ...ctx.log, warn: (...args: unknown[]) => void warnings.push(args) }, warnings };
}

function byId(postings: RawPosting[], id: string): RawPosting {
  const posting = postings.find((p) => p.externalId === id);
  if (!posting) throw new Error(`posting ${id} missing`);
  return posting;
}

describe('workingnomads definition', () => {
  it('describes the official featured-jobs snapshot', () => {
    expect(workingnomadsSource.def).toMatchObject({
      id: 'workingnomads',
      name: 'Working Nomads',
      kind: 'board',
      mode: 'feed',
      homepage: 'https://www.workingnomads.com',
      perCompany: false,
      configFields: [],
      defaultEnabled: true,
      defaultTtlMinutes: 720,
      fullSnapshot: true,
      minRequestIntervalMs: 1000,
    });
    expect(workingnomadsSource.def.attribution).toMatch(/Working Nomads/);
    expect(workingnomadsSource.def.description).toMatch(/featured/);
    expect(workingnomadsSource.def.description).toMatch(/under 1%/);
  });
});

describe('workingnomads fetchFeed', () => {
  it('requests only the official endpoint (with its trailing slash) and returns a complete snapshot', async () => {
    const http = serve(readFixture('workingnomads', 'exposed_jobs.json'));
    const controller = new AbortController();
    const result = await workingnomadsSource.fetchFeed!({ ...testContext(http), signal: controller.signal });

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]).toMatchObject({ method: 'GET', url: FEED });
    expect(http.requests[0]!.options).toMatchObject({ minIntervalMs: 1000, signal: controller.signal });
    expect(http.requests[0]!.options.query).toBeUndefined();
    expect(result.complete).toBe(true);
    expect(result.cursor).toBeUndefined();
    expect(result.postings.map((p) => p.externalId)).toEqual([
      '2043539', '2043006', '2033949', '2027058', '2012619', '2007977', '2007538', '1978731',
    ]);
  });

  it('maps every field of a posting', async () => {
    const result = await workingnomadsSource.fetchFeed!(testContext(serve(readFixture('workingnomads', 'exposed_jobs.json'))));
    const { descriptionHtml, ...rest } = byId(result.postings, '2043539');
    expect(rest).toEqual({
      externalId: '2043539',
      url: 'https://www.workingnomads.com/job/go/2043539/',
      title: 'Looking For Online ESL Teachers - Remote- Joining Rewards of up to USD $100',
      company: 'Polly English',
      locations: ['North America'],
      remote: 'remote',
      postedAt: '2026-11-23T04:14:27-05:00',
      tags: ['Education', 'english', 'teaching'],
    });
    expect(descriptionHtml).toMatch(/^<p>Polly English is an online English teaching com/);
    expect(descriptionHtml).toMatch(/ourney with Polly English\.<\/p>$/);
    // No salary is invented from the "$100" in the title.
    expect(result.postings.every((p) => p.salary === undefined && p.applyUrl === undefined)).toBe(true);
  });

  it('passes awkward values through raw', async () => {
    const { postings } = await workingnomadsSource.fetchFeed!(
      testContext(serve(readFixture('workingnomads', 'exposed_jobs.json'))),
    );
    expect(byId(postings, '2043006')).toMatchObject({
      company: 'Sneed & Mitchell LLP',
      locations: ['Philippines'],
      tags: ['Administration', 'operations', 'communication', 'data entry', 'case management', 'phone'],
    });
    // "Global" is the API's default even for a Spain-only role; it is passed on as given.
    expect(byId(postings, '2033949').locations).toEqual(['Global']);
    expect(byId(postings, '2027058').locations).toEqual(['USA, Canada, Ireland and UK ONLY']);
    expect(byId(postings, '2012619').locations).toEqual(['United States only (ShyftOff-approved states)']);
    expect(byId(postings, '2007977')).toMatchObject({
      locations: ['Time zone: CET (+/- 3 hours)'],
      descriptionHtml: expect.stringMatching(/^<h3><strong>About us:<\/strong><\/h3>\n<p> <\/p>/),
    });
    expect(byId(postings, '2007538').locations).toEqual(['Anywhere in the world']);
    // An October posting keeps its own DST offset.
    expect(byId(postings, '1978731')).toMatchObject({
      postedAt: '2026-10-28T10:06:33-04:00',
      locations: ['Europe, USA, Canada, Australia, Singapore, Mexico'],
    });
  });

  it('skips malformed postings with a warning and de-duplicates by id', async () => {
    const jobs = readJsonFixture<Record<string, unknown>[]>('workingnomads', 'exposed_jobs.json');
    const good = jobs[0]!;
    const http = serve([
      good,
      { ...good, title: 'Repost with the same id' },
      null,
      { ...good, url: 'https://www.workingnomads.com/jobs/some-slug' }, // no /job/go/<id>/
      { ...good, url: 'ftp://www.workingnomads.com/job/go/1/' },
      { ...good, url: 'https://www.workingnomads.com/job/go/2/', title: '' },
      { ...good, url: 'https://www.workingnomads.com/job/go/3/', company_name: '   ' },
      { ...good, url: 'https://www.workingnomads.com/job/go/4', tags: ['not', 'a', 'string'], location: '', description: '' },
    ]);
    const ctx = recordingContext(http);
    const result = await workingnomadsSource.fetchFeed!(ctx);

    expect(result.postings.map((p) => p.externalId)).toEqual(['2043539', '4']);
    expect(result.postings[0]!.title).toBe(good.title);
    expect(result.postings[1]).toMatchObject({ locations: [], tags: ['Education'], descriptionHtml: undefined });
    expect(ctx.warnings).toHaveLength(5);
    expect(ctx.warnings.every((w) => w[0] === 'workingnomads: skipped a malformed posting')).toBe(true);
    expect(result.complete).toBe(true);
  });

  it('does not claim a complete snapshot for an empty list', async () => {
    const ctx = recordingContext(serve([]));
    const result = await workingnomadsSource.fetchFeed!(ctx);
    expect(result).toEqual({ postings: [], complete: false });
    expect(ctx.warnings).toHaveLength(1);
  });

  it.each([
    ['an object', { detail: 'Not found.' }],
    ['a number', '42'],
  ])('throws a parse error when the payload is %s', async (_label, body) => {
    await expect(workingnomadsSource.fetchFeed!(testContext(serve(body)))).rejects.toMatchObject({ kind: 'parse' });
  });

  it('throws a parse error on invalid JSON', async () => {
    const promise = workingnomadsSource.fetchFeed!(testContext(serve('{"truncated": ')));
    await expect(promise).rejects.toBeInstanceOf(SourceError);
    await expect(promise).rejects.toMatchObject({ kind: 'parse' });
  });

  it.each([
    [429, 'rate-limited'],
    [404, 'not-found'],
    [502, 'http'],
  ])('propagates HTTP %i as %s', async (status, kind) => {
    await expect(workingnomadsSource.fetchFeed!(testContext(serve('', status)))).rejects.toMatchObject({ kind, status });
  });

  it('does not make a request once the sync was cancelled', async () => {
    const http = serve(readFixture('workingnomads', 'exposed_jobs.json'));
    const controller = new AbortController();
    controller.abort();
    await expect(workingnomadsSource.fetchFeed!({ ...testContext(http), signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(http.requests).toHaveLength(0);
  });
});
