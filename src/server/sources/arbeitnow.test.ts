import { describe, expect, it, vi } from 'vitest';
import { arbeitnowSource } from './arbeitnow';
import { type FakeRoute, fakeHttp, readJsonFixture, testContext } from './testing';
import { type SourceContext, SourceError } from './types';

interface Envelope {
  data: Array<Record<string, unknown>>;
  links: Record<string, unknown>;
  meta: Record<string, unknown>;
}

const page1 = () => readJsonFixture<Envelope>('arbeitnow', 'list.json');
const page2 = () => readJsonFixture<Envelope>('arbeitnow', 'list-page2.json');
const lastPage = () => readJsonFixture<Envelope>('arbeitnow', 'list-page37-last.json');
const emptyPage = () => readJsonFixture<Envelope>('arbeitnow', 'empty-page38.json');

const LAST_MODIFIED = 'Wed, 25 Nov 2026 00:10:39 GMT';

function pageRoute(n: number, body: unknown, extra: Partial<FakeRoute> = {}): FakeRoute {
  return { match: (url) => new URL(url).searchParams.get('page') === String(n), body, ...extra };
}

function withWarnSpy(ctx: SourceContext) {
  const warn = vi.fn();
  ctx.log = { ...ctx.log, warn };
  return warn;
}

async function fetchFeed(routes: FakeRoute[], cursor?: { etag?: string; lastModified?: string }) {
  const http = fakeHttp(routes);
  const ctx = testContext(http);
  const warn = withWarnSpy(ctx);
  const result = await arbeitnowSource.fetchFeed!(ctx, undefined, cursor);
  return { http, result, warn };
}

/** Three real pages: 8 + 3 + 4 postings, the last one with links.next = null. */
const threePages = (): FakeRoute[] => [
  pageRoute(1, page1(), { headers: { 'last-modified': LAST_MODIFIED } }),
  pageRoute(2, page2()),
  pageRoute(3, lastPage()),
];

describe('arbeitnow definition', () => {
  it('describes the source truthfully', () => {
    const def = arbeitnowSource.def;
    expect(def).toMatchObject({
      id: 'arbeitnow',
      kind: 'board',
      mode: 'feed',
      perCompany: false,
      fullSnapshot: true,
      defaultEnabled: true,
      defaultTtlMinutes: 720,
      minRequestIntervalMs: 2000,
      configFields: [],
      homepage: 'https://www.arbeitnow.com',
    });
    expect(def.attribution).toMatch(/Arbeitnow \(arbeitnow\.com\)/);
    expect(def.description).toMatch(/Germany/);
    expect(arbeitnowSource.fetchFeed).toBeTypeOf('function');
  });
});

describe('arbeitnow fetchFeed', () => {
  it('maps every field of the real postings', async () => {
    const { result } = await fetchFeed(threePages());
    const byId = new Map(result.postings.map((p) => [p.externalId, p]));

    const first = byId.get('forward-deployed-engineer-certil-berlin-395999');
    expect(first).toEqual({
      externalId: 'forward-deployed-engineer-certil-berlin-395999',
      url: 'https://www.arbeitnow.com/jobs/companies/neurawork-gmbh-co-kg/forward-deployed-engineer-certil-berlin-395999',
      title: 'Forward Deployed Engineer (m/w/d)- Certil',
      company: 'Neurawork GmbH & Co. KG',
      locations: ['Berlin'],
      remote: 'remote',
      descriptionHtml: expect.stringMatching(/^<p><strong>Du baust LLM-Anwendungen/),
      postedAt: 1795532452,
      employmentType: 'Unbefristeter arbeitsvertrag, berufserfahren',
      tags: ['Remote', 'Software Development'],
    });
    // The description is passed through untouched, including Arbeitnow's own promo footer.
    expect(first?.descriptionHtml).toMatch(/English Speaking Jobs in Germany<\/a> on Arbeitnow<\/a>$/);

    // Awkward: empty location, no job types, remote:false (which says nothing either way).
    const awkward = byId.get('commercial-account-executive-uki-218237');
    expect(awkward).toMatchObject({ title: 'Commercial Account Executive UKI', company: 'Catonetworks', locations: [] });
    expect(awkward).not.toHaveProperty('remote');
    expect(awkward).not.toHaveProperty('employmentType');
    expect(awkward?.tags).toEqual(['Commercial Account Executive - EMEA']);

    // Raw location strings are not split or interpreted.
    expect(byId.get('sales-planning-strategy-paris-france-barcelona-spain-361693')?.locations).toEqual([
      'Paris, France; Barcelona, Spain',
    ]);
    const homeoffice = byId.get('remote-freelancer-group-fitness-instructor-cornavin-462282');
    expect(homeoffice).toMatchObject({ locations: ['Homeoffice'], remote: 'remote', employmentType: 'Experienced, freelance' });
    expect(byId.get('senior-managing-consultant-hybrid-299724')).not.toHaveProperty('tags');
  });

  it('walks every page until links.next is null and reports a complete snapshot', async () => {
    const { http, result } = await fetchFeed(threePages());
    expect(result.complete).toBe(true);
    expect(result.notModified).toBeUndefined();
    expect(result.postings).toHaveLength(8 + 3 + 4);
    expect(result.cursor).toEqual({ lastModified: LAST_MODIFIED });

    expect(http.requests.map((r) => r.url)).toEqual([
      'https://www.arbeitnow.com/api/job-board-api?page=1',
      'https://www.arbeitnow.com/api/job-board-api?page=2',
      'https://www.arbeitnow.com/api/job-board-api?page=3',
    ]);
    for (const req of http.requests) {
      expect(req.method).toBe('GET');
      expect(req.options.minIntervalMs).toBe(2000);
      expect(req.options.etag).toBeUndefined();
      expect(req.options.lastModified).toBeUndefined();
    }
  });

  it('treats an empty page as the end of the board', async () => {
    const { http, result } = await fetchFeed([pageRoute(1, page1()), pageRoute(2, emptyPage())]);
    expect(result.complete).toBe(true);
    expect(result.postings).toHaveLength(8);
    expect(http.requests).toHaveLength(2);
  });

  it('keeps walking when a page has no links block, until an empty page', async () => {
    const { links: _links, ...noLinks } = page1();
    const { http, result } = await fetchFeed([pageRoute(1, noLinks), pageRoute(2, emptyPage())]);
    expect(http.requests).toHaveLength(2);
    expect(result.complete).toBe(true);
  });

  it('stops at the 40-page cap without claiming completeness', async () => {
    let n = 0;
    const http = fakeHttp();
    // Every page: one fresh posting and a next link.
    http.getJson = async (url, opts = {}) => {
      http.requests.push({ method: 'GET', url: `${url}?page=${String(opts.query?.page)}`, options: opts });
      n++;
      const job = { ...page1().data[1], slug: `job-${n}` };
      return { status: 200, headers: {}, data: { data: [job], links: { next: `${url}?page=${n + 1}` } } as never, text: '', url };
    };
    const ctx = testContext(http);
    const warn = withWarnSpy(ctx);
    const result = await arbeitnowSource.fetchFeed!(ctx);
    expect(http.requests).toHaveLength(40);
    expect(result.postings).toHaveLength(40);
    expect(result.complete).toBe(false);
    expect(result.cursor).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/page cap/), expect.anything());
  });

  it('sends If-Modified-Since on page 1 only and handles 304', async () => {
    const { http, result } = await fetchFeed([pageRoute(1, undefined, { status: 304 })], { lastModified: LAST_MODIFIED });
    expect(result).toEqual({ postings: [], complete: false, notModified: true, cursor: { lastModified: LAST_MODIFIED } });
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.options.lastModified).toBe(LAST_MODIFIED);
  });

  it('passes the validators of page 1 on and none on later pages', async () => {
    const newer = 'Wed, 25 Nov 2026 01:10:00 GMT';
    const routes = threePages();
    routes[0] = pageRoute(1, page1(), { headers: { 'last-modified': newer } });
    const { http, result } = await fetchFeed(routes, { lastModified: LAST_MODIFIED });
    expect(http.requests.map((r) => r.options.lastModified)).toEqual([LAST_MODIFIED, undefined, undefined]);
    expect(result.cursor).toEqual({ lastModified: newer });
  });

  it('returns the pages read so far, incomplete and without validators, when a later page fails', async () => {
    const { result, warn } = await fetchFeed([
      pageRoute(1, page1(), { headers: { 'last-modified': LAST_MODIFIED } }),
      pageRoute(2, undefined, { status: 429 }),
    ]);
    expect(result.postings).toHaveLength(8);
    expect(result.complete).toBe(false);
    expect(result.cursor).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/page failed/), expect.objectContaining({ page: 2 }));
  });

  it('treats a wrong-shaped later page like a failed page', async () => {
    const { result } = await fetchFeed([pageRoute(1, page1()), pageRoute(2, { data: 'nope' })]);
    expect(result.postings).toHaveLength(8);
    expect(result.complete).toBe(false);
  });

  it('throws when page 1 fails', async () => {
    await expect(fetchFeed([pageRoute(1, undefined, { status: 429 })])).rejects.toMatchObject({ kind: 'rate-limited' });
    await expect(fetchFeed([])).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('rethrows cancellation from a later page', async () => {
    await expect(
      fetchFeed([pageRoute(1, page1()), pageRoute(2, undefined, { error: new SourceError('aborted', 'cancelled') })]),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('honours an already aborted signal', async () => {
    const http = fakeHttp(threePages());
    const ctx = testContext(http);
    const controller = new AbortController();
    controller.abort();
    ctx.signal = controller.signal;
    await expect(arbeitnowSource.fetchFeed!(ctx)).rejects.toMatchObject({ kind: 'aborted' });
    expect(http.requests).toHaveLength(0);
  });

  it('rejects a payload of the wrong shape with a parse error', async () => {
    await expect(fetchFeed([pageRoute(1, [page1().data])])).rejects.toMatchObject({ kind: 'parse' });
    await expect(fetchFeed([pageRoute(1, { ...page1(), data: { 0: 'x' } })])).rejects.toMatchObject({ kind: 'parse' });
    await expect(fetchFeed([pageRoute(1, 'not json')])).rejects.toMatchObject({ kind: 'parse' });
  });

  it('skips malformed postings, de-duplicates by slug and logs each skip', async () => {
    const good = page1().data;
    const base = good[1] ?? {};
    const body = {
      ...page1(),
      links: { next: null },
      data: [
        ...good,
        good[0], // duplicate slug
        null,
        { ...base, slug: '' },
        { ...base, slug: 'no-title', title: '  ' },
        { ...base, slug: 'no-company', company_name: null },
        { ...base, slug: 'bad-url', url: 'javascript:alert(1)' },
        { ...base, slug: 'relative-url', url: '/jobs/x' },
        { ...base, slug: 'minimal', job_types: 'x', tags: null, created_at: 'soon', location: 7, description: '' },
      ],
    };
    const { result, warn } = await fetchFeed([pageRoute(1, body)]);
    expect(result.postings.map((p) => p.externalId)).toEqual([...good.map((j) => j.slug), 'minimal']);
    expect(warn).toHaveBeenCalledTimes(6);
    expect(warn).toHaveBeenCalledWith('arbeitnow: skipped a malformed posting', expect.objectContaining({ slug: 'bad-url' }));
    const minimal = result.postings.at(-1);
    expect(minimal).toEqual({
      externalId: 'minimal',
      url: base.url,
      title: base.title,
      company: base.company_name,
      locations: ['7'],
    });
    expect(result.complete).toBe(true);
  });

  it('never reports an empty board as complete', async () => {
    const { result } = await fetchFeed([pageRoute(1, emptyPage())]);
    expect(result).toEqual({ postings: [], complete: false, cursor: undefined });
  });
});
