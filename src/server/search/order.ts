/**
 * Result ordering. 'date' and 'salary' sort on first-pass columns. 'relevance' sorts every
 * result by a cheap score (text relevance + recency), rescores the top RESCORE_CAP with the full
 * scorer, and keeps the rest in cheap order behind them — so nothing is dropped when the cap
 * binds; results past it are just ordered less precisely. Page items are scored again with
 * explanations by the caller (same score).
 */
import type { Salary } from '../../shared/types';
import { parseJson } from '../db';
import type { ScoringRow } from './engine';
import { type CandidateRow, type SearchPlan, USD_PER_UNIT } from './plan';
import { recency, type ScoreContext, type ScoreInput, scorePosting, textRelevance } from './rank';

export const RESCORE_CAP = 2000;

const newestFirst = (a: CandidateRow, b: CandidateRow): number => (a.ts === b.ts ? b.rid - a.rid : a.ts < b.ts ? 1 : -1);

export function bestRank(rows: readonly CandidateRow[]): number | null {
  let best: number | null = null;
  for (const r of rows) if (r.rank !== null && (best === null || r.rank < best)) best = r.rank;
  return best;
}

/**
 * Highest annual pay first: the search's currency, then other currencies compared in US dollars
 * (¥25M is not more than $445k), then currencies without a rate, then no salary.
 */
export function bySalary(rows: CandidateRow[], currency: string): CandidateRow[] {
  const keyed = rows.map((r) => {
    const amount = r.salary?.amount;
    const rate = r.salary?.currency ? USD_PER_UNIT[r.salary.currency] : undefined;
    if (amount == null) return { r, tier: 3, value: 0 };
    if (r.salary?.currency === currency) return { r, tier: 0, value: amount };
    return rate === undefined ? { r, tier: 2, value: amount } : { r, tier: 1, value: amount * rate };
  });
  keyed.sort((a, b) => a.tier - b.tier || b.value - a.value || newestFirst(a.r, b.r));
  return keyed.map((k) => k.r);
}

function salaryOf(r: Pick<ScoringRow, 'salary_currency' | 'salary_annual_min' | 'salary_annual_max'>): Salary | undefined {
  if (r.salary_annual_min === null && r.salary_annual_max === null) return undefined;
  const salary: Salary = { period: 'year' };
  if (r.salary_currency) salary.currency = r.salary_currency;
  if (r.salary_annual_min !== null) salary.min = salary.annualMin = r.salary_annual_min;
  if (r.salary_annual_max !== null) salary.max = salary.annualMax = r.salary_annual_max;
  return salary;
}

export function scoreInputFromRow(row: CandidateRow, s: ScoringRow): ScoreInput {
  return {
    title: s.title,
    titleCore: s.title_core,
    roleId: s.role_id ?? undefined,
    tags: parseJson<string[]>(s.tags, []),
    skills: parseJson<string[]>(s.skills, []),
    snippet: s.snippet,
    location: { places: parseJson(s.places, []), remote: row.remote, remoteScope: parseJson<string[]>(s.remote_scope, []) },
    seniority: row.seniority,
    salary: salaryOf(s),
    ts: row.ts,
    closed: row.closed,
    rank: row.rank,
  };
}

export interface Ordered {
  rows: CandidateRow[];
  /** Results ordered by the cheap score only (0 unless the cap bound). */
  beyondCap: number;
}

export function orderResults(
  reps: CandidateRow[],
  plan: SearchPlan,
  score: ScoreContext,
  loadScoring: (rids: number[]) => Map<number, ScoringRow>,
): Ordered {
  if (plan.opts.sort === 'date') return { rows: [...reps].sort(newestFirst), beyondCap: 0 };
  if (plan.opts.sort === 'salary') return { rows: bySalary(reps, plan.salaryCurrency), beyondCap: 0 };

  // Typed arrays and index sorting: this runs over every result (tens of thousands when browsing).
  const n = reps.length;
  const cheap = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = reps[i]!;
    const fresh = recency(r.ts, plan.now);
    cheap[i] = r.rank === null ? fresh : 0.75 * textRelevance(r.rank, score.bestRank) + 0.25 * fresh;
  }
  const order = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => cheap[b]! - cheap[a]! || newestFirst(reps[a]!, reps[b]!));
  const byCheap = Array.from(order, (i) => reps[i]!);
  const head = byCheap.slice(0, RESCORE_CAP);
  const scoring = loadScoring(head.map((r) => r.rid));
  const final = new Map<number, number>();
  for (const r of head) {
    const s = scoring.get(r.rid);
    if (s) final.set(r.rid, scorePosting(scoreInputFromRow(r, s), score, { explain: false }).score);
  }
  // Stable sort: equal scores keep their cheap-score order.
  head.sort((a, b) => (final.get(b.rid) ?? 0) - (final.get(a.rid) ?? 0));
  return { rows: [...head, ...byCheap.slice(RESCORE_CAP)], beyondCap: Math.max(0, byCheap.length - RESCORE_CAP) };
}
