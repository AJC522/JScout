import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ok } from '../../shared/api';
import { searchQuerySchema } from '../../shared/schemas';
import { savedSearchNameSchema } from '../features/saved-searches/service';
import type { AppContext } from '../services';
import { parse } from '../validate';

const idParamsSchema = z.object({ id: z.string().min(1).max(200) });
const createSchema = z.strictObject({ name: savedSearchNameSchema, query: searchQuerySchema });
const patchSchema = z.strictObject({
  name: savedSearchNameSchema.optional(),
  query: searchQuerySchema.optional(),
  pinned: z.boolean().optional(),
});

/** Saved searches. Services are read per request so tests can swap them after buildApp. */
export function registerSavedSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const s = ctx.services;

  app.get('/api/saved-searches', async () => s.savedSearches.list());

  app.post('/api/saved-searches', async (request) => s.savedSearches.create(parse(createSchema, request.body)));

  app.patch('/api/saved-searches/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return s.savedSearches.patch(id, parse(patchSchema, request.body));
  });

  app.post('/api/saved-searches/:id/viewed', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return s.savedSearches.markViewed(id);
  });

  app.delete('/api/saved-searches/:id', async (request): Promise<Ok> => {
    const { id } = parse(idParamsSchema, request.params);
    s.savedSearches.remove(id);
    return { ok: true };
  });
}
