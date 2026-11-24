import type { AppContext, ApplicationsService } from '../../services';
import { stubService } from '../../stub';

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createApplicationsService(_ctx: AppContext): ApplicationsService {
  return stubService<ApplicationsService>('applications');
}
