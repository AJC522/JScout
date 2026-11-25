/** Dates and date ranges as written in résumés: "Jan 2020 – Present", "2019-2021", "03/2018 - 11/2020", "Summer 2022". */

export interface DatePoint {
  year: number;
  /** 1–12; undefined when only the year is known. */
  month?: number;
}

export interface DateRange {
  start: DatePoint;
  /** undefined when the range runs to the present. */
  end?: DatePoint;
  current: boolean;
  /** Position of the matched text in the line. */
  index: number;
  length: number;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const SEASONS: Record<string, [number, number]> = { spring: [3, 5], summer: [6, 8], fall: [9, 11], autumn: [9, 11], winter: [1, 2] };

const YEAR = '(?:19|20)\\d{2}';
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const SEASON = '(?:spring|summer|fall|autumn|winter)';
const DATE = [
  `${MONTH}\\s*,?\\s*${YEAR}`,
  `(?:0?[1-9]|1[0-2])\\s*[/.]\\s*${YEAR}`,
  `${YEAR}\\s*[/.-]\\s*(?:0[1-9]|1[0-2])(?!\\d)`,
  `${SEASON}\\s*${YEAR}`,
  YEAR,
].join('|');
const PRESENT = '(?:present|current(?:ly)?|now|today|ongoing|to\\s+date|till\\s+date|date)';
const SEPARATOR = '(?:\\s*[-–—‒―~]+\\s*|\\s+(?:to|until|till|through|thru)\\s+)';

const RANGE_RE = new RegExp(`(?<![\\w/.])(${DATE})${SEPARATOR}(${DATE}|${PRESENT})(?![\\w/])`, 'gi');
const SEASON_RE = new RegExp(`(?<![\\w/.])(${SEASON})\\s*(${YEAR})(?![\\w/])`, 'gi');
const SINGLE_RE = new RegExp(`(?<![\\w/.])(${DATE})(?![\\w/])`, 'gi');

const MIN_YEAR = 1950;

/** Parse one date. Season and year-only values resolve to the start or end of their period. */
export function parseDatePoint(raw: string, role: 'start' | 'end'): DatePoint | undefined {
  const s = raw.trim().toLowerCase();
  let m = /^([a-z]+)\.?\s*,?\s*(\d{4})$/.exec(s);
  if (m) {
    const season = SEASONS[m[1]!];
    if (season) return { year: Number(m[2]), month: role === 'start' ? season[0] : season[1] };
    const month = MONTHS[m[1]!.slice(0, 3)];
    return month ? { year: Number(m[2]), month } : undefined;
  }
  m = /^(\d{1,2})\s*[/.]\s*(\d{4})$/.exec(s) ?? /^(\d{4})\s*[/.-]\s*(\d{2})$/.exec(s);
  if (m) {
    const [year, month] = m[1]!.length === 4 ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
    return month >= 1 && month <= 12 ? { year, month } : undefined;
  }
  m = /^(\d{4})$/.exec(s);
  return m ? { year: Number(m[1]) } : undefined;
}

const monthIndex = (p: DatePoint): number => p.year * 12 + ((p.month ?? 6) - 1);

function plausible(start: DatePoint, end: DatePoint | undefined, now: Date): boolean {
  const maxYear = now.getUTCFullYear() + 6; // expected graduation dates may lie ahead
  if (start.year < MIN_YEAR || start.year > now.getUTCFullYear() + 1) return false;
  if (!end) return true;
  if (end.year < MIN_YEAR || end.year > maxYear) return false;
  // Year-only ends ("2019 - 2019", "Mar 2019 - 2019") are fine; otherwise the end may not precede the start.
  return end.month === undefined || start.month === undefined ? end.year >= start.year : monthIndex(end) >= monthIndex(start);
}

/** Every date range in a line, plus single seasons ("Summer 2022") as ranges covering that season. */
export function findDateRanges(line: string, now: Date): DateRange[] {
  const ranges: DateRange[] = [];
  for (const m of line.matchAll(RANGE_RE)) {
    const start = parseDatePoint(m[1]!, 'start');
    const endText = m[2]!;
    const current = new RegExp(`^${PRESENT}$`, 'i').test(endText.trim());
    const end = current ? undefined : parseDatePoint(endText, 'end');
    if (!start || (!current && !end) || !plausible(start, end, now)) continue;
    ranges.push({ start, end, current, index: m.index, length: m[0].length });
  }
  if (ranges.length) return ranges;
  for (const m of line.matchAll(SEASON_RE)) {
    const start = parseDatePoint(`${m[1]} ${m[2]}`, 'start');
    const end = parseDatePoint(`${m[1]} ${m[2]}`, 'end');
    if (start && end && plausible(start, end, now)) ranges.push({ start, end, current: false, index: m.index, length: m[0].length });
  }
  return ranges;
}

/** The last single date in a line (e.g. a graduation date), when there is no range. */
export function findSingleDate(line: string, now: Date): (DatePoint & { index: number; length: number }) | undefined {
  let found: (DatePoint & { index: number; length: number }) | undefined;
  for (const m of line.matchAll(SINGLE_RE)) {
    const point = parseDatePoint(m[1]!, 'end');
    if (point && point.year >= MIN_YEAR && point.year <= now.getUTCFullYear() + 6) {
      found = { ...point, index: m.index, length: m[0].length };
    }
  }
  return found;
}

export function formatDatePoint(p: DatePoint | undefined): string {
  if (!p) return '';
  return p.month ? `${p.year}-${String(p.month).padStart(2, '0')}` : String(p.year);
}

/**
 * Total years covered by the ranges, counting overlapping periods once. Year-only dates count
 * from mid-year, ranges are capped at `now`, and the result has one decimal.
 */
export function yearsCovered(ranges: Array<Pick<DateRange, 'start' | 'end' | 'current'>>, now: Date): number | null {
  if (!ranges.length) return null;
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const intervals = ranges
    .map((r) => [monthIndex(r.start), r.current || !r.end ? nowIndex : Math.min(monthIndex(r.end), nowIndex)] as const)
    .filter(([start, end]) => start <= end)
    .sort((a, b) => a[0] - b[0]);
  if (!intervals.length) return null;
  let months = 0;
  let [curStart, curEnd] = intervals[0]!;
  for (const [start, end] of intervals.slice(1)) {
    if (start <= curEnd + 1) {
      curEnd = Math.max(curEnd, end);
    } else {
      months += curEnd - curStart + 1;
      [curStart, curEnd] = [start, end];
    }
  }
  months += curEnd - curStart + 1;
  return Math.round((months / 12) * 10) / 10;
}
