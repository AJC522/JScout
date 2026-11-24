import { describe, expect, it } from 'vitest';
import { remoteokSource } from './remoteok';
import { fakeHttp, readFixture, readJsonFixture, testContext } from './testing';
import { type RawPosting, type SourceContext, SourceError } from './types';

const API = 'https://remoteok.com/api';

function serve(body: unknown, status = 200) {
  return fakeHttp([{ match: (url) => url === API, body, status }]);
}

function recordingContext(http: ReturnType<typeof fakeHttp>): SourceContext & { warnings: unknown[][] } {
  const warnings: unknown[][] = [];
  const ctx = testContext(http);
  return { ...ctx, log: { ...ctx.log, warn: (...args: unknown[]) => void warnings.push(args) }, warnings };
}

async function fetchFixture(name: string): Promise<RawPosting[]> {
  const result = await remoteokSource.fetchFeed!(testContext(serve(readFixture('remoteok', name))));
  return result.postings;
}

function byId(postings: RawPosting[], id: string): RawPosting {
  const posting = postings.find((p) => p.externalId === id);
  if (!posting) throw new Error(`posting ${id} missing`);
  return posting;
}

describe('remoteok definition', () => {
  it('describes a rolling-window feed with the attribution Remote OK asks for', () => {
    const def = remoteokSource.def;
    expect(def).toMatchObject({
      id: 'remoteok',
      name: 'Remote OK',
      kind: 'board',
      mode: 'feed',
      homepage: 'https://remoteok.com',
      perCompany: false,
      configFields: [],
      defaultEnabled: true,
      defaultTtlMinutes: 360,
      fullSnapshot: false,
      minRequestIntervalMs: 1000,
    });
    expect(def.attribution).toMatch(/Remote OK/);
    expect(def.attribution).toMatch(/nofollow/);
    expect(def.attribution).toMatch(/logo/);
    expect(def.description).toMatch(/100/);
    expect(remoteokSource.search).toBeUndefined();
  });
});

describe('remoteok fetchFeed', () => {
  it('requests the API once, paced at the robots.txt crawl delay, and never claims completeness', async () => {
    const http = serve(readFixture('remoteok', 'list.json'));
    const controller = new AbortController();
    const result = await remoteokSource.fetchFeed!({ ...testContext(http), signal: controller.signal });

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]).toMatchObject({ method: 'GET', url: API });
    expect(http.requests[0]!.options).toMatchObject({ minIntervalMs: 1000, signal: controller.signal });
    expect(http.requests[0]!.options.etag).toBeUndefined();
    expect(http.requests[0]!.options.lastModified).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(result.notModified).toBeUndefined();
    expect(result.cursor).toBeUndefined();
    // The legal-notice element is skipped; 8 jobs remain, newest first.
    expect(result.postings.map((p) => p.externalId)).toEqual([
      '1138068', '1137976', '1137951', '1137925', '1137917', '1137913', '1137865', '1137864',
    ]);
  });

  it('maps every field of a posting', async () => {
    const postings = await fetchFixture('list.json');
    const { descriptionHtml, ...rest } = byId(postings, '1138068');
    expect(rest).toEqual({
      externalId: '1138068',
      url: 'https://remoteok.com/remote-jobs/remote-senior-software-developer-agentic-ai-canada-clover-health-1138068',
      title: 'Senior Software Developer, Agentic AI - Canada',
      company: 'Clover Health',
      companyLogo: undefined,
      locations: ['Canada Only'],
      remote: 'remote',
      postedAt: '2026-11-23T09:20:04+00:00',
      salary: undefined,
      tags: ['programming'],
    });
    expect(descriptionHtml).toMatch(/^<p><em>Clover is reinventing health insurance by working to keep peopl/);
    expect(descriptionHtml).toMatch(/<em> company\.<br \/><\/em><\/p>$/);
  });

  it('repairs mojibake in company, location, description and tags', async () => {
    const postings = await fetchFixture('list.json');
    const oura = byId(postings, '1137976');
    expect(oura.company).toBe('ŌURA'); // ŌURA, served as "Å\u008cURA"
    expect(oura.descriptionHtml).toMatch(/^<div><p>Our mission at ŌURA is to empower/);

    const wemolo = byId(postings, '1137917');
    expect(wemolo.locations).toEqual(['München']);
    expect(wemolo.tags).toEqual([
      'embedded', 'sys admin', 'python', 'technical', 'dev', 'testing', 'marketing', 'speech', 'senior', 'ops',
      'sales', 'medical', 'engineer', 'digital nomad',
    ]);

    const princeton = byId(postings, '1137913');
    expect(princeton.locations).toEqual(['Remote, EST United States']);
    expect(princeton.descriptionHtml).toMatch(/^<p>\n<\/p><p>We’re looking for an experienced <strong>Account Director/);
    // Only the trailer's own <br/>s go; the employer's markup before it is kept.
    expect(princeton.descriptionHtml).toMatch(/join us\.<\/p>\n<br><br><p><\/p>$/);

    const arbor = byId(postings, '1137865');
    expect(arbor.descriptionHtml).toMatch(/^<p>Location: Remote - UK<\/p><p>Salary: £70,000-80,000<\/p>/);
    expect(postings.every((p) => !/[\u0080-\u009f]|Ã|Â/.test(JSON.stringify(p)))).toBe(true);
  });

  it('passes structured salary numbers without guessing currency or period', async () => {
    const postings = await fetchFixture('list.json');
    // The description says "£70,000-80,000": the API's numbers carry no currency, so none is set.
    expect(byId(postings, '1137865')).toMatchObject({ locations: [], salary: { min: 70000, max: 80000 } });
    expect(byId(postings, '1137864')).toMatchObject({ locations: ['United States'], salary: { min: 140000, max: 170000 } });
    expect(byId(postings, '1137951').salary).toBeUndefined(); // 0 / 0 = unknown
    expect(byId(postings, '1137951').title).toBe('Revenue Operations Leader, Strategy & Planning');
  });

  it('keeps awkward values raw for the central pipeline (tag-filtered captures)', async () => {
    const python = await fetchFixture('tag-python.json');
    // Title with an embedded newline, dangling-comma location, capitalised tags.
    expect(byId(python, '1135319')).toMatchObject({
      title: 'Python\n Developer',
      company: 'Astrolite Tech Solutions LLC',
      locations: ['Saint-Python'],
      postedAt: '2026-07-21T15:46:07+00:00',
    });
    expect(byId(python, '1137690').tags?.slice(0, 3)).toEqual(['docker', 'git', 'inventory management']);
    expect(byId(python, '1137690').locations).toEqual(['Anywhere in the World']);
    expect(byId(python, '1137808').salary).toEqual({ min: 10000, max: 10000 });
    // Plain-text description with newlines stays as given.
    expect(byId(python, '1135150').descriptionHtml).toMatch(/^About us\nAB InBev is the leading global /);

    const support = await fetchFixture('tag-customer-support.json');
    // Entities in title/company are decoded centrally, not here.
    expect(byId(support, '1137680').title).toBe('Entry Level Scheduling &amp; Coordinating Reservations Online');
    expect(byId(support, '1137194')).toMatchObject({
      company: 'Transportation Partners &amp; Logistics',
      locations: ['Black Bess'],
    });
    expect(byId(support, '1137708').salary).toEqual({ min: 114000000, max: 140000000 });
    expect(byId(support, '1137482').locations).toEqual(['Ciudad de México, Mexico']);
    expect(byId(support, '1137014').company).toBe('Saraswoti Media™');
    expect(byId(support, '1134979').locations).toEqual(['Stockholm, Stockholm, Stockholms län, Sverige']);
    // Entity-escaped HTML is left as given (minus the trailer) for the central sanitiser.
    const curtins = byId(support, '1137542').descriptionHtml!;
    expect(curtins).toMatch(/^&lt;p&gt;&lt;span&gt;At Curtins, we&#39;/);
    expect(curtins).toMatch(/to apply to join us\.&lt;\/p&gt;&lt;h3&gt;&lt;\/h3&gt;$/);
  });

  it('returns no postings for a response holding only the legal notice', async () => {
    const result = await remoteokSource.fetchFeed!(testContext(serve(readFixture('remoteok', 'tag-unknown.json'))));
    expect(result).toEqual({ postings: [], complete: false });
  });
});

describe('remoteok privacy: the IP-bearing anti-spam trailer', () => {
  const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
  const IPV6 = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|[0-9a-f]{0,4}::[0-9a-f]{1,4}/i;

  it.each(['list.json', 'tag-python.json', 'tag-customer-support.json'])('leaves no trace of it in %s', async (name) => {
    const raw = readFixture('remoteok', name);
    const tags = [...new Set([...raw.matchAll(/ and tag (R[A-Za-z0-9+/=]+) when applying/g)].map((m) => m[1]!))];
    expect(tags.length).toBeGreaterThan(0);
    // Sanity: the captured tags really are "R" + base64(IPv4 address).
    for (const tag of tags) expect(Buffer.from(tag.slice(1), 'base64').toString()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);

    const postings = await fetchFixture(name);
    expect(postings).toHaveLength(8);
    for (const posting of postings) {
      const all = JSON.stringify(posting);
      for (const tag of tags) {
        expect(all).not.toContain(tag);
        expect(all).not.toContain(tag.slice(1));
        expect(all).not.toContain(Buffer.from(tag.slice(1), 'base64').toString());
      }
      expect(all).not.toMatch(/Please mention the word|avoid spam applicants|Companies can search these words|\(#R/);
      expect(all).not.toMatch(/\*\*[A-Z]+\*\*/);
      const html = posting.descriptionHtml ?? '';
      expect(html).not.toMatch(IPV4);
      expect(html).not.toMatch(IPV6);
      expect(html).not.toMatch(/<br\s*\/?>\s*$/);
      expect(html.length).toBeGreaterThan(1000);
    }
  });

  function job(description: string) {
    return {
      id: '1',
      url: 'https://remoteOK.com/remote-jobs/remote-x-1',
      position: 'Engineer',
      company: 'Acme',
      location: 'Worldwide',
      tags: ['dev'],
      date: '2026-11-23T09:20:04+00:00',
      description,
    };
  }

  it('strips a trailer whose wording drifted and any other tag that decodes to an IP address', async () => {
    const v6 = `R${Buffer.from('2001:db8::7').toString('base64')}`;
    const v4 = `R${Buffer.from('203.0.113.9').toString('base64')}`;
    const http = serve([
      { legal: 'notice', last_updated: 1 },
      job(`<p>Hello</p><br/><br/>Please mention the word **APPLE** and tag ${v6} so we know you read it (#${v6}).`),
      { ...job(`<p>Ref (#${v4}) Responsibilities: Rust</p>`), id: '2' },
    ]);
    const result = await remoteokSource.fetchFeed!(testContext(http));
    expect(result.postings.map((p) => p.descriptionHtml)).toEqual(['<p>Hello</p>', '<p>Ref  Responsibilities: Rust</p>']);
  });

  it('drops a description that was nothing but the trailer', async () => {
    const tag = `R${Buffer.from('198.51.100.1').toString('base64')}`;
    const trailer =
      `<br/><br/>Please mention the word **WORD** and tag ${tag} when applying to show you read the job post completely (#${tag}). ` +
      "This is a beta feature to avoid spam applicants. Companies can search these words to find applicants that read this and see they're human.";
    const result = await remoteokSource.fetchFeed!(testContext(serve([job(trailer)])));
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]!.descriptionHtml).toBeUndefined();
  });
});

describe('remoteok defensive parsing', () => {
  it('skips malformed postings with a warning and de-duplicates by id', async () => {
    const list = readJsonFixture<Record<string, unknown>[]>('remoteok', 'list.json');
    const good = list[1]!;
    const http = serve([
      list[0],
      good,
      { ...good }, // duplicate id
      'not an object',
      { ...good, id: '' },
      { ...good, id: '9001', position: '  ' },
      { ...good, id: '9002', company: undefined },
      { ...good, id: '9003', url: 'javascript:alert(1)', slug: '../evil' },
      { ...good, id: '9004', url: 'https://example.com/elsewhere', slug: 'remote-thing-9004' },
      { something: 'else' }, // no id, not the legal notice
    ]);
    const ctx = recordingContext(http);
    const result = await remoteokSource.fetchFeed!(ctx);
    expect(result.postings.map((p) => [p.externalId, p.url])).toEqual([
      ['1138068', 'https://remoteok.com/remote-jobs/remote-senior-software-developer-agentic-ai-canada-clover-health-1138068'],
      // A non-Remote OK url falls back to the posting page built from the slug.
      ['9004', 'https://remoteok.com/remote-jobs/remote-thing-9004'],
    ]);
    expect(ctx.warnings).toHaveLength(6);
    expect(ctx.warnings.every((w) => w[0] === 'remoteok: skipped a malformed posting')).toBe(true);
  });

  it.each([
    ['an object', { error: 'nope' }],
    ['a string', '"maintenance"'],
    ['null', 'null'],
  ])('throws a parse error when the payload is %s', async (_label, body) => {
    await expect(remoteokSource.fetchFeed!(testContext(serve(body)))).rejects.toMatchObject({ kind: 'parse' });
  });

  it('throws a parse error on invalid JSON', async () => {
    await expect(remoteokSource.fetchFeed!(testContext(serve('<html>oops')))).rejects.toBeInstanceOf(SourceError);
  });

  it.each([
    [429, 'rate-limited'],
    [404, 'not-found'],
    [403, 'blocked'],
    [500, 'http'],
  ])('propagates HTTP %i as %s', async (status, kind) => {
    await expect(remoteokSource.fetchFeed!(testContext(serve('', status)))).rejects.toMatchObject({ kind, status });
  });

  it('does not make a request once the sync was cancelled', async () => {
    const http = serve(readFixture('remoteok', 'list.json'));
    const controller = new AbortController();
    controller.abort();
    await expect(remoteokSource.fetchFeed!({ ...testContext(http), signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(http.requests).toHaveLength(0);
  });
});
