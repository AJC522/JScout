import { describe, expect, it } from 'vitest';
import { greenhouseSource } from './greenhouse';
import { fakeHttp, readFixture, readJsonFixture, testContext } from './testing';
import { type BoardRef, type RawPosting, SourceError } from './types';

const API = 'https://boards-api.greenhouse.io/v1/boards';
const FEED_QUERY = '?content=true&pay_transparency=true';

interface Envelope {
  jobs: Array<Record<string, unknown>>;
  meta: { total: number };
}

/** The trimmed fixtures keep the live meta.total (e.g. 52) next to 6-8 jobs; make them self-consistent. */
function consistent(name: string): Envelope {
  const env = readJsonFixture<Envelope>('greenhouse', name);
  return { ...env, meta: { total: env.jobs.length } };
}

function board(token: string, name = `${token} (board name)`): BoardRef {
  return { ats: 'greenhouse', token, name };
}

function byId(postings: RawPosting[], id: string): RawPosting {
  const p = postings.find((x) => x.externalId === id);
  if (!p) throw new Error(`posting ${id} not found`);
  return p;
}

function captureWarnings(ctx: ReturnType<typeof testContext>): unknown[][] {
  const warnings: unknown[][] = [];
  ctx.log.warn = (msg, data) => {
    warnings.push([msg, data]);
  };
  return warnings;
}

describe('greenhouseSource.def', () => {
  it('describes a per-company, full-snapshot feed', () => {
    expect(greenhouseSource.def).toMatchObject({
      id: 'greenhouse',
      kind: 'ats',
      mode: 'feed',
      perCompany: true,
      ats: 'greenhouse',
      fullSnapshot: true,
      defaultEnabled: true,
      defaultTtlMinutes: 360,
      minRequestIntervalMs: 1000,
      configFields: [],
    });
    expect(greenhouseSource.def.description.length).toBeGreaterThan(40);
    expect(greenhouseSource.def.attribution).toMatch(/Greenhouse/);
  });
});

describe('greenhouseSource.fetchFeed', () => {
  it('requests the board once with content and pay ranges, and maps every field (duolingo)', async () => {
    const http = fakeHttp([
      { match: `${API}/duolingo/jobs`, body: consistent('jobs-content-pay-duolingo.json'), headers: { etag: 'W/"duo-1"' } },
    ]);
    const result = await greenhouseSource.fetchFeed!(testContext(http), board('duolingo', 'Duolingo'));

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]!.url).toBe(`${API}/duolingo/jobs${FEED_QUERY}`);
    expect(http.requests[0]!.options).toMatchObject({ minIntervalMs: 1000, etag: undefined });
    expect(result.complete).toBe(true);
    expect(result.notModified).toBeUndefined();
    expect(result.cursor).toEqual({ etag: 'W/"duo-1"' });
    expect(result.postings).toHaveLength(7);

    const raw = readJsonFixture<Envelope>('greenhouse', 'jobs-content-pay-duolingo.json').jobs[0]!;
    const phd = byId(result.postings, '8881612002');
    expect(phd).toEqual({
      externalId: '8881612002',
      url: 'https://careers.duolingo.com/jobs/8881612002?gh_jid=8881612002',
      title: 'AI Research Engineer, New PhD Graduate', // trailing space trimmed
      company: 'Duolingo',
      locations: ['New York, NY', 'Pittsburgh, PA'],
      descriptionHtml: raw.content,
      postedAt: '2026-10-12T12:00:11-04:00',
      updatedAt: '2026-11-03T13:15:33-05:00',
      salary: { min: 137700, max: 186300, currency: 'USD', text: 'Salary Range:' },
      department: 'University',
    });
    expect(phd.remote).toBeUndefined();
    expect(phd.applyUrl).toBeUndefined();
  });

  it('converts minor units per currency (JPY has none) and reads the period from the range title', async () => {
    const http = fakeHttp([{ match: `${API}/duolingo/jobs`, body: consistent('jobs-content-pay-duolingo.json') }]);
    const { postings } = await greenhouseSource.fetchFeed!(testContext(http), board('duolingo'));

    expect(byId(postings, '8883563002').salary).toEqual({ min: 11969600, max: 17954400, currency: 'INR', text: 'Salary Range:' });
    expect(byId(postings, '8625579002').salary).toEqual({ min: 17178000, max: 25767100, currency: 'JPY', text: 'Salary Range:' });
    expect(byId(postings, '8858333002').salary).toMatchObject({ min: 90630, max: 122617, currency: 'GBP' });
    expect(byId(postings, '8933285002').salary).toMatchObject({ min: 681212, max: 921640, currency: 'CNY' });

    const intern = byId(postings, '8933791002');
    expect(intern.salary).toEqual({ min: 43, max: 45, currency: 'USD', period: 'hour', text: 'Hourly Range for this internship is:' });
    expect(intern.expiresAt).toBe('2026-12-12T00:00:00-05:00');
  });

  it('uses the post location, not the office tree, when the location names a place', async () => {
    const http = fakeHttp([{ match: `${API}/duolingo/jobs`, body: consistent('jobs-content-pay-duolingo.json') }]);
    const { postings } = await greenhouseSource.fetchFeed!(testContext(http), board('duolingo'));
    // offices: New York + Pittsburgh
    expect(byId(postings, '8858333002').locations).toEqual(['London, England']);
    // office: "Remote"
    expect(byId(postings, '8625579002').locations).toEqual(['Tokyo, Japan']);
  });

  it('passes the entity-escaped content through unchanged (discord)', async () => {
    const http = fakeHttp([{ match: `${API}/discord/jobs`, body: consistent('jobs-content-pay-discord.json') }]);
    const { postings } = await greenhouseSource.fetchFeed!(testContext(http), board('discord', 'Discord'));
    const raw = readJsonFixture<Envelope>('greenhouse', 'jobs-content-pay-discord.json').jobs;

    for (const job of raw) {
      const p = byId(postings, String(job.id));
      expect(p.descriptionHtml).toBe(job.content);
      expect(p.descriptionHtml).toMatch(/^&lt;/);
      expect(p.descriptionHtml).not.toContain('<');
    }
    const ae = byId(postings, '8945798002');
    expect(ae.title).toBe('Account Executive, Media & Entertainment');
    expect(ae.locations).toEqual(['Los Angeles Metropolitan Area or New York City Metropolitan Area']);
    expect(ae.salary).toEqual({ min: 272000, max: 306000, currency: 'USD', text: 'On Target Earnings' });
    expect(ae.company).toBe('Discord');

    expect(byId(postings, '8933480002').salary).toBeUndefined(); // pay_input_ranges: []
    expect(byId(postings, '8652914002').locations).toEqual(['Remote (U.S.)']); // 4 offices ignored
    expect(byId(postings, '8769799002').title).toBe('Senior Platform Security Engineer');
  });

  it('handles N/A locations, mixed separators and 7-digit ids (stripe)', async () => {
    const http = fakeHttp([{ match: `${API}/stripe/jobs`, body: consistent('jobs-content-stripe.json') }]);
    const { postings } = await greenhouseSource.fetchFeed!(testContext(http), board('stripe', 'Stripe'));
    expect(postings).toHaveLength(8);
    expect(byId(postings, '5601879').locations).toEqual(['US']); // "N/A" -> office
    expect(byId(postings, '8190048').locations).toEqual(['US-Remote']);
    expect(byId(postings, '7576967').locations).toEqual(['San Francisco, CA', 'Chicago, IL & New York, NY']);
    expect(byId(postings, '8181024').locations).toEqual(['Chicago, Seattle, NYC, San Francisco, Remote']);
    expect(byId(postings, '8181024').title).toBe('Account Executive Product - Fraud & Risk');
    expect(byId(postings, '8356916').department).toBe('8611 Security Analytics');
    // Two posts of one requisition stay separate postings.
    expect(byId(postings, '8356912').locations).toEqual(['Bucharest']);
    for (const p of postings) {
      expect(p.remote).toBeUndefined(); // metadata: null
      expect(p.salary).toBeUndefined(); // no pay_transparency ranges in this capture
    }
  });

  it('adds office names only when the location is a bare "Remote" (gitlab)', async () => {
    const http = fakeHttp([{ match: `${API}/gitlab/jobs`, body: consistent('jobs-content-gitlab.json') }]);
    const { postings } = await greenhouseSource.fetchFeed!(testContext(http), board('gitlab', 'GitLab'));
    expect(byId(postings, '8950909002').locations).toEqual(['Remote', 'Japan']);
    expect(byId(postings, '8636648002').title).toBe('Engineering Manager, Dedicated Integrations');
    expect(byId(postings, '8636648002').locations).toEqual(['Remote, United Kingdom']); // offices: []
    expect(byId(postings, '8922862002').locations).toEqual(['Remote, Canada', 'Remote, United States']);
    expect(byId(postings, '8926653002').locations).toEqual([
      'Remote Ireland',
      'Remote, France',
      'Remote, Germany',
      'Remote, Italy',
      'Remote, Spain',
      'Remote, United Kingdom',
    ]);
  });

  it('reads remote status only from the "Workplace Type" metadata field (airbnb, no content)', async () => {
    const http = fakeHttp([{ match: `${API}/airbnb/jobs`, body: consistent('jobs-no-content-airbnb.json') }]);
    const { postings } = await greenhouseSource.fetchFeed!(testContext(http), board('airbnb', 'Airbnb'));
    expect(byId(postings, '8365363').remote).toBe('hybrid');
    expect(byId(postings, '8396777').remote).toBe('remote');
    expect(byId(postings, '8336893').remote).toBe('onsite');
    expect(byId(postings, '8355483').locations).toEqual(['United States']);
    expect(byId(postings, '8365363').descriptionHtml).toBeUndefined();
    expect(byId(postings, '8365363').department).toBeUndefined();
  });

  it('uses the board name as the company for every posting, never company_name', async () => {
    const http = fakeHttp([{ match: `${API}/stripe/jobs`, body: consistent('jobs-content-stripe.json') }]);
    const { postings } = await greenhouseSource.fetchFeed!(testContext(http), board('stripe', 'Stripe Payments'));
    expect(new Set(postings.map((p) => p.company))).toEqual(new Set(['Stripe Payments']));
  });

  it('does not vouch for completeness when meta.total disagrees with the jobs received', async () => {
    // The fixture as captured: meta.total is the live 52, jobs holds 7.
    const http = fakeHttp([{ match: `${API}/duolingo/jobs`, body: readFixture('greenhouse', 'jobs-content-pay-duolingo.json') }]);
    const ctx = testContext(http);
    const warnings = captureWarnings(ctx);
    const result = await greenhouseSource.fetchFeed!(ctx, board('duolingo'));
    expect(result.postings).toHaveLength(7);
    expect(result.complete).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('treats an empty board as a complete, empty snapshot', async () => {
    const http = fakeHttp([{ match: `${API}/quiet/jobs`, body: { jobs: [], meta: { total: 0 } } }]);
    const result = await greenhouseSource.fetchFeed!(testContext(http), board('quiet'));
    expect(result).toMatchObject({ postings: [], complete: true });
  });

  it('skips malformed postings with a warning and de-duplicates by id', async () => {
    const env = consistent('jobs-content-pay-discord.json');
    const first = env.jobs[0]!;
    const jobs = [
      ...env.jobs,
      null,
      'nonsense',
      { ...first, id: undefined },
      { ...first, id: 1, title: '   ' },
      { ...first, id: 2, absolute_url: 'javascript:alert(1)' },
      { ...first, id: 3, absolute_url: undefined },
      { ...first, title: 'Duplicate of the first' },
    ];
    const http = fakeHttp([{ match: `${API}/discord/jobs`, body: { jobs, meta: { total: jobs.length } } }]);
    const ctx = testContext(http);
    const warnings = captureWarnings(ctx);
    const result = await greenhouseSource.fetchFeed!(ctx, board('discord'));
    expect(result.postings).toHaveLength(env.jobs.length);
    expect(byId(result.postings, String(first.id)).title).toBe('Account Executive, Media & Entertainment');
    expect(warnings).toHaveLength(6);
    expect(result.complete).toBe(true);
  });

  it.each([
    ['a list', []],
    ['jobs not a list', { jobs: { a: 1 }, meta: { total: 1 } }],
    ['missing jobs', { name: 'Stripe' }],
    ['invalid JSON', '{"jobs": ['],
    ['no entry is a posting', { jobs: [{ title: 'x' }, null], meta: { total: 2 } }],
  ])('throws a parse error for a payload of the wrong shape (%s)', async (_label, body) => {
    const http = fakeHttp([{ match: `${API}/stripe/jobs`, body }]);
    await expect(greenhouseSource.fetchFeed!(testContext(http), board('stripe'))).rejects.toMatchObject({ kind: 'parse' });
  });

  it('sends the stored ETag and reports 304 as not modified', async () => {
    const http = fakeHttp([{ match: `${API}/stripe/jobs`, status: 304, headers: { etag: 'W/"937868511d64faba9a3f1ab730f3434f"' } }]);
    const cursor = { etag: 'W/"937868511d64faba9a3f1ab730f3434f"' };
    const result = await greenhouseSource.fetchFeed!(testContext(http), board('stripe'), cursor);
    expect(http.requests[0]!.options.etag).toBe(cursor.etag);
    expect(http.requests[0]!.options.lastModified).toBeUndefined();
    expect(result).toEqual({ postings: [], complete: false, notModified: true, cursor });
  });

  it('keeps the previous ETag when a 304 carries none', async () => {
    const http = fakeHttp([{ match: `${API}/stripe/jobs`, status: 304 }]);
    const result = await greenhouseSource.fetchFeed!(testContext(http), board('stripe'), { etag: 'W/"old"' });
    expect(result.cursor).toEqual({ etag: 'W/"old"' });
  });

  it('propagates not-found for an unknown board and rate limiting', async () => {
    const http = fakeHttp([
      { match: `${API}/zzqqnonexistentboard9731/jobs`, status: 404, body: readFixture('greenhouse', 'error-unknown-board-jobs-404.json') },
      { match: `${API}/busy/jobs`, error: new SourceError('rate-limited', 'HTTP 429', { status: 429, retryAfter: 30 }) },
    ]);
    const ctx = testContext(http);
    await expect(greenhouseSource.fetchFeed!(ctx, board('zzqqnonexistentboard9731'))).rejects.toMatchObject({ kind: 'not-found', status: 404 });
    await expect(greenhouseSource.fetchFeed!(ctx, board('busy'))).rejects.toMatchObject({ kind: 'rate-limited', retryAfter: 30 });
  });

  it('encodes the token, needs a board, and honours an aborted signal', async () => {
    const http = fakeHttp([{ match: () => true, body: { jobs: [], meta: { total: 0 } } }]);
    await greenhouseSource.fetchFeed!(testContext(http), board(' odd/token '));
    expect(http.requests[0]!.url).toBe(`${API}/odd%2Ftoken/jobs${FEED_QUERY}`);

    await expect(greenhouseSource.fetchFeed!(testContext(http))).rejects.toBeInstanceOf(SourceError);

    const controller = new AbortController();
    controller.abort();
    const ctx = { ...testContext(http), signal: controller.signal };
    await expect(greenhouseSource.fetchFeed!(ctx, board('stripe'))).rejects.toMatchObject({ kind: 'aborted' });
    expect(http.requests).toHaveLength(1);
  });

  it('passes the signal to the HTTP client', async () => {
    const http = fakeHttp([{ match: () => true, body: { jobs: [], meta: { total: 0 } } }]);
    const controller = new AbortController();
    await greenhouseSource.fetchFeed!({ ...testContext(http), signal: controller.signal }, board('stripe'));
    expect(http.requests[0]!.options.signal).toBe(controller.signal);
  });
});

describe('greenhouseSource.fetchDetail', () => {
  it('fetches one post with its pay range and returns the description fields', async () => {
    const http = fakeHttp([{ match: `${API}/duolingo/jobs/8883563002`, body: readFixture('greenhouse', 'detail-pay-duolingo-8883563002.json') }]);
    const raw = readJsonFixture<Record<string, unknown>>('greenhouse', 'detail-pay-duolingo-8883563002.json');
    const detail = await greenhouseSource.fetchDetail!(
      testContext(http),
      { externalId: '8883563002', url: 'https://careers.duolingo.com/jobs/8883563002?gh_jid=8883563002' },
      board('duolingo'),
    );
    expect(http.requests[0]!.url).toBe(`${API}/duolingo/jobs/8883563002?pay_transparency=true`);
    expect(http.requests[0]!.options.allowStatus).toEqual([404]);
    expect(detail).toEqual({
      descriptionHtml: raw.content,
      salary: { min: 11969600, max: 17954400, currency: 'INR', text: 'Salary Range:' },
    });
  });

  it('returns only the description when the post has no pay data (stripe)', async () => {
    const http = fakeHttp([{ match: `${API}/stripe/jobs/8172510`, body: readFixture('greenhouse', 'detail-stripe-8172510.json') }]);
    const detail = await greenhouseSource.fetchDetail!(testContext(http), { externalId: '8172510', url: 'https://stripe.com/jobs/search?gh_jid=8172510' }, board('stripe'));
    expect(Object.keys(detail ?? {})).toEqual(['descriptionHtml']);
    expect(detail?.descriptionHtml).toMatch(/^&lt;h2&gt;&lt;strong&gt;Who we are/);
  });

  it('returns null when the post is gone (404)', async () => {
    const http = fakeHttp([{ match: `${API}/discord/jobs/1`, status: 404, body: readFixture('greenhouse', 'error-unknown-job-404.json') }]);
    const detail = await greenhouseSource.fetchDetail!(testContext(http), { externalId: '1', url: 'https://job-boards.greenhouse.io/discord/jobs/1' }, board('discord'));
    expect(detail).toBeNull();
  });

  it('throws a parse error for a payload of the wrong shape', async () => {
    const http = fakeHttp([{ match: `${API}/discord/jobs/1`, body: [1, 2] }]);
    await expect(
      greenhouseSource.fetchDetail!(testContext(http), { externalId: '1', url: 'https://example.com/1' }, board('discord')),
    ).rejects.toMatchObject({ kind: 'parse' });
  });
});

describe('greenhouseSource.probeBoard', () => {
  it('reads the display name and the open-job count', async () => {
    const http = fakeHttp([
      { match: /\/boards\/stripe$/, body: readFixture('greenhouse', 'board-stripe.json') },
      { match: /\/boards\/stripe\/jobs$/, body: readFixture('greenhouse', 'jobs-no-content-airbnb.json') },
    ]);
    const result = await greenhouseSource.probeBoard!(testContext(http), 'stripe');
    expect(result).toEqual({ jobs: 199, name: 'Stripe' }); // meta.total of the capture
    expect(http.requests.map((r) => r.url)).toEqual([`${API}/stripe`, `${API}/stripe/jobs`]);
  });

  it('counts the jobs when meta is missing', async () => {
    const http = fakeHttp([
      { match: /\/boards\/acme$/, body: { name: 'Acme', content: '' } },
      { match: /\/boards\/acme\/jobs$/, body: { jobs: [{ id: 1 }, { id: 2 }] } },
    ]);
    expect(await greenhouseSource.probeBoard!(testContext(http), 'acme')).toEqual({ jobs: 2, name: 'Acme' });
  });

  it('returns null for an unknown board without fetching its jobs', async () => {
    const http = fakeHttp([{ match: /\/boards\/zzqqnonexistentboard9731$/, status: 404, body: readFixture('greenhouse', 'error-unknown-board-404.json') }]);
    expect(await greenhouseSource.probeBoard!(testContext(http), 'zzqqnonexistentboard9731')).toBeNull();
    expect(http.requests).toHaveLength(1);
  });
});
