import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCompactNumber,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatSalary,
  formatYearMonth,
  initials,
  pluralize,
  pluralWord,
} from './format';

const NOW = new Date('2026-11-24T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

describe('formatRelativeTime', () => {
  it('uses compact past spans, floored', () => {
    expect(formatRelativeTime(ago(10_000), NOW)).toBe('just now');
    expect(formatRelativeTime(ago(50_000), NOW)).toBe('1m ago');
    expect(formatRelativeTime(ago(5 * MIN), NOW)).toBe('5m ago');
    expect(formatRelativeTime(ago(3 * 60 * MIN + 59 * MIN), NOW)).toBe('3h ago');
    expect(formatRelativeTime(ago(3 * DAY), NOW)).toBe('3d ago');
    expect(formatRelativeTime(ago(13 * DAY), NOW)).toBe('1w ago');
    expect(formatRelativeTime(ago(65 * DAY), NOW)).toBe('2mo ago');
    expect(formatRelativeTime(ago(400 * DAY), NOW)).toBe('1y ago');
  });

  it('handles future times, Date inputs and bad values', () => {
    expect(formatRelativeTime(new Date(NOW + 2 * DAY), NOW)).toBe('in 2d');
    expect(formatRelativeTime(new Date(NOW - 2 * DAY), new Date(NOW))).toBe('2d ago');
    expect(formatRelativeTime(undefined, NOW)).toBe('');
    expect(formatRelativeTime('', NOW)).toBe('');
    expect(formatRelativeTime('not a date', NOW)).toBe('');
  });
});

describe('formatDate / formatYearMonth', () => {
  it('formats in the requested style and locale', () => {
    expect(formatDate('2026-11-24T15:00:00Z', 'medium', { locale: 'en-US', timeZone: 'UTC' })).toBe('Nov 24, 2026');
    expect(formatDate('2026-11-24T15:00:00Z', 'short', { locale: 'en-US', timeZone: 'UTC' })).toBe('Nov 24');
    expect(formatDate('2026-11-24T15:00:00Z', 'long', { locale: 'en-US', timeZone: 'UTC' })).toBe('November 24, 2026');
  });

  it('reads a bare calendar day as that local day', () => {
    expect(formatDate('2026-01-05', 'medium', { locale: 'en-US' })).toBe('Jan 5, 2026');
  });

  it('returns "" for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('garbage')).toBe('');
  });

  it('formats profile year-month values', () => {
    expect(formatYearMonth('2021-03', { locale: 'en-US' })).toBe('Mar 2021');
    expect(formatYearMonth('2021')).toBe('2021');
    expect(formatYearMonth('Present')).toBe('Present');
    expect(formatYearMonth(undefined)).toBe('');
  });
});

describe('numbers', () => {
  it('adds thousands separators', () => {
    expect(formatNumber(12430, { locale: 'en-US' })).toBe('12,430');
    expect(formatNumber(0, { locale: 'en-US' })).toBe('0');
    expect(formatNumber(Number.NaN)).toBe('');
    expect(formatNumber(undefined)).toBe('');
  });

  it('compacts counts for badges', () => {
    expect(formatCompactNumber(950)).toBe('950');
    expect(formatCompactNumber(1240)).toBe('1.2k');
    expect(formatCompactNumber(1000)).toBe('1k');
    expect(formatCompactNumber(12430)).toBe('12k');
    expect(formatCompactNumber(1_250_000)).toBe('1.3M');
  });

  it('formats ratios and sizes', () => {
    expect(formatPercent(0.4167)).toBe('42%');
    expect(formatPercent(null)).toBe('–');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(8 * 1024 * 1024)).toBe('8 MB');
    expect(formatBytes(-1)).toBe('');
  });
});

describe('formatSalary', () => {
  it('formats ranges with the period suffix', () => {
    expect(formatSalary({ min: 120000, max: 150000, currency: 'USD', period: 'year' })).toBe('$120k–$150k/yr');
    expect(formatSalary({ min: 150000, max: 120000, currency: 'USD', period: 'year' })).toBe('$120k–$150k/yr');
    expect(formatSalary({ min: 95000, max: 95000, currency: 'EUR', period: 'year' })).toBe('€95k/yr');
  });

  it('handles open-ended and hourly amounts', () => {
    expect(formatSalary({ min: 60000, currency: 'EUR', period: 'year' })).toBe('From €60k/yr');
    expect(formatSalary({ max: 45.5, currency: 'GBP', period: 'hour' })).toBe('Up to £45.50/hr');
    expect(formatSalary({ min: 1_250_000, currency: 'JPY', period: 'year' })).toBe('From ¥1.25M/yr');
  });

  it('keeps currency codes apart from the number and does not repeat them', () => {
    expect(formatSalary({ min: 120000, max: 150000, currency: 'CHF', period: 'year' })).toBe('CHF 120k–150k/yr');
    expect(formatSalary({ min: 90000, max: 110000, currency: 'CAD', period: 'year' })).toBe('CA$90k–CA$110k/yr');
  });

  it('can show the annualised equivalent', () => {
    expect(formatSalary({ min: 50, max: 60, currency: 'USD', period: 'hour', annualMin: 104000, annualMax: 124800 }, { annualized: true })).toBe(
      '$104k–$124.8k/yr',
    );
  });

  it('falls back to the source text, then to ""', () => {
    expect(formatSalary({ text: ' Competitive ' })).toBe('Competitive');
    expect(formatSalary({ min: 0, max: Number.NaN })).toBe('');
    expect(formatSalary(undefined)).toBe('');
    expect(formatSalary({ min: 70000, currency: 'not-a-code', period: 'year' })).toBe('From NOT-A-CODE 70k/yr');
  });
});

describe('words', () => {
  it('pluralises', () => {
    expect(pluralize(1, 'job')).toBe('1 job');
    expect(pluralize(0, 'job')).toBe('0 jobs');
    expect(pluralize(12430, 'job')).toMatch(/^12.430 jobs$/);
    expect(pluralize(2, 'match', 'matches')).toBe('2 matches');
    expect(pluralWord(1, 'match', 'matches')).toBe('match');
  });

  it('builds initials', () => {
    expect(initials('Acme Rockets Inc')).toBe('AR');
    expect(initials('stripe')).toBe('S');
    expect(initials('  ')).toBe('');
    expect(initials('Émile Zola')).toBe('ÉZ');
  });
});
