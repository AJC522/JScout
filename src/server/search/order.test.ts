import { describe, expect, it } from 'vitest';
import { bySalary } from './order';
import type { CandidateRow } from './plan';

const row = (rid: number, currency: string | null, amount: number | null): CandidateRow => ({
  rid,
  clusterKey: `c${rid}`,
  remote: 'remote',
  employmentType: 'full-time',
  seniority: 'unknown',
  source: 's',
  companyKey: 'k',
  ts: '2026-01-01T00:00:00.000Z',
  closed: false,
  hasDescription: true,
  rank: null,
  salary: { currency, amount },
});

describe('bySalary', () => {
  it('puts the search currency first, then compares other currencies in one unit, then unknown rates, then none', () => {
    const rows = [
      row(1, 'PHP', 600_000), // ~ $10k
      row(2, 'USD', 445_000),
      row(3, 'JPY', 25_800_000), // ~ $173k
      row(4, 'EUR', 90_000),
      row(5, 'XYZ', 9_000_000),
      row(6, null, null),
      row(7, 'EUR', 120_000),
    ];
    expect(bySalary(rows, 'EUR').map((r) => r.rid)).toEqual([7, 4, 2, 3, 1, 5, 6]);
  });
});
