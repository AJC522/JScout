import type { ProfilePatch, ResumeResult } from '../../../shared/api';
import type { Profile, ResumeInfo } from '../../../shared/types';
import { type Db, parseJson } from '../../db';
import { badRequest } from '../../errors';
import { extractSkills } from '../../lib/skills';
import { uniqueFolded } from '../../lib/text';
import type { AppContext, ProfileService } from '../../services';
import { computeCompleteness } from './completeness';
import { normalizeProfile, withDefaults } from './normalize';
import { buildQuickFill } from './quick-fill';
import { analyzeResumeText } from './resume-analysis';
import {
  RESUME_MIME,
  detectResumeKind,
  extractResumeText,
  normalizeResumeText,
  resumeMimeType,
  sanitizeFileName,
} from './resume-file';
import { deleteResumeFile, readResumeFile, writeResumeFile } from './resume-store';

const PASTED_NAME = 'Pasted résumé';

/**
 * A profile written inside a transaction must not be cached: it may still roll back (a failed data
 * import). Node versions without `isTransaction` are treated as always inside one (uncached).
 */
const inTransaction = (db: Db): boolean => db.raw.isTransaction ?? true;

/** Whether two résumé records describe the same upload (used to keep the stored file across a data import). */
const sameResume = (a: ResumeInfo | null, b: ResumeInfo | null) =>
  !!a && !!b && a.fileName === b.fileName && a.mimeType === b.mimeType && a.sizeBytes === b.sizeBytes && a.text === b.text;

/**
 * Other services are available on `ctx.services` but may not exist yet while
 * this factory runs: read them lazily inside methods, never at construction.
 */
export function createProfileService(ctx: AppContext): ProfileService {
  const { db } = ctx;
  const nowIso = () => ctx.now().toISOString();
  // Parsed profile, shared by every read until the next write. Callers get copies.
  let cached: Profile | undefined;
  // Skills found in the résumé text (recomputed only when the text changes) and the merged list per profile version.
  let resumeSkills: { text: string; skills: string[] } | undefined;
  let effective: { profile: Profile; skills: string[] } | undefined;

  function load(): Profile {
    if (cached) return cached;
    const raw = db.scalar<string>("SELECT data FROM profile WHERE id = 'default'");
    const profile = withDefaults(parseJson<unknown>(raw, undefined), nowIso());
    if (!inTransaction(db)) cached = profile;
    return profile;
  }

  function save(profile: Profile): Profile {
    const json = JSON.stringify(profile);
    db.run(
      `INSERT INTO profile (id, data, updated_at) VALUES ('default', ?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      json,
      profile.updatedAt,
    );
    const saved = JSON.parse(json) as Profile;
    cached = inTransaction(db) ? undefined : saved;
    return structuredClone(saved);
  }

  function setResume(resume: ResumeInfo | null): Profile {
    const current = load();
    return save({ ...current, resume, updatedAt: nowIso() });
  }

  function resumeResult(profile: Profile): ResumeResult {
    return { resume: profile.resume!, analysis: analyzeResume() };
  }

  function analyzeResume() {
    const resume = load().resume;
    return analyzeResumeText(resume?.text ?? '', { now: ctx.now(), mimeType: resume?.mimeType });
  }

  return {
    get: () => structuredClone(load()),

    patch(patch: ProfilePatch): Profile {
      const previous = load();
      const merged: Profile = {
        ...previous,
        personal: { ...previous.personal, ...patch.personal },
        work: { ...previous.work, ...patch.work },
        preferences: { ...previous.preferences, ...patch.preferences },
        experience: patch.experience ?? previous.experience,
        education: patch.education ?? previous.education,
        answers: patch.answers ?? previous.answers,
        onboardedAt: patch.onboardedAt === undefined ? previous.onboardedAt : patch.onboardedAt,
      };
      return save(normalizeProfile(merged, { now: nowIso(), previous, mode: 'reject' }));
    },

    replace(profile: Profile): Profile {
      const previous = load();
      const now = nowIso();
      const incoming = withDefaults(profile, now);
      // The original upload is not part of a backup: keep the stored file only if it is the same résumé.
      let resume = incoming.resume;
      if (resume) resume = { ...resume, hasFile: resume.hasFile && sameResume(previous.resume, resume) && previous.resume!.hasFile };
      if (!resume?.hasFile) deleteResumeFile(ctx.config.dataDir);
      return save({ ...normalizeProfile(incoming, { now, mode: 'import' }), resume });
    },

    completeness: () => computeCompleteness(load()),

    effectiveSkills(): string[] {
      const profile = load();
      if (effective?.profile !== profile) {
        const text = profile.resume?.text ?? '';
        if (resumeSkills?.text !== text) resumeSkills = { text, skills: text ? extractSkills(text) : [] };
        // All lists are canonical already: preferences are canonicalised on write, extractSkills returns canonical names.
        // Certifications count as skills too: postings list them among their skills ("CompTIA Security+", "PMP").
        const { skills, certifications } = profile.preferences;
        effective = { profile, skills: uniqueFolded([...skills, ...certifications, ...resumeSkills.skills]) };
      }
      return [...effective.skills];
    },

    resumeText: () => load().resume?.text ?? '',

    async setResumeFile({ fileName, bytes }): Promise<ResumeResult> {
      const kind = detectResumeKind(fileName, bytes);
      const text = normalizeResumeText(await extractResumeText(kind, bytes));
      writeResumeFile(ctx.config.dataDir, bytes);
      const profile = setResume({
        fileName: sanitizeFileName(fileName, kind),
        mimeType: resumeMimeType(kind, fileName),
        text,
        updatedAt: nowIso(),
        sizeBytes: bytes.length,
        hasFile: true,
      });
      return resumeResult(profile);
    },

    setResumeText(raw: string): ResumeResult {
      const text = normalizeResumeText(raw);
      if (!text) throw badRequest('Paste the text of your résumé first.');
      deleteResumeFile(ctx.config.dataDir);
      const profile = setResume({
        fileName: PASTED_NAME,
        mimeType: RESUME_MIME.text,
        text,
        updatedAt: nowIso(),
        sizeBytes: 0,
        hasFile: false,
      });
      return resumeResult(profile);
    },

    analyzeResume,

    resumeFile() {
      const resume = load().resume;
      if (!resume?.hasFile) return undefined;
      const bytes = readResumeFile(ctx.config.dataDir);
      return bytes ? { fileName: resume.fileName, mimeType: resume.mimeType, bytes } : undefined;
    },

    deleteResume(): Profile {
      deleteResumeFile(ctx.config.dataDir);
      return setResume(null);
    },

    quickFill: () => buildQuickFill(load()),
  };
}
