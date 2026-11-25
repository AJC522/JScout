/**
 * The requirements and "nice to haves" of a posting, one item per line, ready to check
 * against a résumé.
 *
 * Items come from the lists and sentences under requirement headings ("What you'll bring",
 * "Qualifications", "Nice to have"…). Postings without such a section fall back to the lines
 * that read like requirements ("3+ years of…", "experience with…", "degree in…"). Work
 * authorisation, shifts, travel and similar conditions are left out: a résumé doesn't answer
 * them (the fit analysis's blockers cover them).
 */
import type { RequirementKind, RequirementLevel } from '../../../shared/types';
import { extractSkills } from '../../lib/skills';
import { foldText, truncate } from '../../lib/text';
import { requiredYears } from './flags';
import { BOILERPLATE, REQUIREMENT_HEADING, isHeading } from './keywords';
import { splitSentences } from './text';

export interface Requirement {
  text: string;
  level: RequirementLevel;
  kind: RequirementKind;
}

export const MAX_REQUIREMENTS = 20;
const FALLBACK_MAX = 12;
const MAX_ITEM_CHARS = 240;

const PREFERRED_HEADING =
  /\b(nice[- ]to[- ]haves?|preferred|bonus|pluses|desired|desirable|ideally|good to have|extra credit|not required|optional|would be great)\b/i;
const PREFERRED_ITEM =
  /\b(preferred|nice[- ]to[- ]have|(is |are |would be )?an? (big |huge |strong )?plus|bonus|ideally|desirable|desired|advantageous|helpful|not required|optional)\b/i;
const DUTIES_HEADING =
  /\b(responsibilities|what you('|’)?ll (do|be doing|work on|own)|duties|the role|about the (role|job|team|position)|day[- ]to[- ]day|your impact|in this role|key tasks|what we offer|benefits|perks|about us|who we are)\b/i;
/** Lines that read like a requirement when a posting has no requirements section. */
const REQUIREMENT_CUE =
  /\b(required|requires?|must|you have|you bring|experience (with|in|of|building|leading|managing)|proficien\w*|knowledge of|familiar\w* with|expertise in|degree|bachelor\w*|master\w*|certif\w*|licen[cs]\w*|\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?years?)\b/i;
/** Conditions of the job rather than things a résumé shows. */
const NOT_RESUME_CONTENT =
  /\b(citizen\w*|permanent resident|authori[sz]ed to work|work authori[sz]ation|sponsor\w*|visa|on-?site|in[- ]office|remote|relocat\w*|travel\w*|shifts?|weekends?|overtime|on[- ]call|background check|drug (test|screen)\w*|lift(ing)? (up to )?\d+|pounds|lbs|salary|compensation|benefits|equal opportunity|accommodation|reliable transportation|be at least \d+|years of age|18 years)\b/i;

const SOFT =
  /\b(communicat\w*|collaborat\w*|team ?work|team player|interpersonal|attention to detail|detail[- ]oriented|organi[sz](ed|ation(al)?)|independent\w*|self[- ]starter|self[- ]motivated|problem[- ]solv\w*|leadership|adaptab\w*|flexib\w*|fast[- ]paced|customer[- ]service|time management|written and verbal|verbal and written|motivated|proactive|ownership|curious|curiosity|empath\w*|work ethic|positive attitude|multi-?task\w*|prioriti[sz]\w*)\b/i;
/** Degree abbreviations that are also ordinary words or codes ("MS Office", "Boston, MA") only count in a degree context. */
const ABBR_CONTEXT = String.raw`(?=\s*(?:\/|or\b|and\b|in\b|of\b|degree\b))`;
const DEGREE_PATTERNS: Array<[number, RegExp]> = [
  [4, /\b(ph\.?\s?d|doctorate|doctoral)\b/i],
  [3, /\b(master['’]?s|masters|master of|graduate degree|advanced degree)\b|\bm\.(s|a)\./i],
  [3, new RegExp(String.raw`\b(MBA|MSc|MEng|MSN|MPH)\b|\b(MS|MA)\b${ABBR_CONTEXT}`)],
  [2, /\b(bachelor\w*|(undergraduate|four[- ]year|4[- ]year|college|university) degree)\b|\bb\.(s|a)\./i],
  [2, new RegExp(String.raw`\b(BSc|BEng|BSN)\b|\b(BS|BA)\b${ABBR_CONTEXT}`)],
  [1, /\b(associate['’]?s?\s+degree|associate of|(two|2)[- ]year degree)\b/i],
  [1, new RegExp(String.raw`\b(AA|AS|AAS)\b(?=\s*(?:in\b|degree\b))`)],
];
const DEGREE_WORDS = /\b(degree|diploma|ged|high school)\b/i;

const isDegree = (text: string) => DEGREE_WORDS.test(text) || degreeLevel(text) > 0;
const CREDENTIAL = /\b(licen[cs]\w*|certif\w*|clearance|registered|board[- ]certified)\b/i;

const LOOSE_YEARS = /\b(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?years?\b/i;

/**
 * Years a requirement item asks for. Inside a requirements list "3+ years with Terraform" means
 * experience even without the word, so a looser pattern than the posting-wide one is used.
 */
export function itemYears(text: string): number | undefined {
  const strict = requiredYears(text);
  if (strict !== undefined) return strict;
  const n = Number(LOOSE_YEARS.exec(text)?.[1]);
  return n > 0 && n <= 25 && !/\b(years? (old|of age)|age)\b/i.test(text) ? n : undefined;
}

function classify(text: string): RequirementKind {
  if (itemYears(text) !== undefined) return 'experience';
  if (isDegree(text)) return 'education';
  if (CREDENTIAL.test(text)) return 'credential';
  // "Excellent communication skills" names a skill, but a soft one.
  if (extractSkills(text).some((s) => !SOFT.test(s))) return 'skill';
  if (SOFT.test(text)) return 'soft';
  if (extractSkills(text).length > 0) return 'skill';
  return 'other';
}

function clean(item: string): string {
  return truncate(
    item
      .trim()
      .replace(/^[-•*·▪◦‣●○]\s*/, '')
      .replace(/[;,.:\s]+$/, '')
      .trim(),
    MAX_ITEM_CHARS,
  );
}

/** Items of an inline "Requirements: a; b; c" line, split on semicolons. */
function inlineItems(line: string): { heading: string; items: string[] } | undefined {
  const m = /^([^:]{1,40}):\s*(\S.*)$/.exec(line);
  if (!m || !REQUIREMENT_HEADING.test(m[1]!) && !PREFERRED_HEADING.test(m[1]!)) return undefined;
  return { heading: m[1]!, items: m[2]!.split(/;\s*/) };
}

export function extractRequirements(descriptionText: string): Requirement[] {
  const fromSections: Array<{ text: string; level: RequirementLevel }> = [];
  const fallback: Array<{ text: string; level: RequirementLevel }> = [];
  let mode: 'none' | 'duties' | RequirementLevel = 'none';
  let sawList = false;

  const add = (target: typeof fromSections, raw: string, sectionLevel: RequirementLevel) => {
    const text = clean(raw);
    if (!/\p{L}{2}/u.test(text) || NOT_RESUME_CONTENT.test(text) || BOILERPLATE.test(text)) return;
    target.push({ text, level: sectionLevel === 'preferred' || PREFERRED_ITEM.test(text) ? 'preferred' : 'required' });
  };

  for (const rawLine of descriptionText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const isList = line.startsWith('- ');
    if (!isList && isHeading(line)) {
      mode = PREFERRED_HEADING.test(line) ? 'preferred' : REQUIREMENT_HEADING.test(line) ? 'required' : DUTIES_HEADING.test(line) ? 'duties' : 'none';
      sawList = false;
      continue;
    }
    const inline = isList ? undefined : inlineItems(line);
    if (inline) {
      const level = PREFERRED_HEADING.test(inline.heading) ? 'preferred' : 'required';
      for (const item of inline.items) add(fromSections, item, level);
      continue;
    }
    if (mode === 'required' || mode === 'preferred') {
      // A requirements list ends at the first prose paragraph after it.
      if (!isList && sawList) mode = 'none';
      else {
        if (isList) {
          sawList = true;
          add(fromSections, line.slice(2), mode);
        } else {
          for (const sentence of splitSentences(line)) add(fromSections, sentence, mode);
        }
        continue;
      }
    }
    if (mode === 'duties' && isList) continue;
    for (const piece of isList ? [line.slice(2)] : splitSentences(line)) {
      if (REQUIREMENT_CUE.test(piece)) add(fallback, piece, 'required');
    }
  }

  const chosen = fromSections.length > 0 ? fromSections : fallback.slice(0, FALLBACK_MAX);
  const seen = new Set<string>();
  const out: Requirement[] = [];
  for (const item of chosen) {
    const key = foldText(item.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, kind: classify(item.text) });
    if (out.length >= MAX_REQUIREMENTS) break;
  }
  return out;
}

/** Degree levels named in the text: 1 associate · 2 bachelor · 3 master · 4 doctorate. */
function degreeLevels(text: string): number[] {
  return [...new Set(DEGREE_PATTERNS.filter(([, re]) => re.test(text)).map(([level]) => level))];
}

/** The highest degree named (what a résumé holds); 0 when none. */
export function degreeLevel(text: string): number {
  return Math.max(0, ...degreeLevels(text));
}

/** The lowest degree named (what a requirement such as "BS or MS" asks for at minimum); 0 when none. */
export function minDegreeLevel(text: string): number {
  const levels = degreeLevels(text);
  return levels.length > 0 ? Math.min(...levels) : 0;
}

/** "or equivalent experience" softens a degree requirement. */
export const EQUIVALENT_EXPERIENCE = /\bor (an? )?(equivalent|comparable|relevant) (practical |work |professional )?(experience|combination)\b/i;
