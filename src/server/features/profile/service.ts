import type { AppContext, ProfileService } from '../../services';
import { stubService } from '../../stub';

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createProfileService(_ctx: AppContext): ProfileService {
  return stubService<ProfileService>('profile');
}
