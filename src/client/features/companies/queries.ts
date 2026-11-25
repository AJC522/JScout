/** Company board data with optimistic follow/unfollow and removal. */
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { CompanyBulkUpdate, CompanyList, CompanyListQuery } from '../../../shared/api';
import type { AtsKind, CompanyBoard } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { useToast } from '../../components/ui';
import { qk } from '../../lib/query';

export function useCompanies(query: CompanyListQuery) {
  return useQuery({
    queryKey: qk.companies(query),
    queryFn: ({ signal }) => api('GET /api/companies', { query, signal }),
    placeholderData: keepPreviousData,
  });
}

type Snapshot = Array<[QueryKey, CompanyList | undefined]>;

/** Apply `update` to every cached company page now; returns what to restore if the request fails. */
function patchLists(queryClient: QueryClient, update: (list: CompanyList) => CompanyList): Snapshot {
  const snapshot = queryClient.getQueriesData<CompanyList>({ queryKey: qk.companies() });
  queryClient.setQueriesData<CompanyList>({ queryKey: qk.companies() }, (list) => (list?.items ? update(list) : list));
  return snapshot;
}

function restore(queryClient: QueryClient, snapshot: Snapshot | undefined): void {
  for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data);
}

function useRefreshAfter() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.companies() });
    void queryClient.invalidateQueries({ queryKey: qk.sources() });
    void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
  };
}

export function useSetFollowing() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: ({ company, enabled }: { company: CompanyBoard; enabled: boolean }) =>
      api('PATCH /api/companies/:id', { params: { id: company.id }, body: { enabled } }),
    onMutate: async ({ company, enabled }) => {
      await queryClient.cancelQueries({ queryKey: qk.companies() });
      return patchLists(queryClient, (list) => ({
        ...list,
        enabledTotal: list.items.some((c) => c.id === company.id && c.enabled !== enabled) ? list.enabledTotal + (enabled ? 1 : -1) : list.enabledTotal,
        items: list.items.map((c) => (c.id === company.id ? { ...c, enabled } : c)),
      }));
    },
    onError: (error, { company }, snapshot) => {
      restore(queryClient, snapshot);
      toast.error(`Could not update ${company.name}`, { description: errorMessage(error) });
    },
    onSettled: refresh,
  });
}

export function useRemoveCompany() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: (company: CompanyBoard) => api('DELETE /api/companies/:id', { params: { id: company.id } }),
    onMutate: async (company) => {
      await queryClient.cancelQueries({ queryKey: qk.companies() });
      return patchLists(queryClient, (list) => {
        const present = list.items.find((c) => c.id === company.id);
        if (!present) return list;
        return {
          ...list,
          total: list.total - 1,
          enabledTotal: present.enabled ? list.enabledTotal - 1 : list.enabledTotal,
          items: list.items.filter((c) => c.id !== company.id),
        };
      });
    },
    onSuccess: (_res, company) => toast.success(`Removed ${company.name}`, { description: 'JScout will stop checking its job board.' }),
    onError: (error, company, snapshot) => {
      restore(queryClient, snapshot);
      toast.error(`Could not remove ${company.name}`, { description: errorMessage(error) });
    },
    onSettled: refresh,
  });
}

export function useBulkFollow() {
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: (body: CompanyBulkUpdate) => api('POST /api/companies/bulk', { body }),
    onSettled: refresh,
  });
}

export function useDetectCompany() {
  return useMutation({
    mutationFn: (input: string) => api('POST /api/companies/detect', { body: { input: input.trim() } }),
  });
}

export function useAddCompany() {
  const refresh = useRefreshAfter();
  return useMutation({
    mutationFn: (input: { ats: AtsKind; token: string; name: string }) => api('POST /api/companies', { body: input }),
    onSuccess: refresh,
  });
}

/** Ask for a sync of one ATS so a newly added board's jobs show up soon. */
export function useRequestSync() {
  return useMutation({
    mutationFn: (sources: string[]) => api('POST /api/sync', { body: { sources } }),
  });
}

export function useCompanySources() {
  return useQuery({
    queryKey: qk.sources(),
    queryFn: ({ signal }) => api('GET /api/sources', { signal }),
    staleTime: 60_000,
  });
}
