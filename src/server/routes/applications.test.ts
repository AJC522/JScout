import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobPosting } from '../../shared/types';
import { type BuiltApp, buildApp } from '../app';
import { loadConfig } from '../config';
import { openDb } from '../db';
import type { JobStore, SyncService } from '../services';

const posting = {
  id: 'job-1',
  clusterKey: 'cluster-1',
  source: 'lever',
  sourceName: 'Lever',
  externalId: 'e1',
  url: 'https://jobs.example.com/1',
  title: 'Backend Engineer',
  company: 'Acme',
  location: { places: [], remote: 'hybrid', remoteScope: [] },
  locationText: 'Berlin, Germany',
  employmentType: 'full-time',
  seniority: 'mid',
  tags: [],
  skills: ['Go'],
  snippet: '',
  hasDescription: false,
  firstSeenAt: '2026-11-01T00:00:00.000Z',
  lastSeenAt: '2026-11-19T00:00:00.000Z',
} satisfies JobPosting;

let built: BuiltApp;
let descriptions: Map<string, string>;
let fetchDescription: ReturnType<typeof vi.fn<SyncService['fetchDescription']>>;

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  const res = await built.app.inject({ method, url, headers: { host: 'localhost:4310' }, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
}

beforeEach(async () => {
  built = await buildApp({
    config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir: '/nonexistent-not-used' }),
    db: openDb(':memory:'),
    now: () => new Date('2026-11-20T12:00:00.000Z'),
  });
  descriptions = new Map();
  const jobs: Partial<JobStore> = {
    getPosting: (id) => (id === posting.id ? posting : undefined),
    getDescriptionHtml: (id) => descriptions.get(id) ?? '',
  };
  fetchDescription = vi.fn<SyncService['fetchDescription']>(async (id) => {
    descriptions.set(id, '<p>Fetched description</p>');
    return '<p>Fetched description</p>';
  });
  built.ctx.services.jobs = jobs as JobStore;
  built.ctx.services.sync = { fetchDescription } as Partial<SyncService> as SyncService;
});

afterEach(async () => {
  await built.close();
});

describe('application routes', () => {
  it('saves an indexed job once, fetching a missing description first', async () => {
    const first = await call('POST', '/api/applications', { jobId: 'job-1' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ jobId: 'job-1', status: 'saved', job: { descriptionHtml: '<p>Fetched description</p>' } });
    expect(fetchDescription).toHaveBeenCalledWith('job-1');

    const again = await call('POST', '/api/applications', { jobId: 'job-1' });
    expect(again.body.id).toBe(first.body.id);
    expect(fetchDescription).toHaveBeenCalledTimes(1);
  });

  it('still saves when the description cannot be fetched', async () => {
    fetchDescription.mockRejectedValueOnce(new Error('offline'));
    const res = await call('POST', '/api/applications', { jobId: 'job-1' });
    expect(res.status).toBe(200);
    expect(res.body.job.descriptionHtml).toBe('');
    expect((await call('POST', '/api/applications', { jobId: 'nope' })).status).toBe(404);
  });

  it('validates create bodies', async () => {
    const bad = [
      {},
      { jobId: 'job-1', job: { title: 'X', company: 'Y' } },
      { job: { title: 'X' } },
      { job: { title: 'X', company: 'Y', url: 'javascript:alert(1)' } },
      { job: { title: 'X', company: 'Y' }, notes: 'n'.repeat(20_001) },
      { job: { title: 'X'.repeat(201), company: 'Y' } },
      { job: { title: 'X', company: 'Y' }, status: 'hired' },
      { job: { title: 'X', company: 'Y' }, extra: true },
    ];
    for (const payload of bad) {
      const res = await call('POST', '/api/applications', payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect(res.body.error.code).toBe('validation');
    }
  });

  it('serves the full tracker lifecycle', async () => {
    const created = await call('POST', '/api/applications', {
      job: { title: 'Designer', company: 'Initech', url: 'https://initech.example/jobs/1', descriptionHtml: 'Plain text' },
    });
    expect(created.status).toBe(200);
    const id: string = created.body.id;
    expect(created.body.job.descriptionHtml).toContain('Plain text');

    const stats = await call('GET', '/api/applications/stats');
    expect(stats.body).toMatchObject({ total: 1, byStatus: { saved: 1 } });

    const patched = await call('PATCH', `/api/applications/${id}`, {
      status: 'applied',
      priority: 2,
      contacts: [{ name: 'Sam' }],
      checklist: [{ label: 'Prep' }],
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ status: 'applied', priority: 2, appliedAt: '2026-11-20T12:00:00.000Z' });
    expect(patched.body.contacts[0]).toMatchObject({ name: 'Sam', email: '' });
    expect(patched.body.contacts[0].id).not.toBe('');
    expect((await call('PATCH', `/api/applications/${id}`, { priority: 5 })).status).toBe(400);
    expect((await call('PATCH', `/api/applications/${id}`, { followUpAt: 'soon' })).status).toBe(400);
    expect((await call('PATCH', `/api/applications/${id}`, { unknown: 1 })).status).toBe(400);

    expect((await call('GET', '/api/applications?status=applied&q=initech')).body).toHaveLength(1);
    expect((await call('GET', '/api/applications?status=saved')).body).toHaveLength(0);
    expect((await call('GET', '/api/applications?status=nope')).status).toBe(400);

    const event = await call('POST', `/api/applications/${id}/events`, { type: 'interview', title: 'Onsite', at: '2026-11-28T10:00:00Z' });
    expect(event.body).toMatchObject({ applicationId: id, type: 'interview', at: '2026-11-28T10:00:00.000Z' });
    expect((await call('POST', `/api/applications/${id}/events`, { type: 'party', title: 'x' })).status).toBe(400);

    const doc = await call('POST', `/api/applications/${id}/documents`, {
      kind: 'cover-letter',
      title: 'Letter',
      content: 'Dear Initech',
      generatedBy: 'manual',
    });
    expect(doc.status).toBe(200);
    expect(
      (await call('POST', `/api/applications/${id}/documents`, { kind: 'other', title: 'Big', content: 'x'.repeat(100_001), generatedBy: 'manual' }))
        .status,
    ).toBe(400);
    const docPatch = await call('PATCH', `/api/applications/${id}/documents/${doc.body.id}`, { title: 'Final letter' });
    expect(docPatch.body).toMatchObject({ title: 'Final letter', content: 'Dear Initech' });

    const other = await call('POST', '/api/applications', { job: { title: 'Other', company: 'Co' } });
    expect((await call('DELETE', `/api/applications/${other.body.id}/documents/${doc.body.id}`)).status).toBe(404);
    expect((await call('DELETE', `/api/applications/${other.body.id}/events/${event.body.id}`)).status).toBe(404);

    const detail = await call('GET', `/api/applications/${id}`);
    expect(detail.body.events[0]).toMatchObject({ title: 'Onsite' });
    expect(detail.body.documents).toHaveLength(1);

    expect((await call('DELETE', `/api/applications/${id}/events/${event.body.id}`)).body).toEqual({ ok: true });
    expect((await call('DELETE', `/api/applications/${id}/documents/${doc.body.id}`)).body).toEqual({ ok: true });
    expect((await call('DELETE', `/api/applications/${id}`)).body).toEqual({ ok: true });
    expect((await call('GET', `/api/applications/${id}`)).status).toBe(404);
    expect((await call('PATCH', `/api/applications/${id}`, { notes: 'x' })).status).toBe(404);
    expect((await call('DELETE', `/api/applications/${id}`)).status).toBe(404);
  });
});
