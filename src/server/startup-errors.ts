/**
 * Plain-language explanations for failures while opening the database at startup, which otherwise
 * end in a stack trace that names neither the file nor what to do about it.
 */

/** SQLite primary result codes (the low byte of an extended code). */
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_READONLY = 8;
const SQLITE_CORRUPT = 11;
const SQLITE_FULL = 13;
const SQLITE_CANTOPEN = 14;
const SQLITE_NOTADB = 26;

/** What to tell the user when opening the database at `dbPath` failed with `err`; undefined when it is not a database problem. */
export function databaseProblem(err: unknown, dbPath: string): string | undefined {
  const e = (err ?? {}) as { code?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  if (/newer version of JScout/.test(message)) {
    return `${message}\n  Update JScout and start it again, or set JSCOUT_DATA_DIR to use another data folder.\n  Database: ${dbPath}`;
  }
  if (e.code !== 'ERR_SQLITE_ERROR') return undefined;
  const code = typeof e.errcode === 'number' ? e.errcode & 0xff : undefined;
  const detail = typeof e.errstr === 'string' && e.errstr ? e.errstr : message;
  switch (code) {
    case SQLITE_NOTADB:
    case SQLITE_CORRUPT:
      return (
        `JScout's database is damaged or is not a JScout database (${detail}):\n  ${dbPath}\n` +
        '  Restore it from a backup, or move it (with any -wal and -shm files next to it) out of the folder;\n' +
        '  JScout then starts with an empty database.'
      );
    case SQLITE_BUSY:
    case SQLITE_LOCKED:
      return `JScout's database is in use by another program. Is JScout already running?\n  ${dbPath}`;
    case SQLITE_READONLY:
    case SQLITE_CANTOPEN:
      return `JScout cannot open or write its database (${detail}). Check that the folder exists and that you can write to it:\n  ${dbPath}`;
    case SQLITE_FULL:
      return `The disk is full, so JScout cannot write its database. Free some space and start again.\n  ${dbPath}`;
    default:
      return `JScout could not open its database (${detail}):\n  ${dbPath}`;
  }
}
