/**
 * RawPosting (from an adapter) -> NormalizedPosting (ready for the JobStore).
 *
 * This is the single place where untrusted source data is cleaned and
 * interpreted. Adapters stay dumb; the store stays mechanical.
 */
import { notImplemented } from '../lib/not-implemented';
import { stableHash } from '../lib/text';
import type { BoardRef, RawPosting, SourceDefinition } from '../sources/types';
import type { NormalizedPosting } from './types';

export interface NormalizeContext {
  source: SourceDefinition;
  feedKey: string;
  /** Present for per-company (ATS) feeds; its name is the company for every posting. */
  board?: BoardRef;
  now: Date;
}

/** Feed key: the source id, or "<source>:<token>" for per-company feeds. */
export function feedKeyFor(sourceId: string, board?: Pick<BoardRef, 'token'>): string {
  return board ? `${sourceId}:${board.token}` : sourceId;
}

/** Stable internal posting id. */
export function jobIdFor(sourceId: string, feedKey: string, externalId: string): string {
  return stableHash(sourceId, feedKey, externalId);
}

/**
 * Normalise one posting. Returns null when the posting is unusable (no title,
 * company or http(s) url after cleaning) — callers count and log those.
 *
 * Steps (each uses the library named; none of this belongs in adapters):
 *  - id = jobIdFor(source.id, feedKey, externalId); title/company: entities decoded, whitespace
 *    collapsed; company = board.name when a board is given; companyKey = companyKey(company).
 *  - Description: sanitizeHtml(descriptionHtml) or textToHtml(descriptionText) (lib/html);
 *    descriptionText = htmlToText(sanitised); snippet = first ~300 chars (truncate).
 *  - Title: analyzeTitle (lib/titles) -> titleCore, roleId, familyId;
 *    seniority = detectSeniority(title, raw.seniority, descriptionText);
 *    employmentType = detectEmploymentType(raw.employmentType, title, descriptionText).
 *  - Location: parseJobLocation({ locations, remote, title, descriptionText, tags }) (lib/location)
 *    -> location + locationText.
 *  - Salary: normalizeSalary(raw.salary, { country }) and, only when that yields nothing,
 *    extractSalaryFromText(descriptionText, { country }) (lib/salary); country = first place's country,
 *    else the single remote-scope country.
 *  - Dates: postedAt = toIsoDate(raw.postedAt, now) ?? toIsoDate(raw.updatedAt, now) (lib/dates).
 *  - Skills: extractSkills over title + tags + description, capped at ~40 (lib/skills).
 *  - tags de-duplicated; department kept; urls must be http(s) (applyUrl dropped when equal to url).
 *  - clusterKey = clusterKeyFor(...) ; contentHash covers every user-visible field.
 */
export function normalizePosting(raw: RawPosting, ctx: NormalizeContext): NormalizedPosting | null {
  return notImplemented(`normalizePosting(${raw.externalId}, ${ctx.feedKey})`);
}

/**
 * Key shared by postings that are the same job seen through different sources
 * (an employer's ATS board and an aggregator re-listing it, or the same job on
 * two boards). Built from companyKey + titleCore + seniority + a location key.
 *
 * The location key must make "Registered Nurse at Acme in Denver" and the same
 * title in Boston different jobs, while the Greenhouse copy ("Remote - US") and
 * the Remotive copy ("USA", remote) of one remote job stay the same job:
 *  - remote jobs: "remote" (scope ignored: sources describe it inconsistently)
 *  - otherwise the first resolved place, as city (or admin1, or country) key
 *  - nothing resolved: the normalised first raw location string, or "" when none
 */
export function clusterKeyFor(parts: {
  companyKey: string;
  titleCore: string;
  seniority: string;
  locationKey: string;
}): string {
  return stableHash('cluster', parts.companyKey, parts.titleCore, parts.seniority, parts.locationKey);
}
