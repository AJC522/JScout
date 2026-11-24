import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { MIGRATIONS } from './schema';

export type SqlValue = SQLInputValue;
export type Row = Record<string, unknown>;

/**
 * Thin wrapper over node:sqlite's synchronous API.
 *
 * - Statements are prepared once and cached by SQL text.
 * - `tx` runs a function inside a transaction (nested calls use savepoints).
 * - Everything is synchronous; keep individual transactions small enough not
 *   to stall the event loop (ingest in batches of a few hundred rows).
 */
export class Db {
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;

  constructor(filename: string) {
    this.raw = new DatabaseSync(filename);
    this.raw.exec('PRAGMA foreign_keys = ON');
    if (filename !== ':memory:') {
      this.raw.exec('PRAGMA journal_mode = WAL');
      this.raw.exec('PRAGMA synchronous = NORMAL');
    }
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.raw.exec('PRAGMA temp_store = MEMORY');
    this.raw.exec('PRAGMA cache_size = -64000');
  }

  private prepare(sql: string): StatementSync {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  /** Run a statement that returns no rows. */
  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    const r = this.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  /** First row or undefined. */
  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  /** Single value from the first column of the first row. */
  scalar<T = unknown>(sql: string, ...params: SqlValue[]): T | undefined {
    const row = this.prepare(sql).get(...params) as Row | undefined;
    if (!row) return undefined;
    const first = Object.keys(row)[0];
    return first === undefined ? undefined : (row[first] as T);
  }

  /** Execute raw SQL (multiple statements allowed, no params). */
  exec(sql: string): void {
    this.raw.exec(sql);
  }

  tx<T>(fn: () => T): T {
    const name = `sp_${this.depth}`;
    if (this.depth === 0) this.raw.exec('BEGIN IMMEDIATE');
    else this.raw.exec(`SAVEPOINT ${name}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      if (this.depth === 0) this.raw.exec('COMMIT');
      else this.raw.exec(`RELEASE ${name}`);
      return result;
    } catch (err) {
      this.depth--;
      if (this.depth === 0) this.raw.exec('ROLLBACK');
      else this.raw.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
      throw err;
    }
  }

  close(): void {
    this.statements.clear();
    this.raw.close();
  }
}

export function migrate(db: Db): void {
  const current = Number(db.scalar<number>('PRAGMA user_version') ?? 0);
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Database is from a newer version of JScout (schema ${current}, this build knows ${MIGRATIONS.length}).`,
    );
  }
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.tx(() => {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

/** Open (creating if needed) and migrate the database. Use ':memory:' in tests. */
export function openDb(filename: string): Db {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Db(filename);
  if (filename !== ':memory:') {
    // The database holds personal data and API keys: keep it readable by the owner only (no-op on Windows).
    try {
      fs.chmodSync(filename, 0o600);
    } catch {
      /* best effort */
    }
  }
  migrate(db);
  return db;
}

/** Parse a JSON column, falling back when it is empty or malformed. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** `?, ?, ?` for an IN list of the given length. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
