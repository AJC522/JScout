/** Résumé review data: the review of a target, scores across applications, drafts and re-checks. */
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ResumeReviewRequest, ResumeReworkRequest, ResumeTarget } from '../../../shared/types';
import { api } from '../../api/client';
import { qk } from '../../lib/query';
import { targetKey } from './model';

/** Only the fields the server needs, without undefined keys. */
export function resumeTargetBody(target: ResumeTarget): ResumeTarget {
  return {
    ...(target.applicationId ? { applicationId: target.applicationId } : {}),
    ...(target.jobId ? { jobId: target.jobId } : {}),
    ...(target.posting ? { posting: target.posting } : {}),
  };
}

/** The saved résumé reviewed against a target. Disabled until there is a target and a résumé. */
export function useResumeReview(target: ResumeTarget, enabled = true) {
  const body = resumeTargetBody(target);
  return useQuery({
    queryKey: qk.resumeReview(body),
    queryFn: ({ signal }) => api('POST /api/applykit/resume-review', { body, signal }),
    enabled: enabled && targetKey(body) !== '',
  });
}

export function useResumeScores(enabled = true) {
  return useQuery({
    queryKey: qk.resumeScores(),
    queryFn: ({ signal }) => api('GET /api/applykit/resume-scores', { signal }),
    enabled,
  });
}

/** Review an edited or tailored draft without saving it. */
export function useDraftReview() {
  return useMutation({
    mutationFn: (body: ResumeReviewRequest) => api('POST /api/applykit/resume-review', { body }),
  });
}

export function useResumeRework() {
  return useMutation({
    mutationFn: (body: ResumeReworkRequest) => api('POST /api/applykit/resume-rework', { body }),
  });
}
