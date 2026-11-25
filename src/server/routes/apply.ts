import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../services';
import { parse } from '../validate';

const id = z.string().trim().min(1).max(200);
const target = z.strictObject({ jobId: id.optional(), applicationId: id.optional() }).refine((t) => t.jobId || t.applicationId, 'jobId or applicationId is required');

const sendSchema = z
  .strictObject({
    jobId: id.optional(),
    applicationId: id.optional(),
    to: z.string().trim().min(1).max(1000),
    cc: z.string().trim().max(1000).optional(),
    subject: z.string().max(300),
    body: z.string().max(25_000),
    attachResume: z.boolean(),
  })
  .refine((t) => t.jobId || t.applicationId, 'jobId or applicationId is required');

/**
 * Applying by email: a draft, sending it (which also records the application as made), and a
 * test message for the account set up in Settings. Services are read per request so tests can swap them.
 */
export function registerApplyRoutes(app: FastifyInstance, ctx: AppContext): void {
  const service = () => ctx.services.emailApply;

  app.post('/api/apply/email/draft', async (request) => {
    const body = parse(target, request.body);
    // The posting's address is in its description: fetch one the feed left out (best effort).
    if (body.jobId && !body.applicationId) {
      try {
        if (ctx.services.jobs.getPosting(body.jobId) && ctx.services.jobs.getDescriptionHtml(body.jobId) === '') await ctx.services.sync.fetchDescription(body.jobId);
      } catch (err) {
        ctx.log.debug('description fetch before email draft failed', { jobId: body.jobId, err: String(err) });
      }
    }
    return service().draft(body);
  });

  app.post('/api/apply/email/send', async (request) => service().send(parse(sendSchema, request.body)));

  app.post('/api/email/test', async () => service().test());
}
