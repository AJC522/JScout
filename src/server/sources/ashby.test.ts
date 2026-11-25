import { describe, expect, it } from 'vitest';
import { ashbySource } from './ashby';
import { fakeHttp, readFixture, readJsonFixture, testContext } from './testing';
import { type BoardRef, type RawPosting, SourceError } from './types';

const API = 'https://api.ashbyhq.com/posting-api/job-board';

interface Envelope {
  jobs: Array<Record<string, unknown> & { id: string; descriptionHtml: string; descriptionPlain: string }>;
  apiVersion: string;
}

function board(token: string, name = `${token} (board name)`): BoardRef {
  return { ats: 'ashby', token, name };
}

function byId(postings: RawPosting[], id: string): RawPosting {
  const p = postings.find((x) => x.externalId === id);
  if (!p) throw new Error(`posting ${id} not found`);
  return p;
}

function rawById(fixture: string, id: string) {
  const j = readJsonFixture<Envelope>('ashby', fixture).jobs.find((x) => x.id === id);
  if (!j) throw new Error(`raw posting ${id} not found`);
  return j;
}

async function feed(token: string, fixture: string, name?: string) {
  const http = fakeHttp([{ match: `${API}/${token}`, body: readFixture('ashby', fixture), headers: { etag: `W/"job-board:${token}"` } }]);
  const result = await ashbySource.fetchFeed!(testContext(http), board(token, name));
  return { http, result };
}

describe('ashbySource.def', () => {
  it('describes a per-company, full-snapshot feed', () => {
    expect(ashbySource.def).toMatchObject({
      id: 'ashby',
      kind: 'ats',
      mode: 'feed',
      perCompany: true,
      ats: 'ashby',
      fullSnapshot: true,
      defaultEnabled: true,
      defaultTtlMinutes: 360,
      minRequestIntervalMs: 500,
      configFields: [],
    });
  });
});

describe('ashbySource.fetchFeed', () => {
  it('requests the board once with compensation and maps every field (ramp)', async () => {
    const { http, result } = await feed('ramp', 'jobs-ramp.json', 'Ramp');
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]!.url).toBe(`${API}/ramp?includeCompensation=true`);
    expect(http.requests[0]!.options).toMatchObject({ minIntervalMs: 500, etag: undefined });
    expect(result.complete).toBe(true);
    expect(result.cursor).toEqual({ etag: 'W/"job-board:ramp"' });
    expect(result.postings).toHaveLength(5);

    const id = '8c004352-f162-4d89-858f-75a649e77ec4';
    expect(byId(result.postings, id)).toEqual({
      externalId: id,
      url: `https://jobs.ashbyhq.com/ramp/${id}`,
      applyUrl: `https://jobs.ashbyhq.com/ramp/${id}/application`,
      title: 'Account Executive | Commercial',
      company: 'Ramp',
      locations: ['New York, NY (HQ)', 'San Francisco, CA'],
      remote: 'hybrid',
      descriptionHtml: rawById('jobs-ramp.json', id).descriptionHtml,
      postedAt: '2025-10-09T20:16:19.133+00:00',
      // Two tiers (OTE $425K / $383K): the summary Salary component spans both.
      salary: {
        min: 216000,
        max: 240000,
        currency: 'USD',
        period: 'year',
        text: '$216K – $240K • Offers Equity • Offers Commission • Multiple Ranges',
      },
      employmentType: 'FullTime',
      department: 'Sales',
      tags: ['Account Executive'],
    });
  });

  it('maps monthly, GBP, CAD and equity-percentage compensation', async () => {
    const { result } = await feed('ramp', 'jobs-ramp.json');
    expect(byId(result.postings, 'b87e898f-8d8b-447d-b3d5-9073ccf7d109').salary).toEqual({
      min: 8000,
      max: 8000,
      currency: 'USD',
      period: 'month',
      text: '$8K per month',
    });
    const london = byId(result.postings, '8be15a12-b918-4653-a631-834db164a146');
    expect(london.salary).toEqual({ min: 75000, max: 100000, currency: 'GBP', period: 'year', text: '£75K – £100K • Offers Equity' });
    expect(london.remote).toBe('onsite');
    expect(london.locations).toEqual(['London, UK', 'Remote (UK)']);
    // EquityPercentage (interval NONE, no currency) comes first in summaryComponents and is ignored.
    expect(byId(result.postings, 'd204e136-2749-42de-82b4-88a0dd352090').salary).toMatchObject({ min: 204400, max: 352000, currency: 'USD', period: 'year' });
    expect(byId(result.postings, '70958953-f10f-4dba-a606-80a10f80a8f6').salary).toMatchObject({
      min: 138000,
      max: 189000,
      currency: 'CAD',
      text: 'CA$138K – CA$189K • Offers Equity • Offers Commission • 70/30 Split',
    });
  });

  it('handles hourly pay, a null workplace type and secondary locations (openai)', async () => {
    const { result } = await feed('openai', 'jobs-openai.json', 'OpenAI');
    const contract = byId(result.postings, 'dbd5ae8a-7c01-4f17-be39-b8caa8fd95d5');
    expect(contract.salary).toEqual({ min: 57, max: 70, currency: 'USD', period: 'hour', text: '$57 – $70 per hour' });
    expect(contract.employmentType).toBe('Contract');
    expect(contract.locations).toEqual(['San Francisco', 'New York City', 'Seattle']);
    expect(contract.department).toBe('People');
    expect(contract.tags).toEqual(['Recruiting']);

    const android = byId(result.postings, '6202038a-323b-43ce-ae10-534acba4145c');
    expect(android.title).toBe('Android Engineer, Applied Foundations'); // trailing space trimmed
    expect(android.remote).toBeUndefined(); // workplaceType: null, isRemote: null

    const security = byId(result.postings, 'f51f750f-a737-4441-8f96-30133a2a8049');
    expect(security.remote).toBe('remote');
    expect(security.locations).toEqual(['US - Remote', 'New York City', 'Seattle', 'San Francisco']);
    expect(security.tags).toBeUndefined(); // team equals department
    expect(security.department).toBe('Security');
  });

  it('omits salary when the board hides pay (notion, linear)', async () => {
    const notion = (await feed('notion', 'jobs-notion.json')).result;
    const tokyo = byId(notion.postings, 'c64a2cda-4c84-45bd-823d-f9141c316733');
    expect(tokyo.salary).toBeUndefined();
    expect(tokyo.locations).toEqual(['Tokyo, Japan']);
    expect(byId(notion.postings, '43b37ac5-1ce9-4106-8df1-1ae8515087ee')).toMatchObject({
      remote: 'remote',
      locations: ['Atlanta, Georgia'],
      title: 'Enterprise Solutions Consultant (Atlanta, GA)',
    });

    const linear = (await feed('linear', 'jobs-linear.json', 'Linear')).result;
    expect(byId(linear.postings, 'cb8e77a6-4316-45c6-ac8d-7ade980cd65e')).toMatchObject({
      title: 'Account Executive, Growth',
      remote: 'hybrid',
      locations: ['Singapore'],
      company: 'Linear',
      department: 'GTM',
      tags: ['Sales'],
    });
    expect(byId(linear.postings, 'f16dd5e9-ed10-4b8e-b5d7-1b8b5e3f002f').locations).toEqual(['North America', 'Europe']);
    for (const p of linear.postings) expect(p.salary).toBeUndefined();
  });

  it('uses the board name as the company for every posting', async () => {
    const { result } = await feed('openai', 'jobs-openai.json', 'OpenAI, L.L.C.');
    expect(new Set(result.postings.map((p) => p.company))).toEqual(new Set(['OpenAI, L.L.C.']));
  });

  it('falls back to the postal address, the plain description and the first tier', async () => {
    const env = readJsonFixture<Envelope>('ashby', 'jobs-ramp.json');
    const base = env.jobs[2]!; // London, OnSite, GBP
    const job = {
      ...base,
      location: '',
      secondaryLocations: [{ address: { postalAddress: { addressLocality: 'Leeds', addressCountry: 'United Kingdom' } } }],
      descriptionHtml: '   ',
      workplaceType: 'Unknown',
      compensation: {
        compensationTierSummary: null,
        summaryComponents: [],
        compensationTiers: [{ components: [{ compensationType: 'Salary', interval: '1 WEEK', currencyCode: 'eur', minValue: 900, maxValue: null }] }],
      },
    };
    const http = fakeHttp([{ match: `${API}/ramp`, body: { ...env, jobs: [job] } }]);
    const [p] = (await ashbySource.fetchFeed!(testContext(http), board('ramp'))).postings;
    expect(p!.locations).toEqual(['London, United Kingdom', 'Leeds, United Kingdom']);
    expect(p!.descriptionHtml).toBeUndefined();
    expect(p!.descriptionText).toBe(base.descriptionPlain.trim());
    expect(p!.remote).toBeUndefined();
    expect(p!.salary).toEqual({ min: 900, currency: 'EUR', period: 'week' });
  });

  it('skips unlisted and malformed postings, de-duplicates by id', async () => {
    const env = readJsonFixture<Envelope>('ashby', 'jobs-linear.json');
    const first = env.jobs[0]!;
    const jobs = [
      ...env.jobs,
      { ...first, id: 'hidden-1', isListed: false },
      null,
      { ...first, id: undefined },
      { ...first, id: 'x1', title: '' },
      { ...first, id: 'x2', jobUrl: 'jobs.ashbyhq.com/linear/x2' },
      { ...first, title: 'Duplicate' },
    ];
    const http = fakeHttp([{ match: `${API}/linear`, body: { ...env, jobs } }]);
    const ctx = testContext(http);
    const warnings: unknown[] = [];
    ctx.log.warn = (msg) => {
      warnings.push(msg);
    };
    const result = await ashbySource.fetchFeed!(ctx, board('linear'));
    expect(result.postings.map((p) => p.externalId)).toEqual(env.jobs.map((j) => j.id));
    expect(byId(result.postings, first.id).title).toBe('Account Executive, Growth');
    expect(warnings).toHaveLength(4);
    expect(result.complete).toBe(true);
  });

  it('treats an empty board as a complete, empty snapshot', async () => {
    const http = fakeHttp([{ match: `${API}/quiet`, body: { jobs: [], apiVersion: '1' } }]);
    expect(await ashbySource.fetchFeed!(testContext(http), board('quiet'))).toMatchObject({ postings: [], complete: true });
  });

  it.each([
    ['a list', []],
    ['jobs not a list', { jobs: 'none', apiVersion: '1' }],
    ['plain text', 'Not Found'],
    ['no entry is a posting', { jobs: [1, 2], apiVersion: '1' }],
  ])('throws a parse error for a payload of the wrong shape (%s)', async (_label, body) => {
    const http = fakeHttp([{ match: `${API}/linear`, body }]);
    await expect(ashbySource.fetchFeed!(testContext(http), board('linear'))).rejects.toMatchObject({ kind: 'parse' });
  });

  it('sends the stored ETag and reports 304 as not modified', async () => {
    const etag = 'W/"job-board:6f5e863d0cdbda5dc05278d45ebfee6d7a1e98bf8dd69ff5febe694906608fd0"';
    const http = fakeHttp([{ match: `${API}/linear`, status: 304, headers: { etag } }]);
    const result = await ashbySource.fetchFeed!(testContext(http), board('linear'), { etag });
    expect(http.requests[0]!.options.etag).toBe(etag);
    expect(result).toEqual({ postings: [], complete: false, notModified: true, cursor: { etag } });
  });

  it('propagates not-found for an unknown board and rate limiting', async () => {
    const http = fakeHttp([
      { match: `${API}/zzqqnonexistentco9731`, status: 404, body: readFixture('ashby', 'error-unknown-board-404.txt') },
      { match: `${API}/busy`, status: 429 },
    ]);
    const ctx = testContext(http);
    await expect(ashbySource.fetchFeed!(ctx, board('zzqqnonexistentco9731'))).rejects.toMatchObject({ kind: 'not-found', status: 404 });
    await expect(ashbySource.fetchFeed!(ctx, board('busy'))).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it('needs a board and honours an aborted signal', async () => {
    const http = fakeHttp([{ match: () => true, body: { jobs: [] } }]);
    await expect(ashbySource.fetchFeed!(testContext(http))).rejects.toBeInstanceOf(SourceError);
    const controller = new AbortController();
    controller.abort();
    await expect(ashbySource.fetchFeed!({ ...testContext(http), signal: controller.signal }, board('linear'))).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(http.requests).toHaveLength(0);
  });
});

describe('ashbySource.fetchDetail', () => {
  it('re-reads the board and returns the posting description and pay', async () => {
    const id = 'dbd5ae8a-7c01-4f17-be39-b8caa8fd95d5';
    const http = fakeHttp([{ match: `${API}/openai`, body: readFixture('ashby', 'jobs-openai.json') }]);
    const detail = await ashbySource.fetchDetail!(testContext(http), { externalId: id, url: `https://jobs.ashbyhq.com/openai/${id}` }, board('openai'));
    expect(http.requests[0]!.url).toBe(`${API}/openai?includeCompensation=true`);
    expect(http.requests[0]!.options.allowStatus).toEqual([404]);
    expect(detail).toEqual({
      descriptionHtml: rawById('jobs-openai.json', id).descriptionHtml,
      salary: { min: 57, max: 70, currency: 'USD', period: 'hour', text: '$57 – $70 per hour' },
    });
  });

  it('returns null when the posting is no longer on the board, or the board is gone', async () => {
    const http = fakeHttp([
      { match: `${API}/openai`, body: readFixture('ashby', 'jobs-openai.json') },
      { match: `${API}/gone`, status: 404, body: 'Not Found' },
    ]);
    const ctx = testContext(http);
    expect(await ashbySource.fetchDetail!(ctx, { externalId: 'not-there', url: 'https://jobs.ashbyhq.com/openai/x' }, board('openai'))).toBeNull();
    expect(await ashbySource.fetchDetail!(ctx, { externalId: 'x', url: 'https://jobs.ashbyhq.com/gone/x' }, board('gone'))).toBeNull();
  });
});

describe('ashbySource.probeBoard', () => {
  it('counts the listed postings without asking for compensation', async () => {
    const http = fakeHttp([{ match: `${API}/ramp`, body: readFixture('ashby', 'jobs-ramp.json') }]);
    expect(await ashbySource.probeBoard!(testContext(http), 'ramp')).toEqual({ jobs: 5 });
    expect(http.requests[0]!.url).toBe(`${API}/ramp`);
  });

  it('returns null for an unknown board', async () => {
    const http = fakeHttp([{ match: `${API}/zzqqnonexistentco9731`, status: 404, body: readFixture('ashby', 'error-unknown-board-404.txt') }]);
    expect(await ashbySource.probeBoard!(testContext(http), 'zzqqnonexistentco9731')).toBeNull();
  });

  it('rejects a payload of the wrong shape', async () => {
    const http = fakeHttp([{ match: `${API}/odd`, body: { postings: [] } }]);
    await expect(ashbySource.probeBoard!(testContext(http), 'odd')).rejects.toMatchObject({ kind: 'parse' });
  });
});
