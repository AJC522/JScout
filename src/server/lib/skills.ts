/**
 * Deterministic skill extraction backed by the bundled skills dictionary
 * (loadReference('skills') from ../data).
 */
import type { SkillSuggestion } from '../../shared/types';
import { notImplemented } from './not-implemented';

/**
 * Find dictionary skills mentioned in free text (a résumé or job description).
 * Returns canonical names, most prominent first (earlier and more frequent mentions rank higher).
 *  - Case-insensitive whole-token matching of names and aliases, including multi-word skills and
 *    names with symbols ("C++", "C#", ".NET", "Node.js", "CI/CD", "A/B testing", "Objective-C").
 *  - Entries flagged `ambiguous` (Go, R, C, Swift, Excel, …) match only case-sensitively AND in a
 *    list-like or skill-like context (comma/slash/bullet-separated lists, after "experience with",
 *    "proficient in", "using", "knowledge of", in a "Skills:" line …), never as an ordinary word
 *    ("go to market", "excel at", "R&D").
 *  - Longest match wins ("Java" must not fire inside "JavaScript"; "SQL" not inside "MySQL";
 *    "React Native" yields React Native, not React).
 * Must stay fast: one pass over the text, usable on thousands of descriptions per second.
 */
export function extractSkills(text: string, opts: { limit?: number } = {}): string[] {
  return notImplemented(`extractSkills(${text.length} chars, ${opts.limit ?? ''})`);
}

/** Canonical name for a skill name or alias (case-insensitive), or undefined when unknown. */
export function canonicalSkill(name: string): string | undefined {
  return notImplemented(`canonicalSkill(${name})`);
}

/** Canonicalise and de-duplicate a user-entered skill list, keeping unknown skills as typed. */
export function normalizeSkillList(names: string[]): string[] {
  return notImplemented(`normalizeSkillList(${names.length})`);
}

/** Autocomplete: skills whose name or alias starts with (then contains) the query. */
export function suggestSkills(query: string, limit = 8): SkillSuggestion[] {
  return notImplemented(`suggestSkills(${query}, ${limit})`);
}

/** Dictionary category for a canonical skill, or undefined. */
export function skillCategory(name: string): string | undefined {
  return notImplemented(`skillCategory(${name})`);
}
