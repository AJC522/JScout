import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config';
import { openDb } from '../../db';
import { ApiError } from '../../errors';
import { EventBus } from '../../events';
import type { AppContext, SavedSearchService, SearchService, Services } from '../../services';
import type { HttpClient } from '../../sources/types';
import { createSavedSearchService } from './service';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const summary = { openJobs: 0 } as never;

let now: Date;
let events: EventBus;
let count: ReturnType<typeof vi.fn<SearchService['count']>>;
let service: SavedSearchService;

const tick = (ms = 1000): void => {
  now = new Date(now.getTime() + ms);
};

function expectApiError(fn: () => unknown, status: number): void {
  expect(fn).toThrow(ApiError);
  try {
    fn();
  } catch (err) {
    expect((err as ApiError).status).toBe(status);
  }
}

beforeEach(() => {
  now = new Date('2026-11-20T12:00:00.000Z');
  events = new EventBus();
  // 10 results in total, 3 of them new since the given date.
  count = vi.fn<SearchService['count']>((_query, opts) => (opts?.firstSeenAfter ? 3 : 10));
  const search: Partial<SearchService> = { count };
  const ctx: AppContext = {
    config: {} as AppConfig,
    db: openDb(':memory:'),
    http: {} as HttpClient,
    events,
    log: silent,
    now: () => now,
    services: { search } as Services,
  };
  service = createSavedSearchService(ctx);
});

describe('saved searches', () => {
  it('creates with a cleaned query and counts', () => {
    const saved = service.create({ name: '  Remote TS  ', query: { q: 'typescript', remote: ['remote'], offset: 30, limit: 30 } });
    expect(saved).toMatchObject({
      name: 'Remote TS',
      query: { q: 'typescript', remote: ['remote'] },
      pinned: false,
      total: 10,
      newCount: 3,
      createdAt: now.toISOString(),
    });
    expect(saved.query).not.toHaveProperty('offset');
    expect(saved.query).not.toHaveProperty('limit');
    expect(saved.lastViewedAt).toBeUndefined();
    expect(count).toHaveBeenCalledWith(saved.query, { firstSeenAfter: saved.createdAt });
  });

  it('validates names and queries', () => {
    expectApiError(() => service.create({ name: '   ', query: { q: 'x' } }), 400);
    expectApiError(() => service.create({ name: 'x'.repeat(121), query: { q: 'x' } }), 400);
    expectApiError(() => service.create({ name: 'ok', query: { q: 'x', bogus: true } as never }), 400);
    expectApiError(() => service.patch('missing', { pinned: true }), 404);
    expectApiError(() => service.markViewed('missing'), 404);
    expectApiError(() => service.remove('missing'), 404);
  });

  it('lists pinned first, then most recently updated', () => {
    const a = service.create({ name: 'A', query: { q: 'a' } });
    tick();
    const b = service.create({ name: 'B', query: { q: 'b' } });
    tick();
    const c = service.create({ name: 'C', query: { q: 'c' } });
    expect(service.list().map((s) => s.name)).toEqual(['C', 'B', 'A']);
    tick();
    service.patch(a.id, { pinned: true });
    tick();
    service.patch(b.id, { name: 'B2' });
    expect(service.list().map((s) => s.name)).toEqual(['A', 'B2', 'C']);
    expect(c.id).toBeTruthy();
  });

  it('memoises counts and invalidates them', () => {
    const a = service.create({ name: 'A', query: { q: 'a' } });
    count.mockClear();
    service.list();
    service.totals();
    expect(count).not.toHaveBeenCalled();

    service.patch(a.id, { name: 'Renamed' });
    expect(count).not.toHaveBeenCalled();
    service.patch(a.id, { query: { q: 'b' } });
    expect(count).toHaveBeenCalledTimes(2);

    count.mockClear();
    events.publish({ type: 'index-changed', index: summary });
    service.list();
    expect(count).toHaveBeenCalledTimes(2);
    count.mockClear();
    events.publish({ type: 'sync-finished', index: summary, added: 5, durationMs: 1 });
    service.totals();
    expect(count).toHaveBeenCalledTimes(2);

    count.mockClear();
    tick(61_000);
    service.list();
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('marks a search viewed', () => {
    const a = service.create({ name: 'A', query: { q: 'a' } });
    tick();
    const viewed = service.markViewed(a.id);
    expect(viewed).toMatchObject({ lastViewedAt: now.toISOString(), newCount: 0, total: 10, updatedAt: a.updatedAt });
    expect(count).toHaveBeenLastCalledWith(a.query, { firstSeenAfter: now.toISOString() });
    expect(service.list()[0]!.newCount).toBe(0);
    expect(service.totals()).toEqual({ count: 1, newResults: 0 });
  });

  it('reports zeros when search is unavailable, without caching the failure', () => {
    count.mockImplementation(() => {
      throw new Error('not ready');
    });
    const a = service.create({ name: 'A', query: { q: 'a' } });
    expect(a).toMatchObject({ total: 0, newCount: 0 });
    count.mockImplementation(() => 4);
    expect(service.totals()).toEqual({ count: 1, newResults: 4 });
  });

  it('removes, exports, imports twice and clears', () => {
    const a = service.create({ name: 'A', query: { q: 'a' } });
    service.markViewed(a.id);
    const b = service.create({ name: 'B', query: { q: 'b' } });
    service.patch(b.id, { pinned: true });
    const exported = service.exportAll();
    expect(exported).toEqual([
      { id: b.id, name: 'B', query: { q: 'b' }, pinned: true, createdAt: b.createdAt, updatedAt: b.updatedAt },
      { id: a.id, name: 'A', query: { q: 'a' }, pinned: false, createdAt: a.createdAt, updatedAt: a.updatedAt, lastViewedAt: now.toISOString() },
    ]);
    service.remove(a.id);
    expect(service.list()).toHaveLength(1);
    service.clear();
    expect(service.list()).toEqual([]);
    expect(service.importAll(exported)).toBe(2);
    expect(service.importAll(exported)).toBe(2);
    expect(service.exportAll()).toEqual(exported);
    expectApiError(() => service.importAll([{ ...exported[0]!, id: 'new', query: { q: 1 } as never }]), 400);
    expect(service.list()).toHaveLength(2);
  });
});
