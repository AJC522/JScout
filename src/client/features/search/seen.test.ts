import { describe, expect, it } from 'vitest';
import { isNewSince, MAX_REMEMBERED, parseVisitLog, recordVisit, VISIT_GAP_MS, type VisitLog } from './seen';

const at = (iso: string) => new Date(iso);

describe('new since last visit', () => {
  it('marks nothing new on the first visit', () => {
    const { log, since } = recordVisit({}, 'q=pm', at('2026-11-20T10:00:00Z'));
    expect(since).toBeUndefined();
    expect(log['q=pm']).toEqual({ lastAt: '2026-11-20T10:00:00.000Z' });
    expect(isNewSince('2026-11-20T09:59:00Z', since)).toBe(false);
  });

  it('uses the previous visit as the boundary when coming back later', () => {
    const first = recordVisit({}, 'q=pm', at('2026-11-20T10:00:00Z'));
    const second = recordVisit(first.log, 'q=pm', at('2026-11-21T08:00:00Z'));
    expect(second.since).toBe('2026-11-20T10:00:00.000Z');
    expect(isNewSince('2026-11-20T12:00:00Z', second.since)).toBe(true);
    expect(isNewSince('2026-11-20T09:00:00Z', second.since)).toBe(false);
  });

  it('keeps the boundary within one visit so badges do not disappear on refresh', () => {
    const first = recordVisit({}, 'q=pm', at('2026-11-20T10:00:00Z'));
    const second = recordVisit(first.log, 'q=pm', at('2026-11-21T08:00:00Z'));
    const soon = new Date(Date.parse('2026-11-21T08:00:00Z') + VISIT_GAP_MS - 1000);
    const third = recordVisit(second.log, 'q=pm', soon);
    expect(third.since).toBe('2026-11-20T10:00:00.000Z');
    expect(third.log['q=pm']?.lastAt).toBe(soon.toISOString());
  });

  it('tracks searches independently', () => {
    const a = recordVisit({}, 'q=pm', at('2026-11-20T10:00:00Z'));
    const b = recordVisit(a.log, 'q=designer', at('2026-11-22T10:00:00Z'));
    expect(b.since).toBeUndefined();
    expect(recordVisit(b.log, 'q=pm', at('2026-11-22T10:00:00Z')).since).toBe('2026-11-20T10:00:00.000Z');
  });

  it('forgets the least recently used searches beyond the limit', () => {
    let log: VisitLog = {};
    for (let i = 0; i <= MAX_REMEMBERED; i++) {
      log = recordVisit(log, `q=${i}`, new Date(Date.UTC(2026, 0, 1, 0, i))).log;
    }
    expect(Object.keys(log)).toHaveLength(MAX_REMEMBERED);
    expect(log['q=0']).toBeUndefined();
    expect(log[`q=${MAX_REMEMBERED}`]).toBeDefined();
  });

  it('accepts only well-formed stored data', () => {
    expect(parseVisitLog(null)).toEqual({});
    expect(parseVisitLog([1, 2])).toEqual({});
    expect(parseVisitLog({ a: { lastAt: 'nope' }, b: { lastAt: '2026-01-01T00:00:00Z', since: 5 }, c: 'x' })).toEqual({
      b: { lastAt: '2026-01-01T00:00:00Z' },
    });
  });
});
