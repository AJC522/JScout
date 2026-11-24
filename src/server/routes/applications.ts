import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../services';

/** Application tracker. */
export function registerApplicationRoutes(_app: FastifyInstance, _ctx: AppContext): void {
  // Implemented by the owning feature. Routes must match src/shared/api.ts exactly.
}
