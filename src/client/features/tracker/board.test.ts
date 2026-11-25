import { describe, expect, it } from 'vitest';
import type { Application, ApplicationStatus } from '../../../shared/types';
import {
  applyMove,
  daysSince,
  findColumn,
  followUpState,
  fromDateInput,
  groupByStatus,
  isFollowUpDue,
  moveBetweenColumns,
  planMove,
  renumber,
  sortOrderAt,
  sortOrderBetween,
  toColumnIds,
  toDateInput,
} from './board';

function app(id: string, status: ApplicationStatus, sortOrder: number, extra: Partial<Application> = {}): Application {
  return {
    id,
    status,
    sortOrder,
    job: {
      title: `Job ${id}`,
      company: 'Acme',
      locationText: '',
      remote: 'unknown',
      url: '',
      source: 'manual',
      sourceName: 'Added by you',
      employmentType: 'unknown',
      skills: [],
      descriptionHtml: '',
    },
    notes: '',
    priority: 0,
    contacts: [],
    checklist: [],
    statusChangedAt: '2026-11-01T10:00:00.000Z',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    jobClosed: false,
    ...extra,
  };
}

const now = new Date(2026, 10, 25, 15, 0).getTime();

describe('groupByStatus', () => {
  it('puts every status in a column, ordered by sortOrder then most recent update', () => {
    const cols = groupByStatus([
      app('a', 'saved', 2),
      app('b', 'saved', 1),
      app('c', 'applied', 0),
      app('d', 'saved', 2, { updatedAt: '2026-11-05T00:00:00.000Z' }),
    ]);
    expect(cols.saved.map((a) => a.id)).toEqual(['b', 'd', 'a']);
    expect(cols.applied.map((a) => a.id)).toEqual(['c']);
    expect(cols.withdrawn).toEqual([]);
  });
});

describe('sortOrderBetween', () => {
  it('handles empty columns and edges', () => {
    expect(sortOrderBetween(undefined, undefined)).toBe(0);
    expect(sortOrderBetween(undefined, 4)).toBe(3);
    expect(sortOrderBetween(4, undefined)).toBe(5);
    expect(sortOrderBetween(1, 2)).toBe(1.5);
  });

  it('reports when precision has run out', () => {
    expect(sortOrderBetween(1, 1)).toBeNull();
    expect(sortOrderBetween(1, 1 + Number.EPSILON)).toBeNull();
  });

  it('sortOrderAt clamps the index into the column', () => {
    const col = [app('a', 'saved', 1), app('b', 'saved', 3)];
    expect(sortOrderAt(col, 0)).toBe(0);
    expect(sortOrderAt(col, 1)).toBe(2);
    expect(sortOrderAt(col, 9)).toBe(4);
  });
});

describe('column ids', () => {
  const apps = [app('a', 'saved', 0), app('b', 'saved', 1), app('c', 'applied', 0)];
  const ids = toColumnIds(groupByStatus(apps));

  it('finds a card or a column by id', () => {
    expect(findColumn(ids, 'c')).toBe('applied');
    expect(findColumn(ids, 'rejected')).toBe('rejected');
    expect(findColumn(ids, 'zzz')).toBeUndefined();
  });

  it('moves a card between columns at an index', () => {
    const moved = moveBetweenColumns(ids, 'a', 'saved', 'applied', 0);
    expect(moved.saved).toEqual(['b']);
    expect(moved.applied).toEqual(['a', 'c']);
    expect(moveBetweenColumns(ids, 'a', 'saved', 'saved', 1)).toBe(ids);
  });
});

describe('planMove', () => {
  const apps = [app('a', 'saved', 0), app('b', 'saved', 1), app('c', 'saved', 2), app('x', 'applied', 5)];

  it('places a card between its new neighbours in another column', () => {
    expect(planMove(apps, 'b', 'applied', ['b', 'x'])).toEqual({ id: 'b', status: 'applied', sortOrder: 4 });
    expect(planMove(apps, 'b', 'applied', ['x', 'b'])).toEqual({ id: 'b', status: 'applied', sortOrder: 6 });
    expect(planMove(apps, 'b', 'offer', ['b'])).toEqual({ id: 'b', status: 'offer', sortOrder: 0 });
  });

  it('reorders within a column using the other cards as neighbours', () => {
    expect(planMove(apps, 'a', 'saved', ['b', 'a', 'c'])).toEqual({ id: 'a', status: 'saved', sortOrder: 1.5 });
    expect(planMove(apps, 'c', 'saved', ['c', 'a', 'b'])).toEqual({ id: 'c', status: 'saved', sortOrder: -1 });
  });

  it('returns null when nothing moved', () => {
    expect(planMove(apps, 'b', 'saved', ['a', 'b', 'c'])).toBeNull();
    expect(planMove(apps, 'nope', 'saved', ['a'])).toBeNull();
  });

  it('flags exhausted precision so the column can be renumbered', () => {
    const tight = [app('a', 'saved', 1), app('b', 'saved', 1), app('c', 'applied', 0)];
    expect(planMove(tight, 'c', 'saved', ['a', 'c', 'b'])?.sortOrder).toBeNull();
    expect(renumber(['a', 'c', 'b'])).toEqual([
      { id: 'a', sortOrder: 1024 },
      { id: 'c', sortOrder: 2048 },
      { id: 'b', sortOrder: 3072 },
    ]);
  });
});

describe('applyMove', () => {
  it('mirrors the server: moving to applied sets the applied and follow-up dates once', () => {
    const nowIso = '2026-11-25T12:00:00.000Z';
    const [moved] = applyMove([app('a', 'saved', 0)], 'a', 'applied', 3, nowIso);
    expect(moved).toMatchObject({ status: 'applied', sortOrder: 3, statusChangedAt: nowIso, appliedAt: nowIso });
    expect(moved?.followUpAt).toBe('2026-12-02T12:00:00.000Z');

    const kept = applyMove([app('a', 'saved', 0, { appliedAt: '2026-01-01T00:00:00.000Z' })], 'a', 'applied', 0, nowIso);
    expect(kept[0]?.appliedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps statusChangedAt for a reorder within the same column', () => {
    const [moved] = applyMove([app('a', 'saved', 0)], 'a', 'saved', 2, '2026-11-25T12:00:00.000Z');
    expect(moved?.statusChangedAt).toBe('2026-11-01T10:00:00.000Z');
  });
});

describe('dates', () => {
  it('counts calendar days since a timestamp', () => {
    expect(daysSince(new Date(2026, 10, 25, 1).toISOString(), now)).toBe(0);
    expect(daysSince(new Date(2026, 10, 22, 23).toISOString(), now)).toBe(3);
    expect(daysSince('not a date', now)).toBe(0);
  });

  it('classifies follow-ups for active applications only', () => {
    const at = (d: number) => new Date(2026, 10, d, 9).toISOString();
    expect(followUpState({ status: 'applied', followUpAt: at(23) }, now)).toEqual({ kind: 'overdue', days: 2 });
    expect(followUpState({ status: 'applied', followUpAt: at(25) }, now)).toEqual({ kind: 'today' });
    expect(followUpState({ status: 'applied', followUpAt: at(28) }, now)).toEqual({ kind: 'upcoming', days: 3 });
    expect(followUpState({ status: 'rejected', followUpAt: at(23) }, now)).toBeNull();
    expect(followUpState({ status: 'applied' }, now)).toBeNull();
    expect(isFollowUpDue({ status: 'saved', followUpAt: at(25) }, now)).toBe(true);
    expect(isFollowUpDue({ status: 'saved', followUpAt: at(26) }, now)).toBe(false);
  });

  it('round-trips date inputs through local noon', () => {
    const iso = fromDateInput('2026-12-03');
    expect(iso).not.toBeNull();
    expect(toDateInput(iso ?? undefined)).toBe('2026-12-03');
    expect(fromDateInput('')).toBeNull();
    expect(fromDateInput('03/12/2026')).toBeNull();
    expect(toDateInput(undefined)).toBe('');
  });
});
