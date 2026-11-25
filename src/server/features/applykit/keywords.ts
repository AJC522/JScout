/**
 * The posting's important terms and whether the user's résumé/profile covers them.
 *
 * Candidates come from three places: the posting's canonical skills, multi-word phrases
 * that recur or sit in a requirements section, and capitalised names (tools, systems,
 * credentials) that recur. Each is scored by frequency, by appearing under a requirements
 * heading, and by appearing early, then normalised to 0–1.
 */
import type { KeywordCoverage } from '../../../shared/types';
import { resolvePlace } from '../../lib/location';
import { escapeRegExp, foldText } from '../../lib/text';
import type { JobContext, ProfileContext } from './context';
import { STOPWORDS, containsPhrase, nearPhrase, occurrences, phraseKey, type Word, words } from './text';

export interface Keyword extends KeywordCoverage {
  kind: 'skill' | 'phrase' | 'word' | 'name';
  /** Stem key used for matching. */
  key: string;
  /** Mentions in the posting (at least 1 for listed skills). */
  count: number;
  /** Position of the first mention as a fraction of the posting (0 = start). */
  firstAt: number;
}

export const MAX_KEYWORDS = 25;
const MIN_KEYWORDS = 10;

/** Generic posting vocabulary that never makes a useful keyword on its own or at a phrase edge. */
const GENERIC = new Set(
  (
    'experience experienced ability abilities able strong excellent great good proven solid deep demonstrated ' +
    'skill skills work works working team teams role roles year years job jobs position candidate candidates ' +
    'opportunity opportunities company including include includes etc knowledge understanding familiarity ' +
    'preferred required requirement requirements plus bonus ideal ideally responsibilities responsibility new well ' +
    'highly related equivalent environment day days time benefits salary pay apply applicant applicants employer ' +
    'large small high fast other various multiple key core main least minimum maximum similar relevant ' +
    'looking seeking join help ensure provide support use using within across based must need needs want ' +
    'someone people person like make making get one two three four five six seven eight nine ten ' +
    'active valid current hour hours week weeks month months up down out off able' +
    ' monday tuesday wednesday thursday friday saturday sunday january february march april may june july' +
    ' august september october november december'
  ).split(' '),
);

/** Broad nouns that are fine inside a phrase ("distributed systems") but say little alone. */
const VAGUE_ALONE = new Set(
  (
    'system systems service services platform platforms product products solution solutions process processes ' +
    'tool tools customer customers client clients business data project projects tech technology technologies'
  ).split(' '),
);

/** Inner words allowed inside a three-word phrase ("attention to detail", "quality of care"). */
const PHRASE_GLUE = new Set(['of', 'and', 'to', 'for', 'in', 'with']);

const REQUIREMENT_HEADING =
  /\b(requirements?|qualifications?|what you('|’)?ll (bring|need|have)|what you bring|what (we|we're|we’re) (are )?looking for|what we look for|must[- ]haves?|you have|you bring|about you|who you are|skills|nice[- ]to[- ]haves?|preferred|bonus points|ideal candidate|essential|desired|competencies)\b/i;

/** Paragraphs that are legal or benefits boilerplate: no phrases or names are taken from them. */
const BOILERPLATE =
  /\b(equal (employment )?opportunity|without regard to|regardless of|reasonable accommodations?|e-?verify|privacy (notice|policy)|benefits include|we offer)\b/i;

interface Ranges {
  requirements: Array<[number, number]>;
  boilerplate: Array<[number, number]>;
}

const inRanges = (ranges: Array<[number, number]>, at: number) => ranges.some(([a, b]) => at >= a && at < b);

/** A short line with no sentence punctuation, or one ending with ':' — a section heading. */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith('- ') || t.length > 80) return false;
  if (t.endsWith(':')) return true;
  return !/[.!?,;]$/.test(t) && t.split(/\s+/).length <= 8;
}

function sectionRanges(text: string): Ranges {
  const requirements: Array<[number, number]> = [];
  const boilerplate: Array<[number, number]> = [];
  let offset = 0;
  let reqStart = -1;
  let sawList = false;
  let afterBlank = false;
  for (const line of text.split('\n')) {
    const end = offset + line.length + 1;
    const trimmed = line.trim();
    const isList = trimmed.startsWith('- ');
    // A requirements list ends at the first prose paragraph after it.
    if (reqStart >= 0 && sawList && afterBlank && trimmed && !isList && !isHeading(trimmed)) {
      requirements.push([reqStart, offset]);
      reqStart = -1;
    }
    if (reqStart >= 0 && isList) sawList = true;
    if (trimmed) afterBlank = false;
    else afterBlank = true;
    if (isHeading(trimmed)) {
      const isReq = REQUIREMENT_HEADING.test(trimmed);
      if (isReq && reqStart < 0) {
        reqStart = offset;
        sawList = false;
      }
      if (!isReq && reqStart >= 0) {
        requirements.push([reqStart, offset]);
        reqStart = -1;
      }
    } else if (/^[^:]{1,40}:\s*\S/.test(trimmed) && REQUIREMENT_HEADING.test(trimmed.split(':')[0]!)) {
      // Inline "Requirements: 5+ years of …" lines.
      requirements.push([offset, end]);
    }
    if (BOILERPLATE.test(line)) boilerplate.push([offset, end]);
    offset = end;
  }
  if (reqStart >= 0) requirements.push([reqStart, offset]);
  return { requirements, boilerplate };
}

/** True when punctuation or a line break separates two adjacent words. */
function breakBetween(text: string, a: Word, b: Word): boolean {
  return /[^ \t\-–'’&]/.test(text.slice(a.index + a.text.length, b.index));
}

interface Candidate {
  term: string;
  key: string;
  kind: Keyword['kind'];
  positions: number[];
}

function phraseCandidates(text: string, ws: Word[], ranges: Ranges, excluded: Set<string>): Candidate[] {
  const byKey = new Map<string, Candidate>();
  const edgeOk = (w: Word) =>
    !STOPWORDS.has(w.norm) && !GENERIC.has(w.norm) && !excluded.has(w.norm) && w.norm.length > 1 && !/^\d+$/.test(w.norm);
  for (let i = 0; i < ws.length; i++) {
    if (inRanges(ranges.boilerplate, ws[i]!.index)) continue;
    for (const n of [2, 3]) {
      const span = ws.slice(i, i + n);
      if (span.length < n) break;
      if (span.some((w, j) => j > 0 && breakBetween(text, span[j - 1]!, w))) break;
      if (!edgeOk(span[0]!) || !edgeOk(span[n - 1]!)) continue;
      if (n === 3 && !edgeOk(span[1]!) && !PHRASE_GLUE.has(span[1]!.norm)) continue;
      const key = span.map((w) => w.stem).join(' ');
      const found = byKey.get(key);
      if (found) found.positions.push(i);
      else {
        const term = text.slice(span[0]!.index, span[n - 1]!.index + span[n - 1]!.text.length);
        byKey.set(key, { term: lowerCapitalised(term), key, kind: 'phrase', positions: [i] });
      }
    }
  }
  return [...byKey.values()];
}

/** "Patient Care" -> "patient care", keeping acronyms ("REST APIs" -> "REST APIs"). */
function lowerCapitalised(phrase: string): string {
  return phrase.replace(/\p{L}+/gu, (w) => (/^\p{Lu}\p{Ll}*$/u.test(w) ? w.toLowerCase() : w));
}

/** Single words that recur at least three times ("payments" in a payments company's posting). */
function wordCandidates(text: string, ws: Word[], ranges: Ranges, excluded: Set<string>): Candidate[] {
  const byStem = new Map<string, Candidate>();
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    if (w.norm.length < 4 || STOPWORDS.has(w.norm) || GENERIC.has(w.norm) || VAGUE_ALONE.has(w.norm)) continue;
    if (excluded.has(w.norm) || /\d/.test(w.norm) || inRanges(ranges.boilerplate, w.index)) continue;
    const found = byStem.get(w.stem);
    if (found) found.positions.push(i);
    else byStem.set(w.stem, { term: lowerCapitalised(w.text), key: w.stem, kind: 'word', positions: [i] });
  }
  return [...byStem.values()].filter((c) => c.positions.length >= 3);
}

/** Place names ("Illinois", "United States") are capitalised but are not skills or tools. */
function isPlaceName(term: string, text: string): boolean {
  const t = escapeRegExp(term);
  const pair = new RegExp(`(\\p{Lu}\\p{L}+ ${t}|${t} \\p{Lu}\\p{L}+)(?![\\p{L}])`, 'u').exec(text)?.[0];
  return [term, pair].some((p) => p !== undefined && resolvePlace(p) !== undefined);
}

/** Capitalised words used like names (never lower-case in the posting), e.g. "Salesforce", "Epic", "ACLS". */
function nameCandidates(text: string, ws: Word[], ranges: Ranges, excluded: Set<string>): Candidate[] {
  const stats = new Map<string, { term: string; positions: number[]; midSentence: number; lower: number }>();
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    if (w.norm.length < 3 || STOPWORDS.has(w.norm) || GENERIC.has(w.norm) || excluded.has(w.norm)) continue;
    if (/^\d/.test(w.norm) || inRanges(ranges.boilerplate, w.index)) continue;
    const s = stats.get(w.norm) ?? { term: w.text, positions: [], midSentence: 0, lower: 0 };
    stats.set(w.norm, s);
    s.positions.push(i);
    if (!/^\p{Lu}/u.test(w.text)) s.lower++;
    else if (i > 0 && !breakBetween(text, ws[i - 1]!, w)) s.midSentence++;
  }
  return [...stats.values()]
    .filter((s) => s.lower === 0 && s.midSentence > 0 && !isPlaceName(s.term, text))
    .map((s) => ({ term: s.term, key: phraseKey(s.term), kind: 'name' as const, positions: s.positions }));
}

/**
 * Whether two candidates say the same thing: one key is a contiguous run inside the other.
 * A recurring single word may sit alongside a phrase containing it ("payments" and
 * "payments platform"); skills and names still absorb phrases built around them.
 */
function overlaps(a: Candidate, b: Candidate): boolean {
  if (a.key === b.key) return true;
  if ((a.kind === 'word' && b.key.includes(' ')) || (b.kind === 'word' && a.key.includes(' '))) return false;
  return ` ${a.key} `.includes(` ${b.key} `) || ` ${b.key} `.includes(` ${a.key} `);
}

/** Important terms of the posting, most important first, each marked present when the profile covers it. */
export function extractKeywords(job: JobContext, profile: ProfileContext): Keyword[] {
  const text = job.descriptionText;
  const ws = words(text);
  const ranges = sectionRanges(text);
  // The employer's own name and location words recur but say nothing about the work.
  const excluded = new Set(words(`${job.company} ${job.locationText}`).map((w) => w.norm));
  // Title words are capitalised mid-sentence ("As a Staff Nurse, you…") without being names.
  const notNames = new Set([...excluded, ...words(job.title).map((w) => w.norm)]);
  const total = Math.max(ws.length, 1);

  const skillCandidates: Candidate[] = job.skills.map((skill) => {
    const key = phraseKey(skill);
    return { term: skill, key, kind: 'skill', positions: occurrences(ws, key.split(' ')) };
  });
  const candidates = [
    ...skillCandidates,
    ...phraseCandidates(text, ws, ranges, excluded),
    ...wordCandidates(text, ws, ranges, notNames),
    ...nameCandidates(text, ws, ranges, notNames),
  ];

  const scored = candidates
    .filter((c) => c.key !== '')
    .map((c) => {
      const inRequirements = c.positions.some((p) => inRanges(ranges.requirements, ws[p]!.index));
      const count = Math.max(c.positions.length, 1);
      const firstAt = c.positions.length > 0 ? c.positions[0]! / total : 0.5;
      const size = c.key.split(' ').length;
      // A one-off three-word phrase is rarely better than its two-word parts.
      const eligible = c.kind === 'skill' || count >= 2 || (inRequirements && size < 3);
      const base = { skill: 2, name: 1.2, phrase: 1, word: 0.9 }[c.kind];
      const score = base * (1 + Math.log2(count)) * (inRequirements ? 1.5 : 1) * (firstAt < 0.25 ? 1.2 : 1);
      return { c, count, firstAt, eligible, score, size };
    })
    .sort((a, b) => b.score - a.score || a.firstAt - b.firstAt);

  const chosen: typeof scored = [];
  const take = (pool: typeof scored, limit: number) => {
    for (const s of pool) {
      if (chosen.length >= limit) return;
      if (chosen.some((x) => overlaps(x.c, s.c))) continue;
      chosen.push(s);
    }
  };
  take(scored.filter((s) => s.eligible), MAX_KEYWORDS);
  // Short postings: top up with single-mention phrases so there is something to check against.
  take(scored.filter((s) => !s.eligible && s.size < 3), MIN_KEYWORDS);

  const top = chosen[0]?.score ?? 1;
  const userSkills = new Set(profile.skills.map(foldText));
  return chosen
    .sort((a, b) => b.score - a.score)
    .map(({ c, count, firstAt, score }) => ({
      term: c.term,
      present:
        (c.kind === 'skill' && userSkills.has(foldText(c.term))) ||
        containsPhrase(profile.corpus, c.key) ||
        (c.kind === 'phrase' && nearPhrase(profile.corpusStems, c.key)),
      weight: Math.round((score / top) * 100) / 100,
      kind: c.kind,
      key: c.key,
      count,
      firstAt,
    }));
}
