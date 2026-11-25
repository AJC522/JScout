/** Display formatting shared by every page. Pure functions; no React. */
import type { Salary, SalaryPeriod } from '../../shared/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface FormatOptions {
  /** BCP 47 locale; defaults to the browser's. */
  locale?: string;
  /** IANA time zone; defaults to the browser's. */
  timeZone?: string;
}

/**
 * Parse an ISO timestamp. A bare "YYYY-MM-DD" is read as a local calendar day:
 * `new Date('2026-11-24')` would be UTC midnight and show as the 23rd west of Greenwich.
 */
function parseDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dayOnly ? new Date(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeSpan(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  const days = Math.floor(ms / DAY);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * Compact relative time: "just now", "5m ago", "3d ago", "2w ago", "4mo ago", "1y ago";
 * future times read "in 3d". Returns "" for a missing or unparseable value.
 * Spans are floored so a posting is never shown as older than it is.
 */
export function formatRelativeTime(iso: string | Date | null | undefined, now: Date | number = Date.now()): string {
  const then = parseDate(iso);
  if (!then) return '';
  const diff = (typeof now === 'number' ? now : now.getTime()) - then.getTime();
  const span = Math.abs(diff);
  if (span < 45_000) return 'just now';
  return diff > 0 ? `${relativeSpan(span)} ago` : `in ${relativeSpan(span)}`;
}

export type DateStyle = 'short' | 'medium' | 'long';

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { month: 'short', day: 'numeric' },
  medium: { month: 'short', day: 'numeric', year: 'numeric' },
  long: { month: 'long', day: 'numeric', year: 'numeric' },
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(key: string, fields: Intl.DateTimeFormatOptions, options: FormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${key}|${options.locale ?? ''}|${options.timeZone ?? ''}`;
  let formatter = dateFormatters.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(options.locale, { ...fields, timeZone: options.timeZone });
    dateFormatters.set(cacheKey, formatter);
  }
  return formatter;
}

/** "Nov 24" (short), "Nov 24, 2026" (medium, default) or "November 24, 2026" (long). "" when missing/invalid. */
export function formatDate(
  iso: string | Date | null | undefined,
  style: DateStyle = 'medium',
  options: FormatOptions = {},
): string {
  const date = parseDate(iso);
  return date ? dateFormatter(style, DATE_STYLES[style], options).format(date) : '';
}

/** "Nov 24, 2026, 2:17 PM". "" when missing/invalid. */
export function formatDateTime(iso: string | Date | null | undefined, options: FormatOptions = {}): string {
  const date = parseDate(iso);
  if (!date) return '';
  return dateFormatter('datetime', { ...DATE_STYLES.medium, hour: 'numeric', minute: '2-digit' }, options).format(date);
}

/** Profile dates are "YYYY-MM" or "YYYY": "2021-03" -> "Mar 2021", "2021" -> "2021". Other text is returned as typed. */
export function formatYearMonth(value: string | null | undefined, options: Pick<FormatOptions, 'locale'> = {}): string {
  const text = value?.trim() ?? '';
  const match = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (!match) return text;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return text;
  // Formatted in UTC from a UTC date so the month never shifts with the viewer's time zone.
  return dateFormatter('year-month', { month: 'short', year: 'numeric' }, { ...options, timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(match[1]), month - 1, 1)),
  );
}

/** Whole numbers with thousands separators: 12430 -> "12,430". "" for NaN/Infinity. */
export function formatNumber(value: number | null | undefined, options: Pick<FormatOptions, 'locale'> = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return new Intl.NumberFormat(options.locale, { maximumFractionDigits: 0 }).format(value);
}

function trimDecimals(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Short counts for badges: 950 -> "950", 1240 -> "1.2k", 12430 -> "12k", 1250000 -> "1.3M". */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs < 1000) return String(Math.round(value));
  if (abs < 10_000) return `${trimDecimals(value / 1000, 1)}k`;
  if (abs < 999_500) return `${Math.round(value / 1000)}k`;
  return `${trimDecimals(value / 1_000_000, 1)}M`;
}

/** A 0–1 ratio as a percentage: 0.4167 -> "42%". "–" when there is nothing to report. */
export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '–';
  return `${Math.round(ratio * 100)}%`;
}

const PERIOD_SUFFIX: Record<SalaryPeriod, string> = {
  year: '/yr',
  month: '/mo',
  week: '/wk',
  day: '/day',
  hour: '/hr',
};

function salaryAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 999_950) return `${trimDecimals(value / 1_000_000, 2)}M`;
  if (abs >= 1000) return `${trimDecimals(value / 1000, 1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * The symbol en-US uses for a currency. Unlike the narrow symbol it keeps
 * dollars apart ("$", "CA$", "A$"), which matters when comparing postings.
 */
function currencySymbol(code: string | undefined): string {
  const currency = code?.trim().toUpperCase();
  if (!currency) return '';
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'symbol' }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    // Not a well-formed ISO 4217 code; show what the source gave us.
    return currency;
  }
}

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export interface SalaryFormatOptions {
  /** Show the yearly equivalent (annualMin/annualMax) when the posting has one. */
  annualized?: boolean;
}

/**
 * "$120k–$150k/yr", "From €60k/yr", "Up to £45.50/hr", "CHF 120k–150k/yr".
 * Falls back to the posting's own salary text, and to "" when there is nothing to show.
 */
export function formatSalary(salary: Salary | null | undefined, options: SalaryFormatOptions = {}): string {
  if (!salary) return '';
  const annual = options.annualized === true && (isPositive(salary.annualMin) || isPositive(salary.annualMax));
  const min = annual ? salary.annualMin : salary.min;
  const max = annual ? salary.annualMax : salary.max;
  const period = annual ? 'year' : salary.period;

  const symbol = currencySymbol(salary.currency);
  // Codes such as "CHF" need a space and read badly when repeated; symbols such as "$" or "CA$" do not.
  const isCode = /[A-Za-z]$/.test(symbol);
  const money = (value: number) => `${symbol}${isCode ? '\u00a0' : ''}${salaryAmount(value)}`;
  const suffix = period ? PERIOD_SUFFIX[period] : '';

  if (isPositive(min) && isPositive(max)) {
    if (min === max) return `${money(min)}${suffix}`;
    const [low, high] = min < max ? [min, max] : [max, min];
    return `${money(low)}–${isCode ? salaryAmount(high) : money(high)}${suffix}`;
  }
  if (isPositive(min)) return `From ${money(min)}${suffix}`;
  if (isPositive(max)) return `Up to ${money(max)}${suffix}`;
  return salary.text?.trim() ?? '';
}

/** The right noun form for a count: pluralWord(1, 'match', 'matches') -> "match". */
export function pluralWord(count: number, singular: string, plural: string = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** Count plus noun: pluralize(1, 'job') -> "1 job", pluralize(12430, 'job') -> "12,430 jobs". */
export function pluralize(count: number, singular: string, plural?: string): string {
  return `${formatNumber(count) || '0'} ${pluralWord(count, singular, plural)}`;
}

/** File sizes: 0 -> "0 B", 1536 -> "1.5 KB", 8388608 -> "8 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${trimDecimals(value, value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Up to two initials for an avatar fallback: "Acme Rockets Inc" -> "AR", "stripe" -> "S". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? '')
    .join('');
}
