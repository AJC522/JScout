/** Data hooks for the settings page. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SourcePatch } from '../../../shared/api';
import type { AiStatus, AppSettings, AppSettingsUpdate, Bootstrap, SourceInfo } from '../../../shared/types';
import { api } from '../../api/client';
import { qk } from '../../lib/query';
import { applySettingsUpdate } from './settings-model';

export function useSettings() {
  return useQuery({ queryKey: qk.settings(), queryFn: ({ signal }) => api('GET /api/settings', { signal }) });
}

/** PATCH /api/settings, shown at once and rolled back if refused; bootstrap carries a copy of the settings too. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  const store = (settings: AppSettings) => {
    queryClient.setQueryData(qk.settings(), settings);
    queryClient.setQueryData<Bootstrap>(qk.bootstrap(), (old) => (old ? { ...old, settings } : old));
  };
  return useMutation({
    mutationFn: (update: AppSettingsUpdate) => api('PATCH /api/settings', { body: update }),
    onMutate: async (update) => {
      await queryClient.cancelQueries({ queryKey: qk.settings() });
      const previous = queryClient.getQueryData<AppSettings>(qk.settings());
      if (previous) store(applySettingsUpdate(previous, update));
      return { previous };
    },
    onError: (_error, _update, context) => {
      if (context?.previous) store(context.previous);
    },
    onSuccess: (saved, update) => {
      store(saved);
      if (update.ai) void queryClient.invalidateQueries({ queryKey: qk.aiStatus() });
    },
  });
}

export function useSources() {
  return useQuery({ queryKey: qk.sources(), queryFn: ({ signal }) => api('GET /api/sources', { signal }) });
}

/** PATCH a source; the enabled switch updates the list at once and rolls back on failure. */
export function usePatchSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SourcePatch }) => api('PATCH /api/sources/:id', { params: { id }, body: patch }),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: qk.sources() });
      const previous = queryClient.getQueryData<SourceInfo[]>(qk.sources());
      if (previous && (patch.enabled !== undefined || patch.ttlMinutes !== undefined)) {
        queryClient.setQueryData<SourceInfo[]>(
          qk.sources(),
          previous.map((s) =>
            s.id === id ? { ...s, enabled: patch.enabled ?? s.enabled, ttlMinutes: patch.ttlMinutes ?? s.ttlMinutes } : s,
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(qk.sources(), context.previous);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<SourceInfo[]>(qk.sources(), (old) => old?.map((s) => (s.id === saved.id ? saved : s)));
      void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
    },
  });
}

export function useAiStatus(enabled: boolean) {
  return useQuery({ queryKey: qk.aiStatus(), queryFn: ({ signal }) => api('GET /api/ai/status', { signal }), enabled });
}

export function useTestAi() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('POST /api/ai/test'),
    onSuccess: (status: AiStatus) => queryClient.setQueryData(qk.aiStatus(), status),
  });
}
