import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, openDb, WAL_SIZE_LIMIT } from './index';

/** Every byte of the database's files on disk, as latin1 text for substring checks. */
function fileBytes(dbPath: string): string {
  return ['', '-wal', '-journal']
    .map((suffix) => (fs.existsSync(dbPath + suffix) ? fs.readFileSync(dbPath + suffix).toString('latin1') : ''))
    .join('');
}

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

  it('scrub() leaves no trace of deleted rows in the database files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jscout-db-'));
    try {
      const file = path.join(dir, 'jscout.db');
      const db = openDb(file);
      expect(db.scalar('PRAGMA secure_delete')).toBe(2);
      expect(db.scalar('PRAGMA journal_size_limit')).toBe(WAL_SIZE_LIMIT);
      db.run(`INSERT INTO settings (key, value) VALUES ('secret', '"sk-ant-SCRUBME123"')`);
      db.run(`INSERT INTO settings (key, value) VALUES ('notes', ?)`, 'Spoke to recruiter Zebedee Quiltwhistle'.repeat(500));
      db.exec('PRAGMA wal_checkpoint(PASSIVE)');
      db.run(`DELETE FROM settings`);
      expect(fileBytes(file)).toContain('sk-ant-SCRUBME123');
      expect(db.scrub({ vacuum: true })).toBe(true);
      const bytes = fileBytes(file);
      expect(bytes).not.toContain('sk-ant-SCRUBME123');
      expect(bytes).not.toContain('Zebedee Quiltwhistle');
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scrub() does nothing inside a transaction', () => {
    const db = openDb(':memory:');
    expect(db.tx(() => db.scrub({ vacuum: true }))).toBe(false);
    db.close();
  });

  it('migration 4 indexes the words of postings stored before it', () => {
    const db = openDb(':memory:');
    db.run(
      `INSERT INTO jobs (id, source, feed_key, external_id, url, title, title_core, company, company_key, cluster_key, location_text, description_html, first_seen_at, last_seen_at, content_hash)
       VALUES ('j1', 's', 's', 'e1', 'u', 'Business Intern', 'business intern', 'Acme', 'acme', 'c1', 'Berlin', '<p>International team</p>', 'x', 'x', 'h')`,
    );
    db.exec(`DROP TABLE jobs_words; DROP TABLE removed_feeds; PRAGMA user_version = 3`);
    migrate(db);
    const words = (expr: string) => db.all(`SELECT rowid FROM jobs_words WHERE jobs_words MATCH ?`, expr).length;
    expect(words('"intern"')).toBe(1);
    expect(words('"international"')).toBe(1);
    expect(words('"internal"')).toBe(0);
    db.close();
  });
});
