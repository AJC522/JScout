/**
 * Relevance scoring and its human explanation.
 *
 * Each component has a maximum; only components that apply to this search count toward the
 * denominator, so a perfect match scores ~100 whether or not there is a query, a profile or a
 * location. Reason points are reported on the same 0–100 scale, so they sum to the score.
 */
import { SENIORITY_LABELS, SENIORITY_ORDER } from '../../shared/constants';
import type { JobLocation, MatchExplanation, MatchReason, Place, Salary, Seniority, TitleMatchKind } from '../../shared/types';
import { daysAgo } from '../lib/dates';
import { distanceKm, matchPlace } from '../lib/location';
import { formatSalary } from '../lib/salary';
import { foldText, normalizeText } from '../lib/text';
import { containsPhrase, type TitleTarget, type Understanding } from './understand';

export interface ScoreInput {
  title: string;
  titleCore: string;
  roleId?: string;
  tags: readonly string[];
  skills: readonly string[];
  snippet: string;
  location: JobLocation;
  seniority: Seniority;
  salary?: Salary;
  /** COALESCE(posted_at, first_seen_at). */
  ts: string;
  closed: boolean;
  /** bm25 (more negative = better), when there was a text query. */
  rank: number | null;
}

export interface LocationTarget {
  place: Place;
  radiusKm: number;
  includeRemote: boolean;
}

export interface ScoreContext {
  understanding: Understanding;
  /** Best (most negative) bm25 in the candidate set, for normalising text relevance. */
  bestRank: number | null;
  /** Folded profile skill -> display name; undefined when the profile is not used or has no skills. */
  profileSkills?: Map<string, string>;
  preferredSeniority: readonly Seniority[];
  location?: LocationTarget;
  now: Date;
}

const MAX = { title: 40, text: 15, skills: 15, location: 8, seniority: 5, recency: 10, salary: 3 } as const;
const CLOSED_PENALTY = 20;
const OLD_PENALTY = 5;
const OLD_DAYS = 60;
const RECENCY_DAYS = 30;

interface Part {
  key: string;
  label: string;
  points: number;
  max: number;
}

export interface TitleTier {
  kind: TitleMatchKind;
  /** Points out of MAX.title. */
  points: number;
  target?: TitleTarget;
  /** Query words found in the title (partial matches). */
  words: string[];
}

/**
 * Title match tier against the searched titles, best first: the query's own title as the whole
 * title, then contained in it ("Software Engineer, Payments"), then a synonym as the whole title,
 * then contained or the same taxonomy role, then an opted-in related role, then shared words.
 */
export function titleTier(input: Pick<ScoreInput, 'title' | 'titleCore' | 'roleId'>, u: Understanding): TitleTier {
  const core = input.titleCore || normalizeText(input.title);
  const tier = (kind: TitleMatchKind, points: number, target?: TitleTarget): TitleTier => ({ kind, points, target, words: [] });
  const typed = u.targets.filter((t) => t.via === 'query');
  const synonyms = u.targets.filter((t) => t.via === 'synonym');
  const related = u.targets.filter((t) => t.via === 'related');
  const find = (list: TitleTarget[], test: (t: TitleTarget) => boolean): TitleTarget | undefined => list.find(test);
  let t: TitleTarget | undefined;
  if ((t = find(typed, (x) => x.phrase === core))) return tier('exact', 40, t);
  if ((t = find(typed, (x) => containsPhrase(core, x.phrase)))) return tier('exact', 36, t);
  if ((t = find(synonyms, (x) => x.phrase === core))) return tier('synonym', 34, t);
  if ((t = find(synonyms, (x) => containsPhrase(core, x.phrase)))) return tier('synonym', 30, t);
  if (input.roleId && (t = find([...typed, ...synonyms], (x) => x.roleId === input.roleId))) return tier('synonym', 28, t);
  if ((t = find(related, (x) => containsPhrase(core, x.phrase) || x.roleId === input.roleId))) return tier('related', 22, t);
  const titleWords = new Set(normalizeText(input.title).split(' '));
  const words = u.words.filter((w) => titleWords.has(w));
  if (words.length === 0) return tier('none', 0);
  return { kind: 'partial', points: Math.max(6, Math.round((24 * words.length) / u.words.length)), words };
}

function titlePart(input: ScoreInput, u: Understanding): { part: Part; kind: TitleMatchKind; matched?: string } {
  const tier = titleTier(input, u);
  const t = tier.target;
  const label =
    tier.kind === 'exact' ? `Title matches “${t?.display}”`
    : tier.kind === 'synonym' ? `Title matches “${t?.display}” (same role)`
    : tier.kind === 'related' ? `Related role: ${t?.display}`
    : tier.kind === 'partial' ? `Title mentions ${tier.words.map((w) => `“${w}”`).join(', ')}`
    : 'Matched in the posting text';
  return { part: { key: 'title', label, points: tier.points, max: MAX.title }, kind: tier.kind, matched: t?.display };
}

function skillsPart(input: ScoreInput, profile: Map<string, string>): { part?: Part; matched: string[]; missing: string[] } {
  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of input.skills) (profile.has(foldText(skill)) ? matched : missing).push(skill);
  if (input.skills.length === 0) return { matched, missing };
  const n = input.skills.length;
  return {
    part: { key: 'skills', label: `You have ${matched.length} of ${n} listed skill${n === 1 ? '' : 's'}`, points: (MAX.skills * matched.length) / n, max: MAX.skills },
    matched,
    missing,
  };
}

function seniorityPart(seniority: Seniority, preferred: readonly Seniority[]): Part | undefined {
  if (preferred.length === 0 || seniority === 'unknown') return undefined;
  const label = SENIORITY_LABELS[seniority];
  if (preferred.includes(seniority)) return { key: 'seniority', label: `${label}, as you prefer`, points: MAX.seniority, max: MAX.seniority };
  const at = SENIORITY_ORDER.indexOf(seniority);
  const near = preferred.some((p) => Math.abs(SENIORITY_ORDER.indexOf(p) - at) === 1);
  return near
    ? { key: 'seniority', label: `${label}, next to your preferred level`, points: 2, max: MAX.seniority }
    : { key: 'seniority', label: `${label}, not your preferred level`, points: 0, max: MAX.seniority };
}

/** The job's city nearest to the target, for "In Round Rock, TX (28 km)". */
function nearestCity(location: JobLocation, target: Place): { place: Place; km: number } | undefined {
  if (target.lat === undefined || target.lon === undefined) return undefined;
  let best: { place: Place; km: number } | undefined;
  for (const p of location.places) {
    if (p.lat === undefined || p.lon === undefined) continue;
    const km = distanceKm({ lat: p.lat, lon: p.lon }, { lat: target.lat, lon: target.lon });
    if (!best || km < best.km) best = { place: p, km };
  }
  return best;
}

function locationPart(location: JobLocation, target: LocationTarget): Part {
  const m = matchPlace(location, target.place, { radiusKm: target.radiusKm, includeRemote: target.includeRemote });
  const part = (label: string, points: number): Part => ({ key: 'location', label, points, max: MAX.location });
  switch (m.kind) {
    case 'city':
      return part(`In ${target.place.label}`, MAX.location);
    case 'radius': {
      const near = nearestCity(location, target.place);
      const km = Math.round(m.distanceKm ?? near?.km ?? 0);
      const share = target.radiusKm > 0 ? Math.min(1, km / target.radiusKm) : 0;
      return part(`In ${near?.place.label ?? 'a nearby city'} (${km} km)`, MAX.location * (1 - 0.4 * share));
    }
    case 'area':
      return part(`In ${target.place.label}`, MAX.location * 0.75);
    case 'remote':
      return part(`Remote, open to ${target.place.label}`, MAX.location * 0.6);
    default:
      return part(`Not in ${target.place.label}`, 0);
  }
}

export function ageLabel(days: number): string {
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 14) return `Posted ${days} days ago`;
  if (days < 60) return `Posted ${Math.round(days / 7)} weeks ago`;
  return `Posted ${Math.round(days / 30)} months ago`;
}

function matchedTerms(input: ScoreInput, u: Understanding, titleMatch?: string): string[] {
  const hay = normalizeText([input.title, ...input.tags, ...input.skills, input.snippet].join(' '));
  const found = u.terms.filter((t) => containsPhrase(hay, normalizeText(t)));
  if (titleMatch && !found.some((t) => foldText(t) === foldText(titleMatch))) found.unshift(titleMatch);
  return found;
}

/** Normalised text relevance, 0–1, within the candidate set. */
export function textRelevance(rank: number | null, bestRank: number | null): number {
  if (rank === null || bestRank === null || bestRank >= 0) return 0;
  return Math.max(0, Math.min(1, rank / bestRank));
}

/** Recency, 0–1: a smooth decay with a ~30-day time constant. */
export function recency(ts: string, now: Date): number {
  return Math.exp(-daysAgo(ts, now) / RECENCY_DAYS);
}

/**
 * Score a posting. With `explain: false` (ranking thousands of candidates) the costlier parts of
 * the explanation — matched terms and the formatted salary — are skipped; the score is the same.
 */
export function scorePosting(input: ScoreInput, ctx: ScoreContext, opts: { explain: boolean } = { explain: true }): { score: number; match: MatchExplanation } {
  const u = ctx.understanding;
  const parts: Part[] = [];
  let titleMatch: TitleMatchKind = 'none';
  let titleDisplay: string | undefined;
  if (u.match) {
    const t = titlePart(input, u);
    parts.push(t.part);
    titleMatch = t.kind;
    titleDisplay = t.matched;
    if (input.rank !== null) {
      const rel = textRelevance(input.rank, ctx.bestRank);
      const label = rel > 0.66 ? 'Strong keyword match' : rel > 0.33 ? 'Good keyword match' : 'Weaker keyword match';
      parts.push({ key: 'text', label, points: MAX.text * rel, max: MAX.text });
    }
  }
  let skillsMatched: string[] = [];
  let skillsMissing: string[] = [];
  if (ctx.profileSkills) {
    const s = skillsPart(input, ctx.profileSkills);
    if (s.part) parts.push(s.part);
    skillsMatched = s.matched;
    skillsMissing = s.missing;
  }
  if (ctx.location) parts.push(locationPart(input.location, ctx.location));
  const seniority = seniorityPart(input.seniority, ctx.preferredSeniority);
  if (seniority) parts.push(seniority);
  const days = daysAgo(input.ts, ctx.now);
  parts.push({ key: 'recency', label: ageLabel(days), points: MAX.recency * recency(input.ts, ctx.now), max: MAX.recency });
  const hasSalary = input.salary?.annualMin !== undefined || input.salary?.annualMax !== undefined;
  const salaryLabel = hasSalary && opts.explain && input.salary ? `Salary listed: ${formatSalary(input.salary)}` : hasSalary ? 'Salary listed' : 'No salary listed';
  parts.push({ key: 'salary', label: salaryLabel, points: hasSalary ? MAX.salary : 0, max: MAX.salary });

  const denominator = parts.reduce((sum, p) => sum + p.max, 0);
  const scale = denominator > 0 ? 100 / denominator : 0;
  const reasons: MatchReason[] = parts.map((p) => ({ key: p.key, label: p.label, points: Math.round(p.points * scale) }));
  let score = parts.reduce((sum, p) => sum + p.points, 0) * scale;
  if (input.closed) {
    reasons.push({ key: 'closed', label: 'This posting is closed', points: -CLOSED_PENALTY });
    score -= CLOSED_PENALTY;
  } else if (days > OLD_DAYS) {
    reasons.push({ key: 'age', label: 'Posted over 2 months ago', points: -OLD_PENALTY });
    score -= OLD_PENALTY;
  }
  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    match: {
      titleMatch,
      matchedTerms: u.match && opts.explain ? matchedTerms(input, u, titleDisplay) : [],
      skillsMatched,
      skillsMissing,
      reasons,
    },
  };
}
