/**
 * RawPosting (from an adapter) -> NormalizedPosting (ready for the JobStore).
 *
 * This is the single place where untrusted source data is cleaned and
 * interpreted. Adapters stay dumb; the store stays mechanical.
 */
import type { JobLocation, Place, Salary } from '../../shared/types';
import { decodeEntities, fixMojibake, htmlToText, safeHref, sanitizeHtml, textToHtml } from '../lib/html';
import { toIsoDate } from '../lib/dates';
import { parseJobLocation } from '../lib/location';
import { extractSalaryFromText, normalizeSalary } from '../lib/salary';
import { extractSkills } from '../lib/skills';
import { companyKey, normalizeText, stableHash, truncate, uniqueFolded } from '../lib/text';
import { analyzeTitle, detectEmploymentType, detectSeniority } from '../lib/titles';
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

const SNIPPET_CHARS = 300;
const MAX_SKILLS = 40;

/** Plain-text preview of a description (also used by the store for lazily fetched descriptions). */
export function makeSnippet(descriptionText: string): string {
  return truncate(descriptionText.replace(/\s+/g, ' ').trim(), SNIPPET_CHARS);
}

/** Canonical skills for a posting (also used by the store for lazily fetched descriptions). */
export function postingSkills(title: string, tags: readonly string[], descriptionText: string): string[] {
  // Tags joined by commas read as a delimited list, which lets ambiguous names ("Go", "Excel") match there.
  const text = [title, tags.join(', '), descriptionText].filter(Boolean).join('\n');
  return extractSkills(text, { limit: MAX_SKILLS });
}

/** Literal placeholders sloppy upstream serialisers emit for missing values. */
const PLACEHOLDER = /^(?:null|undefined|nan|none|n\/a)$/i;
const MARKUP = /<\/?[a-z][^>]*>/i;

/** One line of untrusted text: entities decoded, stray tags dropped, whitespace collapsed. */
function cleanLine(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let s = fixMojibake(String(value));
  s = MARKUP.test(s) ? htmlToText(s) : decodeEntities(s);
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b\u2060\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return PLACEHOLDER.test(s) ? '' : s;
}

const optLine = (value: unknown): string | undefined => cleanLine(value) || undefined;

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const href = safeHref(value);
  return href && /^https?:/i.test(href) ? href : undefined;
}

interface Description {
  html: string;
  text: string;
}

/** Markup without any text (an empty <div>, a lone image) counts as no description. */
function withText(html: string): Description | undefined {
  if (!html) return undefined;
  const text = htmlToText(html);
  return text.trim() ? { html, text } : undefined;
}

function description(raw: RawPosting): Description {
  return (
    withText(typeof raw.descriptionHtml === 'string' ? sanitizeHtml(raw.descriptionHtml) : '') ??
    withText(typeof raw.descriptionText === 'string' ? textToHtml(raw.descriptionText) : '') ?? { html: '', text: '' }
  );
}

/** Country used to read ambiguous currency symbols: the first place's, else the only remote-scope country. */
function salaryCountry(location: JobLocation): string | undefined {
  const placed = location.places.find((p) => p.country)?.country;
  if (placed) return placed;
  return location.remoteScope.length === 1 ? location.remoteScope[0] : undefined;
}

function postedDate(raw: RawPosting, now: Date): string | undefined {
  const iso = toIsoDate(raw.postedAt, now) ?? toIsoDate(raw.updatedAt, now);
  if (iso === undefined) return undefined;
  // toIsoDate tolerates up to two days of clock skew; a job cannot have been posted in the future.
  const nowIso = now.toISOString();
  return iso > nowIso ? nowIso : iso;
}

function isExpired(raw: RawPosting, now: Date): boolean {
  if (raw.expiresAt === undefined || raw.expiresAt === null || raw.expiresAt === '') return false;
  // toIsoDate rejects dates more than two days ahead, so a far-future expiry reads as undefined: not expired.
  const iso = toIsoDate(raw.expiresAt, now);
  return iso !== undefined && iso < now.toISOString();
}

function placeKeyPart(p: Place): string | undefined {
  // Localities missing from the gazetteer carry `city` on an admin1/country place: still a city.
  if (p.city) return `city:${p.country ?? ''}:${p.admin1 ?? ''}:${normalizeText(p.city)}`;
  if (p.kind === 'admin1' && p.admin1) return `admin1:${p.country ?? ''}:${p.admin1}`;
  if (p.kind === 'country' && p.country) return `country:${p.country}`;
  if (p.kind === 'region' && p.region) return `region:${normalizeText(p.region)}`;
  return undefined;
}

/** The location part of the cluster key; see clusterKeyFor. */
export function clusterLocationKey(location: JobLocation, rawLocations: readonly string[]): string {
  if (location.remote === 'remote') return 'remote';
  for (const p of location.places) {
    const key = placeKeyPart(p);
    if (key) return key;
  }
  const first = rawLocations.find((s) => s.trim());
  return first ? `raw:${normalizeText(first)}` : '';
}

/**
 * Normalise one posting. Returns null when the posting is unusable (no title,
 * company or http(s) url after cleaning) or already expired (raw.expiresAt before
 * ctx.now) — callers count and log those.
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
  const externalId = typeof raw.externalId === 'string' || typeof raw.externalId === 'number' ? String(raw.externalId).trim() : '';
  const title = cleanLine(raw.title);
  const company = cleanLine(ctx.board?.name) || cleanLine(raw.company);
  const compKey = companyKey(company);
  const url = httpUrl(raw.url);
  if (!externalId || !title || !compKey || !url || isExpired(raw, ctx.now)) return null;

  const applyUrl = httpUrl(raw.applyUrl);
  const desc = description(raw);
  const tags = uniqueFolded((Array.isArray(raw.tags) ? raw.tags : []).map(cleanLine));
  const locations = (Array.isArray(raw.locations) ? raw.locations : []).map(cleanLine).filter(Boolean);

  const titleInfo = analyzeTitle(title);
  const titleCore = titleInfo.core || normalizeText(title);
  const seniority = detectSeniority(title, optLine(raw.seniority), desc.text);
  const employmentType = detectEmploymentType(optLine(raw.employmentType), title, desc.text);

  const parsed = parseJobLocation({ locations, remote: raw.remote, title, descriptionText: desc.text, tags });
  const country = salaryCountry(parsed.location);
  const salary: Salary | undefined =
    normalizeSalary(raw.salary, { country }) ?? extractSalaryFromText(desc.text, { country });

  const visible = {
    url,
    applyUrl: applyUrl === url ? undefined : applyUrl,
    title,
    roleId: titleInfo.role?.id,
    company,
    companyUrl: httpUrl(raw.companyUrl),
    companyLogo: httpUrl(raw.companyLogo),
    location: parsed.location,
    locationText: parsed.text,
    salary,
    employmentType,
    seniority,
    department: optLine(raw.department),
    tags,
    skills: postingSkills(title, tags, desc.text),
    descriptionHtml: desc.html,
    postedAt: postedDate(raw, ctx.now),
  };
  const clusterKey = clusterKeyFor({
    companyKey: compKey,
    titleCore,
    seniority,
    locationKey: clusterLocationKey(parsed.location, locations),
  });

  return {
    ...visible,
    id: jobIdFor(ctx.source.id, ctx.feedKey, externalId),
    source: ctx.source.id,
    feedKey: ctx.feedKey,
    externalId,
    clusterKey,
    titleCore,
    familyId: titleInfo.role?.familyId,
    companyKey: compKey,
    descriptionText: desc.text,
    snippet: makeSnippet(desc.text),
    // Everything the store writes is derived from these, so an equal hash means nothing to rewrite.
    contentHash: stableHash(JSON.stringify(visible), clusterKey, titleCore, titleInfo.role?.familyId),
  };
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
