import { describe, expect, it } from 'vitest';
import { findDateRanges, findSingleDate, formatDatePoint, yearsCovered } from './resume-dates';

const NOW = new Date('2026-11-25T12:00:00Z');
const ranges = (line: string) =>
  findDateRanges(line, NOW).map((r) => `${formatDatePoint(r.start)}..${r.current ? 'now' : formatDatePoint(r.end)}`);

describe('findDateRanges', () => {
  it.each([
    ['Jan 2020 – Present', '2020-01..now'],
    ['January 2020 - present', '2020-01..now'],
    ['Sept. 2019 to June 2021', '2019-09..2021-06'],
    ['Mar, 2018 — Current', '2018-03..now'],
    ['2019-2021', '2019..2021'],
    ['2019 – 2019', '2019..2019'],
    ['03/2018 - 11/2020', '2018-03..2020-11'],
    ['3/2018 – 11/2020', '2018-03..2020-11'],
    ['2018-03 to 2020-11', '2018-03..2020-11'],
    ['May 2017 – 2019', '2017-05..2019'],
    ['Engineer (2015 - Date)', '2015..now'],
    ['Summer 2022', '2022-06..2022-08'],
    ['Fall 2021 – Spring 2022', '2021-09..2022-05'],
  ])('%s', (line, expected) => {
    expect(ranges(line)).toEqual([expected]);
  });

  it.each([
    ['(512) 555-0142'],
    ['Austin, TX 78701-1234'],
    ['Increased revenue 20% in 2019'],
    ['2021 - 2019'],
    ['Mar 2021 - Jan 2021'],
    ['1890 - 1895'],
    ['2030 - Present'],
    ['ISBN 2019-2021-77'],
    ['Marketing 2019 - 2020 budget'],
  ])('ignores %s', (line) => {
    // The last one is a real range ("2019 - 2020"); only the word before it must not be read as a month.
    expect(ranges(line)).toEqual(line.startsWith('Marketing') ? ['2019..2020'] : []);
  });
});

describe('findSingleDate', () => {
  it('finds the last date on a line, allowing expected graduation years', () => {
    expect(formatDatePoint(findSingleDate('B.S. Biology, May 2016', NOW))).toBe('2016-05');
    expect(formatDatePoint(findSingleDate('Class of 2012, graduated 2016', NOW))).toBe('2016');
    expect(formatDatePoint(findSingleDate('Expected 2028', NOW))).toBe('2028');
    expect(findSingleDate('Room 2400', NOW)).toBeUndefined();
  });
});

describe('yearsCovered', () => {
  it('returns null without ranges and counts overlaps once', () => {
    expect(yearsCovered([], NOW)).toBeNull();
    const a = { start: { year: 2020, month: 1 }, end: { year: 2020, month: 12 }, current: false };
    const b = { start: { year: 2020, month: 7 }, end: { year: 2021, month: 6 }, current: false };
    expect(yearsCovered([a, b], NOW)).toBe(1.5);
    expect(yearsCovered([a, a], NOW)).toBe(1);
  });

  it('ignores ranges that start in the future', () => {
    expect(yearsCovered([{ start: { year: 2027, month: 1 }, current: true }], NOW)).toBeNull();
  });
});
