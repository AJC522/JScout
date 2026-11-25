import { describe, expect, it } from 'vitest';
import { formatQuery, parseQuery } from './query-parse';

describe('parseQuery', () => {
  it('ANDs bare words and keeps quoted phrases', () => {
    expect(parseQuery('senior "machine learning" engineer')).toEqual({
      alternatives: [{ words: ['senior', 'engineer'], phrases: ['machine learning'] }],
      excluded: [],
    });
  });

  it('splits alternatives on commas, | and upper-case OR (lower-case "or" is a word)', () => {
    expect(parseQuery('product manager, program manager').alternatives).toEqual([
      { words: ['product', 'manager'], phrases: [] },
      { words: ['program', 'manager'], phrases: [] },
    ]);
    expect(parseQuery('react OR vue | angular').alternatives.map((a) => a.words)).toEqual([['react'], ['vue'], ['angular']]);
    expect(parseQuery('either or').alternatives[0]!.words).toEqual(['either', 'or']);
  });

  it('excludes words and phrases with a leading minus', () => {
    expect(parseQuery('engineer -senior -"team lead"')).toEqual({
      alternatives: [{ words: ['engineer'], phrases: [] }],
      excluded: ['senior', 'team lead'],
    });
  });

  it('keeps symbols that matter in tech words and drops pure punctuation', () => {
    expect(parseQuery('c++ c# .net node.js - & / ""').alternatives).toEqual([{ words: ['c++', 'c#', '.net', 'node.js'], phrases: [] }]);
  });

  it('copes with unclosed quotes, empty alternatives and duplicates', () => {
    expect(parseQuery('"data eng').alternatives).toEqual([{ words: [], phrases: ['data eng'] }]);
    expect(parseQuery(', ,python,, Python').alternatives).toEqual([{ words: ['python'], phrases: [] }, { words: ['Python'], phrases: [] }]);
    expect(parseQuery('go go GO').alternatives).toEqual([{ words: ['go'], phrases: [] }]);
    expect(parseQuery('   ')).toEqual({ alternatives: [], excluded: [] });
  });

  it('bounds what a pasted wall of text can produce', () => {
    const parsed = parseQuery(Array.from({ length: 30 }, (_, i) => `w${i}`).join(', '));
    expect(parsed.alternatives).toHaveLength(10);
    expect(parseQuery(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')).alternatives[0]!.words).toHaveLength(16);
  });
});

describe('formatQuery', () => {
  it('round-trips, optionally without exclusions', () => {
    const parsed = parseQuery('qa engineer, "test automation" -manual -"no remote"');
    expect(formatQuery(parsed, { withExclusions: true })).toBe('qa engineer, "test automation" -manual -"no remote"');
    expect(formatQuery(parsed, { withExclusions: false })).toBe('qa engineer, "test automation"');
    expect(parseQuery(formatQuery(parsed, { withExclusions: true }))).toEqual(parsed);
  });
});
