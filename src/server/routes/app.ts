import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ApiRoutes } from '../../shared/api';
import { EVENTS_PATH } from '../../shared/api';
import type { Bootstrap, ServerEvent } from '../../shared/types';
import type { AppContext } from '../services';
import { parse } from '../validate';

const settingsPatchSchema = z.strictObject({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  autoSync: z.boolean().optional(),
  closedRetentionDays: z.number().int().min(0).max(365).optional(),
  maxPostingAgeDays: z.number().int().min(0).max(730).optional(),
  ai: z
    .strictObject({
      apiKey: z.string().trim().max(400).nullable().optional(),
      model: z.string().trim().min(1).max(100).optional(),
    })
    .optional(),
});

/** Health, bootstrap, settings and the server-sent event stream. */
export function registerAppRoutes(app: FastifyInstance, ctx: AppContext): void {
  const s = ctx.services;

  app.get('/api/health', async (): Promise<ApiRoutes['GET /api/health']['res']> => ({
    ok: true,
    version: ctx.config.version,
  }));

  app.get('/api/bootstrap', async (): Promise<Bootstrap> => {
    const profile = s.profile.get();
    const stats = s.applications.stats();
    const active = stats.byStatus.saved + stats.byStatus.applied + stats.byStatus.screening + stats.byStatus.interviewing + stats.byStatus.offer;
    return {
      version: ctx.config.version,
      settings: s.settings.getApp(),
      index: s.sync.summary(),
      profile: {
        onboarded: profile.onboardedAt !== null,
        name: profile.personal.preferredName || profile.personal.fullName,
        completeness: s.profile.completeness().percent,
      },
      tracker: { active, followUpsDue: stats.followUpsDue },
      savedSearches: s.savedSearches.totals(),
    };
  });

  app.get('/api/settings', async () => s.settings.getApp());

  app.patch('/api/settings', async (request) => s.settings.updateApp(parse(settingsPatchSchema, request.body)));

  // Server-sent events: sync progress and index changes. One long-lived response per tab.
  app.get(EVENTS_PATH, (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    const send = (event: ServerEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    res.write('retry: 3000\n\n');
    try {
      send({ type: 'hello', index: s.sync.summary() });
    } catch {
      /* index summary unavailable; the client will fetch it */
    }
    const unsubscribe = ctx.events.subscribe(send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    heartbeat.unref();
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', cleanup);
    res.on('error', cleanup);
  });
}
