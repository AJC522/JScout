/**
 * Parses the "what" box (SearchQuery.q) into alternatives and exclusions.
 *
 * Grammar:
 *  - bare words are ANDed within an alternative;
 *  - "quoted phrases" must appear as a phrase (an unclosed quote runs to the end);
 *  - a comma, `|` or the upper-case word OR starts a new alternative. OR binds looser than
 *    AND, so `react remote OR vue` means (react AND remote) OR vue;
 *  - a leading `-` excludes a word or a quoted phrase from every alternative.
 * Words and phrases without a letter, digit, `+` or `#` are dropped, so stray punctuation
 * can never reach the full-text engine as an empty phrase.
 */
import { foldText, tokenize } from '../lib/text';

export interface QueryAlternative {
  /** Bare words as typed, in order (case kept; "C#", "node.js" untouched). */
  words: string[];
  /** Quoted phrases, whitespace collapsed. */
  phrases: string[];
}

export interface ParsedQuery {
  alternatives: QueryAlternative[];
  excluded: string[];
}

/** Bounds keep the generated full-text expression small whatever is pasted into the box. */
const MAX_ALTERNATIVES = 10;
const MAX_TERMS_PER_ALTERNATIVE = 16;
const MAX_EXCLUDED = 20;

const TOKEN = /(-?)"([^"]*)"?|([,|])|([^\s,|"]+)/g;

export function isMeaningful(text: string): boolean {
  return tokenize(text).length > 0;
}

function pushUnique(list: string[], value: string, max: number): void {
  if (list.length >= max) return;
  const key = foldText(value);
  if (!list.some((v) => foldText(v) === key)) list.push(value);
}

export function parseQuery(q: string): ParsedQuery {
  const alternatives: QueryAlternative[] = [];
  const excluded: string[] = [];
  let current: QueryAlternative = { words: [], phrases: [] };
  const flush = (): void => {
    if ((current.words.length || current.phrases.length) && alternatives.length < MAX_ALTERNATIVES) alternatives.push(current);
    current = { words: [], phrases: [] };
  };
  const termCount = (): number => current.words.length + current.phrases.length;

  for (const [, negated, phrase, separator, word] of q.matchAll(TOKEN)) {
    if (separator !== undefined || word === 'OR') {
      flush();
    } else if (phrase !== undefined) {
      const text = phrase.replace(/\s+/g, ' ').trim();
      if (!isMeaningful(text)) continue;
      if (negated) pushUnique(excluded, text, MAX_EXCLUDED);
      else if (termCount() < MAX_TERMS_PER_ALTERNATIVE) pushUnique(current.phrases, text, MAX_TERMS_PER_ALTERNATIVE);
    } else if (word !== undefined) {
      if (word.startsWith('-')) {
        const text = word.slice(1);
        if (isMeaningful(text)) pushUnique(excluded, text, MAX_EXCLUDED);
      } else if (isMeaningful(word) && termCount() < MAX_TERMS_PER_ALTERNATIVE) {
        pushUnique(current.words, word, MAX_TERMS_PER_ALTERNATIVE);
      }
    }
  }
  flush();
  return { alternatives, excluded };
}

/** Display text of one alternative: words then quoted phrases. */
export function alternativeText(alt: QueryAlternative): string {
  return [...alt.words, ...alt.phrases.map((p) => `"${p}"`)].join(' ');
}

/** Rebuild a q string from a parse, optionally without the exclusions (used by broaden suggestions). */
export function formatQuery(parsed: ParsedQuery, opts: { withExclusions: boolean }): string {
  const parts = parsed.alternatives.map(alternativeText).join(', ');
  if (!opts.withExclusions || parsed.excluded.length === 0) return parts;
  const neg = parsed.excluded.map((e) => (/\s/.test(e) ? `-"${e}"` : `-${e}`)).join(' ');
  return parts ? `${parts} ${neg}` : neg;
}
