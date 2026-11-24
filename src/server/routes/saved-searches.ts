import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../services';

/** Saved searches. */
export function registerSavedSearchRoutes(_app: FastifyInstance, _ctx: AppContext): void {
  // Implemented by the owning feature. Routes must match src/shared/api.ts exactly.
}
