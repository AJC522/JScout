import type { AppContext, JobStore } from '../services';
import { stubService } from '../stub';

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createJobStore(_ctx: AppContext): JobStore {
  return stubService<JobStore>('jobs');
}
