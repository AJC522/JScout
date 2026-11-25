import fs from 'node:fs';
import path from 'node:path';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, LogController } from 'fastify';
import { MAX_RESUME_BYTES } from '../shared/constants';
import type { ApiErrorBody } from '../shared/types';
import type { AppConfig } from './config';
import { type Db, openDb } from './db';
import { ApiError } from './errors';
import { EventBus } from './events';
import { createApplicationsService } from './features/applications/service';
import { createApplyKitService } from './features/applykit/service';
import { createCompaniesService } from './features/companies/service';
import { createGapService } from './features/gaps/service';
import { createProfileService } from './features/profile/service';
import { createSavedSearchService } from './features/saved-searches/service';
import { createSettingsService } from './features/settings/service';
import { createJobStore } from './ingest/store';
import { createSyncService } from './ingest/sync';
import { registerAppRoutes } from './routes/app';
import { registerApplicationRoutes } from './routes/applications';
import { registerApplyKitRoutes } from './routes/applykit';
import { registerGapRoutes } from './routes/gaps';
import { registerProfileRoutes } from './routes/profile';
import { registerSavedSearchRoutes } from './routes/saved-searches';
import { registerSearchRoutes } from './routes/search';
import { registerSourceRoutes } from './routes/sources';
import { createSearchService } from './search/service';
import { createUserStateService } from './search/user-state';
import type { AppContext, Logger, Services } from './services';
import { createHttpClient } from './sources/http';
import type { HttpClient } from './sources/types';

export interface BuildOptions {
  config: AppConfig;
  /** Use an existing database (tests pass an in-memory one). */
  db?: Db;
  /** Replace the outbound HTTP client (tests serve fixtures). */
  http?: HttpClient;
  /** Fixed clock for tests. */
  now?: () => Date;
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
  /** Stop background work and close the database. */
  close(): Promise<void>;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function urlOf(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`);
  } catch {
    return undefined;
  }
}

/**
 * JScout holds personal data and API keys and listens on localhost. Any website
 * the user visits can try to talk to localhost, so:
 *  - reject requests whose Host is not a loopback name (defeats DNS rebinding);
 *  - reject state-changing requests whose Origin is not JScout itself (defeats CSRF): an http
 *    loopback origin on the port the request was sent to. Other local web servers (another port)
 *    can send form posts without a preflight, so the port matters. Through the dev server's proxy
 *    the Host stays the dev server's, so its pages pass as same-origin;
 *  - never send CORS headers.
 */
function isLocalRequest(headers: { host?: string; origin?: string }, method: string): boolean {
  const host = urlOf(headers.host);
  if (!host || !LOCAL_HOSTNAMES.has(host.hostname)) return false;
  if (method !== 'GET' && method !== 'HEAD' && headers.origin !== undefined) {
    const origin = urlOf(headers.origin);
    if (!origin || origin.protocol !== 'http:' || !LOCAL_HOSTNAMES.has(origin.hostname) || origin.port !== host.port) return false;
  }
  return true;
}

export async function buildApp(options: BuildOptions): Promise<BuiltApp> {
  const { config } = options;
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    bodyLimit: 12 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
  });

  const log: Logger = {
    debug: (msg, data) => app.log.debug(data ?? {}, msg),
    info: (msg, data) => app.log.info(data ?? {}, msg),
    warn: (msg, data) => app.log.warn(data ?? {}, msg),
    error: (msg, data) => app.log.error(data ?? {}, msg),
  };

  const ownsDb = !options.db;
  const db = options.db ?? openDb(config.dbPath);
  if (ownsDb) fs.mkdirSync(config.dataDir, { recursive: true });

  const ctx: AppContext = {
    config,
    db,
    http: options.http ?? createHttpClient({ userAgent: config.userAgent }),
    events: new EventBus(),
    log,
    now: options.now ?? (() => new Date()),
    services: {} as Services,
  };

  // Dependency order. Factories must not call other services while constructing.
  ctx.services.settings = createSettingsService(ctx);
  ctx.services.profile = createProfileService(ctx);
  ctx.services.jobs = createJobStore(ctx);
  ctx.services.companies = createCompaniesService(ctx);
  ctx.services.sync = createSyncService(ctx);
  ctx.services.applications = createApplicationsService(ctx);
  ctx.services.userState = createUserStateService(ctx);
  ctx.services.search = createSearchService(ctx);
  ctx.services.savedSearches = createSavedSearchService(ctx);
  ctx.services.applyKit = createApplyKitService(ctx);
  ctx.services.gaps = createGapService(ctx);

  app.addHook('onRequest', async (request, reply) => {
    if (!isLocalRequest(request.headers, request.method)) {
      return reply.code(403).send({
        error: { code: 'forbidden', message: 'JScout only accepts requests from this computer.' },
      } satisfies ApiErrorBody);
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.status).send({
        error: { code: error.code, message: error.message, details: error.details },
      } satisfies ApiErrorBody);
    }
    const err = error as { statusCode?: number; message?: string; code?: string; validation?: unknown };
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) request.log.error({ err: error, url: request.url }, 'request failed');
    return reply.code(status).send({
      error: {
        code: status === 413 ? 'too_large' : status >= 500 ? 'internal' : 'bad_request',
        message: status >= 500 ? 'Something went wrong inside JScout. Check the terminal for details.' : (err.message ?? 'Bad request'),
      },
    } satisfies ApiErrorBody);
  });

  await app.register(fastifyMultipart, { limits: { fileSize: MAX_RESUME_BYTES, files: 1 } });

  registerAppRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerSourceRoutes(app, ctx);
  registerProfileRoutes(app, ctx);
  registerSavedSearchRoutes(app, ctx);
  registerApplicationRoutes(app, ctx);
  registerApplyKitRoutes(app, ctx);
  registerGapRoutes(app, ctx);

  const csp = [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  if (config.clientDir) {
    const clientDir = config.clientDir;
    await app.register(fastifyStatic, {
      root: clientDir,
      wildcard: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.header('Content-Security-Policy', csp);
          res.header('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
    const indexHtml = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8');
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply
          .code(200)
          .header('Content-Type', 'text/html; charset=utf-8')
          .header('Content-Security-Policy', csp)
          .header('Cache-Control', 'no-cache')
          .send(indexHtml);
      }
      return reply.code(404).send({
        error: { code: 'not_found', message: `No such endpoint: ${request.method} ${request.url}` },
      } satisfies ApiErrorBody);
    });
  } else {
    app.setNotFoundHandler((request, reply) =>
      reply.code(404).send({
        error: {
          code: 'not_found',
          message: request.url.startsWith('/api/')
            ? `No such endpoint: ${request.method} ${request.url}`
            : 'The web interface has not been built. Run "npm run build", or use "npm run dev".',
        },
      } satisfies ApiErrorBody),
    );
  }

  let closed = false;
  return {
    app,
    ctx,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await ctx.services.sync.stop();
      } catch {
        /* stub or already stopped */
      }
      await app.close();
      if (ownsDb) db.close();
    },
  };
}
