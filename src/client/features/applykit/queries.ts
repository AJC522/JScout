/** Apply-kit data: fit analysis, drafts, AI status, quick-fill and the answer bank. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnswerDraftRequest, CoverLetterRequest, SavedAnswer } from '../../../shared/types';
import { api } from '../../api/client';
import { qk } from '../../lib/query';

/** What the apply kit works on: an application in the tracker, an indexed job, or both. */
export interface ApplyKitTarget {
  applicationId?: string;
  jobId?: string;
}

/** Only the ids the server needs, without undefined keys. */
export function targetBody(target: ApplyKitTarget): ApplyKitTarget {
  return {
    ...(target.applicationId ? { applicationId: target.applicationId } : {}),
    ...(target.jobId ? { jobId: target.jobId } : {}),
  };
}

export function useFitAnalysis(target: ApplyKitTarget) {
  return useQuery({
    queryKey: qk.fitAnalysis(targetBody(target)),
    queryFn: ({ signal }) => api('POST /api/applykit/analyze', { body: targetBody(target), signal }),
    enabled: Boolean(target.applicationId || target.jobId),
  });
}

export function useAiStatus() {
  return useQuery({
    queryKey: qk.aiStatus(),
    queryFn: ({ signal }) => api('GET /api/ai/status', { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useCoverLetter() {
  return useMutation({
    mutationFn: (body: CoverLetterRequest) => api('POST /api/applykit/cover-letter', { body }),
  });
}

export function useAnswerDraft() {
  return useMutation({
    mutationFn: (body: AnswerDraftRequest) => api('POST /api/applykit/answer', { body }),
  });
}

export function useQuickFill() {
  return useQuery({
    queryKey: qk.quickFill(),
    queryFn: ({ signal }) => api('GET /api/profile/quick-fill', { signal }),
  });
}

export function useProfileCompleteness() {
  return useQuery({
    queryKey: qk.profileCompleteness(),
    queryFn: ({ signal }) => api('GET /api/profile/completeness', { signal }),
  });
}

/** Append a question and answer to the profile's answer bank, keeping every existing answer. */
export function useSaveToAnswerBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ question, answer }: { question: string; answer: string }) => {
      // Read fresh so an answer added on another page meanwhile is not dropped.
      const profile = await api('GET /api/profile');
      const added: SavedAnswer = { id: '', question: question.trim(), answer: answer.trim(), tags: [], updatedAt: '' };
      return api('PATCH /api/profile', { body: { answers: [...profile.answers, added] } });
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(qk.profile(), profile);
      void queryClient.invalidateQueries({ queryKey: qk.profileCompleteness() });
      void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
    },
  });
}
