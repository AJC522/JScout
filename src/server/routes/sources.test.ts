import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyList } from '../../shared/api';
import type { CompanyBoard, IndexSummary, SourceInfo } from '../../shared/types';
import { type BuiltApp, buildApp } from '../app';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { notFound } from '../errors';
import type { CompaniesService, SyncService } from '../services';

let built: BuiltApp;

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  const res = await built.app.inject({ method, url, headers: { host: '127.0.0.1:4310' }, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
}

const summary: IndexSummary = { openJobs: 12, sources: 3, companies: 4, syncing: false, pendingFeeds: 0 };
const info = { id: 'remotive', name: 'Remotive', enabled: true } as SourceInfo;

function fakeSync() {
  return {
    sourceInfos: vi.fn(() => [info]),
    updateSource: vi.fn((id: string) => {
      if (id !== 'remotive') throw notFound('Source');
      return info;
    }),
    testSource: vi.fn(async () => ({ ok: true, message: 'Connected: 3 postings', sample: 3 })),
    summary: vi.fn(() => summary),
    requestSync: vi.fn(() => 7),
  };
}

let sync: ReturnType<typeof fakeSync>;

beforeEach(async () => {
  built = await buildApp({
    config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir: '/nonexistent-not-used' }),
    db: openDb(':memory:'),
  });
  sync = fakeSync();
  // Real companies service (it calls sync.requestSync), fake sync so nothing touches the network.
  built.ctx.services.sync = sync as unknown as SyncService;
});

afterEach(async () => {
  await built.close();
});

describe('source routes', () => {
  it('lists, updates and tests sources', async () => {
    expect(await call('GET', '/api/sources')).toEqual({ status: 200, body: [info] });

    const patch = { enabled: true, config: { apiKey: 'k-123', other: null }, ttlMinutes: 120 };
    expect(await call('PATCH', '/api/sources/remotive', patch)).toEqual({ status: 200, body: info });
    expect(sync.updateSource).toHaveBeenCalledWith('remotive', patch);
    expect((await call('PATCH', '/api/sources/nope', { enabled: false })).status).toBe(404);

    expect(await call('POST', '/api/sources/remotive/test')).toEqual({ status: 200, body: { ok: true, message: 'Connected: 3 postings', sample: 3 } });
    expect(sync.testSource).toHaveBeenCalledWith('remotive');
  });

  it('validates source patches', async () => {
    const bad = [
      { ttlMinutes: 14 },
      { ttlMinutes: 10_081 },
      { ttlMinutes: 60.5 },
      { enabled: 'yes' },
      { config: { apiKey: 'x'.repeat(401) } },
      { config: { apiKey: 42 } },
      { config: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v'])) },
      { unknown: true },
    ];
    for (const payload of bad) expect((await call('PATCH', '/api/sources/remotive', payload)).status, JSON.stringify(payload)).toBe(400);
    expect(sync.updateSource).not.toHaveBeenCalled();
  });

  it('reports 404 for unknown sources with the real service', async () => {
    built.ctx.services.sync = (await import('../ingest/sync')).createSyncService(built.ctx);
    expect((await call('PATCH', '/api/sources/nope', { enabled: true })).status).toBe(404);
    expect((await call('POST', '/api/sources/nope/test')).status).toBe(404);
    const sources = await call('GET', '/api/sources');
    expect(sources.status).toBe(200);
    expect((sources.body as SourceInfo[]).map((s) => s.id).slice(0, 3)).toEqual(['greenhouse', 'lever', 'ashby']);
  });
});

describe('sync routes', () => {
  it('reports the index summary and queues syncs', async () => {
    expect(await call('GET', '/api/sync')).toEqual({ status: 200, body: summary });
    expect(await call('POST', '/api/sync')).toEqual({ status: 200, body: { queued: 7 } });
    expect(sync.requestSync).toHaveBeenLastCalledWith({ force: false });
    expect(await call('POST', '/api/sync', { sources: ['remotive', 'greenhouse'], force: true })).toEqual({ status: 200, body: { queued: 7 } });
    expect(sync.requestSync).toHaveBeenLastCalledWith({ sources: ['remotive', 'greenhouse'], force: true });
  });

  it('rejects bad sync requests', async () => {
    expect((await call('POST', '/api/sync', { sources: ['nope'] })).status).toBe(404);
    expect((await call('POST', '/api/sync', { force: 'yes' })).status).toBe(400);
    expect((await call('POST', '/api/sync', { feedKeys: ['remotive'] })).status).toBe(400);
    expect(sync.requestSync).not.toHaveBeenCalled();
  });
});

describe('company routes', () => {
  it('adds, lists, edits, bulk-updates and removes boards', async () => {
    const added = await call('POST', '/api/companies', { ats: 'greenhouse', token: 'Stripe', name: 'Stripe', industry: 'fintech' });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ id: 'greenhouse:stripe', name: 'Stripe', origin: 'user', enabled: true });
    expect(sync.requestSync).toHaveBeenCalledWith({ feedKeys: ['greenhouse:stripe'] });
    await call('POST', '/api/companies', { ats: 'lever', token: 'acme', name: 'Acme' });

    const list = await call('GET', '/api/companies?enabled=true&limit=1&offset=0&q=str&ats=greenhouse');
    expect(list.status).toBe(200);
    expect(list.body as CompanyList).toMatchObject({ total: 1, enabledTotal: 1, industries: [{ value: 'fintech', count: 1 }] });
    expect((list.body as CompanyList).items.map((b) => b.id)).toEqual(['greenhouse:stripe']);

    const patched = await call('PATCH', '/api/companies/greenhouse:stripe', { enabled: false, name: 'Stripe Inc' });
    expect(patched.body as CompanyBoard).toMatchObject({ enabled: false, name: 'Stripe Inc', sync: { status: 'disabled' } });
    expect(await call('POST', '/api/companies/bulk', { enabled: false })).toEqual({ status: 200, body: { updated: 1 } });
    expect(await call('POST', '/api/companies/bulk', { enabled: true, ids: ['greenhouse:stripe'] })).toEqual({ status: 200, body: { updated: 1 } });

    expect(await call('DELETE', '/api/companies/greenhouse:stripe')).toEqual({ status: 200, body: { ok: true } });
    expect((await call('DELETE', '/api/companies/greenhouse:stripe')).status).toBe(404);
    expect((await call('PATCH', '/api/companies/greenhouse:stripe', { enabled: true })).status).toBe(404);
  });

  it('coerces and validates list queries', async () => {
    const list = vi.fn((): CompanyList => ({ total: 0, enabledTotal: 0, items: [], industries: [] }));
    built.ctx.services.companies = { ...built.ctx.services.companies, list } as CompaniesService;
    expect((await call('GET', '/api/companies?enabled=0&limit=50&offset=10&origin=seed&industry=ai')).status).toBe(200);
    expect(list).toHaveBeenLastCalledWith({ enabled: false, limit: 50, offset: 10, origin: 'seed', industry: 'ai' });
    for (const query of ['enabled=maybe', 'limit=0', 'limit=1001', 'offset=-1', 'ats=bamboo', 'origin=other', `q=${'x'.repeat(201)}`]) {
      expect((await call('GET', `/api/companies?${query}`)).status, query).toBe(400);
    }
  });

  it('validates company bodies', async () => {
    const badAdds = [
      { ats: 'greenhouse', token: 'ok' },
      { ats: 'bamboo', token: 'ok', name: 'X' },
      { ats: 'greenhouse', token: '', name: 'X' },
      { ats: 'greenhouse', token: 'x'.repeat(101), name: 'X' },
      { ats: 'greenhouse', token: 'bad token', name: 'X' },
      { ats: 'greenhouse', token: 'ok', name: 'X', extra: 1 },
    ];
    for (const payload of badAdds) expect((await call('POST', '/api/companies', payload)).status, JSON.stringify(payload)).toBe(400);
    expect((await call('POST', '/api/companies/bulk', { ids: ['a'] })).status).toBe(400);
    expect((await call('POST', '/api/companies/bulk', { enabled: true, origin: 'other' })).status).toBe(400);
    expect((await call('PATCH', '/api/companies/greenhouse:x', { name: '' })).status).toBe(400);
    expect((await call('POST', '/api/companies/detect', { input: '  ' })).status).toBe(400);
    expect((await call('POST', '/api/companies/detect', {})).status).toBe(400);
  });

  it('detects boards', async () => {
    const detect = vi.fn(async () => [{ ats: 'lever' as const, token: 'acme', name: 'Acme', jobs: 3 }]);
    built.ctx.services.companies = { ...built.ctx.services.companies, detect } as CompaniesService;
    expect(await call('POST', '/api/companies/detect', { input: ' Acme ' })).toEqual({ status: 200, body: [{ ats: 'lever', token: 'acme', name: 'Acme', jobs: 3 }] });
    expect(detect).toHaveBeenCalledWith('Acme');
  });
});
