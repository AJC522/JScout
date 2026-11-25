/** Search data: paged results, job detail, and the job actions (save, hide, apply, view) with optimistic updates. */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { SEARCH_PAGE_SIZE } from '../../../shared/constants';
import type { JobDetail, JobUserState, SearchQuery, SearchResponse, SearchResultItem } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { useToast } from '../../components/ui';
import { qk } from '../../lib/query';

export type ResultPages = InfiniteData<SearchResponse, number>;

export function useSearchResults(query: SearchQuery, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: qk.search(query),
    queryFn: ({ pageParam, signal }) => api('POST /api/search', { body: { ...query, offset: pageParam, limit: SEARCH_PAGE_SIZE }, signal }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      // An empty page means the index shrank under us; stop rather than ask forever.
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
    enabled,
    placeholderData: keepPreviousData,
    // The index only changes on sync, and the page offers its own "new jobs" refresh.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Every loaded item once, in order (a posting can shift between pages while the index changes). */
export function flattenPages(data: ResultPages | undefined): SearchResultItem[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: SearchResultItem[] = [];
  for (const page of data.pages) {
    for (const item of page.items) {
      if (seen.has(item.job.id)) continue;
      seen.add(item.job.id);
      out.push(item);
    }
  }
  return out;
}

/** The job, with a search item standing in (header, match) while the full description loads. */
export function useJobDetail(id: string | undefined, placeholder?: SearchResultItem) {
  return useQuery({
    queryKey: qk.job(id ?? ''),
    queryFn: ({ signal }) => api('GET /api/jobs/:id', { params: { id: id ?? '' }, signal }),
    enabled: Boolean(id),
    placeholderData: placeholder && placeholder.job.id === id ? { ...placeholder, descriptionHtml: '' } : undefined,
  });
}

/**
 * User state is per cluster (duplicates share it), so one change updates every cached copy of
 * the job: all result sets and all detail entries.
 */
export function setUserState(queryClient: QueryClient, clusterKey: string, update: (state: JobUserState) => JobUserState): void {
  const patchItem = <T extends SearchResultItem>(item: T): T =>
    item.job.clusterKey === clusterKey ? { ...item, userState: update(item.userState) } : item;
  queryClient.setQueriesData<ResultPages>({ queryKey: qk.searchResults() }, (data) =>
    data?.pages ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(patchItem) })) } : data,
  );
  queryClient.setQueriesData<JobDetail>({ queryKey: qk.jobs() }, (job) => (job?.job ? patchItem(job) : job));
}

type JobRef = Pick<SearchResultItem, 'job' | 'userState'>;

function useUserStateMutation<V extends JobRef, R>(options: {
  request: (vars: V) => Promise<R>;
  optimistic?: (state: JobUserState, vars: V) => JobUserState;
  settled: (state: JobUserState, result: R, vars: V) => JobUserState;
  errorTitle: string;
  onSuccess?: (result: R, vars: V) => void;
  /** Tracker data changes too. */
  touchesTracker?: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: options.request,
    onMutate: (vars) => {
      const { optimistic } = options;
      if (optimistic) setUserState(queryClient, vars.job.clusterKey, (state) => optimistic(state, vars));
      return { previous: vars.userState };
    },
    onSuccess: (result, vars) => {
      setUserState(queryClient, vars.job.clusterKey, (state) => options.settled(state, result, vars));
      if (options.touchesTracker) {
        void queryClient.invalidateQueries({ queryKey: qk.applications() });
        void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
      }
      options.onSuccess?.(result, vars);
    },
    onError: (error, vars, context) => {
      if (context) setUserState(queryClient, vars.job.clusterKey, () => context.previous);
      toast.error(options.errorTitle, { description: errorMessage(error) });
    },
  });
}

/** Add the job to the tracker as "Saved". */
export function useSaveJob() {
  return useUserStateMutation({
    request: (item: JobRef) => api('POST /api/applications', { body: { jobId: item.job.id } }),
    optimistic: (state) => ({ ...state, applicationStatus: 'saved' }),
    settled: (state, app) => ({ ...state, applicationId: app.id, applicationStatus: app.status }),
    errorTitle: 'Could not save the job',
    touchesTracker: true,
  });
}

/** Record that the user applied: moves an existing application, or creates one as "Applied". */
export function useMarkApplied() {
  return useUserStateMutation({
    request: (item: JobRef) =>
      item.userState.applicationId
        ? api('PATCH /api/applications/:id', { params: { id: item.userState.applicationId }, body: { status: 'applied' } })
        : api('POST /api/applications', { body: { jobId: item.job.id, status: 'applied' } }),
    optimistic: (state) => ({ ...state, applicationStatus: 'applied' }),
    settled: (state, app) => ({ ...state, applicationId: app.id, applicationStatus: app.status }),
    errorTitle: 'Could not update your tracker',
    touchesTracker: true,
  });
}

export function useHideJob() {
  return useUserStateMutation({
    request: (item: JobRef) => api('POST /api/jobs/:id/hide', { params: { id: item.job.id } }),
    optimistic: (state) => ({ ...state, hidden: true }),
    settled: (_state, result) => result,
    errorTitle: 'Could not hide the job',
  });
}

export function useUnhideJob() {
  return useUserStateMutation({
    request: (item: JobRef) => api('DELETE /api/jobs/:id/hide', { params: { id: item.job.id } }),
    optimistic: (state) => ({ ...state, hidden: false }),
    settled: (_state, result) => result,
    errorTitle: 'Could not show the job again',
  });
}

/** Marks a job as opened. Silent on failure: dimming a card is not worth an error toast. */
export function useMarkViewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: JobRef) => api('POST /api/jobs/:id/view', { params: { id: item.job.id } }),
    onMutate: (item) => {
      if (!item.userState.viewedAt) setUserState(queryClient, item.job.clusterKey, (state) => ({ ...state, viewedAt: new Date().toISOString() }));
    },
    onSuccess: (state, item) => setUserState(queryClient, item.job.clusterKey, () => state),
  });
}

export function useCheckLiveness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api('POST /api/jobs/:id/check', { params: { id: jobId } }),
    onSuccess: (liveness, jobId) => {
      queryClient.setQueryData<JobDetail>(qk.job(jobId), (job) =>
        job ? { ...job, liveness, job: liveness.status === 'closed' && !job.job.closedAt ? { ...job.job, closedAt: liveness.checkedAt } : job.job } : job,
      );
    },
  });
}

export function useSources() {
  return useQuery({
    queryKey: qk.sources(),
    queryFn: ({ signal }) => api('GET /api/sources', { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useSaveSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; query: SearchQuery }) => api('POST /api/saved-searches', { body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.savedSearches() });
      void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
    },
  });
}

export function useSearchHistory(enabled: boolean) {
  return useQuery({
    queryKey: qk.searchHistory(),
    queryFn: ({ signal }) => api('GET /api/search/history', { signal }),
    enabled,
  });
}

export function useClearHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('DELETE /api/search/history'),
    onSuccess: () => queryClient.setQueryData(qk.searchHistory(), []),
  });
}

export function useProfileQuery(enabled: boolean) {
  return useQuery({
    queryKey: qk.searchFromProfile(),
    queryFn: ({ signal }) => api('GET /api/search/from-profile', { signal }),
    enabled,
  });
}
