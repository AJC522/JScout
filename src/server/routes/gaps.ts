import type { FastifyInstance } from 'fastify';
import { gapRequestSchema } from '../features/gaps/schemas';
import type { AppContext } from '../services';
import { parse } from '../validate';

/** Skill gaps across a set of jobs. The service is read per request so tests can swap it. */
export function registerGapRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/gaps', async (request) => ctx.services.gaps.analyze(parse(gapRequestSchema, request.body)));
}
