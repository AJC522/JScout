import type { AppContext, UserStateService } from '../services';
import { stubService } from '../stub';

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createUserStateService(_ctx: AppContext): UserStateService {
  return stubService<UserStateService>('userState');
}
