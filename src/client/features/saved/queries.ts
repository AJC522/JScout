/** Saved-search data with optimistic rename, pin, delete and "viewed". */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SavedSearch } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { useToast } from '../../components/ui';
import { qk } from '../../lib/query';

export const SAVED_SEARCH_NAME_MAX = 120;

/** Pinned first; otherwise the server's order (most recently updated first) is kept. */
export function orderSavedSearches(list: readonly SavedSearch[]): SavedSearch[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function useSavedSearches() {
  return useQuery({
    queryKey: qk.savedSearches(),
    queryFn: ({ signal }) => api('GET /api/saved-searches', { signal }),
    select: orderSavedSearches,
  });
}

/** Shared optimistic plumbing: apply `update` to the cached list now, roll back if the request fails. */
function useSavedSearchMutation<V>(options: {
  request: (vars: V) => Promise<unknown>;
  update: (list: SavedSearch[], vars: V) => SavedSearch[];
  errorTitle: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: options.request,
    onMutate: async (vars: V) => {
      await queryClient.cancelQueries({ queryKey: qk.savedSearches() });
      const previous = queryClient.getQueryData<SavedSearch[]>(qk.savedSearches());
      if (previous) queryClient.setQueryData(qk.savedSearches(), options.update(previous, vars));
      return previous;
    },
    onError: (err, _vars, previous) => {
      if (previous) queryClient.setQueryData(qk.savedSearches(), previous);
      toast.error(options.errorTitle, { description: errorMessage(err) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.savedSearches() });
      // The sidebar badge counts saved searches and their new results.
      void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
    },
  });
}

export function useUpdateSavedSearch() {
  return useSavedSearchMutation<{ id: string; name?: string; pinned?: boolean }>({
    request: ({ id, ...body }) => api('PATCH /api/saved-searches/:id', { params: { id }, body }),
    update: (list, { id, ...patch }) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    errorTitle: 'Could not update the saved search',
  });
}

export function useDeleteSavedSearch() {
  return useSavedSearchMutation<string>({
    request: (id) => api('DELETE /api/saved-searches/:id', { params: { id } }),
    update: (list, id) => list.filter((s) => s.id !== id),
    errorTitle: 'Could not delete the saved search',
  });
}

/** Marks a search as looked at (clears its "new" count). Failures are not worth interrupting the user for. */
export function useMarkViewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('POST /api/saved-searches/:id/viewed', { params: { id } }),
    onSuccess: (saved) => {
      queryClient.setQueryData<SavedSearch[]>(qk.savedSearches(), (list) => list?.map((s) => (s.id === saved.id ? saved : s)));
      void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
    },
  });
}
