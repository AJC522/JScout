/**
 * Small text helpers shared by the apply kit: tokens that keep their original spelling,
 * light English stemming for "does the résumé mention this?" checks, and deterministic
 * variant choice so different jobs get differently phrased drafts.
 */
import { foldText, stableHash } from '../../lib/text';

export interface Word {
  /** As written in the source text. */
  text: string;
  /** Folded, lower-case. */
  norm: string;
  stem: string;
  /** Character offset in the source text. */
  index: number;
}

/** Same token rule as normalizeText in lib/text: runs of letters, digits, '+' and '#'. */
const WORD_RE = /[\p{L}\p{N}+#]+/gu;

/**
 * Deliberately light suffix stripping (plurals, -ing, -ed, trailing e) so "managing",
 * "managed" and "manage" compare equal without the over-merging of a full Porter stemmer.
 */
export function stem(norm: string): string {
  if (norm.length <= 3 || /[^a-z]/.test(norm)) return norm;
  if (/(ies|ied)$/.test(norm) && norm.length > 4) return `${norm.slice(0, -3)}y`;
  if (norm.endsWith('sses')) return norm.slice(0, -2);
  let w = norm;
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (!w.endsWith(suffix) || w.length - suffix.length < 3) continue;
    if (suffix === 's' && /(ss|us|is)$/.test(w)) break;
    w = w.slice(0, -suffix.length);
    break;
  }
  return w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w;
}

export function words(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const norm = foldText(m[0]);
    out.push({ text: m[0], norm, stem: stem(norm), index: m.index });
  }
  return out;
}

/** Stems of a phrase joined by spaces: the comparison key for terms. */
export function phraseKey(phrase: string): string {
  return words(phrase)
    .map((w) => w.stem)
    .join(' ');
}

/** Stemmed text padded with spaces, for whole-phrase `includes` checks. */
export function stemmedText(text: string): string {
  return ` ${phraseKey(text)} `;
}

export function containsPhrase(stemmed: string, key: string): boolean {
  return key !== '' && stemmed.includes(` ${key} `);
}

export function countPhrase(stemmed: string, key: string): number {
  if (key === '') return 0;
  const needle = ` ${key} `;
  let count = 0;
  for (let i = stemmed.indexOf(needle); i !== -1; i = stemmed.indexOf(needle, i + 1)) count++;
  return count;
}

/** Word indices where the stem sequence `key` starts. */
export function occurrences(ws: Word[], key: string[]): number[] {
  const out: number[] = [];
  if (key.length === 0) return out;
  outer: for (let i = 0; i + key.length <= ws.length; i++) {
    for (let j = 0; j < key.length; j++) if (ws[i + j]!.stem !== key[j]) continue outer;
    out.push(i);
  }
  return out;
}

/** Deterministic choice: the same seed and slot always give the same variant. */
export function pick<T>(variants: readonly T[], seed: string, slot: string): T {
  if (variants.length === 0) throw new Error(`no variants for ${slot}`);
  const n = Number.parseInt(stableHash(seed, slot).slice(0, 8), 16);
  return variants[n % variants.length]!;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "a"/"an" + noun phrase, by the first letter (good enough for job titles). */
export function withArticle(phrase: string): string {
  return `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
}

/** Lower-case the first letter unless the first word looks like an acronym or proper name ("AWS", "iOS"). */
export function lowerFirst(s: string): string {
  const first = s.split(/\s/)[0] ?? '';
  if (first.length > 1 && (first === first.toUpperCase() || /[A-Z]/.test(first.slice(1)))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** End with a full stop unless the text already ends with terminal punctuation. */
export function asSentence(s: string): string {
  const t = s.trim().replace(/[;,:\s]+$/, '');
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** "a", "a and b", "a, b and c". */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Function words ignored when extracting or comparing terms. */
export const STOPWORDS = new Set(
  (
    'a an the and or but nor of to in on at by for with from as into onto over under about above below than then ' +
    'this that these those it its is are was were be been being am do does did doing done have has had having ' +
    'will would shall should can could may might must not no yes so if when while where who whom whose which what why how ' +
    'all any both each few more most other some such only own same too very just also etc via per eg ie ' +
    'i me my mine we us our ours you your yours he him his she her hers they them their theirs ' +
    'll re ve s t d m'
  ).split(' '),
);
