/**
 * Test support for the search engine: a realistic index built through the real normalise +
 * store path from every adapter's captured fixtures, plus a few hand-written postings that pin
 * down the product requirements (synonyms, radius, remote scope, salary, duplicates).
 * Used by the search tests only; not by the app.
 */
import { emptyProfile } from '../../shared/constants';
import type { AppSettings, ApplicationStatus, IndexSummary, Profile } from '../../shared/types';
import { type Db, openDb } from '../db';
import { feedKeyFor, normalizePosting } from '../ingest/normalize';
import { createJobStore } from '../ingest/store';
import { FIXTURE_NOW, fetchFixtureFeeds } from '../ingest/testing';
import type { NormalizedPosting } from '../ingest/types';
import type { AppContext, JobStore, SearchService, Services } from '../services';
import { getSource } from '../sources/registry';
import type { BoardRef, RawPosting } from '../sources/types';
import { createSearchService } from './service';
import { createUserStateService } from './user-state';

export { FIXTURE_NOW };

const DAY = 86_400_000;
const daysAgo = (n: number): string => new Date(FIXTURE_NOW.getTime() - n * DAY).toISOString();

type Curated = Partial<RawPosting> & Pick<RawPosting, 'externalId' | 'title'>;

const ACME: BoardRef = { ats: 'greenhouse', token: 'acmerobotics', name: 'Acme Robotics' };
const GLOBEX: BoardRef = { ats: 'lever', token: 'globex', name: 'Globex' };

const description = (skills: string): string =>
  `<p>Join our team building delightful products.</p><h3>Requirements</h3><p>Experience with ${skills}.</p>`;

/** Hand-written postings; external ids are referenced by the tests. */
const CURATED: Array<{ source: string; board?: BoardRef; postings: Curated[] }> = [
  {
    source: 'greenhouse',
    board: ACME,
    postings: [
      { externalId: 'acme-swe-austin', title: 'Software Engineer', locations: ['Austin, TX'], remote: 'onsite', postedAt: daysAgo(2), salary: { min: 90000, max: 130000, currency: 'USD', period: 'year' }, descriptionHtml: description('TypeScript, React, PostgreSQL and AWS') },
      { externalId: 'acme-senior-swe', title: 'Senior Software Engineer', locations: ['Austin, TX'], remote: 'hybrid', postedAt: daysAgo(5), descriptionHtml: description('Go, Kubernetes and PostgreSQL') },
      { externalId: 'acme-dev-roundrock', title: 'Software Developer', locations: ['Round Rock, TX'], remote: 'onsite', postedAt: daysAgo(3), descriptionHtml: description('Java and Spring') },
      { externalId: 'acme-swe-remote-us', title: 'SWE, Platform', locations: ['Remote - US'], remote: 'remote', postedAt: daysAgo(1), descriptionHtml: description('Python and Terraform') },
      { externalId: 'acme-qa-austin', title: 'QA Analyst', locations: ['Austin, TX'], remote: 'onsite', postedAt: daysAgo(4), salary: { min: 60000, max: 80000, currency: 'USD', period: 'year' }, descriptionHtml: description('Selenium and SQL') },
      { externalId: 'acme-csharp-dallas', title: 'C# Developer', locations: ['Dallas, TX'], remote: 'onsite', postedAt: daysAgo(6), descriptionHtml: description('C#, .NET and Azure') },
      { externalId: 'acme-swe-berlin', title: 'Software Engineer', locations: ['Berlin, Germany'], remote: 'hybrid', postedAt: daysAgo(2), descriptionHtml: description('Kotlin and Kafka') },
      { externalId: 'acme-backend-munich', title: 'Backend Engineer', locations: ['München, Germany'], remote: 'onsite', postedAt: daysAgo(8), descriptionHtml: description('Go and PostgreSQL') },
    ],
  },
  {
    source: 'lever',
    board: GLOBEX,
    postings: [
      { externalId: 'globex-swe-london', title: 'Software Engineer', locations: ['London, UK'], remote: 'hybrid', postedAt: daysAgo(3), descriptionHtml: description('Scala and Spark') },
      { externalId: 'globex-node-austin', title: 'Node.js Engineer', locations: ['Austin, TX'], remote: 'onsite', postedAt: daysAgo(9), descriptionHtml: description('Node.js and GraphQL') },
    ],
  },
  {
    source: 'remotive',
    postings: [
      // The same job as acme-swe-remote-us, re-listed by an aggregator: must collapse into the ATS copy.
      { externalId: 'remotive-acme-swe', title: 'SWE, Platform', company: 'Acme Robotics Inc.', locations: ['USA'], remote: 'remote', postedAt: daysAgo(1), descriptionHtml: description('Python and Terraform') },
      { externalId: 'remotive-swe-de-only', title: 'Software Engineer', company: 'Initech', locations: ['Remote (Germany)'], remote: 'remote', postedAt: daysAgo(2), descriptionHtml: description('Ruby on Rails') },
      { externalId: 'remotive-swe-eu', title: 'Software Engineer', company: 'Umbrella', locations: ['Remote - Europe'], remote: 'remote', postedAt: daysAgo(4), descriptionHtml: description('Elixir') },
      { externalId: 'remotive-nurse', title: 'Registered Nurse (Telehealth)', company: 'CareFirst Clinics', locations: ['Remote - US'], remote: 'remote', postedAt: daysAgo(7), descriptionHtml: description('patient triage') },
      // Porter stems "accountant" and "account" alike: title searches must still tell them apart.
      { externalId: 'remotive-accountant', title: 'Senior Accountant', company: 'Ledgerly', locations: ['Remote - US'], remote: 'remote', postedAt: daysAgo(3), descriptionHtml: description('NetSuite and GAAP') },
      { externalId: 'remotive-account-exec', title: 'Account Executive', company: 'Ledgerly', locations: ['Remote - US'], remote: 'remote', postedAt: daysAgo(3), descriptionHtml: description('Salesforce') },
      { externalId: 'remotive-eur-low', title: 'Data Engineer', company: 'Kontor', locations: ['Berlin, Germany'], remote: 'hybrid', postedAt: daysAgo(2), salary: { min: 50000, max: 75000, currency: 'EUR', period: 'year' }, descriptionHtml: description('Airflow') },
      { externalId: 'remotive-eur-high', title: 'Staff Data Engineer', company: 'Kontor', locations: ['Munich, Germany'], remote: 'hybrid', postedAt: daysAgo(2), salary: { min: 110000, max: 130000, currency: 'EUR', period: 'year' }, descriptionHtml: description('Spark') },
      { externalId: 'remotive-teachers', title: 'Online English Teachers', company: 'Polyglot School', locations: ['Remote'], remote: 'remote', postedAt: daysAgo(5), descriptionHtml: description('lesson planning') },
    ],
  },
];

/** The curated postings, normalised, one entry per feed. */
export function curatedFeeds(): Array<{ feed: { feedKey: string; source: string }; postings: NormalizedPosting[] }> {
  return CURATED.map(({ source, board, postings }) => {
    const def = getSource(source)?.def;
    if (!def) throw new Error(`unknown source ${source}`);
    const feedKey = feedKeyFor(source, board);
    const normalized = postings.map((p) => {
      const raw: RawPosting = { url: `https://jobs.example.com/${p.externalId}`, company: board?.name ?? '', locations: [], ...p };
      const n = normalizePosting(raw, { source: def, feedKey, board, now: FIXTURE_NOW });
      if (!n) throw new Error(`curated posting ${p.externalId} was rejected`);
      return n;
    });
    return { feed: { feedKey, source }, postings: normalized };
  });
}

/** Fixture feeds normalised once per test file (running every adapter is the slow part). */
let fixtureFeeds: Promise<Array<{ feed: { feedKey: string; source: string }; postings: NormalizedPosting[] }>> | undefined;

function normalizedFixtures() {
  fixtureFeeds ??= fetchFixtureFeeds().then((feeds) =>
    feeds.map((f) => ({
      feed: { feedKey: f.feedKey, source: f.source.def.id },
      postings: f.postings
        .map((r) => normalizePosting(r, { source: f.source.def, feedKey: f.feedKey, board: f.board, now: FIXTURE_NOW }))
        .filter((p): p is NormalizedPosting => p !== null),
    })),
  );
  return fixtureFeeds;
}

export interface SearchTestEnv {
  db: Db;
  ctx: AppContext;
  store: JobStore;
  search: SearchService;
  profile: Profile;
  settings: { maxPostingAgeDays: number };
  /** Tracker status per cluster, as the applications service would report it. */
  tracker: Map<string, ApplicationStatus>;
  /** Internal id of a curated posting by its external id. */
  id(externalId: string): string;
  close(): void;
}

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const INDEX: IndexSummary = { openJobs: 0, sources: 0, companies: 0, syncing: false, pendingFeeds: 0 };

/** An in-memory app context with the real store, user-state and search services; other services faked. */
export async function createSearchTestEnv(opts: { fixtures?: boolean } = {}): Promise<SearchTestEnv> {
  const db = openDb(':memory:');
  const profile = emptyProfile(FIXTURE_NOW.toISOString());
  const settings = { maxPostingAgeDays: 0 };
  const tracker = new Map<string, ApplicationStatus>();
  const services = {} as Services;
  const ctx = { db, now: () => FIXTURE_NOW, log: silent, services } as unknown as AppContext;
  services.settings = { getApp: () => ({ maxPostingAgeDays: settings.maxPostingAgeDays }) as AppSettings } as Services['settings'];
  services.profile = {
    get: () => profile,
    effectiveSkills: () => [...profile.preferences.skills],
  } as unknown as Services['profile'];
  services.applications = {
    stateByCluster: (keys: string[]) =>
      new Map(keys.flatMap((k) => (tracker.has(k) ? [[k, { applicationId: `app-${k}`, status: tracker.get(k)! }] as const] : []))),
  } as unknown as Services['applications'];
  services.sync = { summary: () => INDEX } as unknown as Services['sync'];
  services.jobs = createJobStore(ctx);
  services.userState = createUserStateService(ctx);
  services.search = createSearchService(ctx);

  const feeds = [...(opts.fixtures === false ? [] : await normalizedFixtures()), ...curatedFeeds()];
  for (const { feed, postings } of feeds) services.jobs.upsertFeed(feed, postings, { complete: true, now: FIXTURE_NOW });

  return {
    db,
    ctx,
    store: services.jobs,
    search: services.search,
    profile,
    settings,
    tracker,
    id(externalId) {
      const id = db.scalar<string>('SELECT id FROM jobs WHERE external_id = ?', externalId);
      if (!id) throw new Error(`no posting ${externalId}`);
      return id;
    },
    close: () => db.close(),
  };
}
