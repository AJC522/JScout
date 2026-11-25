import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { databaseProblem } from './startup-errors';

describe('databaseProblem', () => {
  it('names the file and the remedy for a damaged or newer database, and ignores other errors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jscout-startup-'));
    try {
      const file = path.join(dir, 'jscout.db');
      fs.writeFileSync(file, Buffer.alloc(20_000, 7));
      let err: unknown;
      try {
        openDb(file).close();
      } catch (e) {
        err = e;
      }
      const damaged = databaseProblem(err, file);
      expect(damaged).toContain(file);
      expect(damaged).toMatch(/damaged/);

      const newer = path.join(dir, 'newer.db');
      const db = openDb(newer);
      db.exec('PRAGMA user_version = 99');
      db.close();
      let err2: unknown;
      try {
        openDb(newer).close();
      } catch (e) {
        err2 = e;
      }
      expect(databaseProblem(err2, newer)).toMatch(/newer version of JScout[\s\S]*Update JScout/);
      expect(databaseProblem(new Error('boom'), file)).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
