/**
 * Query understanding: decides whether q is a job title, expands recognised titles with
 * taxonomy synonyms and opted-in related roles, and turns the parse into FTS5 expressions.
 *
 * Title alternatives search the title column. A recognised role is matched by the title
 * phrase found in the alternative ("software engineer" in "senior software engineer payments")
 * OR any of its synonyms, ANDed with the remaining words ("senior", "payments"), so
 * "Sr. Software Developer, Payments" matches too. Keyword alternatives AND their words across
 * every column, which is what "react remote" or "kubernetes" need.
 */
import type { EmploymentType, ExpandedTitle, RemoteMode, SearchQuery } from '../../shared/types';
import { resolvePlace } from '../lib/location';
import { findRole, getRole, type RoleRef } from '../lib/titles';
import { normalizeText, tokenize, uniqueFolded } from '../lib/text';
import { type FtsColumn, ftsAnd, ftsOr, ftsPhraseForms, ftsPrefixString, ftsScope, ftsString, ftsWordsAll, singularWord } from './fts';
import { alternativeText, type ParsedQuery, parseQuery, type QueryAlternative } from './query-parse';

/** A title phrase the engine searched for, for scoring postings' titles. */
export interface TitleTarget {
  /** normalizeText form. */
  phrase: string;
  display: string;
  via: ExpandedTitle['via'];
  roleId?: string;
}

/**
 * One excluded term: a posting is excluded when it matches every expression given. jobs_fts stems
 * ("intern" also finds "international"), so its match is narrowed by the unstemmed jobs_words.
 */
export interface Exclusion {
  /** jobs_fts (stemmed): phrase order and column scope. */
  fts?: string;
  /** jobs_words (unstemmed, no phrases): the words as spelled, plus the last word's plural or singular. */
  words?: string;
  /** jobs_title (unstemmed): exclusions from a title search, which only look at titles. */
  title?: string;
}

export interface Understanding {
  parsed: ParsedQuery;
  titleOnly: boolean;
  /** First recognised role. */
  role?: RoleRef;
  /** Every recognised role, in alternative order. */
  roles: RoleRef[];
  titles: ExpandedTitle[];
  /** Positive terms as searched (display form). */
  terms: string[];
  excluded: string[];
  /** Positive FTS expression; undefined when q has no positive terms. */
  match?: string;
  /**
   * Title searches only: the same title expression for the unstemmed jobs_title index, which a
   * posting must match as well, so Porter stemming cannot pair "accountant" with "Account Executive".
   */
  exact?: string;
  /** Excluded terms; a posting matching any of them is left out. */
  exclusions: Exclusion[];
  /**
   * Title searches with acronym titles ("RN", "SWE"): case-insensitive, "rn" also finds the reference
   * code in "Konstrukteur Mechanik; RN 71344". A posting must match `strict` (the title expression
   * without them) or carry one of `words` in capitals as a word of its own, not followed by a number.
   */
  acronyms?: { strict?: string; words: string[] };
  targets: TitleTarget[];
  /** Normalised positive words, for partial title matches. */
  words: string[];
  /**
   * Work arrangement or employment type typed next to a recognised title ("remote software engineer",
   * "full time nurse"): applied as filters instead of title words. Single-alternative queries only.
   */
  filters: { remote?: RemoteMode[]; employmentTypes?: EmploymentType[] };
}

/** Last words that make a phrase a job title ("rust developer", "night nurse"). Singular forms. */
const TITLE_HEADS = new Set([
  'engineer', 'developer', 'manager', 'designer', 'analyst', 'scientist', 'nurse', 'accountant', 'specialist',
  'coordinator', 'representative', 'technician', 'director', 'assistant', 'associate', 'consultant', 'administrator',
  'officer', 'teacher', 'driver', 'architect', 'programmer', 'lead', 'writer', 'editor', 'recruiter', 'advisor',
  'adviser', 'agent', 'operator', 'mechanic', 'electrician', 'therapist', 'pharmacist', 'physician', 'clerk',
  'cashier', 'supervisor', 'executive', 'producer', 'strategist', 'researcher', 'intern', 'planner', 'buyer',
  'auditor', 'attorney', 'lawyer', 'paralegal', 'tester', 'marketer', 'chef', 'cook', 'receptionist', 'instructor',
  'tutor', 'professor', 'lecturer', 'worker', 'technologist', 'hygienist', 'dentist', 'surgeon', 'psychologist',
  'counselor', 'counsellor', 'inspector', 'estimator', 'controller', 'bookkeeper', 'cleaner', 'pilot', 'welder',
  'plumber', 'carpenter', 'machinist', 'installer', 'president', 'head', 'owner', 'partner', 'trainer', 'sre',
]);

/** Seniority words searched together with their abbreviations. */
const SENIORITY_VARIANTS: ReadonlyArray<readonly string[]> = [
  ['senior', 'sr'],
  ['junior', 'jr'],
  ['intern', 'internship'],
];

function variantsOf(word: string): readonly string[] {
  return SENIORITY_VARIANTS.find((g) => g.includes(word)) ?? [word];
}

function headNoun(tokens: string[]): boolean {
  const last = tokens.at(-1);
  if (!last) return false;
  return TITLE_HEADS.has(last) || (last.endsWith('s') && TITLE_HEADS.has(last.slice(0, -1)));
}

function altTokens(alt: QueryAlternative): string[] {
  return tokenize([...alt.words, ...alt.phrases].join(' '));
}

/** Index where `needle` occurs as a contiguous run in `hay`, or -1. Its last word may be plural in `hay` ("software engineers"). */
function findRun(hay: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > hay.length) return -1;
  const last = needle.length - 1;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j] && !(j === last && singularWord(hay[i + j]!) === needle[j])) continue outer;
    }
    return i;
  }
  return -1;
}

/** The taxonomy role of a title, also when its last word is typed in the plural ("registered nurses"). */
function findRoleOf(text: string): RoleRef | undefined {
  const role = findRole(text);
  if (role) return role;
  const tokens = tokenize(text);
  const last = tokens.at(-1);
  if (!last || singularWord(last) === last) return undefined;
  return findRole([...tokens.slice(0, -1), singularWord(last)].join(' '));
}

/** "software engineer" contained in " senior software engineer " (word-aligned). */
export function containsPhrase(haystack: string, phrase: string): boolean {
  return phrase !== '' && ` ${haystack} `.includes(` ${phrase} `);
}

function roleTitles(role: RoleRef): string[] {
  return uniqueFolded([role.title, ...role.aliases]);
}

interface AltPlan {
  expr?: string;
  /** Title alternatives: `expr` for the unstemmed title index. */
  exact?: string;
  terms: string[];
  targets: TitleTarget[];
  role?: RoleRef;
  remote?: RemoteMode;
  employmentType?: EmploymentType;
  /** Acronym titles searched (see Understanding.acronyms). */
  acronyms?: string[];
  /** `exact` without the acronym titles; undefined when nothing else is left. */
  strictExact?: string;
}

/** A short all-letter title ("rn", "swe", "pm"), which must be written in capitals to count. */
export const isAcronym = (phrase: string): boolean => /^[a-z]{1,3}$/.test(phrase);

/** Words that say how to work, not what the job is called (normalizeText tokens). Longer entries first. */
const ARRANGEMENTS: ReadonlyArray<{ words: string[]; remote?: RemoteMode; employmentType?: EmploymentType }> = [
  { words: ['work', 'from', 'home'], remote: 'remote' },
  { words: ['full', 'time'], employmentType: 'full-time' },
  { words: ['part', 'time'], employmentType: 'part-time' },
  { words: ['on', 'site'], remote: 'onsite' },
  { words: ['in', 'office'], remote: 'onsite' },
  { words: ['fulltime'], employmentType: 'full-time' },
  { words: ['parttime'], employmentType: 'part-time' },
  { words: ['onsite'], remote: 'onsite' },
  { words: ['remote'], remote: 'remote' },
  { words: ['remotely'], remote: 'remote' },
  { words: ['wfh'], remote: 'remote' },
  { words: ['hybrid'], remote: 'hybrid' },
  { words: ['contract'], employmentType: 'contract' },
  { words: ['temporary'], employmentType: 'temporary' },
  { words: ['freelance'], employmentType: 'freelance' },
];

interface Leftovers {
  /** Words still required in the title. */
  title: string[];
  /** Arrangement words taken out, as typed. */
  taken: string[];
  remote?: RemoteMode;
  employmentType?: EmploymentType;
}

/** Take arrangement words out of the words around a recognised title. */
function takeArrangements(words: string[]): Leftovers {
  const out: Leftovers = { title: [], taken: [] };
  for (let i = 0; i < words.length; ) {
    const a = ARRANGEMENTS.find((x) => x.words.every((w, j) => words[i + j] === w));
    if (!a) {
      out.title.push(words[i++]!);
      continue;
    }
    out.taken.push(a.words.join(' '));
    if (a.remote) out.remote ??= a.remote;
    if (a.employmentType) out.employmentType ??= a.employmentType;
    i += a.words.length;
  }
  return out;
}

const MIN_PLACE_POPULATION = 50_000;

/**
 * True when the words next to a recognised title name a place ("software engineer berlin"): they are
 * searched anywhere in the posting (its location included), not in the title. Only a place's own name
 * counts, and cities need a sizeable population, so title words like "lead" stay title words.
 */
function isPlaceName(words: string[]): boolean {
  if (words.length === 0 || words.some((w) => TITLE_HEADS.has(w) || variantsOf(w).length > 1 || /\d/.test(w))) return false;
  const text = words.join(' ');
  const place = resolvePlace(text);
  if (!place || place.kind === 'unknown' || place.kind === 'anywhere') return false;
  if (place.kind === 'city' && (place.population ?? 0) < MIN_PLACE_POPULATION) return false;
  const name = place.kind === 'city' ? place.city : place.kind === 'region' ? place.region : place.kind === 'country' ? place.countryName : place.admin1Name;
  return name !== undefined && normalizeText(name) === text;
}

/** Search one alternative as a title: role phrase (+ synonyms, related titles) AND remaining words, in the title column. */
function titleAlternative(alt: QueryAlternative, query: SearchQuery, related: TitleTarget[]): AltPlan {
  const text = [...alt.words, ...alt.phrases].join(' ');
  const role = findRoleOf(text);
  // Only bare words can be re-grouped; quoted phrases always stay required as typed.
  const words = tokenize(alt.words.join(' '));
  let core: string[] = [];
  let coreTitle = '';
  if (role) {
    for (const t of roleTitles(role)) {
      const tokens = tokenize(t);
      if (tokens.length > core.length && findRun(words, tokens) >= 0) [core, coreTitle] = [tokens, t];
    }
  }
  const at = findRun(words, core);
  // Around a recognised title: "remote", "full time" become filters and a trailing or leading place
  // name is searched anywhere, so "remote software engineer berlin" does not need all three in the title.
  const before = takeArrangements(at >= 0 ? words.slice(0, at) : []);
  const after = takeArrangements(at >= 0 ? words.slice(at + core.length) : []);
  const anywhere = [before, after].flatMap((side) => (isPlaceName(side.title) ? [side.title.splice(0).join(' ')] : []));
  const extras = at >= 0 ? [...before.title, ...after.title] : words;
  const display = alternativeText(alt);
  const corePhrase = core.join(' ');
  // The taxonomy's spelling reads better in explanations than what was typed ("Software Engineer", not "software engineer").
  const targets: TitleTarget[] = [{ phrase: corePhrase || normalizeText(text), display: coreTitle || display, via: 'query', roleId: role?.id }];
  if (role && corePhrase && query.synonyms !== false) {
    for (const t of roleTitles(role)) {
      const phrase = normalizeText(t);
      if (phrase && phrase !== corePhrase) targets.push({ phrase, display: t, via: 'synonym', roleId: role.id });
    }
  }
  const build = (str: (text: string) => string, withoutAcronyms = false): string | undefined => {
    const keep = (t: TitleTarget) => !withoutAcronyms || !isAcronym(t.phrase);
    const wordExprs = (ws: string[]) => ws.map((w) => ftsOr(variantsOf(w).map(str)));
    const relatedExprs = related.filter(keep).map((t) => str(t.phrase));
    let expr: string | undefined;
    if (corePhrase) {
      const titles = ftsOr([...targets.filter(keep).map((t) => str(t.phrase)), ...relatedExprs]);
      expr = titles && ftsAnd([...wordExprs(extras), ...alt.phrases.map(str), titles]);
    } else {
      const typed = withoutAcronyms && words.length === 1 && alt.phrases.length === 0 && isAcronym(words[0]!) ? undefined : ftsAnd([...wordExprs(words), ...alt.phrases.map(str)]);
      expr = ftsOr([typed, ...relatedExprs]);
    }
    return expr && ftsScope(['title'], expr);
  };
  const acronyms = [...new Set([...targets, ...related].map((t) => t.phrase).filter(isAcronym))];
  if (!corePhrase && words.length === 1 && alt.phrases.length === 0 && isAcronym(words[0]!)) acronyms.push(words[0]!);
  const terms = corePhrase ? [corePhrase, ...extras, ...alt.phrases, ...before.taken, ...after.taken, ...anywhere] : [...words, ...alt.phrases];
  const title = build(ftsString);
  return {
    expr: anywhere.length ? ftsAnd([title, ...anywhere.map(ftsString)]) : title,
    exact: build(ftsPrefixString),
    terms,
    targets,
    role,
    remote: before.remote ?? after.remote,
    employmentType: before.employmentType ?? after.employmentType,
    ...(acronyms.length ? { acronyms: [...new Set(acronyms)], strictExact: build(ftsPrefixString, true) } : {}),
  };
}

/** Search one alternative as keywords: every word and phrase, anywhere in the posting. */
function keywordAlternative(alt: QueryAlternative): AltPlan {
  const expr = ftsAnd([...alt.words, ...alt.phrases].map(ftsString));
  return { expr, terms: [...alt.words, ...alt.phrases], targets: [] };
}

export function isTitleQuery(parsed: ParsedQuery): boolean {
  return (
    parsed.alternatives.length > 0 &&
    parsed.alternatives.every((alt) => findRoleOf([...alt.words, ...alt.phrases].join(' ')) !== undefined || headNoun(altTokens(alt)))
  );
}

function relatedTargets(ids: readonly string[] | undefined): { roles: RoleRef[]; targets: TitleTarget[] } {
  const roles: RoleRef[] = [];
  for (const id of ids ?? []) {
    const role = getRole(id);
    if (role && !roles.includes(role)) roles.push(role);
  }
  const targets = roles.flatMap((role) =>
    roleTitles(role).map((t): TitleTarget => ({ phrase: normalizeText(t), display: t, via: 'related', roleId: role.id })),
  );
  return { roles, targets: targets.filter((t) => t.phrase) };
}

/** Understanding.acronyms for a title search, when any acronym title is searched. */
function acronymCheck(plans: AltPlan[], related: TitleTarget[]): Pick<Understanding, 'acronyms'> {
  const words = new Set(plans.flatMap((p) => p.acronyms ?? []));
  const relatedLong = related.filter((t) => !isAcronym(t.phrase));
  if (plans.length === 0) for (const t of related) if (isAcronym(t.phrase)) words.add(t.phrase);
  if (words.size === 0) return {};
  const strict = ftsOr([
    ...plans.map((p) => (p.acronyms ? p.strictExact : p.exact)),
    ...(plans.length === 0 && relatedLong.length ? [ftsScope(['title'], ftsOr(relatedLong.map((t) => ftsPrefixString(t.phrase)))!)] : []),
  ]);
  return { acronyms: { ...(strict ? { strict } : {}), words: [...words] } };
}

function arrangementFilters(plan: AltPlan): Understanding['filters'] {
  return {
    ...(plan.remote ? { remote: [plan.remote] } : {}),
    ...(plan.employmentType ? { employmentTypes: [plan.employmentType] } : {}),
  };
}

export function understandQuery(query: SearchQuery): Understanding {
  const parsed = parseQuery(query.q ?? '');
  const looksLikeTitle = isTitleQuery(parsed);
  const titleOnly = query.titleOnly ?? looksLikeTitle;
  const related = relatedTargets(query.relatedRoles);

  const plans = parsed.alternatives.map((alt): AltPlan => {
    if (titleOnly) return titleAlternative(alt, query, related.targets);
    const keywords = keywordAlternative(alt);
    if (!looksLikeTitle) return keywords;
    // A title searched "anywhere" keeps its title matches (synonyms included): widening a title search
    // to keywords anywhere must only add results, never drop the "Software Developer" it found.
    const title = titleAlternative(alt, query, []);
    return { ...keywords, expr: ftsOr([title.expr, keywords.expr]), targets: title.targets, role: title.role };
  });
  const alternativesExpr = plans.map((p) => p.expr);
  const exactExpr = plans.map((p) => p.exact);
  // Title alternatives already OR the related titles in; keyword searches get them as one more alternative.
  if ((!titleOnly || plans.length === 0) && related.targets.length) {
    const relatedTitles = (str: (text: string) => string) => ftsScope(['title'], ftsOr(related.targets.map((t) => str(t.phrase)))!);
    alternativesExpr.push(relatedTitles(ftsString));
    exactExpr.push(relatedTitles(ftsPrefixString));
  }

  // Matched as spelled (singular or plural), never by stem: "-intern" must keep "International ..." titles.
  const exclusions: Exclusion[] = [
    ...parsed.excluded.flatMap((e): Exclusion[] => {
      // "-senior" also drops "Sr." titles.
      const variants = variantsOf(normalizeText(e)).map(tokenize).filter((t) => t.length > 0);
      if (variants.length === 0) return [];
      if (titleOnly) return [{ title: ftsOr(variants.map(ftsPhraseForms)) }];
      return [{ fts: ftsOr(variants.map((t) => ftsString(t.join(' ')))), words: ftsOr(variants.map(ftsWordsAll)) }];
    }),
    ...(query.excludeTerms ?? []).flatMap((t): Exclusion[] => {
      const tokens = tokenize(t);
      return tokens.length ? [{ fts: ftsScope(['title', 'body'], ftsString(t)), words: ftsWordsAll(tokens) }] : [];
    }),
  ];

  const targets = [...plans.flatMap((p) => p.targets), ...related.targets];
  const roles = [...new Set(plans.flatMap((p) => (p.role ? [p.role] : [])))];
  const titles: ExpandedTitle[] = [];
  const seenTitles = new Set<string>();
  for (const t of targets) {
    const key = `${t.via}|${t.phrase}`;
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    titles.push(t.roleId ? { title: t.display, via: t.via, roleId: t.roleId } : { title: t.display, via: t.via });
  }

  return {
    parsed,
    titleOnly,
    role: roles[0],
    roles,
    titles,
    terms: uniqueFolded(plans.flatMap((p) => p.terms)),
    excluded: uniqueFolded([...parsed.excluded, ...(query.excludeTerms ?? [])]),
    match: ftsOr(alternativesExpr),
    // A keyword search may OR related titles with words anywhere, so only pure title searches are checked.
    ...(titleOnly ? { exact: ftsOr(exactExpr) } : {}),
    ...(titleOnly ? acronymCheck(plans, related.targets) : {}),
    exclusions,
    targets,
    words: [...new Set(parsed.alternatives.flatMap(altTokens))],
    filters: plans.length === 1 ? arrangementFilters(plans[0]!) : {},
  };
}
