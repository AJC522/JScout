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

  it('recognises a role typed in the plural, and searches the title index in the singular too', () => {
    const u = understandQuery({ q: 'registered nurses' });
    expect(u.role?.id).toBe('registered-nurse');
    expect(u.exact).toContain('"registered nurse"*');
    expect(understandQuery({ q: 'night shift cooks', synonyms: false }).exact).toBe('title : (("night"* AND "shift"* AND "cook"*))');
    expect(understandQuery({ q: 'technology', titleOnly: true, synonyms: false }).exact).toBe('title : (("technology"* OR "technologies"*))');
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
    expect(understandQuery({ q: 'nurse -travel' }).exclusions).toEqual([{ title: '("travel" OR "travels")' }]);
    expect(understandQuery({ q: 'software engineer -senior' }).exclusions).toEqual([{ title: '(("senior" OR "seniors") OR "sr")' }]);
    expect(understandQuery({ q: 'python -django', excludeTerms: ['clearance', 'sales managers', '  '] }).exclusions).toEqual([
      { fts: '"django"', words: '("django" OR "djangos")' },
      { fts: '{title body} : ("clearance")', words: '("clearance" OR "clearances")' },
      { fts: '{title body} : ("sales managers")', words: '("sales" AND ("managers" OR "manager"))' },
    ]);
    expect(understandQuery({ q: '', excludeTerms: ['unpaid'] })).toMatchObject({ match: undefined, excluded: ['unpaid'] });
  });

  it('only ever produces valid FTS5 syntax, whatever is typed', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE VIRTUAL TABLE f USING fts5(title, company, location, tags, body, tokenize = "porter unicode61 remove_diacritics 2 tokenchars '+#'")`);
    db.exec(`CREATE VIRTUAL TABLE w USING fts5(text, detail = none, tokenize = "unicode61 remove_diacritics 2 tokenchars '+#'")`);
    db.exec(`CREATE VIRTUAL TABLE t USING fts5(title, tokenize = "unicode61 remove_diacritics 2 tokenchars '+#'")`);
    db.prepare('INSERT INTO f VALUES (?, ?, ?, ?, ?)').run('Senior C# Developer', 'Acme', 'Austin TX', 'C#, .NET', 'node.js and c++');
    const match = (expr: string, table = 'f') => db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${table} MATCH ?`).get(expr) as { n: number };
    const nasty = ['"', 'a"b', 'title:x', '{title}:x', 'NEAR(a b)', '^x', 'x*', '(', ')', 'AND', 'NOT', '-', '+', ':', '😀', 'col:"x"', 'OR OR', '"" -""', 'node.js', 'São Paulo', 'c++/c#'];
    for (const q of nasty) {
      for (const titleOnly of [false, true]) {
        const u = understandQuery({ q: `${q} -${q} -"${q}"`, excludeTerms: [q], titleOnly });
        if (u.match) expect(() => match(u.match!), `${q} -> ${u.match}`).not.toThrow();
        for (const e of u.exclusions) {
          for (const [expr, table] of [[e.fts, 'f'], [e.words, 'w'], [e.title, 't']] as const) {
            if (expr) expect(() => match(expr, table), `${q} -> ${expr}`).not.toThrow();
          }
        }
      }
    }
    for (const q of ['c#', 'C#', '.net', 'node.js', 'c++']) expect(match(understandQuery({ q }).match!).n, q).toBe(1);
    expect(match(ftsScope(['title', 'body'], ftsString('say "hi"'))).n).toBe(0);
  });
});
