import { notImplemented } from './not-implemented';

/**
 * Parse whatever a job source gives as a date into an ISO-8601 UTC string.
 * Accepts: Date; epoch seconds or milliseconds (number or numeric string; decide by magnitude);
 * ISO-8601 with or without time/zone (date-only is taken as UTC midnight);
 * RFC 2822 ("Tue, 24 Nov 2026 10:00:00 +0000"); "YYYY-MM-DD HH:mm:ss" (taken as UTC);
 * relative phrases ("3 days ago", "yesterday", "just now", "30+ days ago") relative to `now`.
 * Returns undefined for empty/unparseable input and for implausible dates
 * (before 2000 or more than 2 days after `now`).
 */
export function toIsoDate(input: string | number | Date | null | undefined, now: Date = new Date()): string | undefined {
  return notImplemented(`toIsoDate(${String(input)}, ${now.toISOString()})`);
}

/** Whole days between an ISO date and `now` (0 for today/future). */
export function daysAgo(iso: string, now: Date = new Date()): number {
  const ms = now.getTime() - Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}
