import { createHash } from 'node:crypto';

/** Lower-case and strip diacritics, keeping punctuation ("São Paulo" -> "sao paulo"). */
export function foldText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[łŁ]/g, 'l')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

/**
 * Canonical form for comparing free text: folded, with every run of characters
 * other than letters, digits, '+' and '#' collapsed to a single space.
 * "Sr. Software Engineer (C++/C#)" -> "sr software engineer c++ c#"
 */
export function normalizeText(s: string): string {
  return foldText(s)
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(' ') : [];
}

const COMPANY_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company',
  'gmbh', 'ag', 'se', 'sa', 'sas', 'sarl', 'srl', 'spa', 'bv', 'nv', 'ab', 'as', 'asa', 'oy', 'oyj', 'aps',
  'plc', 'pty', 'pte', 'kk', 'kg', 'ug', 'sl', 'sro', 'zoo', 'holdings', 'holding', 'group', 'the',
]);

/**
 * Key for matching the same employer across sources:
 * "Stripe, Inc." / "stripe" / "Stripe Inc" -> "stripe".
 * Legal suffixes are dropped only from the end (and a leading "the"), never so
 * far that the key would be empty.
 */
export function companyKey(name: string): string {
  const tokens = tokenize(name.replace(/&/g, ' and '));
  while (tokens.length > 1 && tokens[0] === 'the') tokens.shift();
  while (tokens.length > 1 && COMPANY_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(' ');
}

/** Short stable hex digest of the parts (joined with a separator that cannot occur in them). */
export function stableHash(...parts: Array<string | number | undefined>): string {
  const h = createHash('sha1');
  for (const p of parts) {
    h.update(String(p ?? ''));
    h.update('\u0000');
  }
  return h.digest('hex').slice(0, 20);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Cut at a word boundary and add an ellipsis when the text is longer than `max`. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** De-duplicate case-insensitively (after folding), keeping first occurrences and their casing. */
export function uniqueFolded(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t) continue;
    const k = foldText(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
