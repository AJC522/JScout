import { describe, expect, it, vi } from 'vitest';
import { type HiringHeader, hnHiringSource, parseHiringHeader } from './hn-hiring';
import { type FakeRoute, fakeHttp, readJsonFixture, testContext } from './testing';
import { type SourceContext, SourceError } from './types';

interface Envelope {
  hits: Array<Record<string, unknown>>;
  nbHits: number;
  nbPages: number;
  page: number;
  hitsPerPage: number;
  exhaustiveNbHits?: boolean;
  [key: string]: unknown;
}

const NOV = '50338728';
const OCT = '49922569';
const stories = () => readJsonFixture<Envelope>('hn-hiring', 'stories.json');
const novThread = () => readJsonFixture<Envelope>('hn-hiring', 'thread-50338728.json');
const octThread = () => readJsonFixture<Envelope>('hn-hiring', 'thread-49922569.json');

const storiesRoute = (body: unknown = stories(), extra: Partial<FakeRoute> = {}): FakeRoute => ({
  match: '/api/v1/search_by_date?',
  body,
  ...extra,
});
const threadRoute = (id: string, body: unknown, page?: number, extra: Partial<FakeRoute> = {}): FakeRoute => ({
  match: (url) => {
    const q = new URL(url).searchParams;
    return url.includes('/api/v1/search?') && q.get('tags') === `comment,story_${id}` && (page === undefined || q.get('page') === String(page));
  },
  body,
  ...extra,
});

function withLogSpies(ctx: SourceContext) {
  const warn = vi.fn();
  const info = vi.fn();
  ctx.log = { ...ctx.log, warn, info };
  return { warn, info };
}

async function fetchFeed(routes: FakeRoute[]) {
  const http = fakeHttp(routes);
  const ctx = testContext(http);
  const spies = withLogSpies(ctx);
  const result = await hnHiringSource.fetchFeed!(ctx);
  return { http, result, ...spies };
}

/** A thread envelope of `count` top-level comments, cloned from a real one with fresh ids. */
function bigThread(count: number): Envelope {
  const env = novThread();
  const template = env.hits[0] ?? {};
  env.hits = Array.from({ length: count }, (_, i) => ({ ...template, objectID: String(60_000_000 + i) }));
  env.nbHits = count;
  return env;
}

describe('hn-hiring definition', () => {
  it('describes the source truthfully', () => {
    expect(hnHiringSource.def).toMatchObject({
      id: 'hn-hiring',
      kind: 'community',
      mode: 'feed',
      perCompany: false,
      fullSnapshot: true,
      defaultEnabled: true,
      defaultTtlMinutes: 360,
      minRequestIntervalMs: 1500,
      configFields: [],
    });
    expect(hnHiringSource.def.attribution).toMatch(/Hacker News/);
    expect(hnHiringSource.def.description).toMatch(/Who is hiring/);
  });
});

describe('hn-hiring fetchFeed', () => {
  it('finds the latest thread, adds the previous one while it is thin, and requests exactly what is needed', async () => {
    const { http, result } = await fetchFeed([storiesRoute(), threadRoute(NOV, novThread()), threadRoute(OCT, octThread())]);

    expect(http.requests.map((r) => r.url)).toEqual([
      'https://hn.algolia.com/api/v1/search_by_date?tags=story%2Cauthor_whoishiring&hitsPerPage=12&attributesToRetrieve=title%2Ccreated_at_i%2Cnum_comments&attributesToHighlight=title',
      `https://hn.algolia.com/api/v1/search?tags=comment%2Cstory_${NOV}&numericFilters=parent_id%3D${NOV}&hitsPerPage=1000&page=0&attributesToRetrieve=author%2Ccomment_text%2Ccreated_at_i%2Cparent_id%2Cstory_id&attributesToHighlight=author`,
      `https://hn.algolia.com/api/v1/search?tags=comment%2Cstory_${OCT}&numericFilters=parent_id%3D${OCT}&hitsPerPage=1000&page=0&attributesToRetrieve=author%2Ccomment_text%2Ccreated_at_i%2Cparent_id%2Cstory_id&attributesToHighlight=author`,
    ]);
    for (const req of http.requests) {
      expect(req.method).toBe('GET');
      expect(req.options.minIntervalMs).toBe(1500);
    }

    // 10 November comments (2 are not job posts) + 3 October ones.
    expect(result.postings.map((p) => p.externalId)).toEqual([
      '50518905', '50483905', '50466168', '50424162', '50398420', '50349615', '50340287', '50339895',
      '49991656', '49982803', '49968954',
    ]);
    expect(result.complete).toBe(true);
    expect(result.notModified).toBeUndefined();
  });

  it('maps every field of real comments', async () => {
    const { result } = await fetchFeed([storiesRoute(), threadRoute(NOV, novThread()), threadRoute(OCT, octThread())]);
    const byId = new Map(result.postings.map((p) => [p.externalId, p]));
    const raw = new Map(novThread().hits.map((h) => [h.objectID, h.comment_text]));

    expect(byId.get('50518905')).toEqual({
      externalId: '50518905',
      url: 'https://news.ycombinator.com/item?id=50518905',
      applyUrl: 'https://idealjob.app/jobs/outgoing/1?utm_source=hackernews&utm_campaign=whoishiring',
      title: 'Software Engineer',
      company: 'outGoing',
      locations: ['Lisbon, Portugal'],
      remote: 'hybrid',
      descriptionHtml: raw.get('50518905'),
      postedAt: 1794844175,
      salary: { text: '€25k–€35k + meal allowance + health insurance' },
    });
    expect(byId.get('50518905')?.descriptionHtml).toMatch(/^outGoing \| Software Engineer \| Lisbon, Portugal \| HYBRID/);

    // Pipes, "Remote or onsite", a salary in the employment segment, a bare domain that is not a link.
    expect(byId.get('50483905')).toMatchObject({
      company: 'Bechtel',
      title: 'Penetration Tester',
      locations: ['Remote or onsite (US + many countries)'],
      remote: 'remote',
      salary: { text: 'Full-time <$145k' },
      employmentType: 'Full-time <$145k',
      applyUrl: 'https://bechtel.jobs.hr.cloud.sap/job-invite/300797/',
    });

    // Header has no role: the roles listed in the body are used. The header's link is the apply URL.
    expect(byId.get('50398420')).toMatchObject({
      company: 'Prior Labs',
      title: 'Infrastructure Engineer, ML Engineer, Backend, Full Stack Developer',
      locations: ['Berlin, Freiburg, NYC'],
      remote: 'onsite',
      employmentType: 'Full-time',
      applyUrl: 'https://priorlabs.ai/',
    });
    expect(byId.get('50398420')).not.toHaveProperty('salary');

    // " - " separators and the work mode inside the role.
    expect(byId.get('50349615')).toMatchObject({ company: 'UNICEF', title: 'backend dev', locations: [], remote: 'remote' });

    // A place first, then the company.
    expect(byId.get('50339895')).toMatchObject({
      company: 'UMH',
      title: 'Product Engineer',
      locations: ['Cologne, Germany'],
      remote: 'hybrid',
      salary: { text: '70k - 100k EUR' },
    });

    // "(YC S20)" is not part of the name; two roles in one segment stay together.
    expect(byId.get('50424162')).toMatchObject({
      company: 'Seal',
      title: 'Forward Deployed Engineer, Founding Product Engineer',
      locations: ['London'],
      remote: 'onsite',
      salary: { text: '£50k–£120k + equity' },
    });

    // From the previous thread: newline-separated header; " — " separators with a place in parentheses.
    expect(byId.get('49968954')).toMatchObject({
      company: 'Okta',
      title: 'Senior Product Manager, Auth0 AI and Identity Products (Auth0)',
      locations: ['Toronto, Canada - Hybrid'],
      remote: 'hybrid',
      postedAt: 1791226729,
    });
    expect(byId.get('49991656')).toMatchObject({ company: 'Flowstate', title: 'Founding Engineer', locations: ['London, UK'] });
    expect(byId.get('49991656')).not.toHaveProperty('remote');
  });

  it('skips comments that are not job posts and says how many', async () => {
    const { result, info } = await fetchFeed([storiesRoute(), threadRoute(NOV, novThread()), threadRoute(OCT, octThread())]);
    const ids = result.postings.map((p) => p.externalId);
    expect(ids).not.toContain('50479091'); // "Location: India (currently travelling ...)" — a job seeker
    expect(ids).not.toContain('50348145'); // "update (Nov 20, 2026) - this position has been filled."
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/skipped comments/), { thread: NOV, skipped: 2, of: 10 });
  });

  it('reads only the current thread once it has enough comments', async () => {
    const { http, result } = await fetchFeed([storiesRoute(), threadRoute(NOV, bigThread(150))]);
    expect(http.requests).toHaveLength(2);
    expect(result.postings).toHaveLength(150);
    expect(result.complete).toBe(true);
  });

  it('pages through a thread and is complete only when every page was read', async () => {
    const env = novThread();
    const pageOf = (n: number) => ({ ...env, hits: env.hits.slice(n * 5, n * 5 + 5), page: n, nbPages: 2, hitsPerPage: 5 });
    const { http, result } = await fetchFeed([
      storiesRoute(),
      threadRoute(NOV, pageOf(0), 0),
      threadRoute(NOV, pageOf(1), 1),
      threadRoute(OCT, octThread()),
    ]);
    expect(http.requests.map((r) => new URL(r.url).searchParams.get('page'))).toEqual([null, '0', '1', '0']);
    expect(result.postings).toHaveLength(11);
    expect(result.complete).toBe(true);
  });

  it('keeps the pages read but is incomplete when a later page fails', async () => {
    const env = novThread();
    const { result, warn } = await fetchFeed([
      storiesRoute(),
      threadRoute(NOV, { ...env, hits: env.hits.slice(0, 5), nbPages: 2 }, 0),
      threadRoute(NOV, undefined, 1, { status: 503 }),
      threadRoute(OCT, octThread()),
    ]);
    expect(result.postings.map((p) => p.externalId)).toEqual(['50518905', '50483905', '50466168', '50424162', '49991656', '49982803', '49968954']);
    expect(result.complete).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/page of comments failed/), expect.objectContaining({ page: 1 }));
  });

  it('stops at the page cap and is then incomplete', async () => {
    const env = novThread();
    const { http, result } = await fetchFeed([
      storiesRoute(),
      threadRoute(NOV, { ...env, nbPages: 5, nbHits: 50 }),
      threadRoute(OCT, octThread()),
    ]);
    expect(http.requests.filter((r) => r.url.includes(`story_${NOV}`))).toHaveLength(3);
    expect(result.complete).toBe(false);
    expect(result.postings).toHaveLength(8 + 3); // the repeated pages are de-duplicated
  });

  it('is incomplete when fewer comments arrive than the API counts, or the count is not exhaustive', async () => {
    const short = await fetchFeed([storiesRoute(), threadRoute(NOV, { ...novThread(), nbHits: 12 }), threadRoute(OCT, octThread())]);
    expect(short.result.complete).toBe(false);
    expect(short.result.postings).toHaveLength(11);

    const guess = await fetchFeed([
      storiesRoute(),
      threadRoute(NOV, novThread()),
      threadRoute(OCT, { ...octThread(), exhaustiveNbHits: false, exhaustive: { nbHits: false } }),
    ]);
    expect(guess.result.complete).toBe(false);
  });

  it('returns the current thread, incomplete, when the previous one fails', async () => {
    const { result, warn } = await fetchFeed([storiesRoute(), threadRoute(NOV, novThread()), threadRoute(OCT, undefined, 0, { status: 429 })]);
    expect(result.postings).toHaveLength(8);
    expect(result.complete).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/previous thread failed/), expect.objectContaining({ thread: OCT }));
  });

  it('propagates errors from the story search and the current thread', async () => {
    await expect(fetchFeed([storiesRoute(undefined, { status: 429 })])).rejects.toMatchObject({ kind: 'rate-limited' });
    await expect(fetchFeed([storiesRoute()])).rejects.toMatchObject({ kind: 'not-found' });
    await expect(fetchFeed([storiesRoute(), threadRoute(NOV, undefined, 0, { status: 500 })])).rejects.toMatchObject({
      kind: 'http',
      status: 500,
    });
  });

  it('rejects payloads of the wrong shape', async () => {
    await expect(fetchFeed([storiesRoute({ results: [] })])).rejects.toMatchObject({ kind: 'parse' });
    await expect(fetchFeed([storiesRoute([])])).rejects.toMatchObject({ kind: 'parse' });
    await expect(fetchFeed([storiesRoute(), threadRoute(NOV, { ...novThread(), hits: null })])).rejects.toMatchObject({
      kind: 'parse',
    });
  });

  it('fails clearly when no "Who is hiring?" thread is listed', async () => {
    const onlyHired = { ...stories(), hits: stories().hits.filter((h) => !String(h.title).includes('Who is hiring')) };
    await expect(fetchFeed([storiesRoute(onlyHired)])).rejects.toThrow(/no "Ask HN: Who is hiring\?" thread/);
  });

  it('skips malformed hits, replies and deleted comments; de-duplicates by id', async () => {
    const env = novThread();
    const first = env.hits[0] ?? {};
    env.hits = [
      ...env.hits,
      first, // duplicate
      null,
      'text',
      { ...first, objectID: undefined },
      { ...first, objectID: 'abc' },
      { ...first, objectID: '70000001', comment_text: null }, // deleted
      { ...first, objectID: '70000002', parent_id: 50340000 }, // a reply
      { ...first, objectID: '70000003', created_at_i: undefined },
    ] as Envelope['hits'];
    env.nbHits = env.hits.length;
    const { result, warn } = await fetchFeed([storiesRoute(), threadRoute(NOV, env), threadRoute(OCT, octThread())]);
    const ids = result.postings.map((p) => p.externalId);
    expect(ids.filter((id) => id === '50518905')).toHaveLength(1);
    expect(ids).toContain('70000003');
    expect(ids).not.toContain('70000001');
    expect(ids).not.toContain('70000002');
    expect(result.postings.find((p) => p.externalId === '70000003')).not.toHaveProperty('postedAt');
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledWith('hn-hiring: skipped a malformed comment', expect.objectContaining({ thread: NOV }));
    expect(result.complete).toBe(true);
  });

  it('honours an aborted signal', async () => {
    const http = fakeHttp([storiesRoute(), threadRoute(NOV, novThread())]);
    const ctx = testContext(http);
    const controller = new AbortController();
    controller.abort();
    ctx.signal = controller.signal;
    await expect(hnHiringSource.fetchFeed!(ctx)).rejects.toBeInstanceOf(SourceError);
    expect(http.requests.filter((r) => r.url.includes('story_'))).toHaveLength(0);
  });
});

describe('parseHiringHeader on real headers', () => {
  // First paragraphs of real top-level comments (November and October 2026 threads), as HTML.
  const cases: Array<[string, HiringHeader | null]> = [
    ["outGoing | Software Engineer | Lisbon, Portugal | HYBRID | €25k–€35k + meal allowance + health insurance",
      { company: "outGoing", title: "Software Engineer", locations: ["Lisbon, Portugal"], remote: 'hybrid', salaryText: "€25k–€35k + meal allowance + health insurance" }],
    ["Early-stage Startup | Software Engineer &amp; Data Analyst | Full-Time | REMOTE (US &amp; US Citizen) | $100,000 - $180,000 USD",
      { company: "Early-stage Startup", title: "Software Engineer & Data Analyst", locations: ["REMOTE (US & US Citizen)"], remote: 'remote', salaryText: "$100,000 - $180,000 USD" }],
    ["Common Prefix | Senior Software Engineer | Athens, Greece &#x2F; REMOTE | Full-time | $80k to $160k + equity + bonus",
      { company: "Common Prefix", title: "Senior Software Engineer", locations: ["Athens, Greece / REMOTE"], remote: 'remote', salaryText: "$80k to $160k + equity + bonus" }],
    ["Joulent | AI Engineer, Company Brain | San Francisco | Onsite | Full-time | $175k-$230k base plus bonus and equity",
      { company: "Joulent", title: "AI Engineer, Company Brain", locations: ["San Francisco"], remote: 'onsite', salaryText: "$175k-$230k base plus bonus and equity" }],
    ["Bonfire Analytics | Senior Data Scientist, Staff Data Scientist | New York, NY (FiDi) | ONSITE &#x2F; HYBRID | Full-time | $140K-$225K + 0.05%-0.2% equity",
      { company: "Bonfire Analytics", title: "Senior Data Scientist, Staff Data Scientist", locations: ["New York, NY (FiDi)"], remote: 'hybrid', salaryText: "$140K-$225K + 0.05%-0.2% equity" }],
    ["*Confidential Healthcare AI Startup | Senior Full Stack Engineer (Frontend-Leaning) | NYC | Hybrid (3 days onsite) | Full-Time | $160K–$200K + Equity*",
      { company: "Confidential Healthcare AI Startup", title: "Senior Full Stack Engineer (Frontend-Leaning)", locations: ["NYC"], remote: 'hybrid', salaryText: "$160K–$200K + Equity" }],
    ["Bechtel | Penetration Tester | Remote or onsite (US + many countries) | Full-time &lt;$145k | www.bechtel.com",
      { company: "Bechtel", title: "Penetration Tester", locations: ["Remote or onsite (US + many countries)"], remote: 'remote', salaryText: "Full-time <$145k" }],
    ["Elm AI | Forward-Deployed Product Engineer | New York &#x2F; London (REMOTE US&#x2F;Europe considered) | Full-time",
      { company: "Elm AI", title: "Forward-Deployed Product Engineer", locations: ["New York / London (REMOTE US/Europe considered)"], remote: 'remote' }],
    ["CERN | Machine Learning Engineer | Geneva, Switzerland | HYBRID | Full-time, 3-year contract | From CHF 9,236&#x2F;month, tax-free",
      { company: "CERN", title: "Machine Learning Engineer", locations: ["Geneva, Switzerland"], remote: 'hybrid', salaryText: "From CHF 9,236/month, tax-free" }],
    ["Genentech | 2027 Interns | PD Data Sciences &amp; Analytics | ONSITE (South San Francisco, CA USA)",
      { company: "Genentech", title: "2027 Interns", locations: ["ONSITE (South San Francisco, CA USA)"], remote: 'onsite' }],
    ["Native | Founding Builder-in-Residence | San Francisco (preferred) or London |REMOTE or ONSITE | 3-month contract, $3,000-6,000&#x2F;month | <a href=\"https:&#x2F;&#x2F;withnative.ai\" rel=\"nofollow\">https:&#x2F;&#x2F;withnative.ai</a>",
      { company: "Native", title: "Founding Builder-in-Residence", locations: ["San Francisco (preferred) or London"], remote: 'remote', salaryText: "3-month contract, $3,000-6,000/month" }],
    ["Landlord | AI Engineer | Beaverton, OR | ONSITE | Full-time | $80k + stock options",
      { company: "Landlord", title: "AI Engineer", locations: ["Beaverton, OR"], remote: 'onsite', salaryText: "$80k + stock options" }],
    ["Kroo | Backend Software Engineer | NYC, Hybrid | Full-Time | $175k - $220k + equity + health benefits",
      { company: "Kroo", title: "Backend Software Engineer", locations: ["NYC, Hybrid"], remote: 'hybrid', salaryText: "$175k - $220k + equity + health benefits" }],
    ["Polymath | Founding MTS, Full-Stack | San Francisco | ONSITE (5 days) | $160K–$220K + 0.75%–1.5% equity | <a href=\"https:&#x2F;&#x2F;polymathmade.com\" rel=\"nofollow\">https:&#x2F;&#x2F;polymathmade.com</a>",
      { company: "Polymath", title: "Founding MTS, Full-Stack", locations: ["San Francisco"], remote: 'onsite', salaryText: "$160K–$220K + 0.75%–1.5% equity" }],
    ["Sunsave | Product Engineer (Mid-Level &#x2F; Senior) | London, United Kingdom (Holborn) | ONSITE (hybrid, 3 days&#x2F;week in office) | Full-time",
      { company: "Sunsave", title: "Product Engineer (Mid-Level / Senior)", locations: ["London, United Kingdom (Holborn)"], remote: 'hybrid' }],
    ["Seal (YC S20) | Forward Deployed Engineer, Founding Product Engineer | London | ONSITE | Full-time | £50k–£120k + equity",
      { company: "Seal", title: "Forward Deployed Engineer, Founding Product Engineer", locations: ["London"], remote: 'onsite', salaryText: "£50k–£120k + equity" }],
    ["OpenTrain AI | REMOTE (US) | Part-time | Backend Engineer, AI Coding Task Design",
      { company: "OpenTrain AI", title: "Backend Engineer, AI Coding Task Design", locations: ["REMOTE (US)"], remote: 'remote' }],
    ["Zefr | Los Angeles, CA (Marina del Rey) | Site Reliability Engineer | Full-time | On-site 2-3x per week | $100,000 - $130,000 | <a href=\"https:&#x2F;&#x2F;zefr.com\" rel=\"nofollow\">https:&#x2F;&#x2F;zefr.com</a>",
      { company: "Zefr", title: "Site Reliability Engineer", locations: ["Los Angeles, CA (Marina del Rey)"], remote: 'hybrid', salaryText: "$100,000 - $130,000" }],
    ["Piramidal (YC W24) | Senior Backend Engineer | New York, NY | $200K-$300K + equity | www.piramidal.ai",
      { company: "Piramidal", title: "Senior Backend Engineer", locations: ["New York, NY"], salaryText: "$200K-$300K + equity" }],
    ["UNICEF - REMOTE backend dev - Digital Inclusion Division, Connectivity Credits",
      { company: "UNICEF", title: "backend dev", locations: [], remote: 'remote' }],
    ["Avoca | Full-Stack Engineers + FDEs | ONSITE (NYC,US) | Full-time",
      { company: "Avoca", title: "Full-Stack Engineers + FDEs", locations: ["ONSITE (NYC,US)"], remote: 'onsite' }],
    ["Antithesis | Washington, DC, London | Remote or In Office (US, UK) | Design Engineer",
      { company: "Antithesis", title: "Design Engineer", locations: ["Washington, DC, London","Remote or In Office (US, UK)"], remote: 'remote' }],
    ["Perry | Founding Commercial Hire, Founding Account Executive (US), Product Designer, Legal Engineer | London (and New York for US AE) | ONSITE | Full-time",
      { company: "Perry", title: "Founding Commercial Hire, Founding Account Executive (US), Product Designer, Legal Engineer", locations: ["London (and New York for US AE)"], remote: 'onsite' }],
    ["KSC Trading | Remote or NYC Hybrid | Full-Time | Senior Backend Software Engineer | $200k to $250k USD Total Compensation + Benefits\nKSC Trading is a proprietary algorithmic trading firm founded in 2020. The company creates software to engage in automated trading in sports and prediction markets. The focus has been on statistical arbitrage and liquidity provision. We are currently a team of two, expecting to grow to a team of six over the next year.",
      { company: "KSC Trading", title: "Senior Backend Software Engineer", locations: ["Remote or NYC Hybrid"], remote: 'remote', salaryText: "$200k to $250k USD Total Compensation + Benefits" }],
    ["Spanish National Cancer Research Centre (CNIO) | Madrid, Spain | HYBRID | Systems Administrator (Infra, Storage and Backup) | Full-time, permanent | €45k-65k gross&#x2F;year | Apply by Nov 11",
      { company: "Spanish National Cancer Research Centre", title: "Systems Administrator (Infra, Storage and Backup)", locations: ["Madrid, Spain"], remote: 'hybrid', salaryText: "€45k-65k gross/year" }],
    ["JPMorganChase | Lead Software Engineer | ONSITE (Jersey City, NJ) | $156,750 - $215,000.",
      { company: "JPMorganChase", title: "Lead Software Engineer", locations: ["ONSITE (Jersey City, NJ)"], remote: 'onsite', salaryText: "$156,750 - $215,000." }],
    ["Cologne, Germany | UMH | Product Engineer | Full-time | 70k - 100k EUR | ONSITE (part remote)",
      { company: "UMH", title: "Product Engineer", locations: ["Cologne, Germany"], remote: 'hybrid', salaryText: "70k - 100k EUR" }],
    ["CNH | AI Engineer Intern | Tempe, AZ, USA | ON-SITE | Summer internship (40 hours&#x2F;week, May–August)",
      { company: "CNH", title: "AI Engineer Intern", locations: ["Tempe, AZ, USA"], remote: 'onsite' }],
    ["Kraus Hamdani Aerospace | Software Engineer | REMOTE (US) or ONSITE in Reno, NV",
      { company: "Kraus Hamdani Aerospace", title: "Software Engineer", locations: ["REMOTE (US) or ONSITE in Reno, NV"], remote: 'remote' }],
    ["Simple Analytics | DevOps Engineer | REMOTE (worldwide, any timezone) | Full-time, 32h, 24h possible | €5,000&#x2F;month (full-time) | <a href=\"https:&#x2F;&#x2F;www.simpleanalytics.com&#x2F;jobs&#x2F;devops\" rel=\"nofollow\">https:&#x2F;&#x2F;www.simpleanalytics.com&#x2F;jobs&#x2F;devops</a>",
      { company: "Simple Analytics", title: "DevOps Engineer", locations: ["REMOTE (worldwide, any timezone)"], remote: 'remote', salaryText: "€5,000/month (full-time)" }],
    ["Hatch | Staff Backend Engineer | REMOTE (US&#x2F;Canada, Pacific Time hours) | Full-time | <a href=\"https:&#x2F;&#x2F;hatch.co\" rel=\"nofollow\">https:&#x2F;&#x2F;hatch.co</a>",
      { company: "Hatch", title: "Staff Backend Engineer", locations: ["REMOTE (US/Canada, Pacific Time hours)"], remote: 'remote' }],
    ["ArtCraft | Senior Engineers | SF (Onsite) &#x2F; Atlanta (Onsite) | $150-$250k + Equity | <a href=\"https:&#x2F;&#x2F;getartcraft.com\" rel=\"nofollow\">https:&#x2F;&#x2F;getartcraft.com</a>",
      { company: "ArtCraft", title: "Senior Engineers", locations: ["SF (Onsite) / Atlanta (Onsite)"], remote: 'onsite', salaryText: "$150-$250k + Equity" }],
    ["Flowstate (London, UK) — Founding Engineer — TypeScript &#x2F; React &#x2F; Postgres &#x2F; AI",
      { company: "Flowstate", title: "Founding Engineer", locations: ["London, UK"] }],
    ["depproof | Part-time B2B Sales Lead | REMOTE (US) | Part-time | Equity + commission | <a href=\"https:&#x2F;&#x2F;depproof.com\" rel=\"nofollow\">https:&#x2F;&#x2F;depproof.com</a>",
      { company: "depproof", title: "Part-time B2B Sales Lead", locations: ["REMOTE (US)"], remote: 'remote' }],
    ["Okta (Auth0)\nSenior Product Manager, Auth0 AI and Identity Products (Auth0)\nToronto, Canada - Hybrid\nI am a Recruiter at Okta\nActively hiring",
      { company: "Okta", title: "Senior Product Manager, Auth0 AI and Identity Products (Auth0)", locations: ["Toronto, Canada - Hybrid"], remote: 'hybrid' }],
    ["Location: India (currently travelling within India; IST, UTC+5:30)",
      null],
    ["SEEKING FREELANCE - Egypt (UTC+2, full EU&#x2F;UK overlap) - Remote",
      null],
    ["update (Nov 20, 2026) - this position has been filled.",
      null],
    ["I&#x27;m Rajneesh Verma, a Full-Stack &amp; AI Engineer currently working with a YC-backed startup. I have hands-on experience building and shipping production-ready applications, scalable backend systems, APIs, and AI-powered products.",
      null],
    ["Hey HN! We’re building ThunderTruck™, the operating system for local food—connecting mobile food vendors and brick-and-mortar storefronts with nearby customers and a dedicated e-scooter&#x2F;flatbed courier fleet.",
      null],
    ["Head of Global GTM + Regional Sales Partners | REMOTE (worldwide) | Commission based",
      null],
    ["*Software Engineer — Remote — US Only* - US Work Authorization Required",
      null],
  ];

  it.each(cases)('%s', (header, expected) => {
    const parsed = parseHiringHeader(header);
    if (expected === null) {
      expect(parsed).toBeNull();
      return;
    }
    expect(parsed).toMatchObject(expected);
    if (!expected.remote) expect(parsed?.remote).toBeUndefined();
    if (!expected.salaryText) expect(parsed?.salaryText).toBeUndefined();
  });

  it('covers at least 30 real headers', () => {
    expect(cases.filter(([, e]) => e !== null).length).toBeGreaterThanOrEqual(30);
  });

  it('decodes entities and reads links in the header', () => {
    expect(
      parseHiringHeader(
        'Acme &amp; Sons | <a href="https:&#x2F;&#x2F;acme.example&#x2F;jobs" rel="nofollow">https:&#x2F;&#x2F;acme.example&#x2F;jobs</a> | Data Engineer | no remote, ONSITE in Denver, CO',
      ),
    ).toEqual({ company: 'Acme & Sons', title: 'Data Engineer', locations: ['no remote, ONSITE in Denver, CO'], remote: 'onsite' });
  });

  it('names the company after the host when the first field is only a link', () => {
    expect(parseHiringHeader('<a href="https:&#x2F;&#x2F;www.acme.example">x</a> | Staff Engineer | REMOTE')).toMatchObject({
      company: 'acme.example',
      title: 'Staff Engineer',
      remote: 'remote',
    });
  });
});
