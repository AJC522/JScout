/**
 * SQL execution for search plans: the fast count path and the first-pass candidate fetch.
 *
 * Both are written to stay on the covering index jobs_search (migration 2) instead of reading
 * table rows, whose large description_html column precedes posted_at/closed_at. The candidate
 * fetch returns arrays (not objects) and encodes low-cardinality columns as small integers:
 * on a 50,000-posting index that halves the cost of materialising every row in JS.
 */
import type { StatementSync } from 'node:sqlite';
import { EMPLOYMENT_TYPES, REMOTE_MODES, SENIORITY_ORDER } from '../../shared/constants';
import type { EmploymentType, RemoteMode, Seniority } from '../../shared/types';
import type { Db, SqlValue } from '../db';
import { BM25_ARGS } from './fts';
import type { CandidateRow, SearchPlan, SqlCond } from './plan';

function whereClause(conds: SqlCond[]): { sql: string; params: SqlValue[] } {
  if (conds.length === 0) return { sql: '', params: [] };
  return { sql: `WHERE ${conds.map((c) => c.sql).join(' AND ')}`, params: conds.flatMap((c) => c.params) };
}

/**
 * Text conditions. The positive match is left index-usable, so SQLite may drive a selective query
 * by its FTS hits (it does once it has statistics); exclusions are only ever probed.
 */
function textConds(plan: SearchPlan): SqlCond[] {
  const conds: SqlCond[] = [];
  if (plan.match) conds.push({ sql: 'j.rid IN (SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ?)', params: [plan.match] });
  conds.push(...filterConds(plan));
  return conds;
}

const excludeCond = (expr: string): SqlCond => ({ sql: '+j.rid NOT IN (SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ?)', params: [expr] });
const titleExactCond = (expr: string): SqlCond => ({ sql: '+j.rid IN (SELECT rowid FROM jobs_title WHERE jobs_title MATCH ?)', params: [expr] });

/** Text conditions that only narrow the positive match: the unstemmed title check and exclusions. */
function filterConds(plan: SearchPlan): SqlCond[] {
  return [...(plan.titleExact ? [titleExactCond(plan.titleExact)] : []), ...(plan.exclude ? [excludeCond(plan.exclude)] : [])];
}

/** De-duplicated result count (distinct clusters) with every filter applied, plus optional extra conditions. */
export function countClusters(db: Db, plan: SearchPlan, extra: SqlCond[] = []): number {
  const dims = Object.values(plan.dims).map((d) => d.cond);
  const where = whereClause([...textConds(plan), ...plan.base, ...dims, ...extra]);
  return db.get<{ n: number }>(`SELECT COUNT(DISTINCT j.cluster_key) AS n FROM jobs j ${where.sql}`, ...where.params)?.n ?? 0;
}

// --- candidate fetch -------------------------------------------------------------------

const SENIORITIES: Seniority[] = [...SENIORITY_ORDER, 'unknown'];

/** `CASE col WHEN 'a' THEN 0 … ELSE -1 END`; values come from constants, never from input. */
function enumCase(column: string, values: readonly string[]): string {
  return `CASE ${column} ${values.map((v, i) => `WHEN '${v}' THEN ${i}`).join(' ')} ELSE -1 END`;
}

const CANDIDATE_COLUMNS = [
  'j.rid',
  'j.cluster_key',
  enumCase('j.remote', REMOTE_MODES),
  enumCase('j.employment_type', EMPLOYMENT_TYPES),
  enumCase('j.seniority', SENIORITIES),
  'j.source',
  'j.company_key',
  'COALESCE(j.posted_at, j.first_seen_at)',
  // Must match the jobs_search index expression exactly for the index to cover it.
  "(j.closed_at IS NOT NULL) + 2 * (j.description_html != '')",
].join(', ');

const SALARY_COLUMNS = 'j.salary_currency, COALESCE(j.salary_annual_max, j.salary_annual_min)';

type CandidateTuple = [number, string, number, number, number, string, string, string, number, number | null, (string | null)?, (number | null)?];

const statements = new WeakMap<Db, Map<string, StatementSync>>();

/** Array-returning statements, cached per connection (the Db wrapper only returns objects). */
function arrayStatement(db: Db, sql: string): StatementSync {
  let cache = statements.get(db);
  if (!cache) statements.set(db, (cache = new Map()));
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.raw.prepare(sql);
    stmt.setReturnArrays(true);
    cache.set(sql, stmt);
  }
  return stmt;
}

function decode(t: CandidateTuple): CandidateRow {
  const row: CandidateRow = {
    rid: t[0],
    clusterKey: t[1],
    remote: (REMOTE_MODES[t[2]] ?? 'unknown') as RemoteMode,
    employmentType: (EMPLOYMENT_TYPES[t[3]] ?? 'unknown') as EmploymentType,
    seniority: SENIORITIES[t[4]] ?? 'unknown',
    source: t[5],
    companyKey: t[6],
    ts: t[7],
    closed: (t[8] & 1) === 1,
    hasDescription: (t[8] & 2) === 2,
    rank: t[9],
  };
  if (t.length > 10) row.salary = { currency: t[10] ?? null, amount: t[11] ?? null };
  return row;
}

/**
 * Every posting passing the base filters, with its bm25 rank when there is a text query.
 * Facet filters are NOT applied: the caller evaluates them in JS so each facet can be counted
 * with its own filter removed from the same rows.
 */
export function fetchCandidates(db: Db, plan: SearchPlan): CandidateRow[] {
  const where = whereClause([...plan.base, ...filterConds(plan)]);
  const salary = plan.opts.sort === 'salary' ? `, ${SALARY_COLUMNS}` : '';
  const tuples = plan.match
    ? arrayStatement(
        db,
        `SELECT ${CANDIDATE_COLUMNS}, m.rank${salary}
         FROM (SELECT rowid AS rid, bm25(jobs_fts, ${BM25_ARGS}) AS rank FROM jobs_fts WHERE jobs_fts MATCH ?) m
         JOIN jobs j ON j.rid = m.rid ${where.sql}`,
      ).all(plan.match, ...where.params)
    : arrayStatement(db, `SELECT ${CANDIDATE_COLUMNS}, NULL${salary} FROM jobs j ${where.sql}`).all(...where.params);
  return (tuples as unknown as CandidateTuple[]).map(decode);
}

// --- second pass ----------------------------------------------------------------------------

/** Columns the scorer needs beyond the first pass; all stored before description_html. */
export interface ScoringRow {
  rid: number;
  title: string;
  title_core: string;
  role_id: string | null;
  tags: string;
  skills: string;
  snippet: string;
  places: string;
  remote_scope: string;
  salary_currency: string | null;
  salary_annual_min: number | null;
  salary_annual_max: number | null;
}

export function fetchScoringRows(db: Db, rids: number[]): Map<number, ScoringRow> {
  const rows = db.all<ScoringRow>(
    `SELECT rid, title, title_core, role_id, tags, skills, snippet, places, remote_scope, salary_currency, salary_annual_min, salary_annual_max
     FROM jobs WHERE rid IN (SELECT value FROM json_each(?))`,
    JSON.stringify(rids),
  );
  return new Map(rows.map((r) => [r.rid, r]));
}
