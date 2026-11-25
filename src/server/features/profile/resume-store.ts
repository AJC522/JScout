/** The original résumé upload, kept as a single owner-only file under <dataDir>/resume/. */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'original';

const resumePath = (dataDir: string) => path.join(dataDir, 'resume', FILE_NAME);

/** Write (replacing any previous upload) atomically, readable by the owner only. */
export function writeResumeFile(dataDir: string, bytes: Buffer): void {
  const dir = path.join(dataDir, 'resume');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${FILE_NAME}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    fs.renameSync(tmp, resumePath(dataDir));
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** The stored bytes, or undefined when there is no file. */
export function readResumeFile(dataDir: string): Buffer | undefined {
  try {
    return fs.readFileSync(resumePath(dataDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export function deleteResumeFile(dataDir: string): void {
  fs.rmSync(resumePath(dataDir), { force: true });
}
