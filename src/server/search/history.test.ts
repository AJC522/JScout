import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Db, openDb } from '../db';
import { createSearchHistory, HISTORY_LIMIT, historySignature, normalizeForHistory, type SearchHistory } from './history';

let db: Db;
let history: SearchHistory;
let clock = 0;

beforeEach(() => {
  db = openDb(':memory:');
  history = createSearchHistory(db, () => new Date(Date.UTC(2026, 10, 24, 0, 0, clock++)));
});
afterEach(() => db.close());

describe('normalizeForHistory', () => {
  it('drops paging, blanks and defaults, and sorts lists so equivalent searches match', () => {
    const a = normalizeForHistory({ q: ' nurse ', offset: 30, limit: 10, remote: ['remote', 'hybrid'], includeRemote: true, sort: 'match', location: '' });
    expect(a).toEqual({ q: 'nurse', remote: ['hybrid', 'remote'] });
    const b = normalizeForHistory({ remote: ['hybrid', 'remote', 'remote'], q: 'nurse' });
    expect(historySignature(a!)).toBe(historySignature(b!));
    expect(normalizeForHistory({ q: '  ', offset: 0 })).toBeUndefined();
    expect(normalizeForHistory({ q: '', remote: ['remote'] })).toEqual({ q: '', remote: ['remote'] });
  });
});

describe('search history', () => {
  it('lists newest first and collapses repeats into the latest run', () => {
    history.record({ q: 'nurse' }, 3);
    history.record({ q: 'welder' }, 1);
    history.record({ q: 'nurse ', offset: 30 }, 5);
    expect(history.list().map((e) => [e.query.q, e.total])).toEqual([['nurse', 5], ['welder', 1]]);
    expect(history.list(1)).toHaveLength(1);
  });

  it('ignores empty searches, keeps only the latest entries, and clears', () => {
    history.record({ q: '' }, 100);
    expect(history.list()).toEqual([]);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) history.record({ q: `q${i}` }, i);
    expect(db.scalar('SELECT COUNT(*) FROM search_history')).toBe(HISTORY_LIMIT);
    expect(history.list(HISTORY_LIMIT)[HISTORY_LIMIT - 1]!.query.q).toBe('q5');
    history.clear();
    expect(history.list()).toEqual([]);
  });

  it('skips rows that no longer match the query schema', () => {
    db.run(`INSERT INTO search_history (query, sig, ran_at, total) VALUES ('{"q":"x","bogus":1}', 's', '2026-01-01T00:00:00.000Z', 0)`);
    history.record({ q: 'ok' }, 1);
    expect(history.list().map((e) => e.query.q)).toEqual(['ok']);
  });
});
