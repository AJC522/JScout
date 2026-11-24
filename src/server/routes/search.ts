import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../services';

/** Search, suggestions, job detail, hide/view/check, search history. */
export function registerSearchRoutes(_app: FastifyInstance, _ctx: AppContext): void {
  // Implemented by the owning feature. Routes must match src/shared/api.ts exactly.
}
