/**
 * Profile match: how well the user's background fits a posting, as a percentage that does not depend on
 * the search text — the résumé, skills, certifications, past and target roles and experience level.
 *
 * Components (only those that can be assessed count toward the denominator):
 *   skills          40  share of the posting's listed skills you have (profile, résumé, experience entries);
 *                       a posting that lists none scores a neutral 50%, since nothing is known either way
 *   certifications  15  share of the certifications/licences the posting lists that you hold
 *   role            30  the posting's role against your target titles, current title and past jobs:
 *                       target role 100% · a role you have held 90% · an adjacent role 60% ·
 *                       the same field 40% · shared title words 15–40% · otherwise 0%
 *   level           15  the posting's seniority against your preferred levels and your years of experience
 *
 * "Best match" ordering (order.ts) sorts by match tier (MATCH_BAND points wide), then location fit, then pay.
 */
import { SENIORITY_LABELS, SENIORITY_ORDER } from '../../shared/constants';
import type {
  FitPart,
  JobLocation,
  LocationFit,
  LocationFitKind,
  Place,
  Profile,
  ProfileFit,
  RemoteMode,
  Salary,
  Seniority,
} from '../../shared/types';
import { parseDatePoint, yearsCovered } from '../features/profile/resume-dates';
import { analyzeResumeText } from '../features/profile/resume-analysis';
import { distanceKm, matchPlace, resolvePlace } from '../lib/location';
import { canonicalSkill, extractSkills, skillCategory } from '../lib/skills';
import { analyzeTitle, findRole, getRole } from '../lib/titles';
import { foldText, normalizeText } from '../lib/text';
import { USD_PER_UNIT } from './plan';

export const MATCH_WEIGHTS = { skills: 40, certifications: 15, role: 30, level: 15 } as const;
/** Width of a match tier in points: 90–100, 80–89, … Jobs in one tier are ordered by location, then pay. */
export const MATCH_BAND = 10;
/** Skills share assumed when a posting lists no skills (its description may simply not be fetched). */
const UNKNOWN_SKILLS_SHARE = 0.5;
const CERT_CATEGORY = 'certification-license';
const IGNORED_CATEGORIES = new Set(['soft-skill']);
const MAX_LISTED = 12;

const ROLE_SCORE = { target: 1, held: 0.9, related: 0.6, family: 0.4 } as const;

/** Title words that say nothing about the kind of work. */
const GENERIC_TITLE_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'at', 'with', 'or', 'i', 'ii', 'iii', 'iv', 'v', 'sr', 'jr',
  'senior', 'junior', 'lead', 'principal', 'staff', 'intern', 'trainee', 'entry', 'level', 'mid', 'associate',
  'assistant', 'chief', 'head', 'remote', 'hybrid', 'team', 'member', 'specialist', 'professional', 'expert',
]);

// ---------------------------------------------------------------------------
// The user's side, built once per profile version
// ---------------------------------------------------------------------------

type RoleVia = 'target' | 'held';

export interface MatchProfile {
  /** Folded canonical skill -> display name: every skill and certification the user has. */
  skills: Map<string, string>;
  /** Taxonomy roles the user targets or has held, with the title that names them. */
  roles: Map<string, { via: RoleVia; title: string }>;
  /** Roles adjacent to the user's roles -> the user's title they are adjacent to. */
  related: Map<string, string>;
  /** Taxonomy families of the user's roles -> the family's name. */
  families: Map<string, string>;
  /** Significant words from the user's titles, for postings whose title the taxonomy does not know. */
  titleWords: Set<string>;
  /** Whether any of the roles are target titles (else the jobs held are what the user is after). */
  hasTargets: boolean;
  /** Levels that fit: preferred levels and the one the years of experience suggest. */
  levels: Seniority[];
  years: number | null;
  /** Enough to compare against: skills or titles. */
  usable: boolean;
}

/** The level years of experience usually reach. */
export function levelForYears(years: number): Seniority {
  if (years < 2) return 'entry';
  if (years < 5) return 'mid';
  if (years < 8) return 'senior';
  return 'lead';
}

function experienceYears(profile: Profile, now: Date): number | null {
  if (profile.work.yearsExperience !== null) return profile.work.yearsExperience;
  const ranges = profile.experience.flatMap((e) => {
    const start = e.start ? parseDatePoint(e.start, 'start') : undefined;
    if (!start) return [];
    const end = e.end ? parseDatePoint(e.end, 'end') : undefined;
    return [{ start, end, current: e.current || !end }];
  });
  return yearsCovered(ranges, now);
}

function significantWords(title: string): string[] {
  const core = analyzeTitle(title).core || normalizeText(title);
  return core.split(' ').filter((w) => w.length > 1 && !GENERIC_TITLE_WORDS.has(w));
}

/**
 * The user's side of the comparison. `effectiveSkills` is the profile service's merged skill list
 * (skills, certifications and résumé skills); the summary and experience entries add the skills they name.
 */
export function buildMatchProfile(profile: Profile, effectiveSkills: readonly string[], now: Date): MatchProfile {
  const described = [profile.work.summary, ...profile.experience.flatMap((e) => [e.title, e.summary, ...e.highlights])]
    .filter(Boolean)
    .join('\n');
  const skills = new Map<string, string>();
  for (const raw of [...effectiveSkills, ...profile.preferences.certifications, ...(described ? extractSkills(described) : [])]) {
    // Postings carry canonical names ("Amazon Web Services"); the profile is canonicalised on save, but not always (imports, tests).
    const s = canonicalSkill(raw) ?? raw;
    const k = foldText(s);
    if (k && !skills.has(k)) skills.set(k, s);
  }

  const resume = profile.resume?.text ? analyzeResumeText(profile.resume.text, { now, mimeType: profile.resume.mimeType }) : undefined;
  const held = [profile.work.currentTitle, ...profile.experience.map((e) => e.title), ...(resume?.titles.map((t) => t.title) ?? [])];
  const titles: Array<{ title: string; via: RoleVia }> = [
    ...profile.preferences.targetTitles.map((title) => ({ title, via: 'target' as const })),
    ...held.map((title) => ({ title, via: 'held' as const })),
  ].filter((t) => t.title.trim());

  const roles = new Map<string, { via: RoleVia; title: string }>();
  const titleWords = new Set<string>();
  for (const { title, via } of titles) {
    for (const w of significantWords(title)) titleWords.add(w);
    const role = findRole(title);
    if (role && !roles.has(role.id)) roles.set(role.id, { via, title });
  }
  const related = new Map<string, string>();
  const families = new Map<string, string>();
  for (const [id, { title }] of roles) {
    const role = getRole(id);
    if (!role) continue;
    families.set(role.familyId, role.family);
    for (const r of role.related) if (!roles.has(r) && !related.has(r)) related.set(r, title);
  }

  const years = experienceYears(profile, now) ?? resume?.yearsExperience ?? null;
  const levels = new Set<Seniority>(profile.preferences.seniority.filter((s) => s !== 'unknown'));
  if (years !== null) levels.add(levelForYears(years));

  return {
    skills,
    roles,
    related,
    families,
    titleWords,
    hasTargets: [...roles.values()].some((r) => r.via === 'target'),
    levels: [...levels],
    years,
    usable: skills.size > 0 || roles.size > 0 || titleWords.size > 0,
  };
}

// ---------------------------------------------------------------------------
// The posting's side
// ---------------------------------------------------------------------------

export interface MatchInput {
  title: string;
  titleCore: string;
  roleId?: string;
  skills: readonly string[];
  seniority: Seniority;
}

export interface MatchResult {
  /** 0–100, or null when there is too little to compare. */
  percent: number | null;
  parts: FitPart[];
  skillsMatched: string[];
  skillsMissing: string[];
  certsMatched: string[];
  certsMissing: string[];
}

/** Folded key and dictionary category per posting skill name: a closed vocabulary, looked up once each. */
const skillInfo = new Map<string, { key: string; category: string | undefined }>();
function infoOf(skill: string): { key: string; category: string | undefined } {
  let info = skillInfo.get(skill);
  if (!info) {
    if (skillInfo.size > 50_000) skillInfo.clear();
    info = { key: foldText(skill), category: skillCategory(skill) };
    skillInfo.set(skill, info);
  }
  return info;
}

export type SkillKind = 'skill' | 'certification' | 'ignored';

/**
 * How the match treats a skill a posting lists: a skill, a certification/licence, or ignored (soft skills).
 * `key` is the folded name MatchProfile.skills is keyed by.
 */
export function classifySkill(skill: string): { key: string; kind: SkillKind } {
  const { key, category } = infoOf(skill);
  const kind: SkillKind = category !== undefined && IGNORED_CATEGORIES.has(category) ? 'ignored' : category === CERT_CATEGORY ? 'certification' : 'skill';
  return { key, kind };
}

type Label = () => string;
interface Scored {
  score: number;
  label: Label;
}

function rolePart(input: MatchInput, mp: MatchProfile): Scored | undefined {
  if (mp.roles.size === 0 && mp.titleWords.size === 0) return undefined;
  const role = input.roleId ? getRole(input.roleId) : undefined;
  if (role) {
    const mine = mp.roles.get(role.id);
    if (mine?.via === 'target') return { score: ROLE_SCORE.target, label: () => `Your target role: ${role.title}` };
    // Without target titles, the jobs you have held are what you are looking for.
    if (mine) return { score: mp.hasTargets ? ROLE_SCORE.held : ROLE_SCORE.target, label: () => `You have worked as ${mine.title}` };
    const near = mp.related.get(role.id);
    if (near) return { score: ROLE_SCORE.related, label: () => `${role.title} is next to your ${near} background` };
  }
  const words = (input.titleCore || normalizeText(input.title)).split(' ').filter((w) => w.length > 1 && !GENERIC_TITLE_WORDS.has(w));
  const shared = words.filter((w) => mp.titleWords.has(w));
  const wordScore = words.length && shared.length ? 0.15 + 0.25 * (shared.length / words.length) : 0;
  if (role && mp.families.has(role.familyId) && ROLE_SCORE.family >= wordScore) {
    return { score: ROLE_SCORE.family, label: () => `Same field as your background (${role.family})` };
  }
  if (wordScore > 0) return { score: wordScore, label: () => `Title shares “${shared.join(' ')}” with your background` };
  return { score: 0, label: () => 'A different line of work from your background' };
}

/**
 * Signed steps from the nearest level that fits the user to the posting's level: 0 when it fits,
 * positive when the job is above it. Undefined when either side is unknown.
 */
export function levelGap(seniority: Seniority, levels: readonly Seniority[]): number | undefined {
  if (seniority === 'unknown' || levels.length === 0) return undefined;
  const at = SENIORITY_ORDER.indexOf(seniority);
  let gap = Infinity;
  for (const l of levels) {
    const d = at - SENIORITY_ORDER.indexOf(l);
    if (Math.abs(d) < Math.abs(gap) || (Math.abs(d) === Math.abs(gap) && d < gap)) gap = d;
  }
  return gap;
}

function levelPart(seniority: Seniority, mp: MatchProfile): Scored | undefined {
  const gap = levelGap(seniority, mp.levels);
  if (gap === undefined) return undefined;
  const label = (text: string): Label => () => {
    const yrs = mp.years !== null ? ` (${mp.years} yr${mp.years === 1 ? '' : 's'} of experience)` : '';
    return `${SENIORITY_LABELS[seniority]}${text}${yrs}`;
  };
  if (gap === 0) return { score: 1, label: label(' fits your level') };
  if (gap < 0) return { score: gap === -1 ? 0.75 : gap === -2 ? 0.4 : 0.15, label: label(', below your level') };
  return { score: gap === 1 ? 0.6 : gap === 2 ? 0.2 : 0, label: label(`, ${gap > 1 ? 'steps' : 'a step'} above your level`) };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * How well the user's background fits one posting. With `explain: false` (ordering every result)
 * the labels are left empty; the percentage is the same.
 */
export function profileMatch(input: MatchInput, mp: MatchProfile, opts: { explain: boolean } = { explain: true }): MatchResult {
  const skillsMatched: string[] = [];
  const skillsMissing: string[] = [];
  const certsMatched: string[] = [];
  const certsMissing: string[] = [];
  for (const s of input.skills) {
    const { key, category } = infoOf(s);
    if (category !== undefined && IGNORED_CATEGORIES.has(category)) continue;
    const have = mp.skills.has(key);
    if (category === CERT_CATEGORY) (have ? certsMatched : certsMissing).push(s);
    else (have ? skillsMatched : skillsMissing).push(s);
  }

  const parts: FitPart[] = [];
  let points = 0;
  let weight = 0;
  const add = (key: FitPart['key'], score: number, label: Label) => {
    const w = MATCH_WEIGHTS[key];
    points += score * w;
    weight += w;
    parts.push({ key, label: opts.explain ? label() : '', score: Math.round(score * 100), weight: w });
  };

  const listed = skillsMatched.length + skillsMissing.length;
  if (mp.skills.size > 0) {
    if (listed > 0) add('skills', skillsMatched.length / listed, () => `You have ${skillsMatched.length} of ${plural(listed, 'listed skill')}`);
    else add('skills', UNKNOWN_SKILLS_SHARE, () => 'The posting lists no specific skills');
  }
  const certs = certsMatched.length + certsMissing.length;
  if (certs > 0) {
    const label = () =>
      certsMatched.length === certs
        ? `You hold ${certs === 1 ? 'the certification' : `all ${certs} certifications`} it lists`
        : `You hold ${certsMatched.length} of ${plural(certs, 'listed certification')}`;
    add('certifications', certsMatched.length / certs, label);
  }
  const role = rolePart(input, mp);
  if (role) add('role', role.score, role.label);
  const level = levelPart(input.seniority, mp);
  if (level) add('level', level.score, level.label);

  // Seniority (or a certification list) alone says too little to call it a match.
  const informative = role !== undefined || (mp.skills.size > 0 && listed > 0);
  const percent = informative && weight > 0 ? Math.round((points * 100) / weight) : null;
  return {
    percent,
    parts,
    skillsMatched: skillsMatched.slice(0, MAX_LISTED),
    skillsMissing: skillsMissing.slice(0, MAX_LISTED),
    certsMatched,
    certsMissing,
  };
}

/** The tier a match falls in, best = highest; jobs with no match come last. */
export function matchBand(percent: number | null): number {
  if (percent === null) return -1;
  return Math.min(Math.floor(100 / MATCH_BAND) - 1, Math.floor(percent / MATCH_BAND));
}

export function bandLabel(percent: number | null): string {
  const band = matchBand(percent);
  if (band < 0) return 'Not enough to compare';
  const low = band * MATCH_BAND;
  return `${low}–${low + MATCH_BAND >= 100 ? 100 : low + MATCH_BAND - 1}% tier`;
}

// ---------------------------------------------------------------------------
// Location fit
// ---------------------------------------------------------------------------

export interface LocationPrefs {
  /** Where the user wants to work (search location, else saved locations, else where they live). */
  places: Place[];
  radiusKm: number;
  /** Remote work is acceptable (the search or saved preferences allow it, or say nothing). */
  acceptsRemote: boolean;
  /** Countries the user can work from, for remote jobs limited to some countries. */
  countries: Set<string>;
}

/** Order of location kinds, best first, when remote work is acceptable and when it is not. */
const ORDER_REMOTE_FIRST: LocationFitKind[] = ['remote', 'local', 'area', 'country', 'unknown', 'abroad', 'remote-elsewhere'];
const ORDER_LOCAL_FIRST: LocationFitKind[] = ['local', 'area', 'remote', 'country', 'unknown', 'abroad', 'remote-elsewhere'];

const usable = (p: Place | undefined): p is Place => p !== undefined && p.kind !== 'anywhere' && p.kind !== 'unknown';

/**
 * The user's location preferences for a search: the searched place(s) when there are any, otherwise the
 * saved locations, otherwise the profile's home location. Remote counts when the search's or the saved
 * work-arrangement list includes it, or neither says.
 */
export function locationPrefs(opts: {
  searchPlaces: Place[];
  searchRadiusKm: number;
  searchRemote?: readonly RemoteMode[];
  profile: Profile;
  /** Fall back to the saved places when the search names none (not when its place could not be resolved). */
  useSavedPlaces: boolean;
}): LocationPrefs {
  const { profile } = opts;
  let places = opts.searchPlaces.filter(usable);
  let radiusKm = opts.searchRadiusKm;
  if (!places.length && opts.useSavedPlaces) {
    places = profile.preferences.locations.map((l) => resolvePlace(l)).filter(usable);
    radiusKm = profile.preferences.radiusKm;
    if (!places.length) {
      const home = profile.personal.location ? resolvePlace(profile.personal.location) : undefined;
      if (usable(home)) places = [home];
    }
  }
  const modes = opts.searchRemote?.length ? opts.searchRemote : profile.preferences.remote;
  const countries = new Set<string>();
  for (const p of places) {
    if (p.country) countries.add(p.country);
    for (const c of p.countries ?? []) countries.add(c);
  }
  return { places, radiusKm, acceptsRemote: modes.length === 0 || modes.includes('remote'), countries };
}

function nearestKm(location: JobLocation, target: Place): number | undefined {
  if (target.lat === undefined || target.lon === undefined) return undefined;
  let best: number | undefined;
  for (const p of location.places) {
    if (p.lat === undefined || p.lon === undefined) continue;
    const km = distanceKm({ lat: p.lat, lon: p.lon }, { lat: target.lat, lon: target.lon });
    if (best === undefined || km < best) best = km;
  }
  return best;
}

interface Candidate {
  kind: LocationFitKind;
  rank: number;
  km?: number;
  label: Label;
}

/**
 * Where a posting stands against the user's location preferences; lower rank is better. With
 * `explain: false` (ordering every result) the label is left empty; the rank is the same.
 */
export function locationFit(location: JobLocation, prefs: LocationPrefs, opts: { explain: boolean } = { explain: true }): LocationFit {
  const order = prefs.acceptsRemote ? ORDER_REMOTE_FIRST : ORDER_LOCAL_FIRST;
  const done = (c: Pick<Candidate, 'kind' | 'km' | 'label'>): LocationFit => ({
    kind: c.kind,
    label: opts.explain ? c.label() : '',
    rank: order.indexOf(c.kind),
    ...(c.km !== undefined ? { distanceKm: Math.round(c.km) } : {}),
  });
  if (location.remote === 'remote') {
    const scope = location.remoteScope;
    if (!scope.length || !prefs.countries.size) return done({ kind: 'remote', label: () => 'Remote' });
    if (scope.some((c) => prefs.countries.has(c)) || prefs.places.some((p) => matchPlace(location, p, { includeRemote: true }).kind !== 'none')) {
      return done({ kind: 'remote', label: () => 'Remote, open to your location' });
    }
    return done({ kind: 'remote-elsewhere', label: () => 'Remote, but not open to your country' });
  }
  const real = location.places.filter((p) => p.kind !== 'unknown' && p.kind !== 'anywhere');
  if (!real.length) return done({ kind: 'unknown', label: () => 'Location not stated' });
  if (!prefs.places.length) return done({ kind: 'unknown', label: () => 'Add your location to rank by distance' });

  let best: Candidate | undefined;
  const consider = (kind: LocationFitKind, label: Label, km?: number) => {
    const rank = order.indexOf(kind);
    if (!best || rank < best.rank || (rank === best.rank && (km ?? Infinity) < (best.km ?? Infinity))) best = { kind, rank, km, label };
  };
  const away = (km: number | undefined) => (km !== undefined ? ` (${Math.round(km)} km)` : '');
  for (const target of prefs.places) {
    const m = matchPlace(location, target, { radiusKm: prefs.radiusKm });
    if (m.kind === 'city') consider('local', () => `In ${target.label}`, 0);
    else if (m.kind === 'area') consider('local', () => `In ${target.label}`);
    else {
      const km = m.distanceKm ?? nearestKm(location, target);
      if (m.kind === 'radius') consider('local', () => `${Math.round(km ?? 0)} km from ${target.label}`, km);
      else if (target.admin1 && real.some((p) => p.country === target.country && p.admin1 === target.admin1)) {
        consider('area', () => `Elsewhere in ${target.admin1Name ?? target.admin1}${away(km)}`, km);
      } else if (target.country && real.some((p) => p.country === target.country || p.countries?.includes(target.country!))) {
        consider('country', () => `Elsewhere in ${target.countryName ?? target.country}${away(km)}`, km);
      } else consider('abroad', () => `Outside ${target.countryName ?? target.label}`, km);
    }
  }
  return done(best!);
}

// ---------------------------------------------------------------------------
// Pay
// ---------------------------------------------------------------------------

/**
 * Annual pay for ordering: the middle of the stated range (or the one end given), converted to
 * `currency` when both rates are known. Undefined when no salary is stated or it cannot be compared.
 */
export function annualPay(salary: Pick<Salary, 'currency' | 'annualMin' | 'annualMax'> | undefined, currency: string): number | undefined {
  if (!salary) return undefined;
  const { annualMin: lo, annualMax: hi } = salary;
  const mid = lo !== undefined && hi !== undefined ? (lo + hi) / 2 : (hi ?? lo);
  if (mid === undefined || !(mid > 0)) return undefined;
  const from = salary.currency ?? currency;
  if (from === currency) return mid;
  const a = USD_PER_UNIT[from];
  const b = USD_PER_UNIT[currency];
  return a !== undefined && b !== undefined ? (mid * a) / b : undefined;
}

// ---------------------------------------------------------------------------
// Together
// ---------------------------------------------------------------------------

export function profileFit(match: MatchResult, location: LocationFit, pay: number | undefined, currency: string): ProfileFit {
  return {
    percent: match.percent,
    band: bandLabel(match.percent),
    parts: match.parts,
    skillsMatched: match.skillsMatched,
    skillsMissing: match.skillsMissing,
    certsMatched: match.certsMatched,
    certsMissing: match.certsMissing,
    location,
    ...(pay !== undefined ? { pay: { annual: Math.round(pay), currency } } : {}),
  };
}

/** Sort key comparison for "Best match": tier, location, pay, exact match. Negative when `a` comes first. */
export function compareFit(
  a: { percent: number | null; locationRank: number; pay: number | undefined },
  b: { percent: number | null; locationRank: number; pay: number | undefined },
): number {
  return (
    matchBand(b.percent) - matchBand(a.percent) ||
    a.locationRank - b.locationRank ||
    (b.pay ?? -1) - (a.pay ?? -1) ||
    (b.percent ?? -1) - (a.percent ?? -1)
  );
}
