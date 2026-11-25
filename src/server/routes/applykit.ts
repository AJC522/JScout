import type { FastifyInstance } from 'fastify';
import {
  analyzeBodySchema,
  answerBodySchema,
  coverLetterBodySchema,
  resumeReviewBodySchema,
  resumeReworkBodySchema,
} from '../features/applykit/schemas';
import type { AppContext } from '../services';
import { parse } from '../validate';

/**
 * Fit analysis, résumé review and rework, cover letters, answer drafts, AI status. Services are read per request so
 * tests can swap them after buildApp. Drafts for an application are returned, never saved:
 * the client saves documents explicitly.
 */
export function registerApplyKitRoutes(app: FastifyInstance, ctx: AppContext): void {
  const kit = () => ctx.services.applyKit;

  app.post('/api/applykit/analyze', async (request) => {
    const body = parse(analyzeBodySchema, request.body);
    await fetchMissingDescription(ctx, body);
    return kit().analyze(body);
  });

  app.post('/api/applykit/cover-letter', async (request) => {
    const body = parse(coverLetterBodySchema, request.body);
    await fetchMissingDescription(ctx, body);
    return kit().coverLetter(body);
  });

  app.post('/api/applykit/answer', async (request) => {
    const body = parse(answerBodySchema, request.body);
    await fetchMissingDescription(ctx, body);
    return kit().answer(body);
  });

  app.post('/api/applykit/resume-review', async (request) => {
    const body = parse(resumeReviewBodySchema, request.body);
    if (!body.posting) await fetchMissingDescription(ctx, body);
    return kit().reviewResume(body);
  });

  app.post('/api/applykit/resume-rework', async (request) => {
    const body = parse(resumeReworkBodySchema, request.body);
    if (!body.posting) await fetchMissingDescription(ctx, body);
    return kit().reworkResume(body);
  });

  app.get('/api/applykit/resume-scores', async () => kit().resumeScores());

  app.get('/api/ai/status', async () => kit().aiStatus());

  app.post('/api/ai/test', async () => kit().aiTest());
}

/**
 * Feed postings often arrive without a description, and an analysis of a snippet is not worth
 * much: fetch it first. Best effort, so the apply kit still works offline. Applications use
 * their own snapshot, so only plain job targets are fetched.
 */
async function fetchMissingDescription(ctx: AppContext, target: { jobId?: string; applicationId?: string }): Promise<void> {
  if (target.jobId === undefined || target.applicationId !== undefined) return;
  try {
    const { jobs, sync } = ctx.services;
    if (!jobs.getPosting(target.jobId) || jobs.getDescriptionHtml(target.jobId) !== '') return;
    await sync.fetchDescription(target.jobId);
  } catch (err) {
    ctx.log.debug('description fetch before apply-kit request failed', { jobId: target.jobId, err: String(err) });
  }
}
