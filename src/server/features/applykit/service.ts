import type { AppContext, ApplyKitService } from '../../services';
import { stubService } from '../../stub';

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createApplyKitService(_ctx: AppContext): ApplyKitService {
  return stubService<ApplyKitService>('applyKit');
}
