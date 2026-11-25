/** Skill gaps data: the analysis of a set of jobs against the profile. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { GapRequest } from '../../../shared/types';
import { api } from '../../api/client';
import { qk } from '../../lib/query';

export function useGaps(request: GapRequest) {
  return useQuery({
    queryKey: qk.gaps(request),
    queryFn: ({ signal }) => api('POST /api/gaps', { body: request, signal }),
    // After "I have it" the analysis is redone; keep showing the last one meanwhile rather than a skeleton.
    placeholderData: keepPreviousData,
  });
}
