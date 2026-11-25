/** Apply-kit data: fit analysis, drafts, AI status, quick-fill and the answer bank. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnswerDraftRequest, CoverLetterRequest, EmailApplicationSend, SavedAnswer } from '../../../shared/types';
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

/** The application email for a job or application (refetched when the target changes). */
export function useEmailDraft(target: ApplyKitTarget, enabled = true) {
  return useQuery({
    queryKey: qk.emailDraft(targetBody(target)),
    queryFn: ({ signal }) => api('POST /api/apply/email/draft', { body: targetBody(target), signal }),
    enabled: enabled && Boolean(target.applicationId || target.jobId),
    // A draft is edited locally; refetching underneath the user would be confusing.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** Send an application email; the tracker, the job and search results all change (it is now applied). */
export function useSendEmailApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EmailApplicationSend) => api('POST /api/apply/email/send', { body }),
    onSuccess: (result) => {
      queryClient.setQueryData(qk.application(result.application.id), result.application);
      void queryClient.invalidateQueries({ queryKey: qk.applications() });
      void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
      void queryClient.invalidateQueries({ queryKey: qk.jobs() });
      void queryClient.invalidateQueries({ queryKey: qk.searchResults() });
      void queryClient.invalidateQueries({ queryKey: ['profile-extras', 'email-draft'] });
    },
  });
}

export function useTestEmail() {
  return useMutation({ mutationFn: () => api('POST /api/email/test') });
}
