import { describe, expect, it } from 'vitest';
import { SourceError } from './types';
import { absoluteUrl, asNumber, asString, compactStrings, requireArray, requireRecord } from './util';

describe('source payload helpers', () => {
  it('reads strings and numbers defensively', () => {
    expect(asString('  hi ')).toBe('hi');
    expect(asString('')).toBeUndefined();
    expect(asString(42)).toBe('42');
    expect(asString(null)).toBeUndefined();
    expect(asNumber('120,000')).toBe(120000);
    expect(asNumber('12.5')).toBe(12.5);
    expect(asNumber('12k')).toBeUndefined();
    expect(asNumber(Number.NaN)).toBeUndefined();
  });

  it('compacts string lists', () => {
    expect(compactStrings([' a ', 'A', '', null, 'b', 3])).toEqual(['a', 'b', '3']);
  });

  it('only returns http(s) URLs', () => {
    expect(absoluteUrl('/jobs/1', 'https://example.com/x')).toBe('https://example.com/jobs/1');
    expect(absoluteUrl('javascript:alert(1)')).toBeUndefined();
    expect(absoluteUrl('not a url')).toBeUndefined();
    expect(absoluteUrl('https://example.com/a b')).toBe('https://example.com/a%20b');
  });

  it('throws parse errors for unexpected shapes', () => {
    expect(() => requireArray({}, 'jobs')).toThrow(SourceError);
    expect(() => requireRecord([], 'response')).toThrow(/expected an object/);
    expect(requireArray([1], 'jobs')).toEqual([1]);
  });
});
