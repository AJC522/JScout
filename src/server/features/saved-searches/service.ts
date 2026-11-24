import type { AppContext, SavedSearchService } from '../../services';
import { stubService } from '../../stub';

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createSavedSearchService(_ctx: AppContext): SavedSearchService {
  return stubService<SavedSearchService>('savedSearches');
}
