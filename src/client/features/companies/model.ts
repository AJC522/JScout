/** Pure helpers for the companies page: labels, filters -> request, and the bulk-change scope. */
import type { CompanyBulkUpdate, CompanyListQuery } from '../../../shared/api';
import type { AtsKind, SourceInfo } from '../../../shared/types';

export const COMPANIES_PAGE_SIZE = 50;

export const ATS_LABELS: Record<AtsKind, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
};
export const ATS_KINDS = Object.keys(ATS_LABELS) as AtsKind[];

/**
 * Job boards JScout can sync, for the job-board filter: those with a per-company source (whose
 * id is the ATS name). Boards it cannot add or sync would only ever filter to nothing. The
 * selected one stays listed so the control never shows the wrong value.
 */
export function syncableAts(sources: ReadonlyArray<Pick<SourceInfo, 'id' | 'perCompany'>> | undefined, selected?: AtsKind): AtsKind[] {
  const ids = new Set((sources ?? []).filter((s) => s.perCompany).map((s) => s.id));
  return ATS_KINDS.filter((ats) => ids.has(ats) || ats === selected);
}

export type FollowFilter = 'all' | 'following' | 'not-following';

export interface CompanyFilters {
  q: string;
  ats?: AtsKind;
  industry?: string;
  follow: FollowFilter;
  /** Only companies the user added. */
  mine: boolean;
  page: number;
}

export const DEFAULT_FILTERS: CompanyFilters = { q: '', follow: 'all', mine: false, page: 0 };

export function toListQuery(filters: CompanyFilters): CompanyListQuery {
  const q = filters.q.trim();
  return {
    ...(q ? { q } : {}),
    ...(filters.ats ? { ats: filters.ats } : {}),
    ...(filters.industry ? { industry: filters.industry } : {}),
    ...(filters.follow !== 'all' ? { enabled: filters.follow === 'following' } : {}),
    ...(filters.mine ? { origin: 'user' as const } : {}),
    limit: COMPANIES_PAGE_SIZE,
    offset: filters.page * COMPANIES_PAGE_SIZE,
  };
}

export function hasFilters(filters: CompanyFilters): boolean {
  return Boolean(filters.q.trim() || filters.ats || filters.industry || filters.follow !== 'all' || filters.mine);
}

export interface BulkPlan {
  body: CompanyBulkUpdate;
  /** Companies the change covers. */
  count: number;
  /** 'all' when the server can apply the filters itself; 'page' when only the listed ids can be sent. */
  scope: 'all' | 'page';
}

/**
 * "Enable/Disable all shown". The bulk endpoint filters by industry and origin only, so a text
 * search or an ATS filter falls back to the ids on the current page. The follow filter can be
 * ignored: switching on everything in a set gives the same result whatever was on before.
 */
export function planBulk(filters: CompanyFilters, enabled: boolean, shownIds: readonly string[], total: number): BulkPlan {
  if (filters.q.trim() || filters.ats) return { body: { enabled, ids: [...shownIds] }, count: shownIds.length, scope: 'page' };
  return {
    body: { enabled, ...(filters.industry ? { industry: filters.industry } : {}), ...(filters.mine ? { origin: 'user' as const } : {}) },
    count: total,
    scope: 'all',
  };
}

/** "1–50 of 492". */
export function pageRange(page: number, shown: number, total: number): string {
  if (total === 0 || shown === 0) return `0 of ${total.toLocaleString('en-US')}`;
  const start = page * COMPANIES_PAGE_SIZE + 1;
  return `${start.toLocaleString('en-US')}–${(start + shown - 1).toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
}

/** A careers-page link or a company name; anything shorter than two characters cannot be probed. */
export function isDetectable(input: string): boolean {
  return input.trim().length >= 2;
}
