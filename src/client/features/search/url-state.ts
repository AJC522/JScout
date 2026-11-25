/**
 * The search page keeps its whole query in the URL so back/forward, reload and copied links
 * all restore the same search. Keys are short, defaults are left out, and anything unknown or
 * malformed in a hand-edited URL is dropped rather than sent to the server.
 */
import { EMPLOYMENT_TYPES, REMOTE_MODES, SEARCH_DEFAULTS, SENIORITY_ORDER } from '../../../shared/constants';
import type { EmploymentType, RemoteMode, SearchQuery, SearchSort, Seniority } from '../../../shared/types';

/** Page-level parameters that live next to the query but are not part of it. */
export const PAGE_PARAMS = { job: 'job', from: 'from', saved: 'saved' } as const;

const SENIORITIES: readonly Seniority[] = [...SENIORITY_ORDER, 'unknown'];
const SORTS: readonly SearchSort[] = ['match', 'relevance', 'date', 'salary'];
/** Upper bounds that keep a mistyped URL from producing absurd requests. */
const MAX_RADIUS_KM = 1000;
const MAX_DAYS = 3650;
const MAX_SALARY = 100_000_000;

type BoolField = 'titleOnly' | 'includeRemote' | 'includeNoSalary' | 'synonyms' | 'useProfile' | 'includeHidden' | 'includeApplied' | 'includeClosed';
type TextListField = 'sources' | 'companies' | 'excludeCompanies' | 'excludeTerms' | 'relatedRoles';

/** Booleans with a server default are written only when they differ from it. */
const BOOL_KEYS: Record<BoolField, { key: string; fallback?: boolean }> = {
  titleOnly: { key: 't' },
  includeRemote: { key: 'ir', fallback: SEARCH_DEFAULTS.includeRemote },
  includeNoSalary: { key: 'ns', fallback: SEARCH_DEFAULTS.includeNoSalary },
  synonyms: { key: 'syn', fallback: SEARCH_DEFAULTS.synonyms },
  useProfile: { key: 'up', fallback: SEARCH_DEFAULTS.useProfile },
  includeHidden: { key: 'hid', fallback: SEARCH_DEFAULTS.includeHidden },
  includeApplied: { key: 'app', fallback: SEARCH_DEFAULTS.includeApplied },
  includeClosed: { key: 'cl', fallback: SEARCH_DEFAULTS.includeClosed },
};

/** Free-text lists may contain commas ("Acme, Inc."), so each value is its own repeated parameter. */
const TEXT_LIST_KEYS: Record<TextListField, string> = {
  sources: 'src',
  companies: 'co',
  excludeCompanies: 'xco',
  excludeTerms: 'x',
  relatedRoles: 'rel',
};

/** Enum lists are comma-joined: their values never contain commas. */
const KEYS = {
  q: 'q',
  location: 'l',
  radiusKm: 'r',
  remote: 'wm',
  salaryMin: 'smin',
  salaryCurrency: 'cur',
  employmentTypes: 'et',
  seniority: 'sen',
  postedWithinDays: 'd',
  sort: 'sort',
} as const;

function uniqueTrimmed(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function positive(value: number | undefined, max: number): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.round(value), max);
}

function enumList<T extends string>(values: readonly string[] | undefined, allowed: readonly T[]): T[] {
  const wanted = new Set(values ?? []);
  // Allowed order, so the same selection always serialises the same way.
  return allowed.filter((value) => wanted.has(value));
}

/**
 * The canonical form of a query: defaults, empty values, duplicates and paging removed.
 * Two queries that would return the same results normalise to deep-equal objects.
 */
export function normalizeQuery(query: Partial<SearchQuery>): SearchQuery {
  const out: SearchQuery = { q: (query.q ?? '').trim() };
  const location = query.location?.trim();
  if (location) out.location = location;
  // A radius only means something around a place.
  const radius = location ? positive(query.radiusKm, MAX_RADIUS_KM) : undefined;
  if (radius) out.radiusKm = radius;

  const remote = enumList<RemoteMode>(query.remote, REMOTE_MODES);
  // Every arrangement selected is the same as no restriction.
  if (remote.length > 0 && remote.length < REMOTE_MODES.length) out.remote = remote;

  const salary = positive(query.salaryMin, MAX_SALARY);
  if (salary) {
    out.salaryMin = salary;
    const currency = query.salaryCurrency?.trim().toUpperCase();
    if (currency && /^[A-Z]{3}$/.test(currency)) out.salaryCurrency = currency;
    if (query.includeNoSalary === false) out.includeNoSalary = false;
  }

  const employment = enumList<EmploymentType>(query.employmentTypes, EMPLOYMENT_TYPES);
  if (employment.length) out.employmentTypes = employment;
  const seniority = enumList<Seniority>(query.seniority, SENIORITIES);
  if (seniority.length) out.seniority = seniority;
  const days = positive(query.postedWithinDays, MAX_DAYS);
  if (days) out.postedWithinDays = days;

  for (const field of Object.keys(TEXT_LIST_KEYS) as TextListField[]) {
    const values = uniqueTrimmed(query[field]);
    if (values.length) out[field] = values;
  }

  for (const field of Object.keys(BOOL_KEYS) as BoolField[]) {
    const value = query[field];
    if (typeof value !== 'boolean') continue;
    if (field === 'includeNoSalary') continue; // handled with the salary above
    if (field === 'includeRemote' && !location) continue; // only meaningful with a place
    if (value !== BOOL_KEYS[field].fallback) out[field] = value;
  }

  if (query.sort && query.sort !== SEARCH_DEFAULTS.sort && SORTS.includes(query.sort)) out.sort = query.sort;
  return out;
}

/** Query string for a query (only the query's own keys; add page params separately). */
export function queryToParams(query: Partial<SearchQuery>): URLSearchParams {
  const q = normalizeQuery(query);
  const params = new URLSearchParams();
  if (q.q) params.set(KEYS.q, q.q);
  if (q.location) params.set(KEYS.location, q.location);
  if (q.radiusKm) params.set(KEYS.radiusKm, String(q.radiusKm));
  if (q.remote) params.set(KEYS.remote, q.remote.join(','));
  if (q.salaryMin) params.set(KEYS.salaryMin, String(q.salaryMin));
  if (q.salaryCurrency) params.set(KEYS.salaryCurrency, q.salaryCurrency);
  if (q.employmentTypes) params.set(KEYS.employmentTypes, q.employmentTypes.join(','));
  if (q.seniority) params.set(KEYS.seniority, q.seniority.join(','));
  if (q.postedWithinDays) params.set(KEYS.postedWithinDays, String(q.postedWithinDays));
  for (const field of Object.keys(TEXT_LIST_KEYS) as TextListField[]) {
    for (const value of q[field] ?? []) params.append(TEXT_LIST_KEYS[field], value);
  }
  for (const field of Object.keys(BOOL_KEYS) as BoolField[]) {
    const value = q[field];
    if (typeof value === 'boolean') params.set(BOOL_KEYS[field].key, value ? '1' : '0');
  }
  if (q.sort) params.set(KEYS.sort, q.sort);
  return params;
}

function numberParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function csvParam(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? '').split(',').map((s) => s.trim());
}

function boolParam(params: URLSearchParams, key: string): boolean | undefined {
  const raw = params.get(key);
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return undefined;
}

/** The query a URL describes, already normalised. Unknown keys (such as page params) are ignored. */
export function paramsToQuery(params: URLSearchParams): SearchQuery {
  const draft: Partial<SearchQuery> = {
    q: params.get(KEYS.q) ?? '',
    location: params.get(KEYS.location) ?? undefined,
    radiusKm: numberParam(params, KEYS.radiusKm),
    remote: csvParam(params, KEYS.remote) as RemoteMode[],
    salaryMin: numberParam(params, KEYS.salaryMin),
    salaryCurrency: params.get(KEYS.salaryCurrency) ?? undefined,
    employmentTypes: csvParam(params, KEYS.employmentTypes) as EmploymentType[],
    seniority: csvParam(params, KEYS.seniority) as Seniority[],
    postedWithinDays: numberParam(params, KEYS.postedWithinDays),
    sort: (params.get(KEYS.sort) ?? undefined) as SearchSort | undefined,
  };
  for (const field of Object.keys(TEXT_LIST_KEYS) as TextListField[]) {
    draft[field] = params.getAll(TEXT_LIST_KEYS[field]);
  }
  for (const field of Object.keys(BOOL_KEYS) as BoolField[]) {
    draft[field] = boolParam(params, BOOL_KEYS[field].key);
  }
  return normalizeQuery(draft);
}

/** True when the query asks for nothing at all (a fresh visit to the search page). */
export function isBlankQuery(query: SearchQuery): boolean {
  return queryToParams(query).size === 0;
}

/**
 * A stable string identifying what a query searches for, ignoring the sort order: used to
 * remember the user's previous visit to "this search".
 */
export function querySignature(query: Partial<SearchQuery>): string {
  const params = queryToParams({ ...query, sort: undefined });
  params.sort();
  return params.toString();
}

/** Merge a patch (from a broaden suggestion or a filter control) into a query. */
export function applyPatch(query: SearchQuery, patch: Partial<SearchQuery>): SearchQuery {
  return normalizeQuery({ ...query, ...patch, offset: undefined, limit: undefined });
}

/** Number of filter-panel settings in use, for the "Filters (3)" badge. */
export function countActiveFilters(query: SearchQuery): number {
  const flags = [
    query.remote?.length,
    query.postedWithinDays,
    query.salaryMin,
    query.employmentTypes?.length,
    query.seniority?.length,
    query.sources?.length,
    query.companies?.length,
    query.excludeCompanies?.length,
    query.excludeTerms?.length,
    query.includeHidden,
    query.includeClosed,
    query.includeApplied === false,
  ];
  return flags.filter(Boolean).length;
}

/** The query with every filter-panel setting removed (what, where and sort stay). */
export function clearFilters(query: SearchQuery): SearchQuery {
  return normalizeQuery({
    q: query.q,
    location: query.location,
    radiusKm: query.radiusKm,
    includeRemote: query.includeRemote,
    titleOnly: query.titleOnly,
    synonyms: query.synonyms,
    relatedRoles: query.relatedRoles,
    useProfile: query.useProfile,
    sort: query.sort,
  });
}
