/**
 * Result ordering. 'date' and 'salary' sort on first-pass columns. 'relevance' sorts every
 * result by a cheap score (text relevance + recency), rescores the top RESCORE_CAP with the full
 * scorer, and keeps the rest in cheap order behind them — so nothing is dropped when the cap
 * binds; results past it are just ordered less precisely. 'match' computes the profile match,
 * location fit and pay of every result (see profile-match.ts) and sorts by match tier, then
 * location, then pay; it falls back to 'relevance' when there is no profile to compare. Page
 * items are scored again with explanations by the caller (same score).
 */
import type { JobLocation, Salary } from '../../shared/types';
import { parseJson } from '../db';
import type { MatchRow, ScoringRow } from './engine';
import { type CandidateRow, type SearchPlan, USD_PER_UNIT } from './plan';
import { annualPay, compareFit, type LocationPrefs, locationFit, type MatchProfile, profileMatch } from './profile-match';
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

/** What "Best match" ordering compares a posting with. */
export interface FitContext {
  profile: MatchProfile;
  location: LocationPrefs;
  /** Currency pay is compared in. */
  currency: string;
}

/** Text relevance + recency, 0–1: the order before (or without) full scoring. */
function cheapScores(reps: readonly CandidateRow[], plan: SearchPlan, score: ScoreContext): Float64Array {
  const cheap = new Float64Array(reps.length);
  for (let i = 0; i < reps.length; i++) {
    const r = reps[i]!;
    const fresh = recency(r.ts, plan.now);
    cheap[i] = r.rank === null ? fresh : 0.75 * textRelevance(r.rank, score.bestRank) + 0.25 * fresh;
  }
  return cheap;
}

export function matchLocation(row: Pick<MatchRow, 'places' | 'remoteScope'>, remote: CandidateRow['remote']): JobLocation {
  const list = <T>(json: string): T[] => (json === '[]' ? [] : parseJson<T[]>(json, []));
  return { places: list(row.places), remote, remoteScope: list<string>(row.remoteScope) };
}

/** What "Best match" sorts a posting by. */
export interface FitKey {
  percent: number | null;
  locationRank: number;
  pay: number | undefined;
}

const MISSING: FitKey = { percent: null, locationRank: Number.MAX_SAFE_INTEGER, pay: undefined };

/** The sort key of one posting (labels are skipped: only the numbers matter here). */
export function fitKey(r: CandidateRow, m: MatchRow | undefined, fit: FitContext): FitKey {
  if (!m) return MISSING;
  const skills = m.skills === '[]' ? [] : parseJson<string[]>(m.skills, []);
  const match = profileMatch({ title: m.title, titleCore: m.titleCore, roleId: m.roleId ?? undefined, skills, seniority: r.seniority }, fit.profile, { explain: false });
  const location = locationFit(matchLocation(m, r.remote), fit.location, { explain: false });
  const salary = { currency: m.salaryCurrency ?? undefined, annualMin: m.salaryAnnualMin ?? undefined, annualMax: m.salaryAnnualMax ?? undefined };
  return { percent: match.percent, locationRank: location.rank, pay: annualPay(salary, fit.currency) };
}

/**
 * Every result by match tier, then location fit, then pay, then exact match; ties keep the cheap
 * relevance order. Closed postings (only present when asked for) go last.
 */
function byMatch(reps: CandidateRow[], cheap: Float64Array, keys: FitKey[]): CandidateRow[] {
  const n = reps.length;
  const order = Uint32Array.from({ length: n }, (_, i) => i).sort(
    (a, b) =>
      Number(reps[a]!.closed) - Number(reps[b]!.closed) ||
      compareFit(keys[a]!, keys[b]!) ||
      cheap[b]! - cheap[a]! ||
      newestFirst(reps[a]!, reps[b]!),
  );
  return Array.from(order, (i) => reps[i]!);
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
  /** For 'match': the sort key of each result, in order (see fitKey). */
  fitKeys?: (reps: CandidateRow[]) => FitKey[],
): Ordered {
  if (plan.opts.sort === 'date') return { rows: [...reps].sort(newestFirst), beyondCap: 0 };
  if (plan.opts.sort === 'salary') return { rows: bySalary(reps, plan.salaryCurrency), beyondCap: 0 };

  // Typed arrays and index sorting: this runs over every result (tens of thousands when browsing).
  const n = reps.length;
  const cheap = cheapScores(reps, plan, score);
  if (plan.opts.sort === 'match' && fitKeys) return { rows: byMatch(reps, cheap, fitKeys(reps)), beyondCap: 0 };
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
