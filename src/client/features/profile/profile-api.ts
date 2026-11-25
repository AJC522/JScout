/** Data hooks for the profile: queries, the optimistic save, résumé upload and suggestion loaders. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESUME_UPLOAD_PATH, type ProfilePatch, type ResumeResult } from '../../../shared/api';
import type { Bootstrap, Profile } from '../../../shared/types';
import { api, uploadFile } from '../../api/client';
import { qk } from '../../lib/query';
import { applyProfilePatch } from './profile-model';

export function useProfile() {
  return useQuery({ queryKey: qk.profile(), queryFn: ({ signal }) => api('GET /api/profile', { signal }) });
}

export function useCompleteness() {
  return useQuery({
    queryKey: qk.profileCompleteness(),
    queryFn: ({ signal }) => api('GET /api/profile/completeness', { signal }),
  });
}

export function useResumeAnalysis(enabled: boolean) {
  return useQuery({
    queryKey: qk.resumeAnalysis(),
    queryFn: ({ signal }) => api('GET /api/profile/resume/analysis', { signal }),
    enabled,
  });
}

/** Everything derived from the profile (completeness, fit scores, quick-fill, the profile search). */
function invalidateDerived(queryClient: ReturnType<typeof useQueryClient>, profile?: Profile) {
  void queryClient.invalidateQueries({ queryKey: qk.profileExtras() });
  void queryClient.invalidateQueries({ queryKey: qk.searchFromProfile() });
  if (profile) {
    queryClient.setQueryData<Bootstrap>(qk.bootstrap(), (old) =>
      old
        ? {
            ...old,
            profile: {
              ...old.profile,
              onboarded: profile.onboardedAt !== null,
              name: profile.personal.preferredName || profile.personal.fullName,
            },
          }
        : old,
    );
  }
  void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
}

/**
 * PATCH /api/profile. With `optimistic`, the cache shows the change at once and is rolled back if
 * the server refuses it (for list actions like reorder and remove). Forms leave it off: they show
 * their own draft, which must survive a failed save. The server's answer replaces the cache either way.
 */
export function useSaveProfile({ optimistic = false }: { optimistic?: boolean } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => api('PATCH /api/profile', { body: patch }),
    onMutate: async (patch) => {
      if (!optimistic) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: qk.profile() });
      const previous = queryClient.getQueryData<Profile>(qk.profile());
      if (previous) queryClient.setQueryData<Profile>(qk.profile(), applyProfilePatch(previous, patch));
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(qk.profile(), context.previous);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.profile(), saved);
      invalidateDerived(queryClient, saved);
    },
  });
}

export type ResumeInput = { kind: 'file'; file: File } | { kind: 'text'; text: string };

/** Upload a résumé file or pasted text. The result carries the stored résumé and what was found in it. */
export function useUploadResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ResumeInput): Promise<ResumeResult> =>
      input.kind === 'file'
        ? uploadFile<ResumeResult>(RESUME_UPLOAD_PATH, input.file)
        : api('PUT /api/profile/resume/text', { body: { text: input.text } }),
    onSuccess: (result) => {
      queryClient.setQueryData<Profile>(qk.profile(), (old) => (old ? { ...old, resume: result.resume } : old));
      queryClient.setQueryData(qk.resumeAnalysis(), result.analysis);
      void queryClient.invalidateQueries({ queryKey: qk.profileCompleteness() });
      void queryClient.invalidateQueries({ queryKey: qk.profile() });
      invalidateDerived(queryClient);
    },
  });
}

export function useDeleteResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('DELETE /api/profile/resume'),
    onSuccess: (profile) => {
      queryClient.setQueryData(qk.profile(), profile);
      queryClient.removeQueries({ queryKey: qk.resumeAnalysis() });
      invalidateDerived(queryClient, profile);
    },
  });
}

const SUGGESTION_LIMIT = 8;

/**
 * Suggestions are a convenience: when the server cannot answer (offline, not ready), the box
 * simply shows none rather than an error. Aborts still propagate so stale requests are dropped.
 */
async function quietly<T>(request: Promise<T[]>): Promise<T[]> {
  try {
    return await request;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return [];
  }
}

export const suggest = {
  titles: (q: string, signal: AbortSignal) =>
    quietly(api('GET /api/suggest/titles', { query: { q, limit: SUGGESTION_LIMIT }, signal }).then((r) => r.map((s) => s.title))),
  locations: (q: string, signal: AbortSignal) =>
    quietly(api('GET /api/suggest/locations', { query: { q, limit: SUGGESTION_LIMIT }, signal }).then((r) => r.map((p) => p.label))),
  skills: (q: string, signal: AbortSignal) =>
    quietly(api('GET /api/suggest/skills', { query: { q, limit: SUGGESTION_LIMIT }, signal }).then((r) => r.map((s) => s.name))),
  companies: (q: string, signal: AbortSignal) =>
    quietly(api('GET /api/suggest/companies', { query: { q, limit: SUGGESTION_LIMIT }, signal }).then((r) => r.map((c) => c.name))),
};
