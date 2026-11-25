import { describe, expect, it } from 'vitest';
import { leverSource } from './lever';
import { fakeHttp, readFixture, readJsonFixture, testContext } from './testing';
import { type BoardRef, type RawPosting, SourceError } from './types';

const API = 'https://api.lever.co/v0/postings';

interface LeverList {
  text: string;
  content: string;
}
interface LeverPosting {
  id: string;
  description: string;
  descriptionPlain: string;
  additional: string;
  salaryDescription?: string;
  lists: LeverList[];
}

function board(token: string, name = `${token} (board name)`): BoardRef {
  return { ats: 'lever', token, name };
}

function byId(postings: RawPosting[], id: string): RawPosting {
  const p = postings.find((x) => x.externalId === id);
  if (!p) throw new Error(`posting ${id} not found`);
  return p;
}

function rawById(fixture: string, id: string): LeverPosting {
  const p = readJsonFixture<LeverPosting[]>('lever', fixture).find((x) => x.id === id);
  if (!p) throw new Error(`raw posting ${id} not found`);
  return p;
}

describe('leverSource.def', () => {
  it('describes a per-company, full-snapshot feed paced at the crawl delay', () => {
    expect(leverSource.def).toMatchObject({
      id: 'lever',
      kind: 'ats',
      mode: 'feed',
      perCompany: true,
      ats: 'lever',
      fullSnapshot: true,
      defaultEnabled: true,
      defaultTtlMinutes: 360,
      minRequestIntervalMs: 1000,
      configFields: [],
    });
    expect(leverSource.def.description).toMatch(/EU/);
  });
});

describe('leverSource.fetchFeed', () => {
  it('requests the whole list once (no paging) and maps every field (spotify)', async () => {
    const http = fakeHttp([{ match: `${API}/spotify`, body: readFixture('lever', 'list-spotify.json'), headers: { etag: 'W/"f1-abc"' } }]);
    const result = await leverSource.fetchFeed!(testContext(http), board('spotify', 'Spotify'));

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]!.url).toBe(`${API}/spotify?mode=json`);
    expect(http.requests[0]!.options).toMatchObject({ minIntervalMs: 1000, etag: undefined });
    expect(result.complete).toBe(true);
    expect(result.cursor).toEqual({ etag: 'W/"f1-abc"' });
    expect(result.postings).toHaveLength(7);

    const id = 'b24fe5e5-dcb2-4238-a883-5fdb6bd404db';
    const raw = rawById('list-spotify.json', id);
    const p = byId(result.postings, id);
    expect(p).toEqual({
      externalId: id,
      url: `https://jobs.lever.co/spotify/${id}`,
      applyUrl: `https://jobs.lever.co/spotify/${id}/apply`,
      title: 'Accounting Analyst, Content Accounting',
      company: 'Spotify',
      locations: ['New York, NY'],
      remote: 'hybrid',
      descriptionHtml: [
        raw.description,
        "<h3>What You'll do</h3>",
        `<ul>${raw.lists[0]!.content}</ul>`,
        '<h3>Who You Are</h3>',
        `<ul>${raw.lists[1]!.content}</ul>`,
        "<h3>Where You'll Be</h3>",
        `<ul>${raw.lists[2]!.content}</ul>`,
        raw.additional,
      ].join('\n'),
      postedAt: 1794565648197,
      salary: { min: 75645, max: 94556, currency: 'USD', period: 'year' },
      department: 'Finance',
      tags: ['Accounting'],
    });
    expect(p.employmentType).toBeUndefined(); // no commitment category
  });

  it('keeps every location, the structured workplace type and the commitment', async () => {
    const http = fakeHttp([{ match: `${API}/spotify`, body: readFixture('lever', 'list-spotify.json') }]);
    const { postings } = await leverSource.fetchFeed!(testContext(http), board('spotify'));

    const music = byId(postings, '65d6caca-6d7c-4049-8256-a128e0e7249e');
    expect(music.locations).toEqual(['New York, NY', 'Boston, MA', 'Miami, FL']);
    expect(music.remote).toBe('remote');
    expect(music.employmentType).toBe('Permanent');
    expect(music.department).toBe('Engineering');
    expect(music.tags).toEqual(['Music']);

    expect(byId(postings, '186b763a-2a61-4563-8813-ff6b40c9c8a7').locations).toEqual(['Stockholm', 'London']);
    expect(byId(postings, '785989a6-b219-43b1-92d9-750a67054f24').remote).toBe('onsite');
  });

  it('builds the description from lists and closing text when the opening is empty', async () => {
    const http = fakeHttp([{ match: `${API}/spotify`, body: readFixture('lever', 'list-spotify.json') }]);
    const { postings } = await leverSource.fetchFeed!(testContext(http), board('spotify'));
    const id = '785989a6-b219-43b1-92d9-750a67054f24';
    const raw = rawById('list-spotify.json', id);
    expect(raw.description).toBe('');
    const html = byId(postings, id).descriptionHtml!;
    expect(html.startsWith('<h3>What You’ll Do</h3>\n<ul><div>')).toBe(true);
    expect(html.endsWith(raw.additional)).toBe(true);

    // Empty `additional` adds nothing.
    const taiwan = rawById('list-spotify.json', 'd174a24c-bf16-4661-9b9a-32396e883c25');
    expect(byId(postings, taiwan.id).descriptionHtml!.endsWith(`<ul>${taiwan.lists[2]!.content}</ul>`)).toBe(true);
  });

  it('escapes plain-text list headings (veeva "Perks & Benefits")', async () => {
    const http = fakeHttp([{ match: `${API}/veeva`, body: readFixture('lever', 'list-veeva-limit100.json') }]);
    const { postings } = await leverSource.fetchFeed!(testContext(http), board('veeva'));
    const html = byId(postings, '83c7b3b4-a840-4452-8478-aaf9a9dd7c1e').descriptionHtml!;
    expect(html).toContain('<h3>Perks &amp; Benefits</h3>');
    expect(html).not.toContain('<h3>Perks & Benefits</h3>');
  });

  it('maps hourly and yearly ranges, level, and includes the salary note in the description (zoox)', async () => {
    const http = fakeHttp([{ match: `${API}/zoox`, body: readFixture('lever', 'list-zoox-limit100.json') }]);
    const { postings } = await leverSource.fetchFeed!(testContext(http), board('zoox', 'Zoox'));
    expect(postings).toHaveLength(8);

    const manager = byId(postings, '05762fb8-07fa-43a3-aa30-e079bb31018e');
    expect(manager.seniority).toBe('Senior');
    expect(manager.salary).toEqual({ min: 166000, max: 230000, currency: 'USD', period: 'year' });
    expect(manager.employmentType).toBe('Full-time');
    expect(manager.department).toBe('People Experience');
    expect(manager.tags).toEqual(['Talent']);

    const mro = byId(postings, '9b088854-b5e0-49e2-a368-e82220c0b375');
    expect(mro.salary).toEqual({ min: 30.25, max: 45.75, currency: 'USD', period: 'hour' });
    expect(mro.remote).toBe('onsite');

    const raw = rawById('list-zoox-limit100.json', '8befaec7-bb9f-4cf3-a48c-46b5e3886bf3');
    const admin = byId(postings, raw.id);
    expect(admin.descriptionHtml).toContain(`\n${raw.salaryDescription!}\n${raw.additional}`);
    expect(admin.salary?.text).toBeUndefined(); // the note goes to the description, not salary.text

    expect(byId(postings, '54be0f19-9a45-466d-89bc-bc72dd3f9d68').title).toBe(
      'Contract Student Worker  – Firmware Engineer (FW Core System Services)',
    );
    expect(byId(postings, '008c7252-edd0-4e72-a79b-0dc021f212d5').employmentType).toBeUndefined();
  });

  it('falls back to the single location, to the team as department, and to plain text', async () => {
    const base = readJsonFixture<Array<Record<string, unknown>>>('lever', 'list-palantir.json')[0]!;
    const body = [
      {
        ...base,
        categories: { location: 'Denver, CO', team: 'Administrative' },
        description: '',
        lists: [],
        additional: '',
        workplaceType: 'unspecified',
        salaryRange: { currency: 'usd', interval: 'per-month-salary', min: 5000 },
      },
    ];
    const http = fakeHttp([{ match: `${API}/palantir`, body }]);
    const [p] = (await leverSource.fetchFeed!(testContext(http), board('palantir'))).postings;
    expect(p!.locations).toEqual(['Denver, CO']);
    expect(p!.department).toBe('Administrative');
    expect(p!.tags).toBeUndefined();
    expect(p!.remote).toBeUndefined();
    expect(p!.descriptionHtml).toBeUndefined();
    expect(p!.descriptionText).toBe(String(base.descriptionPlain).trim());
    expect(p!.salary).toEqual({ min: 5000, currency: 'USD', period: 'month' });
  });

  it('uses the board name for every posting', async () => {
    const http = fakeHttp([{ match: `${API}/palantir`, body: readFixture('lever', 'list-palantir.json') }]);
    const { postings } = await leverSource.fetchFeed!(testContext(http), board('palantir', 'Palantir Technologies'));
    expect(postings).toHaveLength(6);
    expect(new Set(postings.map((p) => p.company))).toEqual(new Set(['Palantir Technologies']));
    expect(byId(postings, '6ed76ce8-4156-4b60-b120-403538bd66cd')).toMatchObject({
      title: 'Administrative Business Partner',
      locations: ['Singapore, Singapore'],
      remote: 'hybrid',
      postedAt: 1786469891368,
      employmentType: 'Full-time',
      department: 'Administrative',
    });
  });

  it('treats an empty list as a complete, empty snapshot', async () => {
    const http = fakeHttp([{ match: `${API}/quiet`, body: readFixture('lever', 'empty-filter-no-match.json') }]);
    expect(await leverSource.fetchFeed!(testContext(http), board('quiet'))).toMatchObject({ postings: [], complete: true });
  });

  it('skips malformed postings with a warning and de-duplicates by id', async () => {
    const list = readJsonFixture<Array<Record<string, unknown>>>('lever', 'list-palantir.json');
    const first = list[0]!;
    const body = [
      ...list,
      null,
      42,
      { ...first, id: '' },
      { ...first, id: 'x1', text: undefined },
      { ...first, id: 'x2', hostedUrl: 'mailto:jobs@example.com' },
      { ...first, text: 'Duplicate' },
    ];
    const http = fakeHttp([{ match: `${API}/palantir`, body }]);
    const ctx = testContext(http);
    const warnings: unknown[] = [];
    ctx.log.warn = (msg) => {
      warnings.push(msg);
    };
    const result = await leverSource.fetchFeed!(ctx, board('palantir'));
    expect(result.postings).toHaveLength(list.length);
    expect(byId(result.postings, String(first.id)).title).toBe('Administrative Business Partner');
    expect(warnings).toHaveLength(5);
    expect(result.complete).toBe(true);
  });

  it.each([
    ['an object', { ok: false, error: 'Document not found' }],
    ['grouped by team', readFixture('lever', 'list-grouped-by-team-palantir-denver.json')],
    ['invalid JSON', '[{"id":'],
  ])('rejects a payload of the wrong shape (%s)', async (_label, body) => {
    const http = fakeHttp([{ match: `${API}/palantir`, body }]);
    // A grouped list is an array of {title, postings}: no entry is a posting, so it must not pass as an empty board.
    await expect(leverSource.fetchFeed!(testContext(http), board('palantir'))).rejects.toMatchObject({ kind: 'parse' });
  });

  it('sends the stored ETag and reports 304 as not modified', async () => {
    const etag = 'W/"6d33-X+ElVzXODc1mfgsi9u0+p29zrXM"';
    const http = fakeHttp([{ match: `${API}/palantir`, status: 304, headers: { etag } }]);
    const result = await leverSource.fetchFeed!(testContext(http), board('palantir'), { etag });
    expect(http.requests[0]!.options.etag).toBe(etag);
    expect(result).toEqual({ postings: [], complete: false, notModified: true, cursor: { etag } });
  });

  it('propagates not-found for an unknown company and rate limiting', async () => {
    const http = fakeHttp([
      { match: `${API}/zzqqnonexistentco9731`, status: 404, body: readFixture('lever', 'error-unknown-company-404.json') },
      { match: `${API}/busy`, status: 429 },
    ]);
    const ctx = testContext(http);
    await expect(leverSource.fetchFeed!(ctx, board('zzqqnonexistentco9731'))).rejects.toMatchObject({ kind: 'not-found' });
    await expect(leverSource.fetchFeed!(ctx, board('busy'))).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it('needs a board and honours an aborted signal', async () => {
    const http = fakeHttp([{ match: () => true, body: [] }]);
    await expect(leverSource.fetchFeed!(testContext(http))).rejects.toBeInstanceOf(SourceError);
    const controller = new AbortController();
    controller.abort();
    await expect(leverSource.fetchFeed!({ ...testContext(http), signal: controller.signal }, board('palantir'))).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(http.requests).toHaveLength(0);
  });
});

describe('leverSource.fetchDetail', () => {
  const id = 'ac978161-6f46-4f6b-ad9e-a258e642751c';

  it('fetches one posting and returns its description', async () => {
    const fixture = `detail-palantir-${id}.json`;
    const raw = readJsonFixture<LeverPosting>('lever', fixture);
    const http = fakeHttp([{ match: `${API}/palantir/${id}`, body: readFixture('lever', fixture) }]);
    const detail = await leverSource.fetchDetail!(testContext(http), { externalId: id, url: `https://jobs.lever.co/palantir/${id}` }, board('palantir'));
    expect(http.requests[0]!.url).toBe(`${API}/palantir/${id}`);
    expect(http.requests[0]!.options.allowStatus).toEqual([404]);
    expect(Object.keys(detail ?? {})).toEqual(['descriptionHtml']); // no salaryRange on this posting
    expect(detail!.descriptionHtml!.startsWith(`${raw.description}\n<h3>${raw.lists[0]!.text}</h3>`)).toBe(true);
    expect(detail!.descriptionHtml!.endsWith(raw.additional)).toBe(true);
  });

  it('returns null when the posting is gone (404)', async () => {
    const gone = '00000000-0000-4000-8000-000000000000';
    const http = fakeHttp([{ match: `${API}/palantir/${gone}`, status: 404, body: readFixture('lever', 'error-unknown-posting-404.json') }]);
    expect(await leverSource.fetchDetail!(testContext(http), { externalId: gone, url: 'https://jobs.lever.co/palantir/x' }, board('palantir'))).toBeNull();
  });

  it('throws a parse error for a payload of the wrong shape', async () => {
    const http = fakeHttp([{ match: `${API}/palantir/${id}`, body: [] }]);
    await expect(leverSource.fetchDetail!(testContext(http), { externalId: id, url: 'https://x.test' }, board('palantir'))).rejects.toMatchObject({
      kind: 'parse',
    });
  });
});

describe('leverSource.probeBoard', () => {
  it('counts the postings in the compact HTML listing (zoox: 246)', async () => {
    const http = fakeHttp([{ match: `${API}/zoox`, body: readFixture('lever', 'list-mode-html-zoox.html') }]);
    expect(await leverSource.probeBoard!(testContext(http), 'zoox')).toEqual({ jobs: 246 });
    expect(http.requests[0]!.url).toBe(`${API}/zoox?mode=html`);
  });

  it('counts a one-posting listing and an empty one', async () => {
    const http = fakeHttp([
      { match: `${API}/palantir`, body: readFixture('lever', 'list-mode-html-limit1.html') },
      { match: `${API}/quiet`, body: '<!DOCTYPE html><meta charset="utf-8"><title>Derby App</title><body class="list"><div class="lever"><ul></ul></div>' },
    ]);
    expect(await leverSource.probeBoard!(testContext(http), 'palantir')).toEqual({ jobs: 1 });
    expect(await leverSource.probeBoard!(testContext(http), 'quiet')).toEqual({ jobs: 0 });
  });

  it('returns null for an unknown company and rejects a non-HTML answer', async () => {
    const http = fakeHttp([
      { match: `${API}/zzqqnonexistentco9731`, status: 404, body: readFixture('lever', 'error-unknown-company-404.json') },
      { match: `${API}/odd`, body: '{"ok":true}' },
    ]);
    expect(await leverSource.probeBoard!(testContext(http), 'zzqqnonexistentco9731')).toBeNull();
    await expect(leverSource.probeBoard!(testContext(http), 'odd')).rejects.toMatchObject({ kind: 'parse' });
  });
});
