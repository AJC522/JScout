import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../services';

/** Profile, résumé, quick-fill, data export/import/reset. */
export function registerProfileRoutes(_app: FastifyInstance, _ctx: AppContext): void {
  // Implemented by the owning feature. Routes must match src/shared/api.ts exactly.
}
