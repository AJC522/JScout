/**
 * Turns a SearchQuery into a SearchPlan: FTS expressions plus SQL conditions on `jobs j`.
 *
 * Conditions are split in two:
 *  - base: filters that are not facets (text, location, salary, closed/hidden/applied, exclusions);
 *  - dims: one filter per facet dimension, each also available as a JS predicate so facets can
 *    be computed "disjunctively" (each with its own filter removed) from one row fetch.
 * Building a plan touches no database, so it is cheap to build many (broaden suggestions do).
 */
import { APPLICATION_STATUSES, SEARCH_DEFAULTS } from '../../shared/constants';
import type { EmploymentType, RemoteMode, SearchQuery, SearchSort, Seniority } from '../../shared/types';
import { companyKey } from '../lib/text';
import { ftsAnd } from './fts';
import { type LocationFilter, locationFilter, type SqlCond } from './location-filter';
import { type Understanding, understandQuery } from './understand';

export type { SqlCond } from './location-filter';

export type FacetDim = 'remote' | 'employmentType' | 'seniority' | 'source' | 'company' | 'postedWithin';
export const FACET_DIMS: readonly FacetDim[] = ['remote', 'employmentType', 'seniority', 'source', 'company', 'postedWithin'];

/** What the first pass loads per posting: enough to apply facet filters, de-duplicate and sort cheaply. */
export interface CandidateRow {
  rid: number;
  clusterKey: string;
  remote: RemoteMode;
  employmentType: EmploymentType;
  seniority: Seniority;
  source: string;
  companyKey: string;
  /** COALESCE(posted_at, first_seen_at), ISO-8601. */
  ts: string;
  closed: boolean;
  hasDescription: boolean;
  /** Loaded only when sorting by salary: currency and annual max (else min). */
  salary?: { currency: string | null; amount: number | null };
  /** bm25 (more negative = better); null without a text query. */
  rank: number | null;
}

export interface DimFilter {
  cond: SqlCond;
  test(row: CandidateRow): boolean;
}

export interface PlanEnv {
  now: Date;
  /** Settings: postings older than this are excluded unless postedWithinDays is set. 0 = never. */
  maxPostingAgeDays: number;
  /** Currency for salaryMin when the query does not name one. */
  defaultCurrency: string;
}

export interface SearchOptions {
  includeRemote: boolean;
  includeNoSalary: boolean;
  synonyms: boolean;
  useProfile: boolean;
  includeHidden: boolean;
  includeApplied: boolean;
  includeClosed: boolean;
  sort: SearchSort;
  offset: number;
  limit: number;
  radiusKm: number;
}

export interface SearchPlan {
  query: SearchQuery;
  opts: SearchOptions;
  understanding: Understanding;
  location: LocationFilter;
  /** Positive FTS expression (query terms AND an unresolved location). */
  match?: string;
  /** FTS expression of excluded terms. */
  exclude?: string;
  base: SqlCond[];
  dims: Partial<Record<FacetDim, DimFilter>>;
  /** Currency salaryMin is compared in (and salary sorting prefers). */
  salaryCurrency: string;
  /** Oldest COALESCE(posted_at, first_seen_at) the date filter keeps, if any. */
  ageCutoff?: string;
  now: Date;
}

export function searchOptions(query: SearchQuery): SearchOptions {
  return {
    includeRemote: query.includeRemote ?? SEARCH_DEFAULTS.includeRemote,
    includeNoSalary: query.includeNoSalary ?? SEARCH_DEFAULTS.includeNoSalary,
    synonyms: query.synonyms ?? SEARCH_DEFAULTS.synonyms,
    useProfile: query.useProfile ?? SEARCH_DEFAULTS.useProfile,
    includeHidden: query.includeHidden ?? SEARCH_DEFAULTS.includeHidden,
    includeApplied: query.includeApplied ?? SEARCH_DEFAULTS.includeApplied,
    includeClosed: query.includeClosed ?? SEARCH_DEFAULTS.includeClosed,
    sort: query.sort ?? SEARCH_DEFAULTS.sort,
    offset: query.offset ?? SEARCH_DEFAULTS.offset,
    limit: query.limit ?? SEARCH_DEFAULTS.limit,
    radiusKm: query.radiusKm ?? 0,
  };
}

const DAY_MS = 86_400_000;
const json = (values: readonly string[]): string => JSON.stringify(values);

function inList(column: string, values: readonly string[], value: (row: CandidateRow) => string): DimFilter {
  const set = new Set<string>(values);
  return { cond: { sql: `${column} IN (SELECT value FROM json_each(?))`, params: [json(values)] }, test: (row) => set.has(value(row)) };
}

/** Postings first published/seen on or after `cutoff`. */
export function ageCondition(cutoff: string): SqlCond {
  return { sql: 'COALESCE(j.posted_at, j.first_seen_at) >= ?', params: [cutoff] };
}

function dimFilters(query: SearchQuery, ageCutoff: string | undefined): Partial<Record<FacetDim, DimFilter>> {
  const dims: Partial<Record<FacetDim, DimFilter>> = {};
  if (query.remote?.length) dims.remote = inList('j.remote', query.remote, (r) => r.remote);
  if (query.employmentTypes?.length) dims.employmentType = inList('j.employment_type', query.employmentTypes, (r) => r.employmentType);
  if (query.seniority?.length) dims.seniority = inList('j.seniority', query.seniority, (r) => r.seniority);
  if (query.sources?.length) dims.source = inList('j.source', query.sources, (r) => r.source);
  if (query.companies?.length) {
    dims.company = inList('j.company_key', [...new Set(query.companies.map(companyKey))], (r) => r.companyKey);
  }
  if (ageCutoff) dims.postedWithin = { cond: ageCondition(ageCutoff), test: (r) => r.ts >= ageCutoff };
  return dims;
}

/** Statuses at or past "applied". */
const APPLIED_OR_LATER = APPLICATION_STATUSES.slice(APPLICATION_STATUSES.indexOf('applied'));

function baseFilters(query: SearchQuery, opts: SearchOptions, location: LocationFilter, salaryCurrency: string): SqlCond[] {
  const base: SqlCond[] = [];
  if (!opts.includeClosed) base.push({ sql: 'j.closed_at IS NULL', params: [] });
  if (!opts.includeHidden) base.push({ sql: 'j.cluster_key NOT IN (SELECT cluster_key FROM hidden_jobs)', params: [] });
  if (!opts.includeApplied) {
    base.push({
      sql: `j.cluster_key NOT IN (SELECT cluster_key FROM applications
              WHERE cluster_key IS NOT NULL AND status IN (SELECT value FROM json_each(?)))`,
      params: [json(APPLIED_OR_LATER)],
    });
  }
  if (query.excludeCompanies?.length) {
    base.push({ sql: 'j.company_key NOT IN (SELECT value FROM json_each(?))', params: [json(query.excludeCompanies.map(companyKey))] });
  }
  if (query.salaryMin !== undefined && query.salaryMin > 0) {
    const amount = 'COALESCE(j.salary_annual_max, j.salary_annual_min)';
    const meets = `(j.salary_currency = ? AND ${amount} >= ?)`;
    base.push(
      opts.includeNoSalary
        ? { sql: `(${meets} OR j.salary_currency IS NULL OR j.salary_currency != ? OR ${amount} IS NULL)`, params: [salaryCurrency, query.salaryMin, salaryCurrency] }
        : { sql: meets, params: [salaryCurrency, query.salaryMin] },
    );
  }
  if (location.cond) base.push(location.cond);
  return base;
}

export function buildPlan(query: SearchQuery, env: PlanEnv): SearchPlan {
  const opts = searchOptions(query);
  const understanding = understandQuery(query);
  const location = locationFilter(query.location, { radiusKm: opts.radiusKm, includeRemote: opts.includeRemote });
  const salaryCurrency = (query.salaryCurrency ?? env.defaultCurrency).toUpperCase();
  const ageDays = query.postedWithinDays ?? (env.maxPostingAgeDays > 0 ? env.maxPostingAgeDays : undefined);
  const ageCutoff = ageDays ? new Date(env.now.getTime() - ageDays * DAY_MS).toISOString() : undefined;
  return {
    query,
    opts,
    understanding,
    location,
    match: ftsAnd([understanding.match, location.fts]),
    exclude: understanding.exclude,
    base: baseFilters(query, opts, location, salaryCurrency),
    dims: dimFilters(query, ageCutoff),
    salaryCurrency,
    ageCutoff,
    now: env.now,
  };
}
