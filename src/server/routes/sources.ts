import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiRoutes, Ok } from '../../shared/api';
import { atsKindSchema } from '../../shared/schemas';
import { notFound } from '../errors';
import type { AppContext } from '../services';
import { getSource } from '../sources/registry';
import { parse, queryBoolean, queryInt } from '../validate';

type Res<K extends keyof ApiRoutes> = Promise<ApiRoutes[K]['res']>;

const sourceId = z.string().trim().min(1).max(60);
const sourceParams = z.object({ id: sourceId });
const companyParams = z.object({ id: z.string().trim().min(1).max(200) });

const sourcePatchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  config: z
    .record(z.string().min(1).max(60), z.string().max(400).nullable())
    .refine((config) => Object.keys(config).length <= 20, 'too many config values')
    .optional(),
  ttlMinutes: z.number().int().min(15).max(10_080).optional(),
});

const syncRequestSchema = z.strictObject({
  sources: z.array(sourceId).max(50).optional(),
  force: z.boolean().optional(),
});

const companyName = z.string().trim().min(1).max(200);
const industry = z.string().trim().min(1).max(60);
const origin = z.enum(['seed', 'user']);

const companyListSchema = z.object({
  q: z.string().trim().max(200).optional(),
  ats: atsKindSchema.optional(),
  enabled: queryBoolean.optional(),
  origin: origin.optional(),
  industry: industry.optional(),
  limit: queryInt(1, 1000).optional(),
  offset: queryInt(0, 1_000_000).optional(),
});

const detectSchema = z.strictObject({ input: z.string().trim().min(1).max(500) });

const companyCreateSchema = z.strictObject({
  ats: atsKindSchema,
  token: z.string().trim().min(1).max(100),
  name: companyName,
  industry: industry.optional(),
});

const companyBulkSchema = z.strictObject({
  enabled: z.boolean(),
  ids: z.array(z.string().min(1).max(200)).max(10_000).optional(),
  industry: industry.optional(),
  origin: origin.optional(),
});

const companyPatchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  name: companyName.optional(),
});

/** Sources, syncing and company boards. Services are read per request (tests swap them). */
export function registerSourceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const s = ctx.services;

  app.get('/api/sources', async (): Res<'GET /api/sources'> => s.sync.sourceInfos());

  app.patch('/api/sources/:id', async (request): Res<'PATCH /api/sources/:id'> => {
    const { id } = parse(sourceParams, request.params);
    const patch = parse(sourcePatchSchema, request.body);
    return s.sync.updateSource(id, patch);
  });

  app.post('/api/sources/:id/test', async (request): Res<'POST /api/sources/:id/test'> => {
    const { id } = parse(sourceParams, request.params);
    return s.sync.testSource(id);
  });

  app.get('/api/sync', async (): Res<'GET /api/sync'> => s.sync.summary());

  app.post('/api/sync', async (request): Res<'POST /api/sync'> => {
    const body = parse(syncRequestSchema, request.body ?? {});
    const unknown = body.sources?.find((id) => !getSource(id));
    if (unknown !== undefined) throw notFound(`Source "${unknown}"`);
    return { queued: s.sync.requestSync({ ...(body.sources ? { sources: body.sources } : {}), force: body.force ?? false }) };
  });

  app.get('/api/companies', async (request): Res<'GET /api/companies'> => {
    const query = parse(companyListSchema, request.query);
    return s.companies.list(query);
  });

  app.post('/api/companies/detect', async (request): Res<'POST /api/companies/detect'> => {
    const { input } = parse(detectSchema, request.body);
    return s.companies.detect(input);
  });

  app.post('/api/companies', async (request): Res<'POST /api/companies'> => {
    const body = parse(companyCreateSchema, request.body);
    return s.companies.add(body);
  });

  app.post('/api/companies/bulk', async (request): Res<'POST /api/companies/bulk'> => {
    const body = parse(companyBulkSchema, request.body);
    return { updated: s.companies.bulk(body) };
  });

  app.patch('/api/companies/:id', async (request): Res<'PATCH /api/companies/:id'> => {
    const { id } = parse(companyParams, request.params);
    const patch = parse(companyPatchSchema, request.body);
    return s.companies.patch(id, patch);
  });

  app.delete('/api/companies/:id', async (request): Promise<Ok> => {
    const { id } = parse(companyParams, request.params);
    s.companies.remove(id);
    return { ok: true };
  });
}
