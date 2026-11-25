import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ftsScope, ftsString } from './fts';
import { isTitleQuery, understandQuery } from './understand';
import { parseQuery } from './query-parse';

describe('title detection', () => {
  it('recognises job titles by taxonomy role or a title head noun, and keyword searches otherwise', () => {
    for (const q of ['software engineer', 'Registered Nurse', 'rust developer', 'night shift cooks', 'swe', 'product manager, program manager']) {
      expect(isTitleQuery(parseQuery(q)), q).toBe(true);
    }
    for (const q of ['python', 'react remote', 'kubernetes', 'machine learning', 'software engineer, kubernetes', '']) {
      expect(isTitleQuery(parseQuery(q)), q).toBe(false);
    }
  });

  it('an explicit titleOnly wins', () => {
    expect(understandQuery({ q: 'python', titleOnly: true }).titleOnly).toBe(true);
    expect(understandQuery({ q: 'software engineer', titleOnly: false }).titleOnly).toBe(false);
  });
});

describe('understandQuery', () => {
  it('expands a recognised role with its synonyms and keeps the other words required', () => {
    const u = understandQuery({ q: 'senior software engineer' });
    expect(u.role?.id).toBe('software-engineer');
    expect(u.terms).toEqual(['software engineer', 'senior']);
    expect(u.titles[0]).toEqual({ title: 'Software Engineer', via: 'query', roleId: 'software-engineer' });
    expect(u.titles.filter((t) => t.via === 'synonym').map((t) => t.title)).toEqual(expect.arrayContaining(['Software Developer', 'SWE']));
    expect(u.match).toMatch(/^title : \(\(\("senior" OR "sr"\) AND \("software engineer" OR "software developer"/);
  });

  it('drops synonyms when asked, and ORs opted-in related roles into the title group', () => {
    expect(understandQuery({ q: 'software engineer', synonyms: false }).titles.map((t) => t.via)).toEqual(['query']);
    const u = understandQuery({ q: 'software engineer', synonyms: false, relatedRoles: ['backend-engineer', 'no-such-role'] });
    expect(u.titles.filter((t) => t.via === 'related')[0]).toEqual({ title: 'Backend Engineer', via: 'related', roleId: 'backend-engineer' });
    expect(u.match).toContain('"backend engineer"');
    // Keyword searches get related roles as one more (title-only) alternative.
    expect(understandQuery({ q: 'python', relatedRoles: ['backend-engineer'] }).match).toMatch(/^\("python" OR title : \(/);
  });

  it('scopes exclusions: q exclusions follow the search, excludeTerms cover title and description', () => {
    expect(understandQuery({ q: 'nurse -travel' }).exclude).toBe('title : ("travel")');
    expect(understandQuery({ q: 'software engineer -senior' }).exclude).toBe('title : (("senior" OR "sr"))');
    expect(understandQuery({ q: 'python -django', excludeTerms: ['clearance'] }).exclude).toBe('("django" OR {title body} : ("clearance"))');
    expect(understandQuery({ q: '', excludeTerms: ['unpaid'] })).toMatchObject({ match: undefined, excluded: ['unpaid'] });
  });

  it('only ever produces valid FTS5 syntax, whatever is typed', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE VIRTUAL TABLE f USING fts5(title, company, location, tags, body, tokenize = "porter unicode61 remove_diacritics 2 tokenchars '+#'")`);
    db.prepare('INSERT INTO f VALUES (?, ?, ?, ?, ?)').run('Senior C# Developer', 'Acme', 'Austin TX', 'C#, .NET', 'node.js and c++');
    const match = (expr: string) => db.prepare('SELECT count(*) AS n FROM f WHERE f MATCH ?').get(expr) as { n: number };
    const nasty = ['"', 'a"b', 'title:x', '{title}:x', 'NEAR(a b)', '^x', 'x*', '(', ')', 'AND', 'NOT', '-', '+', ':', '😀', 'col:"x"', 'OR OR', '"" -""'];
    for (const q of nasty) {
      const u = understandQuery({ q, excludeTerms: [q] });
      for (const expr of [u.match, u.exclude]) if (expr) expect(() => match(expr), `${q} -> ${expr}`).not.toThrow();
    }
    for (const q of ['c#', 'C#', '.net', 'node.js', 'c++']) expect(match(understandQuery({ q }).match!).n, q).toBe(1);
    expect(match(ftsScope(['title', 'body'], ftsString('say "hi"'))).n).toBe(0);
  });
});
