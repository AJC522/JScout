/** Sorting for the tracker's table view. */
import { APPLICATION_STATUSES } from '../../../shared/constants';
import type { Application } from '../../../shared/types';

export type SortKey = 'title' | 'company' | 'status' | 'appliedAt' | 'followUpAt' | 'priority' | 'updatedAt';
export type SortDir = 'asc' | 'desc';
export interface ListSort {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_LIST_SORT: ListSort = { key: 'updatedAt', dir: 'desc' };

/** The direction a column sorts in when first clicked: newest/highest first for dates and priority. */
export const FIRST_DIR: Record<SortKey, SortDir> = {
  title: 'asc',
  company: 'asc',
  status: 'asc',
  appliedAt: 'desc',
  followUpAt: 'asc',
  priority: 'desc',
  updatedAt: 'desc',
};

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

type Comparable = { kind: 'text'; value: string } | { kind: 'number'; value: number } | { kind: 'missing' };

function valueOf(app: Application, key: SortKey): Comparable {
  switch (key) {
    case 'title':
      return { kind: 'text', value: app.job.title };
    case 'company':
      return { kind: 'text', value: app.job.company };
    case 'status':
      return { kind: 'number', value: APPLICATION_STATUSES.indexOf(app.status) };
    case 'priority':
      return { kind: 'number', value: app.priority };
    case 'appliedAt':
    case 'followUpAt':
    case 'updatedAt': {
      const ms = app[key] ? Date.parse(app[key]) : Number.NaN;
      return Number.isNaN(ms) ? { kind: 'missing' } : { kind: 'number', value: ms };
    }
  }
}

function compareValues(a: Comparable, b: Comparable): number {
  if (a.kind === 'text' && b.kind === 'text') return collator.compare(a.value, b.value);
  if (a.kind === 'number' && b.kind === 'number') return a.value - b.value;
  return 0;
}

/** Sorted copy. Rows without a value (no applied date, say) always go last, whichever the direction. */
export function sortApplications(apps: readonly Application[], sort: ListSort): Application[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...apps].sort((x, y) => {
    const a = valueOf(x, sort.key);
    const b = valueOf(y, sort.key);
    if (a.kind === 'missing' || b.kind === 'missing') {
      if (a.kind === b.kind) return y.updatedAt.localeCompare(x.updatedAt);
      return a.kind === 'missing' ? 1 : -1;
    }
    return sign * compareValues(a, b) || y.updatedAt.localeCompare(x.updatedAt);
  });
}

/** Next sort after clicking a column header: toggle the direction, or start a new column at its natural direction. */
export function nextSort(current: ListSort, key: SortKey): ListSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: FIRST_DIR[key] };
}
