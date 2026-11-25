import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ok } from '../../shared/api';
import { searchQuerySchema } from '../../shared/schemas';
import type { JobDetail, JobUserState, SearchQuery } from '../../shared/types';
import { notFound } from '../errors';
import { stableHash } from '../lib/text';
import type { AppContext } from '../services';
import { parse, queryInt } from '../validate';

const idParamsSchema = z.object({ id: z.string().min(1).max(200) });
const suggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: queryInt(1, 20).default(8),
});

/** The same upstream search is not repeated within this window; new postings arrive via 'index-changed'. */
const UPSTREAM_REPEAT_MS = 30 * 60_000;
/** How long opening a job waits for a missing description before showing what it has. */
const DESCRIPTION_TIMEOUT_MS = 6_000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Search, suggestions, job detail, hide/view/check, search history. Services are read per request so tests can swap them. */
export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const s = ctx.services;
  const upstreamRuns = new Map<string, number>();

  /** Ask enabled search-mode sources for this query in the background (never delays or fails the search). */
  function searchUpstream(query: SearchQuery): void {
    try {
      if (!s.sync.sourceInfos().some((src) => src.mode === 'search' && src.enabled && src.configured)) return;
      const upstream = s.search.toUpstreamQuery(query);
      if (upstream.keywords.length === 0) return;
      const now = ctx.now().getTime();
      for (const [sig, at] of upstreamRuns) if (now - at >= UPSTREAM_REPEAT_MS) upstreamRuns.delete(sig);
      const sig = stableHash(JSON.stringify(upstream));
      if (upstreamRuns.has(sig)) return;
      upstreamRuns.set(sig, now);
      s.sync.searchUpstream(upstream).catch((err: unknown) => ctx.log.warn('upstream search failed', { err: String(err) }));
    } catch (err) {
      ctx.log.warn('could not start upstream search', { err: String(err) });
    }
  }

  function postingOr404(id: string) {
    const job = s.jobs.getPosting(id);
    if (!job) throw notFound('Job');
    return job;
  }

  app.post('/api/search', async (request) => {
    const query = parse(searchQuerySchema, request.body);
    const response = s.search.search(query);
    if ((query.offset ?? 0) === 0) {
      s.search.recordHistory(query, response.total);
      searchUpstream(query);
    }
    return response;
  });

  app.get('/api/search/from-profile', async () => s.search.queryFromProfile());

  app.get('/api/search/history', async () => s.search.history());

  app.delete('/api/search/history', async (): Promise<Ok> => {
    s.search.clearHistory();
    return { ok: true };
  });

  app.get('/api/suggest/titles', async (request) => {
    const { q, limit } = parse(suggestQuerySchema, request.query);
    return s.search.suggestTitles(q, limit);
  });

  app.get('/api/suggest/locations', async (request) => {
    const { q, limit } = parse(suggestQuerySchema, request.query);
    return s.search.suggestLocations(q, limit);
  });

  app.get('/api/suggest/skills', async (request) => {
    const { q, limit } = parse(suggestQuerySchema, request.query);
    return s.search.suggestSkills(q, limit);
  });

  app.get('/api/suggest/companies', async (request) => {
    const { q, limit } = parse(suggestQuerySchema, request.query);
    return s.search.suggestCompanies(q, limit);
  });

  app.get('/api/jobs/:id', async (request): Promise<JobDetail> => {
    const { id } = parse(idParamsSchema, request.params);
    const detail = s.search.jobDetail(id);
    if (!detail) throw notFound('Job');
    if (detail.descriptionHtml) return detail;
    // Some sources list jobs without descriptions: fetch it now, but never keep the user waiting long.
    const fetched = await withTimeout(
      s.sync.fetchDescription(id).catch((err: unknown) => {
        ctx.log.warn('fetching a job description failed', { id, err: String(err) });
        return '';
      }),
      DESCRIPTION_TIMEOUT_MS,
      '',
    );
    return fetched ? (s.search.jobDetail(id) ?? detail) : detail;
  });

  app.post('/api/jobs/:id/view', async (request): Promise<JobUserState> => {
    const job = postingOr404(parse(idParamsSchema, request.params).id);
    s.userState.markViewed(job);
    return s.userState.forCluster(job.clusterKey);
  });

  app.post('/api/jobs/:id/hide', async (request): Promise<JobUserState> => {
    const job = postingOr404(parse(idParamsSchema, request.params).id);
    s.userState.hide(job);
    return s.userState.forCluster(job.clusterKey);
  });

  app.delete('/api/jobs/:id/hide', async (request): Promise<JobUserState> => {
    const job = postingOr404(parse(idParamsSchema, request.params).id);
    s.userState.unhide(job.clusterKey);
    return s.userState.forCluster(job.clusterKey);
  });

  app.post('/api/jobs/:id/check', async (request) => {
    const job = postingOr404(parse(idParamsSchema, request.params).id);
    return s.sync.checkLiveness(job.id);
  });
}
