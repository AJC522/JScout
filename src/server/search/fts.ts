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
 * for the unstemmed title index, where plurals are not folded together by a stemmer.
 */
export function ftsPrefixString(text: string): string {
  const last = text.trim().split(/[^\p{L}\p{N}+#]+/u).filter(Boolean).at(-1) ?? '';
  return last.length >= MIN_PREFIX_LENGTH && /^[\p{L}\p{N}]+$/u.test(last) ? `${ftsString(text)}*` : ftsString(text);
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
