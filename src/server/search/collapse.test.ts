import { describe, expect, it } from 'vitest';
import { collapse, countPassing, isBetterRepresentative } from './collapse';
import { bySalary } from './order';
import { buildPlan, type CandidateRow } from './plan';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const env = { now: NOW, maxPostingAgeDays: 0, defaultCurrency: 'USD' };
let rid = 0;
const row = (o: Partial<CandidateRow> & { clusterKey: string }): CandidateRow => ({
  rid: ++rid, remote: 'onsite', employmentType: 'full-time', seniority: 'mid', source: 'greenhouse', companyKey: 'acme',
  ts: '2026-11-23T00:00:00.000Z', closed: false, hasDescription: true, rank: null, ...o,
});
const labels = { companyNames: (keys: string[]) => new Map(keys.map((k) => [k, k.toUpperCase()])) };

describe('isBetterRepresentative', () => {
  it('prefers open, then employer ATS, then a description, then the newest', () => {
    const base = row({ clusterKey: 'c' });
    expect(isBetterRepresentative(base, { ...base, closed: true })).toBe(true);
    expect(isBetterRepresentative(base, { ...base, source: 'remotive' })).toBe(true);
    expect(isBetterRepresentative({ ...base, source: 'remotive' }, { ...base, closed: true })).toBe(true);
    expect(isBetterRepresentative(base, { ...base, hasDescription: false })).toBe(true);
    expect(isBetterRepresentative(base, { ...base, ts: '2026-01-01T00:00:00.000Z' })).toBe(true);
  });
});

const sum = (facet: Array<{ count: number }>): number => facet.reduce((n, f) => n + f.count, 0);

describe('collapse', () => {
  const rows = [
    row({ clusterKey: 'a', source: 'remotive', remote: 'remote' }),
    row({ clusterKey: 'a', source: 'lever', remote: 'remote' }),
    row({ clusterKey: 'b', remote: 'hybrid', companyKey: 'globex', ts: '2026-11-10T00:00:00.000Z' }),
    row({ clusterKey: 'c', remote: 'onsite', seniority: 'senior' }),
  ];

  it('keeps one representative per cluster and counts each facet to the total', () => {
    const { reps, facets } = collapse(rows, buildPlan({ q: '' }, env), labels);
    expect(reps.map((r) => r.clusterKey).sort()).toEqual(['a', 'b', 'c']);
    expect(reps.find((r) => r.clusterKey === 'a')!.source).toBe('lever');
    expect(facets.remote).toEqual([
      { value: 'remote', label: 'Remote', count: 1 },
      { value: 'hybrid', label: 'Hybrid', count: 1 },
      { value: 'onsite', label: 'On-site', count: 1 },
    ]);
    expect(facets.source).toEqual([{ value: 'greenhouse', label: 'Greenhouse', count: 2 }, { value: 'lever', label: 'Lever', count: 1 }]);
    expect(facets.company).toEqual([{ value: 'ACME', label: 'ACME', count: 2 }, { value: 'GLOBEX', label: 'GLOBEX', count: 1 }]);
    expect(facets.postedWithin.map((f) => f.count)).toEqual([0, 2, 2, 2, 3]);
  });

  it('counts a filtered facet without its own filter, and other facets with it', () => {
    const plan = buildPlan({ q: '', remote: ['remote'], postedWithinDays: 7 }, env);
    const { reps, facets } = collapse(rows, plan, labels);
    expect(reps.map((r) => r.clusterKey)).toEqual(['a']);
    // Selecting "onsite" instead would give c; b (hybrid) is older than the 7-day filter.
    expect(facets.remote.map((f) => [f.value, f.count])).toEqual([['remote', 1], ['onsite', 1]]);
    expect(facets.seniority.map((f) => [f.value, f.count])).toEqual([['mid', 1]]);
    // The date facet ignores the date filter but keeps the remote one (so b, hybrid, never counts).
    expect(facets.postedWithin.map((f) => f.count)).toEqual([0, 1, 1, 1, 1]);
    expect(countPassing(rows, plan)).toBe(1);
  });

  it('counts a cross-posted job under the selected source it is shown from', () => {
    const plan = buildPlan({ q: '', sources: ['remotive'] }, env);
    const { reps, facets } = collapse(rows, plan, labels);
    expect(reps.map((r) => [r.clusterKey, r.source])).toEqual([['a', 'remotive']]);
    expect(facets.source.find((f) => f.value === 'remotive')?.count).toBe(1);
    // Clusters not shown are counted under their other copies.
    expect(facets.source.find((f) => f.value === 'greenhouse')?.count).toBe(2);
    expect(sum(facets.source)).toBe(3);
  });

  it('lists selected values even when nothing matches them', () => {
    const { facets } = collapse(rows, buildPlan({ q: '', employmentTypes: ['internship'], companies: ['Initech'] }, env), labels);
    expect(facets.employmentType).toContainEqual({ value: 'internship', label: 'Internship', count: 0 });
    expect(facets.company).toContainEqual({ value: 'Initech', label: 'Initech', count: 0 });
  });
});

describe('bySalary', () => {
  it('orders the search currency first, then other currencies (converted), then no salary', () => {
    const r = (amount: number | null, currency: string | null) => row({ clusterKey: `${amount}${currency}`, salary: { amount, currency } });
    const sorted = bySalary([r(null, null), r(9_000_000, 'JPY'), r(120_000, 'USD'), r(150_000, 'USD'), r(80_000, 'EUR')], 'USD');
    // ¥9M is about $60k, €80k about $88k.
    expect(sorted.map((x) => x.salary)).toEqual([
      { amount: 150_000, currency: 'USD' }, { amount: 120_000, currency: 'USD' },
      { amount: 80_000, currency: 'EUR' }, { amount: 9_000_000, currency: 'JPY' }, { amount: null, currency: null },
    ]);
  });
});
