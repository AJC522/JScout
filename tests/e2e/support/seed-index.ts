/**
 * Seeds a JScout data directory with a deterministic job index for the end-to-end tests, with no
 * network: every feed adapter run on its captured fixtures plus the hand-written search postings,
 * through the real normalise + store path. Fixture company boards are followed, and every feed is
 * recorded as freshly synced, so nothing in the app finds a feed due for syncing.
 *
 * Usage: tsx tests/e2e/support/seed-index.ts <dataDir>
 */
import path from 'node:path';
import { openDb } from '../../../src/server/db';
import { createCompaniesService } from '../../../src/server/features/companies/service';
import { normalizePosting } from '../../../src/server/ingest/normalize';
import { createJobStore } from '../../../src/server/ingest/store';
import { FIXTURE_NOW, fetchFixtureFeeds } from '../../../src/server/ingest/testing';
import type { NormalizedPosting } from '../../../src/server/ingest/types';
import { curatedFeeds } from '../../../src/server/search/testing';
import { greenhouseSource } from '../../../src/server/sources/greenhouse';
import { remotiveSource } from '../../../src/server/sources/remotive';
import type { RawPosting } from '../../../src/server/sources/types';
import type { AppContext, Services } from '../../../src/server/services';

const dataDir = process.argv[2];
if (!dataDir) {
  console.error('usage: tsx tests/e2e/support/seed-index.ts <dataDir>');
  process.exit(2);
}

const db = openDb(path.join(path.resolve(dataDir), 'jscout.db'));
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const ctx = { db, now: () => FIXTURE_NOW, log: quiet, services: {} as Services } as unknown as AppContext;
ctx.services.jobs = createJobStore(ctx);
// The bundled registry, as the app seeds it on first start (all unfollowed).
createCompaniesService(ctx).seedIfEmpty();

/**
 * A defense employer whose postings cover each security clearance outcome (clearance.spec.ts).
 * "Satellite" titles appear nowhere else in the index, so other tests' result counts are untouched.
 */
function clearanceFeed() {
  const board = { ats: 'greenhouse' as const, token: 'northwind-defense', name: 'Northwind Defense' };
  const posting = (id: string, title: string, requirement: string): RawPosting => ({
    externalId: id,
    url: `https://job-boards.greenhouse.io/northwind-defense/jobs/${id}`,
    title,
    company: board.name,
    locations: ['Colorado Springs, CO'],
    remote: 'onsite',
    postedAt: FIXTURE_NOW.toISOString(),
    descriptionHtml: `<p>Support satellite operations for national security customers.</p><h3>Basic Qualifications</h3><ul><li>3+ years of Linux and Python</li><li>${requirement}</li></ul>`,
  });
  const raws = [
    posting('9001', 'Satellite Ground Systems Engineer', 'Must hold an active TS/SCI with CI polygraph.'),
    posting('9002', 'Satellite Mission Planner', 'Must be able to obtain and maintain a Secret clearance.'),
    posting('9003', 'Satellite Data Analyst', 'This position requires a Secret clearance.'),
    posting('9004', 'Satellite Network Technician', 'Clearance Type: None'),
  ];
  const feedKey = `greenhouse:${board.token}`;
  return {
    feed: { feedKey, source: 'greenhouse' },
    postings: raws
      .map((raw) => normalizePosting(raw, { source: greenhouseSource.def, feedKey, board, now: FIXTURE_NOW }))
      .filter((p): p is NormalizedPosting => p !== null),
  };
}

/**
 * A remote job that takes applications by email (apply-by-email.spec.ts); its title appears nowhere else.
 * Added to the curated Remotive feed: feeds are stored as complete snapshots, so a feed of its own
 * under the same key would close the others' postings.
 */
function emailPosting(): NormalizedPosting {
  const raw: RawPosting = {
    externalId: 'e2e-orbital',
    url: 'https://remotive.com/remote-jobs/software-dev/orbital-dynamics-engineer-e2e',
    title: 'Orbital Dynamics Engineer',
    company: 'Lumen Orbital',
    locations: ['Remote - US'],
    remote: 'remote',
    postedAt: FIXTURE_NOW.toISOString(),
    descriptionHtml:
      '<p>Model spacecraft trajectories in Python and C++.</p><p>To apply, send your résumé to <a href="mailto:jobs@lumen-orbital.example">jobs@lumen-orbital.example</a> with the subject line "Orbital Dynamics Engineer".</p>',
  };
  return normalizePosting(raw, { source: remotiveSource.def, feedKey: 'remotive', now: FIXTURE_NOW })!;
}

const fixtures = await fetchFixtureFeeds();
const feeds = [
  // Himalayas is a live-search source that is off until the user adds a key; it has no place in a fresh index.
  ...fixtures
    .filter((f) => f.source.def.mode === 'feed')
    .map((f) => ({
      feed: { feedKey: f.feedKey, source: f.source.def.id },
      postings: f.postings
        .map((raw) => normalizePosting(raw, { source: f.source.def, feedKey: f.feedKey, board: f.board, now: FIXTURE_NOW }))
        .filter((p): p is NormalizedPosting => p !== null),
    })),
  ...curatedFeeds().map((f) => (f.feed.feedKey === 'remotive' ? { ...f, postings: [...f.postings, emailPosting()] } : f)),
  clearanceFeed(),
];

// Feeds count as synced just now (real time), so the app's freshness check queues none of them.
const syncedAt = new Date().toISOString();
db.tx(() => {
  for (const { feed, postings } of feeds) {
    ctx.services.jobs.upsertFeed(feed, postings, { complete: true, now: FIXTURE_NOW });
    // Company board feeds are keyed "<ats>:<token>": follow the board (bundled or not) they came from.
    const [ats, token] = feed.feedKey.split(':');
    if (ats && token) {
      db.run(
        `INSERT INTO companies (id, name, ats, token, origin, enabled, added_at) VALUES (?, ?, ?, ?, 'user', 1, ?)
         ON CONFLICT (id) DO UPDATE SET enabled = 1`,
        feed.feedKey,
        postings[0]?.company ?? token,
        ats,
        token,
        syncedAt,
      );
    }
    db.run(
      `INSERT INTO sync_state (feed_key, source, status, last_attempt_at, last_success_at, job_count)
       VALUES (?, ?, 'ok', ?, ?, (SELECT COUNT(*) FROM jobs WHERE feed_key = ? AND closed_at IS NULL))
       ON CONFLICT (feed_key) DO UPDATE SET last_success_at = excluded.last_success_at, job_count = excluded.job_count`,
      feed.feedKey,
      feed.source,
      syncedAt,
      syncedAt,
      feed.feedKey,
    );
  }
});

console.log(`Seeded ${ctx.services.jobs.openCount()} open postings from ${feeds.length} feeds into ${dataDir}`);
db.close();
