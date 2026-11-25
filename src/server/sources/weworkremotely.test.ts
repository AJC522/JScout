import { describe, expect, it } from 'vitest';
import { weworkremotelySource } from './weworkremotely';
import { type FakeRoute, fakeHttp, readFixture, testContext } from './testing';
import { type RawPosting, type SourceContext, SourceError } from './types';

const CATEGORIES: [name: string, slug: string][] = [
  ['Back-End Programming', 'remote-back-end-programming-jobs'],
  ['Front-End Programming', 'remote-front-end-programming-jobs'],
  ['Full-Stack Programming', 'remote-full-stack-programming-jobs'],
  ['DevOps and Sysadmin', 'remote-devops-sysadmin-jobs'],
  ['Design', 'remote-design-jobs'],
  ['Product', 'remote-product-jobs'],
  ['Customer Support', 'remote-customer-support-jobs'],
  ['Sales and Marketing', 'remote-sales-and-marketing-jobs'],
  ['Management and Finance', 'remote-management-and-finance-jobs'],
  ['All Other Remote', 'all-other-remote-jobs'],
];

const feedUrl = (slug: string) => `https://weworkremotely.com/categories/${slug}.rss`;

const BACK_END = readFixture('weworkremotely', 'feed-category-back-end-programming.xml');
const DESIGN = readFixture('weworkremotely', 'feed-category-design.xml');

/** A valid channel with no items. */
function emptyChannel(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>We Work Remotely: ${name} Jobs</title>\n    <ttl>60</ttl>\n  </channel>\n</rss>\n`;
}

/** A captured feed served as another category's feed (only the channel title is changed). */
function retitled(xml: string, name: string): string {
  return xml.replace(/<title>[^<]*<\/title>/, `<title>We Work Remotely: ${name} Jobs</title>`);
}

/** Routes for all ten category feeds: the two captured ones, empty channels elsewhere, plus overrides. */
function serveAll(overrides: Record<string, Omit<FakeRoute, 'match'>> = {}) {
  const bodies: Record<string, string> = {
    'Back-End Programming': BACK_END,
    Design: DESIGN,
  };
  return fakeHttp(
    CATEGORIES.map(([name, slug]) => ({
      match: (url: string) => url === feedUrl(slug),
      body: bodies[name] ?? emptyChannel(name),
      ...overrides[name],
    })),
  );
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

describe('weworkremotely definition', () => {
  it('describes a per-category RSS feed', () => {
    expect(weworkremotelySource.def).toMatchObject({
      id: 'weworkremotely',
      name: 'We Work Remotely',
      kind: 'board',
      mode: 'feed',
      homepage: 'https://weworkremotely.com',
      perCompany: false,
      configFields: [],
      defaultEnabled: true,
      defaultTtlMinutes: 180,
      fullSnapshot: true,
      minRequestIntervalMs: 2000,
    });
    expect(weworkremotelySource.def.attribution).toMatch(/We Work Remotely/);
    expect(weworkremotelySource.def.description).toMatch(/public per-category RSS feeds/);
  });
});

describe('weworkremotely fetchFeed', () => {
  it('reads all ten category feeds in order, sequentially paced, and returns a complete result', async () => {
    const http = serveAll();
    const controller = new AbortController();
    const result = await weworkremotelySource.fetchFeed!({ ...testContext(http), signal: controller.signal });

    expect(http.requests.map((r) => r.url)).toEqual(CATEGORIES.map(([, slug]) => feedUrl(slug)));
    for (const request of http.requests) {
      expect(request.method).toBe('GET');
      expect(request.options).toMatchObject({ minIntervalMs: 2000, maxBytes: 10 * 1024 * 1024, signal: controller.signal });
      expect(request.options.headers?.accept).toMatch(/^application\/rss\+xml/);
      // The ETag changes on every response, so no validators are sent.
      expect(request.options.etag).toBeUndefined();
      expect(request.options.lastModified).toBeUndefined();
    }
    expect(result.complete).toBe(true);
    expect(result.notModified).toBeUndefined();
    expect(result.cursor).toBeUndefined();
    // 8 back-end items (one duplicate-guid pair merged) + 4 design items.
    expect(result.postings).toHaveLength(11);
  });

  it('maps every field of a posting', async () => {
    const { postings } = await weworkremotelySource.fetchFeed!(testContext(serveAll()));
    const { descriptionHtml, ...rest } = byId(postings, 'vertican-senior-applied-ai-engineer-document-intelligence');
    expect(rest).toEqual({
      externalId: 'vertican-senior-applied-ai-engineer-document-intelligence',
      url: 'https://weworkremotely.com/remote-jobs/vertican-senior-applied-ai-engineer-document-intelligence',
      title: 'Senior Applied AI Engineer, Document Intelligence',
      company: 'Vertican',
      companyUrl: 'https://vertican.com',
      companyLogo: 'https://wwr-pro.s3.amazonaws.com/logos/0171/6696/logo.gif',
      // Countries only: the HQ "New Jersey, USA" is the company's address, and the region is the default.
      locations: ['Bolivia (Plurinational State of)', 'Brazil', 'Chile', 'Colombia', 'Peru', 'Uruguay'],
      remote: 'remote',
      postedAt: 'Thu, 05 Nov 2026 17:12:27 +0000',
      expiresAt: 'Sat, 05 Dec 2026 17:12:27 +0000',
      employmentType: 'Full-Time',
      tags: ['Back-End Programming', 'Python', 'Large Language Models (LLMs)', 'Agentic AI'],
    });
    // XML entities decoded exactly once; the HTML (including WWR's header and footer) is otherwise as given.
    expect(descriptionHtml).toMatch(
      /^<img src="https:\/\/we-work-remotely\.imgix\.net\/logos\/0171\/6696\/logo\.gif\?ixlib=rails-4\.0\.0&w=50&h=50/,
    );
    expect(descriptionHtml).toContain('<strong>Headquarters:</strong> New Jersey, USA');
    expect(descriptionHtml).toMatch(
      /<p><strong>To apply:<\/strong> <a href="https:\/\/weworkremotely\.com\/remote-jobs\/vertican-senior-applied-ai-engineer-document-intelligence">[^<]*<\/a><\/p>$/,
    );
  });

  it('splits "Company: Role" at the first ": " and builds locations from country, HQ and region', async () => {
    const { postings } = await weworkremotelySource.fetchFeed!(testContext(serveAll()));

    expect(byId(postings, 'gitlab-backend-engineer-python-ai-engineering-agent-foundations')).toMatchObject({
      company: 'GitLab',
      title: 'Backend Engineer (Python),AI Engineering: Agent Foundations',
      locations: [
        'Canada',
        'Poland',
        'United Kingdom of Great Britain and Northern Ireland',
        'Remote, Canada; Remote, Poland; Remote, United Kingdom',
      ],
    });
    expect(byId(postings, 'stripe-backend-engineer-developer-end-user-experience-platform')).toMatchObject({
      company: 'Stripe',
      title: 'Backend Engineer, Developer & End-user Experience Platform',
      locations: ['Toronto Canada, San Francisco, Remote in US, Remote in Canada'],
      companyUrl: undefined,
      companyLogo: undefined,
    });

    // Contract, logo, company URL, a junk HQ (the company name) and the company's <state> — neither is a location.
    const elvoro = byId(postings, 'elvoro-ai-creative-engineer-social-media');
    expect(elvoro).toMatchObject({
      company: 'Elvoro',
      title: 'AI Creative Engineer (Social Media)',
      employmentType: 'Contract',
      companyUrl: 'https://elvoro.com/',
      companyLogo: 'https://wwr-pro.s3.amazonaws.com/logos/0171/6817/logo.gif',
      locations: ['Anywhere in the World'],
      tags: [
        'Back-End Programming', 'Digital Marketing', 'Google Cloud', 'JavaScript', 'Marketing', 'Marketing Automation',
        'Python', 'Social Media Marketing', 'SQL', 'Social Media Ads', 'Social Media Content', 'GitHub', 'REST APIs',
      ],
    });

    // A 74-country eligibility list is passed on in full, flags removed, multi-word names intact.
    const lemon = byId(postings, 'lemon-io-senior-magento-developer').locations;
    expect(lemon).toHaveLength(74);
    expect(lemon.slice(0, 3)).toEqual(['Andorra', 'United Arab Emirates', 'Albania']);
    expect(lemon).toContain('Bosnia and Herzegovina');
    expect(lemon.every((l) => !/\p{Regional_Indicator}|,|^and /u.test(l))).toBe(true);

    const design = postings.filter((p) => p.tags?.[0] === 'Design');
    expect(design.map((p) => [p.company, p.title])).toEqual([
      ['Lightbox Animation', 'Sets&Props Concept Artist Internship'],
      ['No Sweat Work Media', 'Remote High-End Automotive AI Retoucher | South Africa | R700 per hour or project fee | Ad hoc work in 2027'],
      ['MapTiler', 'Head of Design | Maps Platform (Remote in Europe)'], // "MapTiler:  Head…" (two spaces)
      ['Seat Geek', 'Senior UX Designer'],
    ]);
    expect(design[0]).toMatchObject({
      locations: ['Europe Only'],
      tags: ['Design', 'Problem Solving', 'Architecture', 'Color Theory', 'Storytelling', 'Composition'],
    });
    expect(design[1]!.locations).toEqual(['Africa Only']);
    expect(design[1]!.companyLogo).toMatch(/^https:\/\/wwr-pro\.s3\.amazonaws\.com\/logos\//);
    expect(design[2]!.locations).toHaveLength(45);
    expect(design[2]!.tags).toEqual(['Design', 'UI/UX Design', 'Artificial Intelligence (AI)', 'Team Management']);
    // HQ "Remote" mentions remote, so it is kept as a location string.
    expect(design[3]).toMatchObject({ locations: ['United States of America', 'Remote'], tags: ['Design', 'UI/UX Design'] });
  });

  it('merges postings that share a guid, combining their locations', async () => {
    const { postings } = await weworkremotelySource.fetchFeed!(testContext(serveAll()));
    const reddit = postings.filter((p) => p.externalId === 'reddit-engineering-manager-ads-product-catalogs');
    expect(reddit).toHaveLength(1);
    expect(reddit[0]).toMatchObject({
      company: 'Reddit',
      title: 'Engineering Manager, Ads Product Catalogs',
      locations: ['Remote - The Netherlands', 'Remote - United Kingdom'],
    });
    expect(reddit[0]!.descriptionHtml).toContain('Remote - The Netherlands'); // the first item's description
  });

  it('merges duplicates within and across category feeds (all-jobs capture served as a category)', async () => {
    const all = readFixture('weworkremotely', 'feed-all.xml');
    const http = serveAll({
      'All Other Remote': { body: retitled(all, 'All Other Remote') },
      Product: { body: retitled(DESIGN, 'Product') }, // the same four design items again
    });
    const { postings, complete } = await weworkremotelySource.fetchFeed!(testContext(http));
    expect(complete).toBe(true);
    expect(postings).toHaveLength(11 + 7); // 8 items with one Sezzle pair; design items not duplicated
    expect(new Set(postings.map((p) => p.externalId)).size).toBe(postings.length);

    expect(byId(postings, 'sezzle-executive-recruiter').locations).toEqual(['Mexico', 'Mexico, Remote', 'Brazil', 'Brazil, Remote']);
    expect(byId(postings, 'airbnb-senior-software-engineer-guest-host')).toMatchObject({
      company: 'Airbnb',
      title: 'Senior Software Engineer Guest & Host',
      locations: ['United States of America', 'Remote, USA'],
      tags: ['Full-Stack Programming'],
    });
    expect(byId(postings, 'oddball-lead-integration-architect')).toMatchObject({
      locations: ['USA Only'], // empty HQ
      companyUrl: 'https://www.oddball.io',
      tags: ['Management and Finance', 'AWS', 'Java', 'Agile', 'API Design'],
    });
    expect(byId(postings, 'omni-interactions-us-only-learn-on-your-time-customer-support-16-hour-weekly-pay-1')).toMatchObject({
      title: 'US ONLY! Learn on your time!! - Customer Support! $16+/hour - Weekly Pay',
      employmentType: 'Contract',
      locations: ['United States of America'], // <state>Texas</state> and HQ "Texas" are not job locations
      companyUrl: expect.stringMatching(/^https:\/\/us-3\.fountain\.com\/omni\/apply\/.*\?utm_source=WWR$/),
    });
    // "$16+/hour" in the title is left to the central salary parser.
    expect(postings.every((p) => p.salary === undefined)).toBe(true);
    expect(byId(postings, 'gusto-inc-staff-product-designer')).toMatchObject({
      company: 'Gusto, Inc.',
      locations: [
        'Atlanta, GA - Hybrid; Denver, CO - Hybrid; New York, NY - Hybrid; San Francisco, CA - Hybrid; Toronto, Ontario - Remote',
      ],
      remote: 'remote',
    });
  });

  it('tolerates the old item schema (no type, country, skills or expiry)', async () => {
    const legacy = readFixture('weworkremotely', 'feed-legacy-remote-programming-jobs.xml');
    const http = serveAll({ 'Front-End Programming': { body: retitled(legacy, 'Front-End Programming') } });
    const { postings } = await weworkremotelySource.fetchFeed!(testContext(http));
    expect(byId(postings, 'yooli-full-time-software-engineer-position-react-and-rest-1')).toMatchObject({
      company: 'Yooli',
      title: 'FULL TIME: Software Engineer Position - React and Rest',
      employmentType: undefined,
      expiresAt: undefined,
      postedAt: 'Wed, 05 Aug 2026 05:52:46 +0000',
    });
    expect(byId(postings, 'simpletiger-web-developer-wordpress-hubspot-u-s-based-remote-contractor')).toMatchObject({
      company: 'SimpleTiger',
      title: 'Web Developer: WordPress & HubSpot (U.S. Based, Remote Contractor)',
    });
    expect(byId(postings, 'crazy-maple-studio-screenwriter-reelshort-contractor').locations).toEqual(['USA Only']);
    // Vertican appears in both the back-end feed and here: still one posting, first copy kept.
    expect(byId(postings, 'vertican-senior-applied-ai-engineer-document-intelligence').employmentType).toBe('Full-Time');
  });

  it('skips malformed items with a warning', async () => {
    const item = (inner: string) => `<item>${inner}</item>`;
    const ok = (slug: string, title: string) =>
      item(`<title>${title}</title><region>USA Only</region><category>Product</category><guid>https://weworkremotely.com/remote-jobs/${slug}</guid><link>https://weworkremotely.com/remote-jobs/${slug}</link>`);
    const body = emptyChannel('Product').replace(
      '<ttl>60</ttl>',
      [
        ok('acme-pm', 'Acme: Product Manager'),
        ok('no-company', 'Product Manager without a company prefix'),
        ok('blank-company', ': Product Manager'),
        ok('blank-role', 'Acme: '),
        item('<title>Acme: No link</title>'),
        item('<title>Acme: Bad link</title><link>javascript:alert(1)</link>'),
        ok('acme-designer', 'Acme: Designer &amp; Researcher'),
      ].join('\n'),
    );
    const ctx = recordingContext(serveAll({ Product: { body } }));
    const result = await weworkremotelySource.fetchFeed!(ctx);
    expect(result.complete).toBe(true);
    expect(byId(result.postings, 'acme-pm')).toMatchObject({ company: 'Acme', title: 'Product Manager', locations: ['USA Only'] });
    expect(byId(result.postings, 'acme-designer').title).toBe('Designer & Researcher');
    expect(result.postings.some((p) => ['no-company', 'blank-company', 'blank-role'].includes(p.externalId))).toBe(false);
    expect(ctx.warnings).toHaveLength(5);
    expect(ctx.warnings.every((w) => w[0] === 'weworkremotely: skipped a malformed posting')).toBe(true);
    expect(ctx.warnings[0]![1]).toMatchObject({ category: 'Product', index: 1 });
  });

  describe('partial failures', () => {
    it('returns what was fetched as incomplete when a category fails, and says which', async () => {
      const ctx = recordingContext(
        serveAll({
          Design: { status: 404, body: '' },
          // An unknown slug answers 301 with no Location header; the client hands back the 301.
          Product: { status: 301, body: '' },
        }),
      );
      const result = await weworkremotelySource.fetchFeed!(ctx);
      expect(result.complete).toBe(false);
      expect(result.postings).toHaveLength(7); // back-end only
      expect(ctx.warnings).toHaveLength(1);
      expect(ctx.warnings[0]![1]).toMatchObject({
        failed: [
          { category: 'Design', kind: 'not-found', status: 404 },
          { category: 'Product', kind: 'http', status: 301 },
        ],
        notFetched: [],
      });
    });

    it.each([
      ['a non-RSS document', '<?xml version="1.0"?><feed><title>x</title></feed>'],
      ['an empty body', ''],
      ['another feed (wrong channel title)', readFixture('weworkremotely', 'feed-all.xml')],
    ])('treats %s as a failed category', async (_label, body) => {
      const ctx = recordingContext(serveAll({ 'Customer Support': { body } }));
      const result = await weworkremotelySource.fetchFeed!(ctx);
      expect(result.complete).toBe(false);
      expect(result.postings).toHaveLength(11);
      expect(ctx.warnings[0]![1]).toMatchObject({ failed: [{ category: 'Customer Support', kind: 'parse' }] });
    });

    it('stops at a rate limit and returns the categories fetched before it', async () => {
      const http = serveAll({ 'Full-Stack Programming': { status: 429, body: '' } });
      const ctx = recordingContext(http);
      const result = await weworkremotelySource.fetchFeed!(ctx);
      expect(http.requests.map((r) => r.url)).toEqual(CATEGORIES.slice(0, 3).map(([, slug]) => feedUrl(slug)));
      expect(result.complete).toBe(false);
      expect(result.postings).toHaveLength(7);
      expect(ctx.warnings[0]![1]).toMatchObject({
        failed: [{ category: 'Full-Stack Programming', kind: 'rate-limited' }],
        notFetched: CATEGORIES.slice(3).map(([name]) => name),
      });
    });

    it('stops at a bot challenge, whether it comes as a 403 or as a 200 HTML page', async () => {
      const challenge = readFixture('weworkremotely', 'error-cloudflare-challenge-403.html');
      for (const status of [403, 200]) {
        const http = serveAll({ 'Front-End Programming': { status, body: challenge } });
        const ctx = recordingContext(http);
        const result = await weworkremotelySource.fetchFeed!(ctx);
        expect(http.requests).toHaveLength(2);
        expect(result.complete).toBe(false);
        expect(ctx.warnings[0]![1]).toMatchObject({ failed: [{ category: 'Front-End Programming', kind: 'blocked' }] });
      }
    });

    it('throws when every category fails', async () => {
      const http = fakeHttp([]); // every URL is a 404
      await expect(weworkremotelySource.fetchFeed!(testContext(http))).rejects.toMatchObject({ kind: 'not-found' });
      expect(http.requests).toHaveLength(10);
    });

    it('throws a parse error when no category feed is RSS', async () => {
      const http = fakeHttp([{ match: /weworkremotely\.com/, body: '{"not":"xml"}' }]);
      const promise = weworkremotelySource.fetchFeed!(testContext(http));
      await expect(promise).rejects.toBeInstanceOf(SourceError);
      await expect(promise).rejects.toMatchObject({ kind: 'parse' });
    });

    it('throws the rate limit when the first request is refused', async () => {
      const http = serveAll({ 'Back-End Programming': { status: 429, body: '' } });
      await expect(weworkremotelySource.fetchFeed!(testContext(http))).rejects.toMatchObject({ kind: 'rate-limited' });
      expect(http.requests).toHaveLength(1);
    });

    it('does not vouch for a board where every category is empty', async () => {
      const ctx = recordingContext(
        serveAll({ 'Back-End Programming': { body: emptyChannel('Back-End Programming') }, Design: { body: emptyChannel('Design') } }),
      );
      const result = await weworkremotelySource.fetchFeed!(ctx);
      expect(result).toEqual({ postings: [], complete: false });
      expect(ctx.warnings).toHaveLength(1);
    });
  });

  describe('cancellation', () => {
    it('makes no request when already cancelled', async () => {
      const http = serveAll();
      const controller = new AbortController();
      controller.abort();
      await expect(weworkremotelySource.fetchFeed!({ ...testContext(http), signal: controller.signal })).rejects.toMatchObject({
        kind: 'aborted',
      });
      expect(http.requests).toHaveLength(0);
    });

    it('stops between categories when cancelled mid-sync', async () => {
      const controller = new AbortController();
      const inner = serveAll();
      const http = {
        ...inner,
        getText: async (...args: Parameters<typeof inner.getText>) => {
          const res = await inner.getText(...args);
          if (inner.requests.length === 2) controller.abort();
          return res;
        },
      };
      await expect(weworkremotelySource.fetchFeed!({ ...testContext(http), signal: controller.signal })).rejects.toMatchObject({
        kind: 'aborted',
      });
      expect(inner.requests).toHaveLength(2);
    });

    it('rethrows an aborted request instead of counting it as a failed category', async () => {
      const http = serveAll({ Design: { error: new SourceError('aborted', 'Request aborted') } });
      await expect(weworkremotelySource.fetchFeed!(testContext(http))).rejects.toMatchObject({ kind: 'aborted' });
    });
  });
});
