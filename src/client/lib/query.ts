/** TanStack Query setup: one client for the app and the query-key factories every feature shares. */
import { QueryClient } from '@tanstack/react-query';
import type { CompanyListQuery } from '../../shared/api';
import type { ApplicationStatus, ResumeTarget, SearchQuery } from '../../shared/types';
import { ApiRequestError } from '../api/client';

/** Retry a failed query once, except when the server answered 4xx: asking again cannot change that answer. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
        retryDelay: 600,
      },
      // A write that failed may still have been applied; never repeat it automatically.
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();

/**
 * Drop the parts of a params object that mean "not set" (undefined, null, "", []) so that
 * equivalent requests share one cache entry: { q: 'x', location: '' } and { q: 'x' } are the same search.
 */
export function compactParams<T extends object>(params: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(params) as Array<keyof T>) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

export type SuggestKind = 'titles' | 'locations' | 'skills' | 'companies';

export interface ApplicationListFilter {
  status?: ApplicationStatus;
  q?: string;
}

/**
 * Query keys. Families are hierarchical, so invalidating a prefix refreshes everything under it:
 * `qk.applications()` covers every list, the stats and every detail; `qk.search()` every result set.
 */
export const qk = {
  bootstrap: () => ['bootstrap'] as const,
  settings: () => ['settings'] as const,
  aiStatus: () => ['ai-status'] as const,

  /** No argument: the prefix for every search. With a query: that result set. */
  search: (query?: SearchQuery) => (query ? (['search', 'results', compactParams(query)] as const) : (['search'] as const)),
  searchFromProfile: () => ['search', 'from-profile'] as const,
  searchHistory: () => ['search', 'history'] as const,
  job: (id: string) => ['job', id] as const,
  suggest: (kind: SuggestKind, q: string) => ['suggest', kind, q.trim().toLowerCase()] as const,

  /** The profile itself; `profileExtras()` prefixes the data derived from it. */
  profile: () => ['profile'] as const,
  profileExtras: () => ['profile-extras'] as const,
  profileCompleteness: () => ['profile-extras', 'completeness'] as const,
  resumeAnalysis: () => ['profile-extras', 'resume-analysis'] as const,
  quickFill: () => ['profile-extras', 'quick-fill'] as const,

  savedSearches: () => ['saved-searches'] as const,

  /** No argument: the prefix for all tracker data. With a filter: that list. */
  applications: (filter?: ApplicationListFilter) =>
    filter ? (['applications', 'list', compactParams(filter)] as const) : (['applications'] as const),
  applicationStats: () => ['applications', 'stats'] as const,
  application: (id: string) => ['applications', 'detail', id] as const,

  sources: () => ['sources'] as const,
  /** No argument: the prefix for every company list. With a query: that page. */
  companies: (query?: CompanyListQuery) =>
    query ? (['companies', 'list', compactParams(query)] as const) : (['companies'] as const),

  /** Apply-kit fit analysis for an application or job. Under profile-extras because profile edits change it. */
  fitAnalysis: (target: { applicationId?: string; jobId?: string }) => ['profile-extras', 'fit', compactParams(target)] as const,
  /** Résumé review of the saved résumé against a job, application or pasted posting. Profile edits change it too. */
  resumeReview: (target: ResumeTarget) => ['profile-extras', 'resume-review', compactParams(target)] as const,
  /** The saved résumé scored against every active application. */
  resumeScores: () => ['profile-extras', 'resume-scores'] as const,

  /** Prefix of every result set made by `qk.search(query)` (not history or from-profile). */
  searchResults: () => ['search', 'results'] as const,
  /** Prefix of every `qk.job(id)`. */
  jobs: () => ['job'] as const,
};
