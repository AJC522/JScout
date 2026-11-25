/** Plain-English summaries of search queries, for saved searches and anywhere else a query is listed. */
import { EMPLOYMENT_LABELS, POSTED_WITHIN_OPTIONS, REMOTE_LABELS, REMOTE_MODES, SENIORITY_LABELS } from '../../../shared/constants';
import type { SearchQuery } from '../../../shared/types';
import { formatSalary } from '../../lib/format';

export const SUMMARY_SEPARATOR = ' · ';

/** "A, B and C"; longer lists are cut to `max` items plus "+N more". */
function listOf(items: readonly string[], max = 3, joiner = 'and'): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} +${rest} more`;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} ${joiner} ${shown.at(-1)}`;
}

function quoted(items: readonly string[]): string[] {
  return items.map((s) => `“${s}”`);
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Comma-separated titles read as alternatives; anything else is shown as typed. */
function describeWhat(q: string): string {
  const parts = q
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'Any job';
  return listOf(parts, 3, 'or');
}

function describeWhere(query: SearchQuery): string {
  const location = query.location?.trim();
  const remote = query.remote ?? [];
  if (!location) return 'Anywhere';
  const radius = query.radiusKm && query.radiusKm > 0 ? ` within ${query.radiusKm} km` : '';
  const remoteAllowed = remote.length === 0 || remote.includes('remote');
  const orRemote = query.includeRemote !== false && remoteAllowed ? ' or remote' : '';
  return `${location}${radius}${orRemote}`;
}

function describeRemote(query: SearchQuery): string | null {
  const modes = [...new Set(query.remote ?? [])];
  if (modes.length === 0 || modes.length >= REMOTE_MODES.length) return null;
  const labels = modes.map((m, i) => (i === 0 ? REMOTE_LABELS[m] : lowerFirst(REMOTE_LABELS[m])));
  return listOf(labels, 4, 'or');
}

function describeSalary(query: SearchQuery): string | null {
  if (!query.salaryMin || query.salaryMin <= 0) return null;
  const amount = formatSalary({ min: query.salaryMin, currency: query.salaryCurrency ?? 'USD', period: 'year' });
  return query.includeNoSalary === false ? `${amount}, salary listed` : amount;
}

function describePosted(days: number | undefined): string | null {
  if (!days || days <= 0) return null;
  return POSTED_WITHIN_OPTIONS.find((o) => o.days === days)?.label ?? `Past ${days} days`;
}

/**
 * One line describing what a search looks for, e.g.
 * "Product designer or UX designer · Berlin within 25 km or remote · From €70k/yr · Senior · Past week".
 */
export function describeQuery(query: SearchQuery): string {
  const parts: string[] = [describeWhat(query.q ?? ''), describeWhere(query)];

  const remote = describeRemote(query);
  if (remote) parts.push(remote);
  const salary = describeSalary(query);
  if (salary) parts.push(salary);
  if (query.seniority?.length) parts.push(listOf(query.seniority.map((s) => SENIORITY_LABELS[s]), 3, 'or'));
  if (query.employmentTypes?.length) parts.push(listOf(query.employmentTypes.map((t) => EMPLOYMENT_LABELS[t]), 3, 'or'));
  const posted = describePosted(query.postedWithinDays);
  if (posted) parts.push(posted);
  if (query.companies?.length) parts.push(`At ${listOf(query.companies, 2, 'or')}`);
  if (query.excludeCompanies?.length) parts.push(`Not at ${listOf(query.excludeCompanies, 2, 'or')}`);
  if (query.excludeTerms?.length) parts.push(`Without ${listOf(quoted(query.excludeTerms), 2, 'or')}`);
  if (query.relatedRoles?.length) parts.push(`+${query.relatedRoles.length} related ${query.relatedRoles.length === 1 ? 'role' : 'roles'}`);
  if (query.sources?.length) parts.push(`${query.sources.length} ${query.sources.length === 1 ? 'source' : 'sources'} only`);
  if (query.includeApplied === false) parts.push('Hiding jobs you applied to');
  if (query.includeClosed) parts.push('Including closed postings');

  return parts.join(SUMMARY_SEPARATOR);
}
