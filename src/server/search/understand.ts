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
import type { ExpandedTitle, SearchQuery } from '../../shared/types';
import { findRole, getRole, type RoleRef } from '../lib/titles';
import { normalizeText, tokenize, uniqueFolded } from '../lib/text';
import { type FtsColumn, ftsAnd, ftsOr, ftsScope, ftsString } from './fts';
import { alternativeText, type ParsedQuery, parseQuery, type QueryAlternative } from './query-parse';

/** A title phrase the engine searched for, for scoring postings' titles. */
export interface TitleTarget {
  /** normalizeText form. */
  phrase: string;
  display: string;
  via: ExpandedTitle['via'];
  roleId?: string;
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
  /** FTS expression matching any excluded term; undefined when nothing is excluded. */
  exclude?: string;
  targets: TitleTarget[];
  /** Normalised positive words, for partial title matches. */
  words: string[];
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

/** Index where `needle` occurs as a contiguous run in `hay`, or -1. */
function findRun(hay: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > hay.length) return -1;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
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
  terms: string[];
  targets: TitleTarget[];
  role?: RoleRef;
}

/** Search one alternative as a title: role phrase (+ synonyms, related titles) AND remaining words, in the title column. */
function titleAlternative(alt: QueryAlternative, query: SearchQuery, related: TitleTarget[]): AltPlan {
  const text = [...alt.words, ...alt.phrases].join(' ');
  const role = findRole(text);
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
  const extras = at >= 0 ? [...words.slice(0, at), ...words.slice(at + core.length)] : words;
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
  const wordExprs = (ws: string[]) => ws.map((w) => ftsOr(variantsOf(w).map(ftsString)));
  const relatedExprs = related.map((t) => ftsString(t.phrase));
  const expr = corePhrase
    ? ftsAnd([...wordExprs(extras), ...alt.phrases.map(ftsString), ftsOr([...targets.map((t) => ftsString(t.phrase)), ...relatedExprs])])
    : ftsOr([ftsAnd([...wordExprs(words), ...alt.phrases.map(ftsString)]), ...relatedExprs]);
  const terms = corePhrase ? [corePhrase, ...extras, ...alt.phrases] : [...words, ...alt.phrases];
  return { expr: expr && ftsScope(['title'], expr), terms, targets, role };
}

/** Search one alternative as keywords: every word and phrase, anywhere in the posting. */
function keywordAlternative(alt: QueryAlternative): AltPlan {
  const expr = ftsAnd([...alt.words, ...alt.phrases].map(ftsString));
  return { expr, terms: [...alt.words, ...alt.phrases], targets: [] };
}

export function isTitleQuery(parsed: ParsedQuery): boolean {
  return (
    parsed.alternatives.length > 0 &&
    parsed.alternatives.every((alt) => findRole([...alt.words, ...alt.phrases].join(' ')) !== undefined || headNoun(altTokens(alt)))
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

export function understandQuery(query: SearchQuery): Understanding {
  const parsed = parseQuery(query.q ?? '');
  const titleOnly = query.titleOnly ?? isTitleQuery(parsed);
  const related = relatedTargets(query.relatedRoles);

  const plans = parsed.alternatives.map((alt) => (titleOnly ? titleAlternative(alt, query, related.targets) : keywordAlternative(alt)));
  const alternativesExpr = plans.map((p) => p.expr);
  // Title alternatives already OR the related titles in; keyword searches get them as one more alternative.
  if ((!titleOnly || plans.length === 0) && related.targets.length) {
    alternativesExpr.push(ftsScope(['title'], ftsOr(related.targets.map((t) => ftsString(t.phrase)))!));
  }

  const scope: FtsColumn[] = titleOnly ? ['title'] : [];
  const exclusions = [
    // "-senior" also drops "Sr." titles.
    ...parsed.excluded.map((e) => ftsScope(scope, ftsOr(variantsOf(normalizeText(e)).map(ftsString))!)),
    ...(query.excludeTerms ?? []).filter((t) => tokenize(t).length > 0).map((t) => ftsScope(['title', 'body'], ftsString(t))),
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
    exclude: ftsOr(exclusions),
    targets,
    words: [...new Set(parsed.alternatives.flatMap(altTokens))],
  };
}
