/** The search page's URL state: the query, the selected job, and navigation helpers that keep them in step. */
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import type { SearchQuery } from '../../../shared/types';
import { PAGE_PARAMS, paramsToQuery, queryToParams, querySignature } from './url-state';

interface DetailState {
  /** Set when the detail was opened with a history entry of its own, so closing it can go back. */
  detailPushed?: boolean;
}

export function useSearchUrl() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const serialized = params.toString();

  // Re-derived only when the URL changes, so the query object is stable between renders.
  const query = useMemo(() => paramsToQuery(new URLSearchParams(serialized)), [serialized]);
  const signature = querySignature(query);
  const selectedId = params.get(PAGE_PARAMS.job) ?? undefined;
  const from = params.get(PAGE_PARAMS.from) ?? undefined;
  const savedId = params.get(PAGE_PARAMS.saved) ?? undefined;
  const detailPushed = (location.state as DetailState | null)?.detailPushed === true;

  /** Run a new search. Pushes a history entry so Back undoes it; the selection is dropped. */
  const setQuery = useCallback(
    (next: SearchQuery, options: { replace?: boolean } = {}) => {
      const search = queryToParams(next).toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: options.replace });
    },
    [navigate, location.pathname],
  );

  /** Select a job (or clear the selection with undefined), keeping the query as it is. */
  const selectJob = useCallback(
    (id: string | undefined, options: { push?: boolean } = {}) => {
      const current = new URLSearchParams(serialized);
      if (id === current.get(PAGE_PARAMS.job) || (!id && !current.has(PAGE_PARAMS.job))) return;
      if (!id && detailPushed) {
        navigate(-1);
        return;
      }
      if (id) current.set(PAGE_PARAMS.job, id);
      else current.delete(PAGE_PARAMS.job);
      const search = current.toString();
      // Only opening the detail from nothing gets its own entry; moving between jobs replaces it.
      const push = Boolean(options.push && id && !selectedId);
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : '' },
        { replace: !push, state: push ? ({ detailPushed: true } satisfies DetailState) : location.state },
      );
    },
    [navigate, location.pathname, location.state, serialized, detailPushed, selectedId],
  );

  return { query, signature, selectedId, from, savedId, setQuery, selectJob };
}
