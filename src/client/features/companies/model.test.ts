import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, hasFilters, isDetectable, pageRange, planBulk, toListQuery } from './model';

describe('companies model', () => {
  it('turns filters into a list request without empty values', () => {
    expect(toListQuery(DEFAULT_FILTERS)).toEqual({ limit: 50, offset: 0 });
    expect(toListQuery({ q: ' acme ', ats: 'lever', industry: 'Fintech', follow: 'not-following', mine: true, page: 2 })).toEqual({
      q: 'acme',
      ats: 'lever',
      industry: 'Fintech',
      enabled: false,
      origin: 'user',
      limit: 50,
      offset: 100,
    });
  });

  it('knows when filters are in use', () => {
    expect(hasFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasFilters({ ...DEFAULT_FILTERS, page: 3 })).toBe(false);
    expect(hasFilters({ ...DEFAULT_FILTERS, follow: 'following' })).toBe(true);
  });

  it('lets the server apply industry and origin filters to every match', () => {
    expect(planBulk({ ...DEFAULT_FILTERS, industry: 'Fintech', follow: 'following' }, false, ['a', 'b'], 87)).toEqual({
      body: { enabled: false, industry: 'Fintech' },
      count: 87,
      scope: 'all',
    });
    expect(planBulk({ ...DEFAULT_FILTERS, mine: true }, true, ['a'], 4).body).toEqual({ enabled: true, origin: 'user' });
  });

  it('falls back to the listed ids for a text or ATS filter', () => {
    expect(planBulk({ ...DEFAULT_FILTERS, q: 'acme' }, true, ['a', 'b'], 120)).toEqual({ body: { enabled: true, ids: ['a', 'b'] }, count: 2, scope: 'page' });
    expect(planBulk({ ...DEFAULT_FILTERS, ats: 'ashby' }, true, ['a'], 9).scope).toBe('page');
  });

  it('formats the page range', () => {
    expect(pageRange(0, 50, 492)).toBe('1–50 of 492');
    expect(pageRange(9, 42, 492)).toBe('451–492 of 492');
    expect(pageRange(0, 0, 0)).toBe('0 of 0');
  });

  it('needs at least two characters to look for a board', () => {
    expect(isDetectable(' a ')).toBe(false);
    expect(isDetectable('ab')).toBe(true);
  });
});
