/**
 * Date parsing for job sources. Every format is parsed explicitly into UTC components;
 * Date.parse is never used, because its handling of anything but full ISO-8601 is
 * implementation-defined and (for zone-less strings) depends on the machine's timezone.
 */

const DAY_MS = 86_400_000;
const MIN_TIME = Date.UTC(2000, 0, 1);
/** Values accepted as dates may lie at most this far after `now` (clock skew, time zones). */
const MAX_FUTURE_MS = 2 * DAY_MS;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/** Named zones seen in RFC 2822 / RSS dates, as minutes east of UTC. Unknown names are read as UTC. */
const ZONES: Readonly<Record<string, number>> = {
  z: 0, ut: 0, utc: 0, gmt: 0, wet: 0, bst: 60, cet: 60, cest: 120, met: 60, mest: 120, eet: 120, eest: 180,
  est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420,
  akst: -540, akdt: -480, hst: -600, ast: -240, adt: -180, nst: -210, ndt: -150,
  msk: 180, sgt: 480, hkt: 480, jst: 540, kst: 540, aest: 600, aedt: 660, acst: 570, awst: 480, nzst: 720, nzdt: 780,
};

const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: DAY_MS, day: DAY_MS, days: DAY_MS,
  w: 7 * DAY_MS, wk: 7 * DAY_MS, wks: 7 * DAY_MS, week: 7 * DAY_MS, weeks: 7 * DAY_MS,
  mo: 30 * DAY_MS, mos: 30 * DAY_MS, month: 30 * DAY_MS, months: 30 * DAY_MS,
  y: 365 * DAY_MS, yr: 365 * DAY_MS, yrs: 365 * DAY_MS, year: 365 * DAY_MS, years: 365 * DAY_MS,
};

/** Epoch milliseconds from UTC components, or undefined when a component is out of range (no rollover). */
function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number | undefined {
  if (!Number.isInteger(y) || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return undefined;
  const t = Date.UTC(y, mo - 1, d, h, mi, Math.min(s, 59), ms);
  const dt = new Date(t);
  // Reject dates that Date.UTC would roll over (e.g. 31 June, 29 Feb in a non-leap year).
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1) return undefined;
  return t;
}

/** "+01:00", "+0100", "+01", "-05", "Z", "GMT", "EST", "GMT+0100" -> minutes east of UTC. */
function zoneOffset(zone: string | undefined): number | undefined {
  if (!zone) return 0;
  const z = zone.trim().toLowerCase();
  if (!z) return 0;
  const m = /^(?:gmt|utc|ut)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(z);
  if (m) {
    const h = Number(m[2]);
    const mi = Number(m[3] ?? 0);
    if (h > 14 || mi > 59) return undefined;
    return (m[1] === '-' ? -1 : 1) * (h * 60 + mi);
  }
  if (/^[a-z]{1,5}$/.test(z)) return ZONES[z] ?? 0;
  return undefined;
}

function fromEpoch(n: number): number | undefined {
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // Seconds until year 5138; anything at or above 1e11 must be milliseconds.
  if (n < 1e11) return Math.round(n * 1000);
  if (n < 1e14) return Math.round(n);
  return undefined;
}

function twoDigitYear(y: string): number {
  const n = Number(y);
  if (y.length !== 2) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

function fraction(f: string | undefined): number {
  return f ? Math.round(Number(`0.${f}`) * 1000) : 0;
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(z|[+-]\d{2}(?::?\d{2})?|(?:utc|gmt)(?:\s*[+-]\d{1,2}(?::?\d{2})?)?)?$/i;
const SLASH_YMD_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(z|utc|gmt)?$/i;
const TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(am|pm)?`;
const ZONE = String.raw`(?:\s*\(?((?:gmt|utc|ut)?\s*[+-]\d{2}:?\d{2}|[a-z]{1,5})\)?)?`;
const WEEKDAY = String.raw`(?:[a-z]{3,9}\.?,?\s+)?`;
/** "Tue, 24 Nov 2026 10:00:00 +0000", "24 November 2026", "24-Nov-2026 10:00". */
const DMY_RE = new RegExp(String.raw`^${WEEKDAY}(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{4}|\d{2})(?:,?\s+(?:at\s+)?${TIME})?${ZONE}(?:\s*\([^)]*\))?$`, 'i');
/** "Nov 24, 2026", "Tue Nov 24 2026 10:00:00 GMT+0000 (Coordinated Universal Time)", "November 24th, 2026 at 9:00 AM EST". */
const MDY_RE = new RegExp(String.raw`^${WEEKDAY}([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:,?\s+(?:at\s+)?${TIME})?${ZONE}(?:\s*\([^)]*\))?$`, 'i');

function withTime(
  y: number, mo: number, d: number,
  h: string | undefined, mi: string | undefined, s: string | undefined, frac: string | undefined,
  ampm: string | undefined, zone: string | undefined,
): number | undefined {
  let hour = h === undefined ? 0 : Number(h);
  if (ampm) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0);
  }
  const off = zoneOffset(zone);
  if (off === undefined) return undefined;
  const t = utc(y, mo, d, hour, Number(mi ?? 0), Number(s ?? 0), fraction(frac));
  return t === undefined ? undefined : t - off * 60_000;
}

function parseNamedMonth(s: string): number | undefined {
  let m = DMY_RE.exec(s);
  if (m) {
    const mo = MONTHS[(m[2] ?? '').toLowerCase()];
    if (!mo) return undefined;
    return withTime(twoDigitYear(m[3] ?? ''), mo, Number(m[1]), m[4], m[5], m[6], m[7], m[8], m[9]);
  }
  m = MDY_RE.exec(s);
  if (m) {
    const mo = MONTHS[(m[1] ?? '').toLowerCase()];
    if (!mo) return undefined;
    return withTime(Number(m[3]), mo, Number(m[2]), m[4], m[5], m[6], m[7], m[8], m[9]);
  }
  return undefined;
}

/** "3 days ago", "an hour ago", "30+ days ago", "yesterday", "just now", "Posted 2w ago", "today". */
function parseRelative(s: string, now: number): number | undefined {
  const t = s
    .toLowerCase()
    .replace(/^(?:posted|updated|published|active|reposted|added)\s*:?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(?:just now|now|right now|moments? ago|today|just posted|new)$/.test(t)) return now;
  if (t === 'yesterday') return now - DAY_MS;
  const last = /^(?:last|past) (day|week|month|year)$/.exec(t);
  if (last) return now - (UNIT_MS[last[1] ?? ''] ?? 0);
  const m = /^(?:about |around |over |almost |nearly |more than |less than )?(an?|\d{1,4})\s*\+?\s*([a-z]+)\s*\+?\s*ago$/.exec(t);
  if (!m) return undefined;
  const n = m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1]);
  const unit = UNIT_MS[m[2] ?? ''];
  if (!unit || !Number.isFinite(n)) return undefined;
  return now - n * unit;
}

function parseString(raw: string, now: number): number | undefined {
  const s = raw.trim().replace(/^(?:posted|published|updated|date posted)(?:\s+on)?\s*:?\s*(?=\w)/i, '');
  if (!s) return undefined;

  if (/^\d+(?:\.\d+)?$/.test(s)) {
    // Compact calendar date "20261123" (8 digits, plausible Y/M/D) before epoch seconds.
    const ymd = /^(19|20)(\d{2})(\d{2})(\d{2})$/.exec(s);
    if (ymd) {
      const t = utc(Number(`${ymd[1]}${ymd[2]}`), Number(ymd[3]), Number(ymd[4]));
      if (t !== undefined) return t;
    }
    return fromEpoch(Number(s));
  }

  let m = ISO_RE.exec(s);
  if (m) {
    // Date-only is UTC midnight; a date-time without a zone ("2026-11-19 14:03:22",
    // "2026-11-13T17:29:57") is taken as UTC, which is what job APIs mean by it.
    return withTime(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5], m[6], m[7], undefined, m[8]);
  }
  m = SLASH_YMD_RE.exec(s);
  if (m) return withTime(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5], m[6], undefined, undefined, m[7]);

  return parseNamedMonth(s) ?? parseRelative(s, now);
}

/**
 * Parse whatever a job source gives as a date into an ISO-8601 UTC string.
 * Accepts: Date; epoch seconds or milliseconds (number or numeric string; decide by magnitude);
 * ISO-8601 with or without time/zone (date-only is taken as UTC midnight);
 * RFC 2822 ("Tue, 24 Nov 2026 10:00:00 +0000"); "YYYY-MM-DD HH:mm:ss" (taken as UTC);
 * relative phrases ("3 days ago", "yesterday", "just now", "30+ days ago") relative to `now`.
 * Returns undefined for empty/unparseable input and for implausible dates
 * (before 2000 or more than 2 days after `now`).
 *
 * Details: numbers below 1e11 are seconds, 1e11–1e14 milliseconds. ISO date-times without a
 * zone are read as UTC. Named zones in RFC 2822 dates (GMT, EST, PDT, CET, …) are honoured;
 * unknown zone names are read as UTC. Relative months/years count as 30/365 days. Never throws.
 */
export function toIsoDate(input: string | number | Date | null | undefined, now: Date = new Date()): string | undefined {
  try {
    const nowMs = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
    let t: number | undefined;
    if (input instanceof Date) t = input.getTime();
    else if (typeof input === 'number') t = fromEpoch(input);
    else if (typeof input === 'string') t = parseString(input, nowMs);
    if (t === undefined || !Number.isFinite(t)) return undefined;
    if (t < MIN_TIME || t > nowMs + MAX_FUTURE_MS) return undefined;
    return new Date(t).toISOString();
  } catch {
    return undefined;
  }
}

/** Whole days between an ISO date and `now` (0 for today/future). */
export function daysAgo(iso: string, now: Date = new Date()): number {
  const ms = now.getTime() - Date.parse(iso);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}
