import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BuiltApp, buildApp } from '../app';
import { loadConfig } from '../config';
import { openDb } from '../db';
import type { SearchService } from '../services';

let built: BuiltApp;

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  const res = await built.app.inject({ method, url, headers: { host: '127.0.0.1:4310' }, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
}

beforeEach(async () => {
  built = await buildApp({
    config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir: '/nonexistent-not-used' }),
    db: openDb(':memory:'),
  });
  const search: Partial<SearchService> = { count: (_q, opts) => (opts?.firstSeenAfter ? 2 : 7) };
  built.ctx.services.search = search as SearchService;
});

afterEach(async () => {
  await built.close();
});

describe('saved search routes', () => {
  it('creates, lists, edits, marks viewed and deletes', async () => {
    const created = await call('POST', '/api/saved-searches', { name: 'Go jobs', query: { q: 'golang', location: 'Berlin', limit: 30 } });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ name: 'Go jobs', query: { q: 'golang', location: 'Berlin' }, total: 7, newCount: 2 });
    expect(created.body.query.limit).toBeUndefined();
    const id: string = created.body.id;

    expect((await call('GET', '/api/saved-searches')).body).toHaveLength(1);
    const pinned = await call('PATCH', `/api/saved-searches/${id}`, { pinned: true, name: 'Golang' });
    expect(pinned.body).toMatchObject({ pinned: true, name: 'Golang' });
    const viewed = await call('POST', `/api/saved-searches/${id}/viewed`);
    expect(viewed.body).toMatchObject({ newCount: 0, total: 7 });
    expect(viewed.body.lastViewedAt).toBeDefined();

    expect((await call('DELETE', `/api/saved-searches/${id}`)).body).toEqual({ ok: true });
    expect((await call('DELETE', `/api/saved-searches/${id}`)).status).toBe(404);
    expect((await call('PATCH', `/api/saved-searches/${id}`, { pinned: false })).status).toBe(404);
    expect((await call('POST', `/api/saved-searches/${id}/viewed`)).status).toBe(404);
  });

  it('validates bodies', async () => {
    const bad = [
      { name: 'x' },
      { name: '', query: { q: 'a' } },
      { name: 'x'.repeat(121), query: { q: 'a' } },
      { name: 'ok', query: { q: 'a', unknownFilter: 1 } },
      { name: 'ok', query: { q: 'a' }, pinned: 'yes' },
    ];
    for (const payload of bad) {
      const res = await call('POST', '/api/saved-searches', payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
    }
    const created = await call('POST', '/api/saved-searches', { name: 'ok', query: { q: 'a' } });
    expect((await call('PATCH', `/api/saved-searches/${created.body.id}`, { pinned: 'yes' })).status).toBe(400);
    expect((await call('PATCH', `/api/saved-searches/${created.body.id}`, { query: { radiusKm: 9000 } })).status).toBe(400);
  });
});
