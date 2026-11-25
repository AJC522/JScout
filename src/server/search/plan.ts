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
import { atsKindSchema } from '../../shared/schemas';
import type { EmploymentType, RemoteMode, SearchQuery, SearchSort, Seniority } from '../../shared/types';
import { companyKey } from '../lib/text';
import { ftsAnd } from './fts';
import { type LocationFilter, locationFilter, type SqlCond } from './location-filter';
import { type Exclusion, type Understanding, understandQuery } from './understand';

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
  /** A disabled source's or board's postings are still being deleted: leave them out (see JobStore.hideFeeds). */
  hideRemovedFeeds?: boolean;
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
  /** Title searches: expression the unstemmed jobs_title index must match too (see Understanding.exact). */
  titleExact?: string;
  /** Title searches with acronym titles: how they must be written (see Understanding.acronyms). */
  titleAcronyms?: Understanding['acronyms'];
  /** Excluded terms (see Understanding.exclusions). */
  exclusions: Exclusion[];
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

/**
 * Rough US dollars per unit of common salary currencies, used only to apply a minimum salary to
 * postings paid in another currency: without it a €50k job passes a "$120k or more" filter as
 * "not comparable". Rates move, so a posting within ~10% of the minimum may land on either side.
 */
export const USD_PER_UNIT: Readonly<Record<string, number>> = {
  USD: 1, EUR: 1.1, GBP: 1.28, CHF: 1.15, CAD: 0.73, AUD: 0.66, NZD: 0.6, SGD: 0.75, HKD: 0.128, JPY: 0.0067,
  CNY: 0.14, INR: 0.012, KRW: 0.00073, SEK: 0.095, NOK: 0.093, DKK: 0.147, PLN: 0.25, CZK: 0.044, HUF: 0.0028,
  RON: 0.22, ILS: 0.27, AED: 0.272, TRY: 0.03, ZAR: 0.055, BRL: 0.18, MXN: 0.055, PHP: 0.017,
};
/** SQL for a posting's currency in US dollars per unit; NULL for currencies not in the table. Values are constants. */
const USD_RATE_SQL = `CASE j.salary_currency ${Object.entries(USD_PER_UNIT)
  .map(([code, rate]) => `WHEN '${code}' THEN ${rate}`)
  .join(' ')} END`;

/** Postings whose stated pay reaches `min` (yearly, in `currency`), converting other currencies roughly when both are known. */
function salaryMeets(min: number, currency: string): SqlCond {
  const amount = 'COALESCE(j.salary_annual_max, j.salary_annual_min)';
  const rate = USD_PER_UNIT[currency];
  if (rate === undefined) return { sql: `(j.salary_currency = ? AND ${amount} >= ?)`, params: [currency, min] };
  return { sql: `(${amount} * (${USD_RATE_SQL}) >= ?)`, params: [min * rate] };
}

/** Postings with no salary that can be compared with a minimum in `currency`. */
function salaryUnknown(currency: string): SqlCond {
  const amount = 'COALESCE(j.salary_annual_max, j.salary_annual_min)';
  if (USD_PER_UNIT[currency] === undefined) return { sql: `(j.salary_currency IS NULL OR j.salary_currency != ? OR ${amount} IS NULL)`, params: [currency] };
  return { sql: `(${amount} IS NULL OR (${USD_RATE_SQL}) IS NULL)`, params: [] };
}

const ATS_SOURCES_JSON = JSON.stringify(atsKindSchema.options);
const IN_ATS = 'source IN (SELECT value FROM json_each(?))';
const CLOSED_ATS_CLUSTERS = `SELECT cluster_key FROM jobs WHERE closed_at IS NOT NULL AND ${IN_ATS}`;

/**
 * Re-listed copies of a job its employer has taken down: the employer's board (a complete snapshot)
 * closed its copy, so an aggregator's still-open copy must not show the job as open. A cluster with
 * another open board copy (the job re-posted) is still open; that copy passes on its own.
 */
const CLOSED_BY_EMPLOYER: SqlCond = {
  sql: `(j.${IN_ATS} OR +j.cluster_key NOT IN (${CLOSED_ATS_CLUSTERS} AND cluster_key NOT IN (
    SELECT cluster_key FROM jobs WHERE closed_at IS NULL AND cluster_key IN (${CLOSED_ATS_CLUSTERS}) AND ${IN_ATS})))`,
  params: [ATS_SOURCES_JSON, ATS_SOURCES_JSON, ATS_SOURCES_JSON, ATS_SOURCES_JSON],
};

/** Statuses at or past "applied". */
const APPLIED_OR_LATER = APPLICATION_STATUSES.slice(APPLICATION_STATUSES.indexOf('applied'));

function baseFilters(
  query: SearchQuery,
  opts: SearchOptions,
  location: LocationFilter,
  salaryCurrency: string,
  understanding: Understanding,
): SqlCond[] {
  const base: SqlCond[] = [];
  // "remote software engineer": the arrangement typed with the title, unless the facet says otherwise.
  const { remote, employmentTypes } = understanding.filters;
  if (remote?.length && !query.remote?.length) base.push({ sql: 'j.remote IN (SELECT value FROM json_each(?))', params: [json(remote)] });
  if (employmentTypes?.length && !query.employmentTypes?.length) {
    base.push({ sql: 'j.employment_type IN (SELECT value FROM json_each(?))', params: [json(employmentTypes)] });
  }
  if (!opts.includeClosed) base.push({ sql: 'j.closed_at IS NULL', params: [] }, CLOSED_BY_EMPLOYER);
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
    const meets = salaryMeets(query.salaryMin, salaryCurrency);
    if (opts.includeNoSalary) {
      const unknown = salaryUnknown(salaryCurrency);
      base.push({ sql: `(${meets.sql} OR ${unknown.sql})`, params: [...meets.params, ...unknown.params] });
    } else {
      base.push(meets);
    }
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
    titleExact: understanding.exact,
    ...(understanding.acronyms ? { titleAcronyms: understanding.acronyms } : {}),
    exclusions: understanding.exclusions,
    base: [
      ...baseFilters(query, opts, location, salaryCurrency, understanding),
      // Not on the covering index, so only while a removal is pending.
      ...(env.hideRemovedFeeds ? [{ sql: 'j.feed_key NOT IN (SELECT feed_key FROM removed_feeds)', params: [] }] : []),
    ],
    dims: dimFilters(query, ageCutoff),
    salaryCurrency,
    ageCutoff,
    now: env.now,
  };
}
