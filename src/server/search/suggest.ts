/** Autocomplete for the search boxes, with live counts from the local index. */
import type { TitleSuggestion } from '../../shared/types';
import type { Db, SqlValue } from '../db';
import { suggestTitles as libSuggestTitles } from '../lib/titles';
import { normalizeText } from '../lib/text';

export function titleSuggestions(db: Db, q: string, limit: number): TitleSuggestion[] {
  const titles = libSuggestTitles(q, limit);
  if (titles.length === 0) return [];
  const counts = new Map(
    db
      .all<{ role_id: string; n: number }>(
        `SELECT role_id, COUNT(DISTINCT cluster_key) AS n FROM jobs
         WHERE role_id IN (SELECT value FROM json_each(?)) AND +closed_at IS NULL GROUP BY role_id`,
        JSON.stringify([...new Set(titles.map((t) => t.roleId))]),
      )
      .map((r) => [r.role_id, r.n]),
  );
  return titles.map((t) => ({ title: t.title, roleId: t.roleId, family: t.family, count: counts.get(t.roleId) ?? 0 }));
}

/** LIKE pattern for a literal prefix. */
const likePrefix = (s: string): string => `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Companies with open postings whose name (or a word of it) starts with q, most postings first.
 * Prefix matches on the normalised key use the company index; word matches cost a scan and
 * only run when prefixes do not fill the list. (`+closed_at` keeps the planner on the
 * role/company indexes rather than scanning every open posting.)
 */
export function companySuggestions(db: Db, q: string, limit: number): Array<{ name: string; count: number }> {
  const key = normalizeText(q);
  if (!key) return [];
  const run = (cond: string, params: SqlValue[], n: number, skip: string[]) =>
    db.all<{ company_key: string; name: string; n: number }>(
      `SELECT company_key, MAX(company) AS name, COUNT(DISTINCT cluster_key) AS n FROM jobs
       WHERE ${cond} AND +closed_at IS NULL AND company_key NOT IN (SELECT value FROM json_each(?))
       GROUP BY company_key ORDER BY n DESC, company_key LIMIT ?`,
      ...params,
      JSON.stringify(skip),
      n,
    );
  // [key, key + U+10FFFF) is the index range of keys starting with `key` (binary collation).
  const prefix = run('company_key >= ? AND company_key < ?', [key, `${key}\u{10FFFF}`], limit, []);
  const rows =
    prefix.length >= limit
      ? prefix
      : [...prefix, ...run(`company_key LIKE ? ESCAPE '\\'`, [`% ${likePrefix(key)}`], limit - prefix.length, prefix.map((r) => r.company_key))];
  return rows.map((r) => ({ name: r.name, count: r.n }));
}
