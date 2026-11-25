import type { FastifyInstance } from 'fastify';
import type { Ok } from '../../shared/api';
import { notFound } from '../errors';
import {
  applicationCreateSchema,
  applicationListQuerySchema,
  applicationPatchSchema,
  documentCreateSchema,
  documentParamsSchema,
  documentPatchSchema,
  eventCreateSchema,
  eventParamsSchema,
  idParamsSchema,
} from '../features/applications/schemas';
import type { AppContext } from '../services';
import { parse } from '../validate';

const OK: Ok = { ok: true };

/** Application tracker. Services are read per request so tests can swap them after buildApp. */
export function registerApplicationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const s = ctx.services;

  app.get('/api/applications', async (request) => s.applications.list(parse(applicationListQuerySchema, request.query)));

  // Registered before /:id so "stats" is never taken for an id.
  app.get('/api/applications/stats', async () => s.applications.stats());

  app.post('/api/applications', async (request) => {
    const body = parse(applicationCreateSchema, request.body);
    if (body.jobId !== undefined) await fetchMissingDescription(ctx, body.jobId);
    return s.applications.create(body);
  });

  app.get('/api/applications/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const found = s.applications.get(id);
    if (!found) throw notFound('Application');
    return found;
  });

  app.patch('/api/applications/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return s.applications.patch(id, parse(applicationPatchSchema, request.body));
  });

  app.delete('/api/applications/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    s.applications.remove(id);
    return OK;
  });

  app.post('/api/applications/:id/events', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return s.applications.addEvent(id, parse(eventCreateSchema, request.body));
  });

  app.delete('/api/applications/:id/events/:eventId', async (request) => {
    const { id, eventId } = parse(eventParamsSchema, request.params);
    s.applications.removeEvent(id, eventId);
    return OK;
  });

  app.post('/api/applications/:id/documents', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return s.applications.addDocument(id, parse(documentCreateSchema, request.body));
  });

  app.patch('/api/applications/:id/documents/:docId', async (request) => {
    const { id, docId } = parse(documentParamsSchema, request.params);
    return s.applications.patchDocument(id, docId, parse(documentPatchSchema, request.body));
  });

  app.delete('/api/applications/:id/documents/:docId', async (request) => {
    const { id, docId } = parse(documentParamsSchema, request.params);
    s.applications.removeDocument(id, docId);
    return OK;
  });
}

/**
 * Feed postings often omit the description; fetch it before the snapshot is taken so the
 * tracker keeps the full posting. Best effort: saving must work offline too. Skipped when
 * the job is unknown (create() answers 404) or already tracked (create() returns that one).
 */
async function fetchMissingDescription(ctx: AppContext, jobId: string): Promise<void> {
  const { jobs, applications, sync } = ctx.services;
  const posting = jobs.getPosting(jobId);
  if (!posting || applications.stateByCluster([posting.clusterKey]).size > 0) return;
  if (jobs.getDescriptionHtml(jobId) !== '') return;
  try {
    await sync.fetchDescription(jobId);
  } catch (err) {
    ctx.log.debug('description fetch before saving failed', { jobId, err: String(err) });
  }
}
