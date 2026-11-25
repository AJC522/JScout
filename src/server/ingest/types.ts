import type { JobPosting } from '../../shared/types';

/**
 * A posting after normalisation, ready to be stored. Produced by
 * normalizePosting() from a RawPosting; consumed by the JobStore.
 */
export interface NormalizedPosting
  extends Omit<JobPosting, 'sourceName' | 'firstSeenAt' | 'lastSeenAt' | 'closedAt' | 'hasDescription' | 'roleId'> {
  feedKey: string;
  /** TitleInfo.core — normalised title without seniority/noise. */
  titleCore: string;
  roleId?: string;
  familyId?: string;
  /** companyKey(company). */
  companyKey: string;
  /** Sanitised HTML ('' when the source gave no description). */
  descriptionHtml: string;
  /** Plain text of the description, for the full-text index (not stored). */
  descriptionText: string;
  /** Hash of every field that affects what the user sees; unchanged hash => skip rewrite. */
  contentHash: string;
}

export interface UpsertStats {
  added: number;
  updated: number;
  unchanged: number;
  /** Postings marked closed because they vanished from a complete feed. */
  closed: number;
  /** Postings re-opened because they reappeared. */
  reopened: number;
}
