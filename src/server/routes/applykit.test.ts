import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiStatus, FitAnalysis, ResumeReview } from '../../shared/types';
import { type BuiltApp, buildApp } from '../app';
import { loadConfig } from '../config';
import { openDb } from '../db';
import { notFound } from '../errors';
import type { ApplyKitService, JobStore, SyncService } from '../services';

let built: BuiltApp;
let kit: { [K in keyof ApplyKitService]: ReturnType<typeof vi.fn> };
let descriptions: Map<string, string>;
let fetchDescription: ReturnType<typeof vi.fn<SyncService['fetchDescription']>>;

const status: AiStatus = { configured: false, model: 'claude-opus-5-5' };

async function call(method: 'GET' | 'POST', url: string, payload?: object) {
  const res = await built.app.inject({ method, url, headers: { host: 'localhost:4310' }, ...(payload ? { payload } : {}) });
  return { status: res.statusCode, body: res.json() };
}

beforeEach(async () => {
  built = await buildApp({
    config: loadConfig({ logLevel: 'silent', disableSync: true, clientDir: undefined, dataDir: '/nonexistent-not-used' }),
    db: openDb(':memory:'),
    now: () => new Date('2026-11-20T12:00:00.000Z'),
  });
  kit = {
    analyze: vi.fn((target: { jobId?: string }) => {
      if (target.jobId === 'missing') throw notFound('Job');
      return { score: 70 } as FitAnalysis;
    }),
    coverLetter: vi.fn(async () => ({ content: 'Dear team,', generatedBy: 'template' })),
    answer: vi.fn(async () => ({ content: 'Because…', generatedBy: 'template', related: [] })),
    reviewResume: vi.fn(() => ({ score: 64 }) as ResumeReview),
    reworkResume: vi.fn(async () => ({ content: 'MAYA CHEN', generatedBy: 'template', changes: [] })),
    resumeScores: vi.fn(() => []),
    aiStatus: vi.fn(() => status),
    aiTest: vi.fn(async () => ({ ...status, lastError: 'No AI key is configured.' })),
  };
  descriptions = new Map([['job-full', '<p>Has one</p>']]);
  fetchDescription = vi.fn<SyncService['fetchDescription']>(async () => '<p>Fetched</p>');
  built.ctx.services.applyKit = kit as unknown as ApplyKitService;
  built.ctx.services.jobs = {
    getPosting: (id: string) => (id === 'job-empty' || id === 'job-full' ? { id } : undefined),
    getDescriptionHtml: (id: string) => descriptions.get(id) ?? '',
  } as unknown as JobStore;
  built.ctx.services.sync = { fetchDescription } as Partial<SyncService> as SyncService;
});

afterEach(async () => {
  await built.close();
});

describe('apply kit routes', () => {
  it('analyses a job, fetching a missing description first', async () => {
    const res = await call('POST', '/api/applykit/analyze', { jobId: 'job-empty' });
    expect(res).toEqual({ status: 200, body: { score: 70 } });
    expect(fetchDescription).toHaveBeenCalledWith('job-empty');
    expect(kit.analyze).toHaveBeenCalledWith({ jobId: 'job-empty' });

    await call('POST', '/api/applykit/analyze', { jobId: 'job-full' });
    await call('POST', '/api/applykit/analyze', { applicationId: 'app-1' });
    expect(fetchDescription).toHaveBeenCalledTimes(1);
  });

  it('still answers when the description cannot be fetched', async () => {
    fetchDescription.mockRejectedValueOnce(new Error('offline'));
    expect((await call('POST', '/api/applykit/analyze', { jobId: 'job-empty' })).status).toBe(200);
  });

  it('validates bodies', async () => {
    expect((await call('POST', '/api/applykit/analyze', {})).body).toMatchObject({ error: { code: 'validation' } });
    expect((await call('POST', '/api/applykit/analyze', { jobId: 'x', extra: 1 })).status).toBe(400);
    const letter = { jobId: 'job-full', tone: 'warm', length: 'short', mode: 'template' };
    expect((await call('POST', '/api/applykit/cover-letter', { ...letter, tone: 'sarcastic' })).status).toBe(400);
    expect((await call('POST', '/api/applykit/cover-letter', { ...letter, notes: 'x'.repeat(2001) })).status).toBe(400);
    expect((await call('POST', '/api/applykit/cover-letter', { tone: 'warm', length: 'short', mode: 'ai' })).status).toBe(400);
    const answer = { question: 'Why us?', mode: 'bank' };
    expect((await call('POST', '/api/applykit/answer', { ...answer, question: '   ' })).status).toBe(400);
    expect((await call('POST', '/api/applykit/answer', { ...answer, question: 'q'.repeat(2001) })).status).toBe(400);
    expect((await call('POST', '/api/applykit/answer', { ...answer, maxWords: 29 })).status).toBe(400);
    expect((await call('POST', '/api/applykit/answer', { ...answer, maxWords: 801 })).status).toBe(400);
    expect((await call('POST', '/api/applykit/answer', { ...answer, mode: 'magic' })).status).toBe(400);
    expect(kit.coverLetter).not.toHaveBeenCalled();
    expect(kit.answer).not.toHaveBeenCalled();
  });

  it('passes valid requests through and returns drafts without saving them', async () => {
    const letter = { applicationId: 'app-1', tone: 'concise', length: 'long', mode: 'ai', notes: 'Relocating in March.' };
    expect(await call('POST', '/api/applykit/cover-letter', letter)).toEqual({
      status: 200,
      body: { content: 'Dear team,', generatedBy: 'template' },
    });
    expect(kit.coverLetter).toHaveBeenCalledWith(letter);

    const answer = { question: '  Why do you want to work here?  ', mode: 'ai', maxWords: 150 };
    expect((await call('POST', '/api/applykit/answer', answer)).body).toEqual({ content: 'Because…', generatedBy: 'template', related: [] });
    expect(kit.answer).toHaveBeenCalledWith({ ...answer, question: 'Why do you want to work here?' });
  });

  it('maps service errors to HTTP errors', async () => {
    expect((await call('POST', '/api/applykit/analyze', { jobId: 'missing' })).status).toBe(404);
  });

  it('reviews and reworks résumés against jobs, applications and pasted postings', async () => {
    expect(await call('POST', '/api/applykit/resume-review', { jobId: 'job-empty' })).toEqual({ status: 200, body: { score: 64 } });
    expect(fetchDescription).toHaveBeenCalledWith('job-empty');

    const posting = { title: ' Data Analyst ', description: 'Requirements\n- SQL' };
    await call('POST', '/api/applykit/resume-review', { posting, resumeText: 'Draft' });
    expect(kit.reviewResume).toHaveBeenLastCalledWith({ posting: { title: 'Data Analyst', description: 'Requirements\n- SQL' }, resumeText: 'Draft' });
    expect(fetchDescription).toHaveBeenCalledTimes(1);

    expect((await call('POST', '/api/applykit/resume-rework', { applicationId: 'app-1', mode: 'ai' })).body).toEqual({
      content: 'MAYA CHEN',
      generatedBy: 'template',
      changes: [],
    });
    expect(kit.reworkResume).toHaveBeenCalledWith({ applicationId: 'app-1', mode: 'ai' });
    expect(await call('GET', '/api/applykit/resume-scores')).toEqual({ status: 200, body: [] });
  });

  it('validates résumé review bodies', async () => {
    const bad = [
      {},
      { resumeText: 'x' },
      { jobId: 'x', resumeText: 'x'.repeat(100_001) },
      { posting: { title: '', description: 'x' } },
      { posting: { title: 'x' } },
      { posting: { title: 'x', description: 'y', salary: 1 } },
      { jobId: 'x', extra: true },
    ];
    for (const body of bad) expect((await call('POST', '/api/applykit/resume-review', body)).status).toBe(400);
    expect((await call('POST', '/api/applykit/resume-rework', { jobId: 'x' })).status).toBe(400);
    expect((await call('POST', '/api/applykit/resume-rework', { jobId: 'x', mode: 'magic' })).status).toBe(400);
    expect(kit.reviewResume).not.toHaveBeenCalled();
    expect(kit.reworkResume).not.toHaveBeenCalled();
  });

  it('reports and tests AI status', async () => {
    expect(await call('GET', '/api/ai/status')).toEqual({ status: 200, body: status });
    expect((await call('POST', '/api/ai/test')).body).toEqual({ ...status, lastError: 'No AI key is configured.' });
  });
});
