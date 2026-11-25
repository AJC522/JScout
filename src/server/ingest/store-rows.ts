/**
 * Pure mapping between NormalizedPosting / jobs rows and what the JobStore
 * writes: jobs column values, job_places rows and jobs_fts columns.
 * Kept free of database access so it is easy to test and reason about.
 */
import { atsKindSchema } from '../../shared/schemas';
import type { JobLocation, JobPosting, Place, Salary, SalaryPeriod } from '../../shared/types';
import { parseJson, type SqlValue } from '../db';
import { countryName, countryShortName } from '../lib/location';
import { uniqueFolded } from '../lib/text';
import { getSource } from '../sources/registry';
import type { NormalizedPosting } from './types';

/** Columns rewritten whenever a posting's content changes, in the order of contentValues(). */
export const CONTENT_COLUMNS = [
  'cluster_key', 'url', 'apply_url', 'title', 'title_core', 'role_id', 'family_id',
  'company', 'company_key', 'company_url', 'company_logo',
  'location_text', 'remote', 'remote_scope', 'places',
  'salary_min', 'salary_max', 'salary_currency', 'salary_period', 'salary_annual_min', 'salary_annual_max',
  'salary_text', 'salary_inferred',
  'employment_type', 'seniority', 'department', 'tags', 'skills', 'snippet', 'description_html',
  'posted_at', 'content_hash',
] as const;

const num = (n: number | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

export function contentValues(p: NormalizedPosting): SqlValue[] {
  const s = p.salary;
  return [
    p.clusterKey, p.url, p.applyUrl ?? null, p.title, p.titleCore, p.roleId ?? null, p.familyId ?? null,
    p.company, p.companyKey, p.companyUrl ?? null, p.companyLogo ?? null,
    p.locationText, p.location.remote, JSON.stringify(p.location.remoteScope), JSON.stringify(p.location.places),
    num(s?.min), num(s?.max), s?.currency ?? null, s?.period ?? null, num(s?.annualMin), num(s?.annualMax),
    s?.text ?? null, s?.inferred ? 1 : 0,
    p.employmentType, p.seniority, p.department ?? null, JSON.stringify(p.tags), JSON.stringify(p.skills),
    p.snippet, p.descriptionHtml,
    p.postedAt ?? null, p.contentHash,
  ];
}

// --- job_places ---------------------------------------------------------------------

export interface PlaceRow {
  kind: 'city' | 'admin1' | 'country' | 'region' | 'scope';
  city: string | null;
  admin1: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
}

/** Location index rows for a posting, following the kinds documented on job_places in schema.ts. */
export function placeRows(location: JobLocation): PlaceRow[] {
  const rows: PlaceRow[] = [];
  const seen = new Set<string>();
  const add = (row: PlaceRow): void => {
    const key = `${row.kind}|${row.city ?? ''}|${row.admin1 ?? ''}|${row.country ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  const countryRow = (kind: 'region' | 'scope', country: string): PlaceRow => ({
    kind, city: null, admin1: null, country, lat: null, lon: null,
  });

  for (const place of location.places) {
    if (place.kind === 'city' || place.kind === 'admin1' || place.kind === 'country') {
      if (!place.city && !place.admin1 && !place.country) continue;
      // Small localities missing from the gazetteer come as admin1/country places carrying `city`:
      // they are still a city the job is tied to (just without coordinates).
      add({
        kind: place.city ? 'city' : place.kind,
        city: place.city ?? null,
        admin1: place.admin1 ?? null,
        country: place.country ?? null,
        lat: num(place.lat),
        lon: num(place.lon),
      });
    } else if (place.kind === 'region') {
      for (const c of place.countries ?? []) add(countryRow('region', c));
    }
  }
  for (const c of location.remoteScope) add(countryRow('scope', c));
  return rows;
}

// --- jobs_fts -------------------------------------------------------------------------

/** jobs_fts columns, in schema order. */
export interface FtsDoc {
  title: string;
  company: string;
  location: string;
  tags: string;
  body: string;
}

export interface FtsSource {
  title: string;
  company: string;
  locationText: string;
  location: JobLocation;
  tags: readonly string[];
  skills: readonly string[];
  department?: string;
}

/** Gazetteer admin1 codes are numeric for many countries; only letter codes ("TX", "ENG") are useful terms. */
const LETTER_CODE = /^[A-Za-z]{2,3}$/;

function countryTerms(code: string | undefined, name?: string): Array<string | undefined> {
  if (!code) return [name];
  return [name ?? countryName(code), countryShortName(code), code];
}

/**
 * Searchable location terms: the display text plus every place's names and codes, so
 * "Texas", "TX", "United States" and "US" all find an Austin posting.
 */
export function ftsLocation(locationText: string, location: JobLocation): string {
  const terms: Array<string | undefined> = [locationText];
  for (const p of location.places) {
    terms.push(p.city, p.admin1Name, p.admin1 && LETTER_CODE.test(p.admin1) ? p.admin1 : undefined, p.region);
    terms.push(...countryTerms(p.country, p.countryName));
  }
  for (const c of location.remoteScope) terms.push(...countryTerms(c));
  return uniqueFolded(terms.filter((t): t is string => typeof t === 'string')).join(' ');
}

export function ftsDoc(src: FtsSource, body: string): FtsDoc {
  return {
    title: src.title,
    company: src.company,
    location: ftsLocation(src.locationText, src.location),
    tags: uniqueFolded([...src.tags, ...src.skills, ...(src.department ? [src.department] : [])]).join(', '),
    body,
  };
}

/** The jobs_words document: every jobs_fts column's text, unstemmed and unpositioned (migration 4). */
export function ftsWords(doc: FtsDoc): string {
  return [doc.title, doc.company, doc.location, doc.tags, doc.body].join('\n');
}

// --- reading rows ---------------------------------------------------------------------

/** Columns selected to build a JobPosting (the description itself is not loaded). */
export const POSTING_SELECT = `id, cluster_key, source, external_id, url, apply_url, title, role_id,
  company, company_url, company_logo, location_text, remote, remote_scope, places,
  salary_min, salary_max, salary_currency, salary_period, salary_annual_min, salary_annual_max,
  salary_text, salary_inferred, employment_type, seniority, department, tags, skills, snippet,
  description_html != '' AS has_description, posted_at, first_seen_at, last_seen_at, closed_at`;

export interface PostingRow {
  id: string;
  cluster_key: string;
  source: string;
  external_id: string;
  url: string;
  apply_url: string | null;
  title: string;
  role_id: string | null;
  company: string;
  company_url: string | null;
  company_logo: string | null;
  location_text: string;
  remote: string;
  remote_scope: string;
  places: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  salary_annual_min: number | null;
  salary_annual_max: number | null;
  salary_text: string | null;
  salary_inferred: number;
  employment_type: string;
  seniority: string;
  department: string | null;
  tags: string;
  skills: string;
  snippet: string;
  has_description: number;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  closed_at: string | null;
}

export function sourceName(sourceId: string): string {
  return getSource(sourceId)?.def.name ?? sourceId;
}

const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

function rowSalary(r: PostingRow): Salary | undefined {
  const values = [r.salary_min, r.salary_max, r.salary_annual_min, r.salary_annual_max, r.salary_text];
  if (values.every((v) => v === null)) return undefined;
  const salary: Salary = {
    min: opt(r.salary_min),
    max: opt(r.salary_max),
    currency: opt(r.salary_currency),
    period: opt(r.salary_period) as SalaryPeriod | undefined,
    annualMin: opt(r.salary_annual_min),
    annualMax: opt(r.salary_annual_max),
    text: opt(r.salary_text),
  };
  if (r.salary_inferred) salary.inferred = true;
  return salary;
}

export function rowToPosting(r: PostingRow): JobPosting {
  return {
    id: r.id,
    clusterKey: r.cluster_key,
    source: r.source,
    sourceName: sourceName(r.source),
    externalId: r.external_id,
    url: r.url,
    applyUrl: opt(r.apply_url),
    title: r.title,
    roleId: opt(r.role_id),
    company: r.company,
    companyUrl: opt(r.company_url),
    companyLogo: opt(r.company_logo),
    location: {
      places: parseJson<Place[]>(r.places, []),
      remote: r.remote as JobLocation['remote'],
      remoteScope: parseJson<string[]>(r.remote_scope, []),
    },
    locationText: r.location_text,
    salary: rowSalary(r),
    employmentType: r.employment_type as JobPosting['employmentType'],
    seniority: r.seniority as JobPosting['seniority'],
    department: opt(r.department),
    tags: parseJson<string[]>(r.tags, []),
    skills: parseJson<string[]>(r.skills, []),
    snippet: r.snippet,
    hasDescription: r.has_description === 1,
    postedAt: opt(r.posted_at),
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    closedAt: opt(r.closed_at),
  };
}

const ATS_SOURCES: ReadonlySet<string> = new Set(atsKindSchema.options);

/** Employer ATS boards are the authoritative copy of a job; aggregators re-list it. */
export function isAtsSource(sourceId: string): boolean {
  return ATS_SOURCES.has(sourceId);
}
