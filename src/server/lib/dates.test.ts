import { afterEach, describe, expect, it } from 'vitest';
import { daysAgo, toIsoDate } from './dates';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const iso = (input: Parameters<typeof toIsoDate>[0]): string | undefined => toIsoDate(input, NOW);

describe('toIsoDate: epoch numbers', () => {
  it.each([
    [1795520405, '2026-11-24T11:40:05.000Z'],
    [1795520405000, '2026-11-24T11:40:05.000Z'],
    ['1795520405', '2026-11-24T11:40:05.000Z'],
    ['1795520405000', '2026-11-24T11:40:05.000Z'],
    [' 1795520405 ', '2026-11-24T11:40:05.000Z'],
    ['1795520405.5', '2026-11-24T11:40:05.500Z'],
    [1795520405.25, '2026-11-24T11:40:05.250Z'],
    [946684800, '2000-01-01T00:00:00.000Z'],
    [946684800000, '2000-01-01T00:00:00.000Z'],
    [1764547200, '2025-12-01T00:00:00.000Z'],
  ])('%j -> %s', (input, expected) => {
    expect(iso(input)).toBe(expected);
  });

  it.each([0, -1, '0', '-1795520405', 946684799, 99999999999, NaN, Infinity, -Infinity, 1e15, '1e9', 20261123, 1795520405 + 3 * 86400])(
    'rejects %j',
    (input) => {
      expect(iso(input)).toBeUndefined();
    },
  );
});

describe('toIsoDate: ISO-8601 and SQL-style strings', () => {
  it.each([
    ['2026-11-23T09:40:00+01:00', '2026-11-23T08:40:00.000Z'],
    ['2026-11-23T09:40:00-05:00', '2026-11-23T14:40:00.000Z'],
    ['2026-11-23T09:40:00+0530', '2026-11-23T04:10:00.000Z'],
    ['2026-11-23T09:40:00 +05:30', '2026-11-23T04:10:00.000Z'],
    ['2026-11-23T09:40:00+05', '2026-11-23T04:40:00.000Z'],
    ['2026-11-23T09:40:00+14:00', '2026-11-22T19:40:00.000Z'],
    ['2026-11-23T09:40:00Z', '2026-11-23T09:40:00.000Z'],
    ['2026-11-23t09:40:00z', '2026-11-23T09:40:00.000Z'],
    ['2026-11-23T09:40:00.123456Z', '2026-11-23T09:40:00.123Z'],
    ['2026-11-23T09:40:00,5Z', '2026-11-23T09:40:00.500Z'],
    ['2026-11-23T09:40Z', '2026-11-23T09:40:00.000Z'],
    ['2026-11-23T09:40:60Z', '2026-11-23T09:40:59.000Z'], // leap second clamps
    ['2026-11-23', '2026-11-23T00:00:00.000Z'],
    [' 2026-11-23 ', '2026-11-23T00:00:00.000Z'],
    ['2024-02-29', '2024-02-29T00:00:00.000Z'],
    ['2026-11-19 14:03:22', '2026-11-19T14:03:22.000Z'],
    ['2026-11-13T17:29:57', '2026-11-13T17:29:57.000Z'],
    ['2026-11-19 14:03:22 UTC', '2026-11-19T14:03:22.000Z'],
    ['2026-11-19 14:03:22 GMT+02:00', '2026-11-19T12:03:22.000Z'],
    ['2026-11-19 14:03:22.000000', '2026-11-19T14:03:22.000Z'],
    ['2026/11/23', '2026-11-23T00:00:00.000Z'],
    ['2026/11/23 14:03', '2026-11-23T14:03:00.000Z'],
    ['20261123', '2026-11-23T00:00:00.000Z'],
    ['23.11.2026', '2026-11-23T00:00:00.000Z'],
    ['23/11/2026', '2026-11-23T00:00:00.000Z'],
    ['11/23/2026', '2026-11-23T00:00:00.000Z'],
    ['05/05/2026', '2026-05-05T00:00:00.000Z'],
    ['Posted on 2026-11-20', '2026-11-20T00:00:00.000Z'],
    ['Date posted: 2026-11-20', '2026-11-20T00:00:00.000Z'],
  ])('%j -> %s', (input, expected) => {
    expect(iso(input)).toBe(expected);
  });

  it.each([
    '2026-02-29', // not a leap year
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-11-00',
    '2026-11-23T24:00:00Z',
    '2026-11-23T09:60:00Z',
    '2026-11-23T09:40:00+15:00',
    '2026-11-23T09:40:00+05:75',
    '2026-11-23T09:40:00Z garbage',
    '03/04/2026', // ambiguous day/month order
    '13/13/2026',
    '2026-1-5',
    '٢٠٢٦-١١-٢٣',
  ])('rejects %j', (input) => {
    expect(iso(input)).toBeUndefined();
  });
});

describe('toIsoDate: RFC 2822 and other named-month formats', () => {
  it.each([
    ['Mon, 23 Nov 2026 09:40:00 GMT', '2026-11-23T09:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 +0000', '2026-11-23T09:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 -0000', '2026-11-23T09:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 EST', '2026-11-23T14:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 EDT', '2026-11-23T13:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 PST', '2026-11-23T17:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 CET', '2026-11-23T08:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 UT', '2026-11-23T09:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 Z', '2026-11-23T09:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 +0100', '2026-11-23T08:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 -0500 (EST)', '2026-11-23T14:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40 GMT', '2026-11-23T09:40:00.000Z'],
    ['Mon, 23 Nov 26 09:40:00 GMT', '2026-11-23T09:40:00.000Z'],
    ['23 Nov 2026 09:40:00 +0000', '2026-11-23T09:40:00.000Z'],
    ['Monday, 23 November 2026 09:40:00 GMT', '2026-11-23T09:40:00.000Z'],
    ['Mon, 23 Nov 2026 09:40:00 XYZ', '2026-11-23T09:40:00.000Z'], // unknown zone name -> UTC
    ['23 Nov 2026', '2026-11-23T00:00:00.000Z'],
    ['23-Nov-2026', '2026-11-23T00:00:00.000Z'],
    ['Nov 23, 2026', '2026-11-23T00:00:00.000Z'],
    ['Sept 3, 2026', '2026-09-03T00:00:00.000Z'],
    ['November 23rd, 2026 at 9:40 PM PST', '2026-11-24T05:40:00.000Z'],
    ['November 23, 2026 12:15 AM', '2026-11-23T00:15:00.000Z'],
    ['Mon Nov 23 2026 09:40:00 GMT+0100 (Central European Standard Time)', '2026-11-23T08:40:00.000Z'],
  ])('%j -> %s', (input, expected) => {
    expect(iso(input)).toBe(expected);
  });

  it.each([
    'Tue, 31 Feb 2026 10:00:00 GMT',
    'Mon, 23 Foo 2026 09:40:00 GMT',
    'Mon, 23 Nov 2026 25:40:00 GMT',
    'Mon, 23 Nov 2026 09:40:00 +2500',
    'November 23, 2026 13:15 PM',
    'Mon, 23 Nov 1999 09:40:00 GMT',
  ])('rejects %j', (input) => {
    expect(iso(input)).toBeUndefined();
  });
});

describe('toIsoDate: relative phrases (relative to now)', () => {
  it.each([
    ['just now', '2026-11-24T12:00:00.000Z'],
    ['today', '2026-11-24T12:00:00.000Z'],
    ['Just posted', '2026-11-24T12:00:00.000Z'],
    ['yesterday', '2026-11-23T12:00:00.000Z'],
    ['Yesterday', '2026-11-23T12:00:00.000Z'],
    ['3 days ago', '2026-11-21T12:00:00.000Z'],
    ['1 day ago', '2026-11-23T12:00:00.000Z'],
    ['0 days ago', '2026-11-24T12:00:00.000Z'],
    ['30+ days ago', '2026-10-25T12:00:00.000Z'],
    ['30 days+ ago', '2026-10-25T12:00:00.000Z'],
    ['Posted 2w ago', '2026-11-10T12:00:00.000Z'],
    ['Posted: 5 days ago', '2026-11-19T12:00:00.000Z'],
    ['Reposted 3 days ago', '2026-11-21T12:00:00.000Z'],
    ['an hour ago', '2026-11-24T11:00:00.000Z'],
    ['24h ago', '2026-11-23T12:00:00.000Z'],
    ['5 mins ago', '2026-11-24T11:55:00.000Z'],
    ['about 1 month ago', '2026-10-25T12:00:00.000Z'],
    ['2 months ago', '2026-09-25T12:00:00.000Z'],
    ['1 year ago', '2025-11-24T12:00:00.000Z'],
    ['last week', '2026-11-17T12:00:00.000Z'],
    ['  3   DAYS   AGO  ', '2026-11-21T12:00:00.000Z'],
  ])('%j -> %s', (input, expected) => {
    expect(iso(input)).toBe(expected);
  });

  it.each(['in 3 days', '3 days', 'ago', 'some days ago', '100000 days ago', '9999 years ago', 'tomorrow', '3 fortnights ago'])(
    'rejects %j',
    (input) => {
      expect(iso(input)).toBeUndefined();
    },
  );
});

describe('toIsoDate: Date objects, bounds and garbage', () => {
  it('accepts valid Date objects and rejects invalid ones', () => {
    expect(iso(new Date('2026-11-20T00:00:00Z'))).toBe('2026-11-20T00:00:00.000Z');
    expect(iso(new Date('invalid'))).toBeUndefined();
    expect(iso(new Date('1999-01-01T00:00:00Z'))).toBeUndefined();
  });

  it('enforces the 2000 lower bound and the now + 2 days upper bound exactly', () => {
    expect(iso('2000-01-01T00:00:00Z')).toBe('2000-01-01T00:00:00.000Z');
    expect(iso('1999-12-31T23:59:59Z')).toBeUndefined();
    expect(iso('2026-11-26T12:00:00Z')).toBe('2026-11-26T12:00:00.000Z');
    expect(iso('2026-11-26T12:00:01Z')).toBeUndefined();
    expect(iso('2027-01-01')).toBeUndefined();
    expect(iso('2028-02-29')).toBeUndefined();
  });

  it.each([undefined, null, '', '   ', 'not a date', 'N/A', '-', 'TBD', '2026', 'Nov 2026', {}, [], true, Symbol('x')])(
    'returns undefined (without throwing) for %s',
    (input) => {
      expect(() => toIsoDate(input as never, NOW)).not.toThrow();
      expect(toIsoDate(input as never, NOW)).toBeUndefined();
    },
  );

  it('falls back to the real clock when now is invalid', () => {
    expect(toIsoDate('2026-11-20', new Date('invalid'))).toBe('2026-11-20T00:00:00.000Z');
  });

  it('defaults now to the current time', () => {
    const recent = new Date(Date.now() - 3600_000).toISOString();
    expect(toIsoDate(recent)).toBe(recent);
    expect(toIsoDate(new Date(Date.now() + 10 * 86_400_000))).toBeUndefined();
  });

  it('always returns a valid ISO string that round-trips', () => {
    const inputs = ['2026-11-23T09:40:00+01:00', 1795520405, 'Mon, 23 Nov 2026 09:40:00 EST', '3 days ago', '2026-11-19 14:03:22'];
    for (const input of inputs) {
      const out = iso(input);
      expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(out ?? '').toISOString()).toBe(out);
    }
  });
});

describe('toIsoDate: independent of the machine timezone', () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('gives identical results under very different TZ settings', () => {
    const inputs = [
      '2026-11-19 14:03:22', '2026-11-23', '2026-11-13T17:29:57', 'Nov 23, 2026', '23 Nov 2026', 'Mon, 23 Nov 2026 09:40:00 GMT',
      '23.11.2026', '2026/11/23', '20261123', 'November 23, 2026 12:15 AM', '3 days ago',
    ];
    const results = new Map<string, string>();
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      process.env.TZ = tz;
      const key = inputs.map((x) => iso(x) ?? 'undefined').join('|');
      results.set(tz, key);
    }
    expect(new Set(results.values()).size).toBe(1);
    expect(results.get('UTC')).toContain('2026-11-19T14:03:22.000Z');
  });
});

describe('daysAgo', () => {
  it('counts whole days and clamps the future to 0', () => {
    expect(daysAgo('2026-11-21T12:00:00.000Z', NOW)).toBe(3);
    expect(daysAgo('2026-11-21T12:00:01.000Z', NOW)).toBe(2);
    expect(daysAgo('2026-11-24T00:00:00.000Z', NOW)).toBe(0);
    expect(daysAgo('2026-11-25T00:00:00.000Z', NOW)).toBe(0);
    expect(daysAgo('garbage', NOW)).toBe(0);
  });

  it('composes with toIsoDate for "posted N days ago" display', () => {
    expect(daysAgo(toIsoDate('3 days ago', NOW) ?? '', NOW)).toBe(3);
    expect(daysAgo(toIsoDate('Mon, 23 Nov 2026 09:40:00 GMT', NOW) ?? '', NOW)).toBe(1);
  });
});
