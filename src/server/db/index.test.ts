import { describe, expect, it } from 'vitest';
import { openDb } from './index';

describe('db', () => {
  it('migrates a fresh database and supports FTS5 with bm25', () => {
    const db = openDb(':memory:');
    expect(db.scalar<number>('PRAGMA user_version')).toBeGreaterThan(0);
    db.run(
      `INSERT INTO jobs_fts (rowid, title, company, location, tags, body) VALUES (?, ?, ?, ?, ?, ?)`,
      1,
      'Senior Software Engineer',
      'Acme',
      'Austin, TX',
      'c++ c# typescript',
      'Build things with C++ and engineers.',
    );
    const hit = db.get<{ rowid: number; score: number }>(
      `SELECT rowid, bm25(jobs_fts, 10, 4, 1, 3, 1) AS score FROM jobs_fts WHERE jobs_fts MATCH ?`,
      'title:engineering',
    );
    expect(hit?.rowid).toBe(1);
    expect(db.get(`SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ?`, '"c++"')).toBeTruthy();
    db.run(`DELETE FROM jobs_fts WHERE rowid = ?`, 1);
    expect(db.get(`SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ?`, 'acme')).toBeUndefined();
    db.close();
  });

  it('rolls back failed transactions, including nested ones', () => {
    const db = openDb(':memory:');
    db.run(`INSERT INTO settings (key, value) VALUES ('a', '1')`);
    expect(() =>
      db.tx(() => {
        db.run(`INSERT INTO settings (key, value) VALUES ('b', '2')`);
        db.tx(() => {
          db.run(`INSERT INTO settings (key, value) VALUES ('c', '3')`);
        });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.all(`SELECT key FROM settings`).length).toBe(1);
    db.tx(() => {
      db.run(`INSERT INTO settings (key, value) VALUES ('b', '2')`);
      try {
        db.tx(() => {
          db.run(`INSERT INTO settings (key, value) VALUES ('c', '3')`);
          throw new Error('inner');
        });
      } catch {
        /* inner rolled back, outer continues */
      }
    });
    expect(db.all<{ key: string }>(`SELECT key FROM settings ORDER BY key`).map((r) => r.key)).toEqual(['a', 'b']);
    db.close();
  });
});
