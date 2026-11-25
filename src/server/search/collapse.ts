/**
 * De-duplication and disjunctive facets over first-pass rows.
 *
 * Rows are postings that passed the base filters; facet filters are evaluated here so every
 * facet can be counted with its own filter removed (what selecting another value would give)
 * from the same rows, without one SQL query per facet.
 */
import {
  EMPLOYMENT_LABELS,
  EMPLOYMENT_TYPES,
  POSTED_WITHIN_OPTIONS,
  REMOTE_LABELS,
  REMOTE_MODES,
  SENIORITY_LABELS,
  SENIORITY_ORDER,
} from '../../shared/constants';
import type { FacetCount, SearchFacets, SearchQuery } from '../../shared/types';
import { isAtsSource, sourceName } from '../ingest/store-rows';
import { companyKey } from '../lib/text';
import { type CandidateRow, FACET_DIMS, type FacetDim, type SearchPlan } from './plan';

/** Better cluster representative: open > closed, employer ATS > aggregator, has description, newest. */
export function isBetterRepresentative(a: CandidateRow, b: CandidateRow): boolean {
  if (a.closed !== b.closed) return !a.closed;
  const atsA = isAtsSource(a.source);
  if (atsA !== isAtsSource(b.source)) return atsA;
  if (a.hasDescription !== b.hasDescription) return a.hasDescription;
  if (a.ts !== b.ts) return a.ts > b.ts;
  return a.rid < b.rid;
}

export interface Collapsed {
  /** One representative per cluster that passes every filter. */
  reps: CandidateRow[];
  facets: SearchFacets;
}

type ValueDim = Exclude<FacetDim, 'postedWithin'>;
const VALUE_DIMS: readonly ValueDim[] = ['remote', 'employmentType', 'seniority', 'source', 'company'];
const valueOf: Record<ValueDim, (r: CandidateRow) => string> = {
  remote: (r) => r.remote,
  employmentType: (r) => r.employmentType,
  seniority: (r) => r.seniority,
  source: (r) => r.source,
  company: (r) => r.companyKey,
};
const bit = (dim: FacetDim): number => 1 << FACET_DIMS.indexOf(dim);

const COMPANY_FACET_SIZE = 15;
const DAY_MS = 86_400_000;

function bump(map: Map<string, number>, key: string, by: number): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** Which facet filters a row fails, one bit per dimension (0 = passes them all). */
function maskFn(plan: SearchPlan): (row: CandidateRow) => number {
  const active = FACET_DIMS.flatMap((dim) => {
    const filter = plan.dims[dim];
    return filter ? [{ bit: bit(dim), test: filter.test }] : [];
  });
  if (active.length === 0) return () => 0;
  return (row) => {
    let mask = 0;
    for (const a of active) if (!a.test(row)) mask |= a.bit;
    return mask;
  };
}

interface ClusterEntry {
  rep: CandidateRow;
  /** Newest COALESCE(posted_at, first_seen_at) among the cluster's passing rows. */
  newest: string;
}

function addRow(clusters: Map<string, ClusterEntry>, row: CandidateRow): void {
  const entry = clusters.get(row.clusterKey);
  if (!entry) clusters.set(row.clusterKey, { rep: row, newest: row.ts });
  else {
    if (isBetterRepresentative(row, entry.rep)) entry.rep = row;
    if (row.ts > entry.newest) entry.newest = row.ts;
  }
}

export interface FacetLabels {
  /** Display names for company keys (the most common spelling in the index). */
  companyNames(keys: string[]): Map<string, string>;
}

/**
 * Collapse rows to cluster representatives and count facets. Each cluster counts once per
 * facet, under its representative's value, so a facet's counts add up to the number of
 * results it would show without its own filter. (A cluster whose copies disagree — one
 * source says hybrid, another remote — is counted under the value it is shown with when it
 * passes the filter, else under its best other copy's value.)
 */
export function collapse(rows: CandidateRow[], plan: SearchPlan, labels: FacetLabels): Collapsed {
  const failMask = maskFn(plan);
  const main = new Map<string, ClusterEntry>();
  const onlyFailing = new Map<number, CandidateRow[]>();
  for (const row of rows) {
    const mask = failMask(row);
    if (mask === 0) addRow(main, row);
    else if ((mask & (mask - 1)) === 0) {
      // Fails exactly one facet filter: it counts toward that facet only.
      const list = onlyFailing.get(mask);
      if (list) list.push(row);
      else onlyFailing.set(mask, [row]);
    }
  }

  const mainCounts: Record<ValueDim, Map<string, number>> = {
    remote: new Map(), employmentType: new Map(), seniority: new Map(), source: new Map(), company: new Map(),
  };
  for (const { rep } of main.values()) {
    bump(mainCounts.remote, rep.remote, 1);
    bump(mainCounts.employmentType, rep.employmentType, 1);
    bump(mainCounts.seniority, rep.seniority, 1);
    bump(mainCounts.source, rep.source, 1);
    bump(mainCounts.company, rep.companyKey, 1);
  }

  const counts = {} as Record<ValueDim, Map<string, number>>;
  for (const d of VALUE_DIMS) {
    const extra = onlyFailing.get(bit(d));
    if (!extra) {
      counts[d] = mainCounts[d];
      continue;
    }
    // Only clusters not already shown are added. A shown cluster stays under its shown value, or a
    // selected source would read 0 while its (cross-posted) jobs are on screen.
    const over = new Map<string, CandidateRow>();
    for (const row of extra) {
      if (main.has(row.clusterKey)) continue;
      const current = over.get(row.clusterKey);
      if (!current || isBetterRepresentative(row, current)) over.set(row.clusterKey, row);
    }
    const adjusted = new Map(mainCounts[d]);
    for (const row of over.values()) bump(adjusted, valueOf[d](row), 1);
    counts[d] = adjusted;
  }

  // Newest posting date per cluster, counting rows that fail only the date filter too.
  const olderOnly = new Map<string, string>();
  for (const row of onlyFailing.get(bit('postedWithin')) ?? []) {
    const ts = olderOnly.get(row.clusterKey);
    if (ts === undefined || row.ts > ts) olderOnly.set(row.clusterKey, row.ts);
  }
  const newest: string[] = [];
  for (const [cluster, entry] of main) {
    const other = olderOnly.get(cluster);
    newest.push(other !== undefined && other > entry.newest ? other : entry.newest);
    olderOnly.delete(cluster);
  }
  newest.push(...olderOnly.values());

  return {
    reps: [...main.values()].map((e) => e.rep),
    facets: buildFacets(plan, counts, newest, labels),
  };
}

function ordered(counts: Map<string, number>, order: readonly string[], selected: readonly string[], label: (v: string) => string): FacetCount[] {
  const values = [...order, ...[...counts.keys()].filter((v) => !order.includes(v))];
  return values
    .filter((v) => (counts.get(v) ?? 0) > 0 || selected.includes(v))
    .map((v) => ({ value: v, label: label(v), count: counts.get(v) ?? 0 }));
}

function byCount(counts: Map<string, number>, selected: readonly string[], label: (v: string) => string, limit = Infinity): FacetCount[] {
  const top = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([v]) => v);
  for (const v of selected) if (!top.includes(v)) top.push(v);
  return top.map((v) => ({ value: v, label: label(v), count: counts.get(v) ?? 0 }));
}

function buildFacets(plan: SearchPlan, counts: Record<ValueDim, Map<string, number>>, newest: string[], labels: FacetLabels): SearchFacets {
  const q: SearchQuery = plan.query;
  const selectedCompanies = new Map((q.companies ?? []).map((name) => [companyKey(name), name]));
  const companyFacet = byCount(counts.company, [...selectedCompanies.keys()], (k) => k, COMPANY_FACET_SIZE);
  const names = labels.companyNames(companyFacet.map((f) => f.value));
  const now = plan.now.getTime();
  const cutoffs = POSTED_WITHIN_OPTIONS.map(({ days }) => new Date(now - days * DAY_MS).toISOString());
  const withinCounts = cutoffs.map(() => 0);
  for (const ts of newest) {
    for (let i = 0; i < cutoffs.length; i++) if (ts >= cutoffs[i]!) withinCounts[i]!++;
  }
  return {
    remote: ordered(counts.remote, REMOTE_MODES, q.remote ?? [], (v) => REMOTE_LABELS[v as keyof typeof REMOTE_LABELS] ?? v),
    employmentType: ordered(counts.employmentType, EMPLOYMENT_TYPES, q.employmentTypes ?? [], (v) => EMPLOYMENT_LABELS[v as keyof typeof EMPLOYMENT_LABELS] ?? v),
    seniority: ordered(counts.seniority, [...SENIORITY_ORDER, 'unknown'], q.seniority ?? [], (v) => SENIORITY_LABELS[v as keyof typeof SENIORITY_LABELS] ?? v),
    source: byCount(counts.source, q.sources ?? [], sourceName),
    // Company values are display names, as SearchQuery.companies expects.
    company: companyFacet.map((f) => {
      const name = selectedCompanies.get(f.value) ?? names.get(f.value) ?? f.value;
      return { value: name, label: name, count: f.count };
    }),
    postedWithin: POSTED_WITHIN_OPTIONS.map(({ days, label }, i) => ({ value: String(days), label, count: withinCounts[i] ?? 0 })),
  };
}

/** Distinct clusters among rows that pass the plan's facet filters (counting a patched query from the same rows). */
export function countPassing(rows: CandidateRow[], plan: SearchPlan): number {
  const failMask = maskFn(plan);
  const clusters = new Set<string>();
  for (const row of rows) if (failMask(row) === 0) clusters.add(row.clusterKey);
  return clusters.size;
}
