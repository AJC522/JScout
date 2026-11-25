/**
 * "New since your last visit" bookkeeping, per search. A visit is a stretch of activity on one
 * search; coming back after VISIT_GAP_MS starts a new visit, and postings first seen after the
 * start of the previous visit's last activity are marked new. Pure functions over a plain
 * record so the page can keep it in localStorage and the rules stay testable.
 */
import type { IsoDate } from '../../../shared/types';

export const SEEN_STORAGE_KEY = 'jscout.search.visits';
export const VISIT_GAP_MS = 30 * 60_000;
/** Searches remembered; the least recently used are forgotten first. */
export const MAX_REMEMBERED = 200;

export interface SearchVisit {
  /** Postings first seen after this are "new" during the current visit. Absent on a first visit. */
  since?: IsoDate;
  /** Last time this search was looked at. */
  lastAt: IsoDate;
}

export type VisitLog = Record<string, SearchVisit>;

/** Accepts whatever was in storage and keeps only well-formed entries. */
export function parseVisitLog(value: unknown): VisitLog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: VisitLog = {};
  for (const [signature, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const { since, lastAt } = entry as Record<string, unknown>;
    if (typeof lastAt !== 'string' || Number.isNaN(Date.parse(lastAt))) continue;
    out[signature] = typeof since === 'string' && !Number.isNaN(Date.parse(since)) ? { since, lastAt } : { lastAt };
  }
  return out;
}

/**
 * Record that `signature` is being looked at `now`, and return the updated log plus the
 * boundary for "new" in this visit.
 */
export function recordVisit(log: VisitLog, signature: string, now: Date): { log: VisitLog; since: IsoDate | undefined } {
  const previous = log[signature];
  const nowIso = now.toISOString();
  let entry: SearchVisit;
  if (previous && now.getTime() - Date.parse(previous.lastAt) < VISIT_GAP_MS) {
    // Same visit: keep the boundary so badges do not vanish while the user scrolls or refreshes.
    entry = previous.since ? { since: previous.since, lastAt: nowIso } : { lastAt: nowIso };
  } else {
    entry = previous ? { since: previous.lastAt, lastAt: nowIso } : { lastAt: nowIso };
  }
  const next: VisitLog = { ...log, [signature]: entry };
  return { log: prune(next), since: entry.since };
}

function prune(log: VisitLog): VisitLog {
  const entries = Object.entries(log);
  if (entries.length <= MAX_REMEMBERED) return log;
  entries.sort((a, b) => Date.parse(b[1].lastAt) - Date.parse(a[1].lastAt));
  return Object.fromEntries(entries.slice(0, MAX_REMEMBERED));
}

/** Whether a posting counts as new for a visit boundary. Nothing is new on a first visit. */
export function isNewSince(firstSeenAt: IsoDate, since: IsoDate | undefined): boolean {
  if (!since) return false;
  const seen = Date.parse(firstSeenAt);
  return !Number.isNaN(seen) && seen > Date.parse(since);
}
