/** Pure tracker logic: grouping into columns, drag-and-drop positions, follow-up and age calculations. */
import { ACTIVE_STATUSES, APPLICATION_STATUSES } from '../../../shared/constants';
import type { Application, ApplicationStatus } from '../../../shared/types';

const DAY_MS = 86_400_000;

export type Columns = Record<ApplicationStatus, Application[]>;

function byPosition(a: Application, b: Application): number {
  return a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt);
}

/** One column per status, each ordered like the server orders it (sortOrder, then most recently updated). */
export function groupByStatus(apps: readonly Application[]): Columns {
  const columns = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, [] as Application[]])) as Columns;
  for (const app of apps) columns[app.status].push(app);
  for (const status of APPLICATION_STATUSES) columns[status].sort(byPosition);
  return columns;
}

/**
 * A sortOrder strictly between two neighbours (either may be missing at a column edge).
 * Returns null when floating-point precision has run out and the column needs renumbering.
 */
export function sortOrderBetween(before: number | undefined, after: number | undefined): number | null {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  const mid = (before + after) / 2;
  return mid > before && mid < after ? mid : null;
}

/** sortOrder for inserting at `index` of a column that does not contain the moving card. */
export function sortOrderAt(column: readonly Application[], index: number): number | null {
  const clamped = Math.max(0, Math.min(index, column.length));
  return sortOrderBetween(column[clamped - 1]?.sortOrder, column[clamped]?.sortOrder);
}

/** Card ids per column; the shape drag-and-drop works on. */
export type ColumnIds = Record<ApplicationStatus, string[]>;

export function toColumnIds(columns: Columns): ColumnIds {
  return Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, columns[s].map((a) => a.id)])) as ColumnIds;
}

export function findColumn(ids: ColumnIds, id: string): ApplicationStatus | undefined {
  if ((APPLICATION_STATUSES as string[]).includes(id)) return id as ApplicationStatus;
  return APPLICATION_STATUSES.find((s) => ids[s].includes(id));
}

/** Move a card id into another column at `index` (used while dragging over a different column). */
export function moveBetweenColumns(
  ids: ColumnIds,
  id: string,
  from: ApplicationStatus,
  to: ApplicationStatus,
  index: number,
): ColumnIds {
  if (from === to) return ids;
  const target = ids[to].filter((x) => x !== id);
  target.splice(Math.max(0, Math.min(index, target.length)), 0, id);
  return { ...ids, [from]: ids[from].filter((x) => x !== id), [to]: target };
}

export interface MovePlan {
  id: string;
  status: ApplicationStatus;
  /** Null when the neighbours are too close together; the column must be renumbered. */
  sortOrder: number | null;
}

/**
 * Where a dropped card ends up, given the final id order of its column and the cards as they were
 * before the drag. Returns null when nothing changed.
 */
export function planMove(apps: readonly Application[], id: string, status: ApplicationStatus, orderedIds: readonly string[]): MovePlan | null {
  const moving = apps.find((a) => a.id === id);
  if (!moving) return null;
  const index = orderedIds.indexOf(id);
  if (index === -1) return null;
  const byId = new Map(apps.map((a) => [a.id, a]));
  const before = orderedIds[index - 1];
  const after = orderedIds[index + 1];
  if (moving.status === status) {
    const current = groupByStatus(apps)[status].map((a) => a.id);
    if (current.indexOf(id) === index && current.length === orderedIds.length) return null;
  }
  const sortOrder = sortOrderBetween(
    before === undefined ? undefined : byId.get(before)?.sortOrder,
    after === undefined ? undefined : byId.get(after)?.sortOrder,
  );
  return { id, status, sortOrder };
}

/** Integer sortOrders for a column in the given order, used when fractional positions run out. */
export function renumber(orderedIds: readonly string[]): Array<{ id: string; sortOrder: number }> {
  return orderedIds.map((id, i) => ({ id, sortOrder: (i + 1) * 1024 }));
}

/** Apply a status/position change to a cached list, as the server will. */
export function applyMove(apps: readonly Application[], id: string, status: ApplicationStatus, sortOrder: number, nowIso: string): Application[] {
  return apps.map((app) => {
    if (app.id !== id) return app;
    const statusChanged = app.status !== status;
    const next: Application = { ...app, status, sortOrder, updatedAt: nowIso };
    if (statusChanged) {
      next.statusChangedAt = nowIso;
      if (status === 'applied') {
        next.appliedAt ??= nowIso;
        next.followUpAt ??= new Date(Date.parse(nowIso) + 7 * DAY_MS).toISOString();
      }
    }
    return next;
  });
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole calendar days from `iso` to `now` (0 = today). */
export function daysSince(iso: string, now: number): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS));
}

export type FollowUpState = { kind: 'overdue'; days: number } | { kind: 'today' } | { kind: 'upcoming'; days: number };

/** Follow-up urgency for an active application; null when none is set or the application is closed. */
export function followUpState(app: Pick<Application, 'followUpAt' | 'status'>, now: number): FollowUpState | null {
  if (!app.followUpAt || !ACTIVE_STATUSES.includes(app.status)) return null;
  const due = Date.parse(app.followUpAt);
  if (Number.isNaN(due)) return null;
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY_MS);
  if (days < 0) return { kind: 'overdue', days: -days };
  if (days === 0) return { kind: 'today' };
  return { kind: 'upcoming', days };
}

/** True when the follow-up is due today or earlier (matches the server's "follow-ups due" count). */
export function isFollowUpDue(app: Pick<Application, 'followUpAt' | 'status'>, now: number): boolean {
  const state = followUpState(app, now);
  return state !== null && state.kind !== 'upcoming';
}

/** "YYYY-MM-DD" in local time, for <input type="date">. "" when missing. */
export function toDateInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * ISO timestamp for a picked calendar day. Local noon keeps the day stable across
 * time zones and DST changes; null when the input was cleared or is not a date.
 */
export function fromDateInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
