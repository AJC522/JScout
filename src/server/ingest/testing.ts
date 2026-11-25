/**
 * Test support for ingest: every source adapter run against its captured
 * fixtures through fakeHttp, so normalisation can be checked on real data.
 * Used by normalize.test.ts and by ad-hoc data-quality scripts; not by the app.
 */
import { arbeitnowSource } from '../sources/arbeitnow';
import { ashbySource } from '../sources/ashby';
import { governmentjobsSource } from '../sources/governmentjobs';
import { greenhouseSource } from '../sources/greenhouse';
import { himalayasSource } from '../sources/himalayas';
import { hnHiringSource } from '../sources/hn-hiring';
import { jobicySource } from '../sources/jobicy';
import { leverSource } from '../sources/lever';
import { remoteokSource } from '../sources/remoteok';
import { remotiveSource } from '../sources/remotive';
import { smartrecruitersSource } from '../sources/smartrecruiters';
import { type FakeRoute, fakeHttp, readFixture, readJsonFixture, testContext } from '../sources/testing';
import type { BoardRef, JobSource, RawPosting, UpstreamQuery } from '../sources/types';
import { usajobsSource } from '../sources/usajobs';
import { weworkremotelySource } from '../sources/weworkremotely';
import { workingnomadsSource } from '../sources/workingnomads';
import { feedKeyFor } from './normalize';

/** The clock the adapters run with (the fixtures were captured around this time). */
export const FIXTURE_NOW = new Date('2026-11-24T12:00:00Z');
/** The government sources' and SmartRecruiters' fixtures were captured a day later. */
const CAPTURED_NOV_25 = new Date('2026-11-25T15:00:00Z');

export interface FixtureFeed {
  source: JobSource;
  board?: BoardRef;
  feedKey: string;
  postings: RawPosting[];
  /** The clock the adapter ran with, when its fixtures were captured on another day than FIXTURE_NOW. */
  now?: Date;
}

interface Scenario {
  source: JobSource;
  board?: BoardRef;
  routes: () => FakeRoute[];
  /** Search-mode sources run this query instead of fetchFeed. */
  search?: UpstreamQuery;
  config?: Record<string, string>;
  /** The adapter's clock, when its fixtures were captured on another day than FIXTURE_NOW. */
  now?: Date;
}

type Envelope = Record<string, unknown> & { jobs: unknown[] };

const param = (url: string, name: string): string | null => new URL(url).searchParams.get(name);
const exact = (target: string, body: unknown): FakeRoute => ({ match: (url) => url === target, body });

function perCompany(source: JobSource, api: string, suffix: string, boards: Array<[token: string, name: string, fixture: string]>): Scenario[] {
  const ats = source.def.ats;
  if (!ats) throw new Error(`${source.def.id} is not an ATS adapter`);
  return boards.map(([token, name, fixture]) => ({
    source,
    board: { ats, token, name },
    routes: () => {
      const body = readJsonFixture<Envelope | unknown[]>(source.def.id, fixture);
      // Trimmed Greenhouse fixtures keep the live meta.total next to a few jobs; make them self-consistent.
      const consistent = !Array.isArray(body) && 'meta' in body ? { ...body, meta: { total: body.jobs.length } } : body;
      return [{ match: `${api}/${token}${suffix}`, body: consistent }];
    },
  }));
}

function himalayasPages(pages: unknown[]): FakeRoute[] {
  const search = 'https://himalayas.app/jobs/api/search';
  return pages.map((body, i) => ({
    match: (url: string) => url.startsWith(`${search}?`) && param(url, 'q') === 'python' && param(url, 'page') === String(i + 1),
    body,
  }));
}

function jobicyPages(): FakeRoute[] {
  const feed = 'https://jobicy.com/api/jobs';
  const files = ['list.json', 'list-page2.json', 'empty-no-match.json'];
  let cursor: string | null = null;
  return files.map((file) => {
    const body = readJsonFixture<{ nextCursor: string | null }>('jobicy', file);
    const expected = cursor;
    cursor = body.nextCursor;
    return { match: (url: string) => url.split('?')[0] === feed && param(url, 'cursor') === expected, body };
  });
}

const WWR_CATEGORIES: Array<[name: string, slug: string, fixture?: string]> = [
  ['Back-End Programming', 'remote-back-end-programming-jobs', 'feed-category-back-end-programming.xml'],
  ['Front-End Programming', 'remote-front-end-programming-jobs'],
  ['Full-Stack Programming', 'remote-full-stack-programming-jobs'],
  ['DevOps and Sysadmin', 'remote-devops-sysadmin-jobs'],
  ['Design', 'remote-design-jobs', 'feed-category-design.xml'],
  ['Product', 'remote-product-jobs'],
  ['Customer Support', 'remote-customer-support-jobs'],
  ['Sales and Marketing', 'remote-sales-and-marketing-jobs'],
  ['Management and Finance', 'remote-management-and-finance-jobs'],
  ['All Other Remote', 'all-other-remote-jobs'],
];

function wwrRoutes(): FakeRoute[] {
  return WWR_CATEGORIES.map(([name, slug, fixture]) =>
    exact(
      `https://weworkremotely.com/categories/${slug}.rss`,
      fixture
        ? readFixture('weworkremotely', fixture)
        : `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>We Work Remotely: ${name} Jobs</title></channel></rss>`,
    ),
  );
}

function hnRoutes(): FakeRoute[] {
  const thread = (id: string): FakeRoute => ({
    match: (url) => url.includes('/api/v1/search?') && param(url, 'tags') === `comment,story_${id}`,
    body: readJsonFixture('hn-hiring', `thread-${id}.json`),
  });
  return [{ match: '/api/v1/search_by_date?', body: readJsonFixture('hn-hiring', 'stories.json') }, thread('50338728'), thread('49922569')];
}

const SCENARIOS: Scenario[] = [
  {
    source: arbeitnowSource,
    routes: () =>
      ['list.json', 'list-page2.json', 'list-page37-last.json'].map((file, i) => ({
        match: (url: string) => param(url, 'page') === String(i + 1),
        body: readJsonFixture('arbeitnow', file),
      })),
  },
  ...perCompany(ashbySource, 'https://api.ashbyhq.com/posting-api/job-board', '', [
    ['linear', 'Linear', 'jobs-linear.json'],
    ['notion', 'Notion', 'jobs-notion.json'],
    ['openai', 'OpenAI', 'jobs-openai.json'],
    ['ramp', 'Ramp', 'jobs-ramp.json'],
  ]),
  ...perCompany(greenhouseSource, 'https://boards-api.greenhouse.io/v1/boards', '/jobs', [
    ['stripe', 'Stripe', 'jobs-content-stripe.json'],
    ['gitlab', 'GitLab', 'jobs-content-gitlab.json'],
    ['discord', 'Discord', 'jobs-content-pay-discord.json'],
    ['duolingo', 'Duolingo', 'jobs-content-pay-duolingo.json'],
    ['airbnb', 'Airbnb', 'jobs-no-content-airbnb.json'],
  ]),
  ...perCompany(leverSource, 'https://api.lever.co/v0/postings', '', [
    ['spotify', 'Spotify', 'list-spotify.json'],
    ['veeva', 'Veeva Systems', 'list-veeva-limit100.json'],
    ['zoox', 'Zoox', 'list-zoox-limit100.json'],
    ['palantir', 'Palantir', 'list-palantir.json'],
  ]),
  {
    source: himalayasSource,
    search: { keywords: ['python'], limit: 100 },
    config: { apiKey: 'hml_test_0123456789' },
    routes: () => {
      const first = readJsonFixture<Envelope>('himalayas', 'search-python.json');
      return himalayasPages([first, { ...first, jobs: [] }]);
    },
  },
  {
    source: himalayasSource,
    search: { keywords: ['python'], limit: 100 },
    config: { apiKey: 'hml_test_0123456789' },
    routes: () => himalayasPages(['list.json', 'list-page2.json', 'list-page3.json'].map((f) => readJsonFixture('himalayas', f))),
  },
  { source: hnHiringSource, routes: hnRoutes },
  { source: jobicySource, routes: jobicyPages },
  { source: remoteokSource, routes: () => [exact('https://remoteok.com/api', readFixture('remoteok', 'list.json'))] },
  { source: remotiveSource, routes: () => [exact('https://remotive.com/api/remote-jobs', readFixture('remotive', 'list.json'))] },
  { source: weworkremotelySource, routes: wwrRoutes },
  ...(
    [
      ['washington', 'State of Washington', 'feed-washington.xml'],
      ['lacounty', 'County of Los Angeles, CA', 'feed-lacounty.xml'],
      ['honolulupd', 'Honolulu Police Department, HI', 'feed-honolulupd.xml'],
    ] as const
  ).map(
    ([token, name, fixture]): Scenario => ({
      source: governmentjobsSource,
      board: { ats: 'governmentjobs', token, name },
      now: CAPTURED_NOV_25,
      routes: () => [{ match: (url) => url.startsWith('https://www.governmentjobs.com/SearchEngine/JobsFeed?') && param(url, 'agency') === token, body: readFixture('governmentjobs', fixture) }],
    }),
  ),
  {
    source: smartrecruitersSource,
    board: { ats: 'smartrecruiters', token: 'CityAndCountyOfSanFrancisco1', name: 'City and County of San Francisco' },
    now: CAPTURED_NOV_25,
    routes: () => [
      {
        match: 'https://api.smartrecruiters.com/v1/companies/CityAndCountyOfSanFrancisco1/postings?',
        body: readFixture('smartrecruiters', 'list-cityandcountyofsanfrancisco1.json'),
      },
    ],
  },
  {
    source: usajobsSource,
    // The list holds announcements that opened on the day it was captured.
    now: CAPTURED_NOV_25,
    routes: () => [
      { match: (url) => url.startsWith('https://data.usajobs.gov/api/historicjoa?') && url.includes('continuationtoken='), body: readFixture('usajobs', 'joa-page2.json') },
      { match: (url) => url.startsWith('https://data.usajobs.gov/api/historicjoa?'), body: readFixture('usajobs', 'joa-page1.json') },
      ...['2210', '1811', '0083'].map((series): FakeRoute => ({ match: `PositionSeries=${series}`, body: readFixture('usajobs', `text-series-${series}.json`) })),
    ],
  },
  {
    source: workingnomadsSource,
    routes: () => [exact('https://www.workingnomads.com/api/exposed_jobs/', readFixture('workingnomads', 'exposed_jobs.json'))],
  },
];

/** Raw postings of every adapter's fixtures, one entry per feed (or search) the adapter ran. */
export async function fetchFixtureFeeds(): Promise<FixtureFeed[]> {
  const feeds: FixtureFeed[] = [];
  for (const s of SCENARIOS) {
    const ctx = testContext(fakeHttp(s.routes()), s.config, s.now ?? FIXTURE_NOW);
    const postings = s.search
      ? await s.source.search!(ctx, s.search)
      : (await s.source.fetchFeed!(ctx, s.board)).postings;
    if (postings.length === 0) throw new Error(`${s.source.def.id} ${s.board?.token ?? ''}: fixtures produced no postings`);
    feeds.push({ source: s.source, board: s.board, feedKey: feedKeyFor(s.source.def.id, s.board), postings, ...(s.now ? { now: s.now } : {}) });
  }
  return feeds;
}

/** Ids of the adapters covered, so a test can fail when a new adapter is added without fixtures here. */
export const FIXTURE_SOURCE_IDS: ReadonlySet<string> = new Set(SCENARIOS.map((s) => s.source.def.id));
