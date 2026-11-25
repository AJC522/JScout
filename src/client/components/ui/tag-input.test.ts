import { describe, expect, it } from 'vitest';
import { hasTag, MAX_TAG_LENGTH, mergeTags, normalizeTag, splitTags, splitTyped } from './tag-input';
import { moveActiveIndex } from './listbox';

describe('normalizeTag', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTag('  React   Native ')).toBe('React Native');
    expect(normalizeTag('\tGo\n')).toBe('Go');
  });

  it('caps very long pieces', () => {
    expect(normalizeTag('x'.repeat(200))).toHaveLength(MAX_TAG_LENGTH);
  });
});

describe('splitTags', () => {
  it('splits pasted text on commas, semicolons, tabs and lines', () => {
    expect(splitTags('Python\nKubernetes, AWS; react\tGo')).toEqual(['Python', 'Kubernetes', 'AWS', 'react', 'Go']);
    expect(splitTags(' , ;\n')).toEqual([]);
    expect(splitTags('Windows\r\nmacOS')).toEqual(['Windows', 'macOS']);
  });
});

describe('splitTyped', () => {
  it('keeps the unfinished remainder in the box', () => {
    expect(splitTyped('go, rust, ty')).toEqual({ tags: ['go', 'rust'], rest: 'ty' });
    expect(splitTyped('go,')).toEqual({ tags: ['go'], rest: '' });
    expect(splitTyped('typescript')).toEqual({ tags: [], rest: 'typescript' });
    expect(splitTyped(', ,x')).toEqual({ tags: [], rest: 'x' });
  });
});

describe('mergeTags', () => {
  it('adds new tags and reports duplicates case-insensitively', () => {
    const result = mergeTags(['React'], ['react', 'Vue', ' vue ', ''], 10);
    expect(result.tags).toEqual(['React', 'Vue']);
    expect(result.added).toEqual(['Vue']);
    expect(result.duplicates).toEqual(['react', 'vue']);
    expect(result.overflow).toEqual([]);
  });

  it('stops at the maximum and reports the rest', () => {
    const result = mergeTags(['a', 'b'], ['c', 'd', 'e'], 3);
    expect(result.tags).toEqual(['a', 'b', 'c']);
    expect(result.overflow).toEqual(['d', 'e']);
  });

  it('does not modify the input array', () => {
    const existing = ['a'];
    mergeTags(existing, ['b']);
    expect(existing).toEqual(['a']);
  });

  it('hasTag ignores case and spacing', () => {
    expect(hasTag(['Node.js'], ' node.JS ')).toBe(true);
    expect(hasTag(['Node.js'], 'Node')).toBe(false);
  });
});

describe('moveActiveIndex', () => {
  it('wraps in both directions and starts from the ends', () => {
    expect(moveActiveIndex(-1, 1, 3)).toBe(0);
    expect(moveActiveIndex(-1, -1, 3)).toBe(2);
    expect(moveActiveIndex(2, 1, 3)).toBe(0);
    expect(moveActiveIndex(0, -1, 3)).toBe(2);
    expect(moveActiveIndex(1, 1, 3)).toBe(2);
    expect(moveActiveIndex(0, 1, 0)).toBe(-1);
  });
});
