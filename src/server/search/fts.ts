/**
 * Builders for FTS5 MATCH expressions. Every piece of user text enters an expression only
 * through ftsString(), as a double-quoted FTS5 string, so input can never introduce
 * operators, column filters or syntax errors. Column names come from this module only.
 */

/** jobs_fts columns, in schema order (bm25 weights follow the same order). */
export type FtsColumn = 'title' | 'company' | 'location' | 'tags' | 'body';

/**
 * bm25 column weights: title > tags/skills > company > body > location.
 * Tuned on the fixture index: titles must dominate so "python" ranks "Python Developer" above
 * a posting that mentions Python ten times in its body, while body text still separates
 * otherwise equal titles.
 */
export const BM25_WEIGHTS: Record<FtsColumn, number> = { title: 12, company: 3, location: 0.5, tags: 5, body: 1 };
export const BM25_ARGS = `${BM25_WEIGHTS.title}, ${BM25_WEIGHTS.company}, ${BM25_WEIGHTS.location}, ${BM25_WEIGHTS.tags}, ${BM25_WEIGHTS.body}`;

/** A quoted FTS5 string (a phrase of the tokens in `text`). */
export function ftsString(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

/** Shortest last word that also matches its longer forms; shorter ones are acronyms ("RN", "SWE") that must match as typed. */
const MIN_PREFIX_LENGTH = 4;

/**
 * ftsString() whose last word also matches longer words starting with it ("teacher" -> "teachers"),
 * for the unstemmed title index, where plurals are not folded together by a stemmer. A plural last
 * word is searched in its singular too ("nurses" -> "nurse"*), or a typed plural finds nothing.
 */
export function ftsPrefixString(text: string): string {
  const tokens = text.trim().split(/[^\p{L}\p{N}+#]+/u).filter(Boolean);
  const last = tokens.at(-1) ?? '';
  if (last.length < MIN_PREFIX_LENGTH || !/^[\p{L}\p{N}]+$/u.test(last)) return ftsString(text);
  const forms = numberForms(last.toLowerCase()).filter((f) => f.length >= MIN_PREFIX_LENGTH);
  // A form that starts with another one is already found by that prefix ("nurse"* finds "nurses").
  const prefixes = forms.filter((f) => !forms.some((g) => g !== f && f.startsWith(g)));
  return ftsOr(prefixes.map((f) => `${ftsString([...tokens.slice(0, -1), f].join(' '))}*`))!;
}

/** The singular of a plural word ("engineers" -> "engineer", "technologies" -> "technology"); other words as they are. */
export function singularWord(word: string): string {
  return numberForms(word).find((f) => f.length < word.length) ?? word;
}

/**
 * The word as typed plus its plural or singular ("intern" -> intern, interns; "nurses" -> nurses,
 * nurse), for unstemmed indexes, which do not fold them together. Only plain words of 3+ letters.
 */
export function numberForms(word: string): string[] {
  if (!/^\p{L}{3,}$/u.test(word)) return [word];
  const forms = [word];
  if (/[^aeiou]y$/.test(word)) forms.push(`${word.slice(0, -1)}ies`);
  else if (/(?:ss|x|z|ch|sh)$/.test(word)) forms.push(`${word}es`);
  else if (!word.endsWith('s')) forms.push(`${word}s`);
  if (word.length > 4 && word.endsWith('ies')) forms.push(`${word.slice(0, -3)}y`);
  else if (/(?:ss|x|z|ch|sh)es$/.test(word)) forms.push(word.slice(0, -2));
  else if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) forms.push(word.slice(0, -1));
  return [...new Set(forms)];
}

/** ftsString() of `tokens` as a phrase, in every number form of its last word. */
export function ftsPhraseForms(tokens: readonly string[]): string | undefined {
  const last = tokens.at(-1);
  if (last === undefined) return undefined;
  return ftsOr(numberForms(last).map((f) => ftsString([...tokens.slice(0, -1), f].join(' '))));
}

/**
 * For indexes with detail=none (jobs_words), which have no phrases: every token as its own string,
 * ANDed, the last in each number form. `tokens` must be single index tokens (tokenize() output).
 */
export function ftsWordsAll(tokens: readonly string[]): string | undefined {
  return ftsAnd(tokens.map((t, i) => (i === tokens.length - 1 ? ftsOr(numberForms(t).map(ftsString)) : ftsString(t))));
}

const group = (parts: string[], op: 'AND' | 'OR'): string | undefined => {
  const kept = parts.filter(Boolean);
  if (kept.length === 0) return undefined;
  return kept.length === 1 ? kept[0] : `(${kept.join(` ${op} `)})`;
};

export const ftsAnd = (parts: Array<string | undefined>): string | undefined =>
  group(parts.filter((p): p is string => p !== undefined), 'AND');
export const ftsOr = (parts: Array<string | undefined>): string | undefined =>
  group(parts.filter((p): p is string => p !== undefined), 'OR');

/** Restrict an expression to some columns; no columns = every column. */
export function ftsScope(columns: readonly FtsColumn[], expr: string): string {
  if (columns.length === 0) return expr;
  const spec = columns.length === 1 ? columns[0] : `{${columns.join(' ')}}`;
  return `${spec} : (${expr})`;
}
