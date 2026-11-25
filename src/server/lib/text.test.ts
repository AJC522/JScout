import { describe, expect, it } from 'vitest';
import { companyKey, foldText, normalizeText, stableHash, tokenize, truncate, uniqueFolded } from './text';

describe('text', () => {
  it('folds diacritics and special letters', () => {
    expect(foldText('São Paulo')).toBe('sao paulo');
    expect(foldText('München')).toBe('munchen');
    expect(foldText('Straße Łódź København')).toBe('strasse lodz kobenhavn');
  });

  it('normalises punctuation but keeps + and #', () => {
    expect(normalizeText('Sr. Software Engineer (C++/C#)')).toBe('sr software engineer c++ c#');
    expect(tokenize('  Full-Stack  Developer, Node.js ')).toEqual(['full', 'stack', 'developer', 'node', 'js']);
    expect(tokenize('')).toEqual([]);
  });

  it('builds company keys that ignore legal suffixes', () => {
    expect(companyKey('Stripe, Inc.')).toBe('stripe');
    expect(companyKey('stripe')).toBe('stripe');
    expect(companyKey('The Trade Desk')).toBe('trade desk');
    expect(companyKey('Zalando SE')).toBe('zalando');
    expect(companyKey('Johnson & Johnson')).toBe('johnson and johnson');
    expect(companyKey('Co')).toBe('co');
    expect(companyKey('The Company Group Ltd')).toBe('company');
  });

  it('hashes stably and distinguishes part boundaries', () => {
    expect(stableHash('a', 'b')).toBe(stableHash('a', 'b'));
    expect(stableHash('ab', '')).not.toBe(stableHash('a', 'b'));
    expect(stableHash('x')).toHaveLength(20);
  });

  it('truncates on word boundaries and dedupes case-insensitively', () => {
    expect(truncate('hello wonderful world', 15)).toBe('hello wonderful…');
    expect(truncate('short', 15)).toBe('short');
    expect(uniqueFolded(['React', 'react ', 'Résumé', 'resume', '', 'Go'])).toEqual(['React', 'Résumé', 'Go']);
  });
});
