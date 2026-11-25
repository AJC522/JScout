import { describe, expect, it } from 'vitest';
import { manualSnapshot, mergeSnapshot, salaryDisplay } from './snapshot';

describe('salaryDisplay', () => {
  it('formats ranges, open ends, periods and currencies', () => {
    expect(salaryDisplay({ min: 120_000, max: 150_000, currency: 'USD', period: 'year' })).toBe('$120K–$150K/yr');
    expect(salaryDisplay({ min: 50_000, currency: 'EUR', period: 'year' })).toBe('From €50K/yr');
    expect(salaryDisplay({ max: 45.5, currency: 'GBP', period: 'hour' })).toBe('Up to £45.5/hr');
    expect(salaryDisplay({ min: 6000, max: 6000, period: 'month' })).toBe('6K/mo');
    expect(salaryDisplay({ min: 100_000, currency: 'not-a-code' })).toBe('From 100K not-a-code');
  });

  it('falls back to the source text and ignores unusable numbers', () => {
    expect(salaryDisplay({ min: Number.NaN, text: '  Competitive\n salary ' })).toBe('Competitive salary');
    expect(salaryDisplay({ min: 0 })).toBeUndefined();
    expect(salaryDisplay(undefined)).toBeUndefined();
  });
});

describe('snapshot edits', () => {
  it('fills manual defaults and normalises edits', () => {
    const snap = manualSnapshot({ title: 'Designer', company: 'Co', skills: [' Figma ', 'Figma', ''], postedAt: '2026-11-01' });
    expect(snap).toMatchObject({ source: 'manual', remote: 'unknown', url: '', skills: ['Figma'], postedAt: '2026-11-01T00:00:00.000Z' });
    const edited = mergeSnapshot({ ...snap, applyUrl: 'https://a.example' }, { applyUrl: ' ', company: 'New Co' });
    expect(edited.applyUrl).toBeUndefined();
    expect(edited.company).toBe('New Co');
    expect(() => mergeSnapshot(snap, { company: '' })).toThrow(/required/);
  });
});
