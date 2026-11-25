import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LivenessResult, SourceInfo } from '../../shared/types';
import { type BuiltApp, buildApp } from '../app';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { curatedFeeds, FIXTURE_NOW } from '../search/testing';
import type { SyncService } from '../services';
import type { UpstreamQuery } from '../sources/types';

let built: BuiltApp;
let upstream: UpstreamQuery[];
let searchSources: Array<Pick<SourceInfo, 'mode' | 'enabled' | 'configured'>>;
let fetchDescription: (id: string) => Promise<string>;

async function call(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) {
  const res = await built.app.inject({ method, url, headers: { host: '127.0.0.1:4310' }, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
}

const idOf = (externalId: string): string => built.ctx.db.scalar<string>('SELECT id FROM jobs WHERE external_id = ?', externalId)!;

beforeEach(async () => {
  built = await buildApp({
    config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir: '/nonexistent-not-used' }),
    db: openDb(':memory:'),
    now: () => FIXTURE_NOW,
  });
  for (const { feed, postings } of curatedFeeds()) built.ctx.services.jobs.upsertFeed(feed, postings, { complete: true, now: FIXTURE_NOW });
  upstream = [];
  searchSources = [{ mode: 'search', enabled: true, configured: true }];
  fetchDescription = async () => '';
  const live: LivenessResult = { status: 'open', checkedAt: FIXTURE_NOW.toISOString() };
  const sync: Partial<SyncService> = {
    summary: () => ({ openJobs: 0, sources: 0, companies: 0, syncing: false, pendingFeeds: 0 }),
    sourceInfos: () => searchSources as SourceInfo[],
    searchUpstream: async (q) => {
      upstream.push(q);
      return { added: 0 };
    },
    fetchDescription: (id) => fetchDescription(id),
    checkLiveness: async () => live,
  };
  built.ctx.services.sync = sync as SyncService;
});

afterEach(async () => {
  vi.useRealTimers();
  await built.close();
});

describe('POST /api/search', () => {
  it('searches, records history and asks search-mode sources once per query', async () => {
    const res = await call('POST', '/api/search', { q: 'software engineer', location: 'Austin, TX', radiusKm: 50 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.items[0].job.title).toBe('Software Engineer');
    expect(upstream).toEqual([expect.objectContaining({ keywords: expect.arrayContaining(['software engineer']), city: 'Austin', country: 'US', limit: 60 })]);

    await call('POST', '/api/search', { q: 'software engineer', location: 'Austin, TX', radiusKm: 50, sort: 'date' });
    expect(upstream).toHaveLength(1);
    // Later pages neither record history nor ask upstream.
    await call('POST', '/api/search', { q: 'nurse', offset: 30 });
    expect(upstream).toHaveLength(1);

    const history = await call('GET', '/api/search/history');
    expect(history.body.map((h: { query: { q: string } }) => h.query.q)).toEqual(['software engineer', 'software engineer']);
    expect(history.body[1]).toMatchObject({ total: res.body.total, query: { location: 'Austin, TX', radiusKm: 50 } });
    expect((await call('DELETE', '/api/search/history')).body).toEqual({ ok: true });
    expect((await call('GET', '/api/search/history')).body).toEqual([]);
  });

  it('does not ask upstream when no search-mode source is usable, or when there are no keywords', async () => {
    searchSources = [{ mode: 'search', enabled: true, configured: false }, { mode: 'feed', enabled: true, configured: true }];
    await call('POST', '/api/search', { q: 'nurse' });
    searchSources = [{ mode: 'search', enabled: true, configured: true }];
    await call('POST', '/api/search', { q: '', location: 'Berlin' });
    expect(upstream).toEqual([]);
  });

  it('a failing sync service never breaks the search', async () => {
    built.ctx.services.sync.sourceInfos = () => {
      throw new Error('boom');
    };
    expect((await call('POST', '/api/search', { q: 'nurse' })).status).toBe(200);
  });

  it('rejects invalid queries', async () => {
    for (const payload of [{ q: 1 }, { q: 'x', limit: 0 }, { q: 'x', remote: ['moon'] }, { q: 'x', unknown: true }, { q: 'x', radiusKm: -1 }]) {
      expect((await call('POST', '/api/search', payload)).status, JSON.stringify(payload)).toBe(400);
    }
  });
});

describe('suggestions and profile query', () => {
  it('validates q and limit', async () => {
    const titles = await call('GET', '/api/suggest/titles?q=software%20eng&limit=3');
    expect(titles.status).toBe(200);
    expect(titles.body.length).toBeLessThanOrEqual(3);
    expect(titles.body[0]).toMatchObject({ title: 'Software Engineer' });
    expect((await call('GET', '/api/suggest/companies?q=acme')).body).toEqual([{ name: 'Acme Robotics', count: 8 }]);
    expect((await call('GET', '/api/suggest/locations?q=austin')).body[0]).toMatchObject({ city: 'Austin' });
    expect((await call('GET', '/api/suggest/skills?q=python')).body[0]).toMatchObject({ name: 'Python' });
    for (const url of ['/api/suggest/titles', '/api/suggest/titles?q=', '/api/suggest/skills?q=x&limit=21', '/api/suggest/companies?q=x&limit=abc']) {
      expect((await call('GET', url)).status, url).toBe(400);
    }
  });

  it('builds a query from the saved profile', async () => {
    built.ctx.services.profile.patch({ preferences: { targetTitles: ['Data Engineer', 'Analytics Engineer'], locations: ['Denver, CO'], radiusKm: 25 } });
    expect((await call('GET', '/api/search/from-profile')).body).toMatchObject({ q: 'Data Engineer, Analytics Engineer', location: 'Denver, CO', radiusKm: 25 });
  });
});

describe('jobs', () => {
  it('returns detail, and 404 for unknown jobs on every job route', async () => {
    const detail = await call('GET', `/api/jobs/${idOf('acme-swe-austin')}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ job: { title: 'Software Engineer' }, userState: { hidden: false } });
    expect(detail.body.descriptionHtml).toContain('TypeScript');
    for (const [method, url] of [['GET', '/api/jobs/nope'], ['POST', '/api/jobs/nope/view'], ['POST', '/api/jobs/nope/hide'], ['DELETE', '/api/jobs/nope/hide'], ['POST', '/api/jobs/nope/check']] as const) {
      expect((await call(method, url)).status, `${method} ${url}`).toBe(404);
    }
  });

  it('scores a job against the search it was opened from, when given', async () => {
    const id = idOf('acme-swe-austin');
    const plain = await call('GET', `/api/jobs/${id}`);
    const withQuery = await call('GET', `/api/jobs/${id}?query=${encodeURIComponent(JSON.stringify({ q: 'software engineer', location: 'Austin, TX' }))}`);
    expect(withQuery.status).toBe(200);
    expect(withQuery.body.match.titleMatch).toBe('exact');
    const location = (body: { match: { reasons: Array<{ key: string; label: string }> } }) => body.match.reasons.find((r) => r.key === 'location')?.label;
    expect(location(withQuery.body)).toBe('In Austin, TX');
    expect(location(plain.body)).toBeUndefined();
    expect((await call('GET', `/api/jobs/${id}?query=not-json`)).status).toBe(400);
    expect((await call('GET', `/api/jobs/${id}?query=${encodeURIComponent(JSON.stringify({ q: 1 }))}`)).status).toBe(400);
  });

  it('fetches a missing description before answering', async () => {
    const id = idOf('acme-swe-austin');
    built.ctx.services.jobs.setDescription(id, '', '');
    fetchDescription = async (jobId) => {
      built.ctx.services.jobs.setDescription(jobId, '<p>Fresh description</p>', 'Fresh description');
      return '<p>Fresh description</p>';
    };
    expect((await call('GET', `/api/jobs/${id}`)).body.descriptionHtml).toBe('<p>Fresh description</p>');
  });

  it('answers without the description when fetching it takes too long', async () => {
    const id = idOf('acme-swe-austin');
    built.ctx.services.jobs.setDescription(id, '', '');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchDescription = () => new Promise<string>(() => {});
    const pending = call('GET', `/api/jobs/${id}`);
    await vi.advanceTimersByTimeAsync(6_000);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.body.descriptionHtml).toBe('');
  });

  it('marks viewed, hides and unhides by cluster, and checks liveness', async () => {
    const id = idOf('acme-swe-remote-us');
    expect((await call('POST', `/api/jobs/${id}/view`)).body.viewedAt).toBe(FIXTURE_NOW.toISOString());
    expect((await call('POST', `/api/jobs/${id}/hide`)).body.hidden).toBe(true);
    const duplicate = idOf('remotive-acme-swe');
    expect((await call('GET', `/api/jobs/${duplicate}`)).body.userState.hidden).toBe(true);
    const search = await call('POST', '/api/search', { q: 'swe' });
    expect(search.body.items.map((i: { job: { id: string } }) => i.job.id)).not.toContain(id);
    expect((await call('DELETE', `/api/jobs/${id}/hide`)).body.hidden).toBe(false);
    expect((await call('POST', `/api/jobs/${id}/check`)).body).toEqual({ status: 'open', checkedAt: FIXTURE_NOW.toISOString() });
  });
});
