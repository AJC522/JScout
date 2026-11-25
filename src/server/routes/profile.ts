import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DataExport, DataImportResult, Ok } from '../../shared/api';
import { RESUME_FILE_PATH, RESUME_UPLOAD_PATH } from '../../shared/api';
import { RESUME_MIME_TYPES, emptyProfile } from '../../shared/constants';
import { ApiError, badRequest, notFound } from '../errors';
import { withDefaults } from '../features/profile/normalize';
import { resumeTooLarge } from '../features/profile/resume-file';
import { dataImportSchema, dataResetSchema, profilePatchSchema, resumeTextSchema } from '../features/profile/schemas';
import { clearAllSettings } from '../features/settings/service';
import type { AppContext } from '../services';
import { parse } from '../validate';

/** RFC 6266 attachment header: an ASCII fallback name plus the exact UTF-8 name. */
function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]|["\\%]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** The single "file" part of a multipart résumé upload. Unreadable or oversized uploads are 4xx errors. */
async function readUpload(request: FastifyRequest): Promise<{ fileName: string; mimeType: string; bytes: Buffer }> {
  if (!request.isMultipart()) throw badRequest('Upload the résumé as a form with a "file" field.');
  try {
    const part = await request.file();
    if (!part) throw badRequest('Choose a résumé file to upload.');
    if (part.fieldname !== 'file') {
      part.file.resume();
      throw badRequest('Send the résumé in a form field named "file".');
    }
    return { fileName: part.filename, mimeType: part.mimetype, bytes: await part.toBuffer() };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE') throw resumeTooLarge();
    throw badRequest('The upload could not be read. Choose the file again and retry.');
  }
}

/** Profile, résumé, quick-fill, data export/import/reset. */
export function registerProfileRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Read services through ctx.services at request time (tests swap them after the app is built).
  const s = ctx.services;

  app.get('/api/profile', async () => s.profile.get());

  app.patch('/api/profile', async (request) => s.profile.patch(parse(profilePatchSchema, request.body)));

  app.get('/api/profile/completeness', async () => s.profile.completeness());

  app.post(RESUME_UPLOAD_PATH, async (request) => s.profile.setResumeFile(await readUpload(request)));

  app.put('/api/profile/resume/text', async (request) => s.profile.setResumeText(parse(resumeTextSchema, request.body).text));

  app.get('/api/profile/resume/analysis', async () => s.profile.analyzeResume());

  app.get(RESUME_FILE_PATH, async (_request, reply) => {
    const file = s.profile.resumeFile();
    if (!file) throw notFound('The original résumé file');
    const known = (RESUME_MIME_TYPES as readonly string[]).includes(file.mimeType);
    const type = !known ? 'application/octet-stream' : file.mimeType.startsWith('text/') ? `${file.mimeType}; charset=utf-8` : file.mimeType;
    return reply
      .header('Content-Type', type)
      .header('Content-Disposition', attachment(file.fileName))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store')
      .send(file.bytes);
  });

  app.delete('/api/profile/resume', async () => s.profile.deleteResume());

  app.get('/api/profile/quick-fill', async () => s.profile.quickFill());

  // The original résumé file is not exported; its text is, as part of the profile.
  app.get('/api/data/export', async (_request, reply): Promise<DataExport> => {
    reply.header('Cache-Control', 'no-store');
    return {
      app: 'jscout',
      formatVersion: 1,
      exportedAt: ctx.now().toISOString(),
      profile: s.profile.get(),
      savedSearches: s.savedSearches.exportAll(),
      applications: s.applications.exportAll(),
      userCompanies: s.companies.exportUser(),
      hiddenJobs: s.userState.exportHidden(),
    };
  });

  app.post('/api/data/import', async (request): Promise<DataImportResult> => {
    const data = parse(dataImportSchema, request.body);
    // The applications service normalises its own (versioned) import format, so it gets the items as
    // sent; they have just passed that service's schema as part of dataImportSchema.
    const applications = (request.body as Partial<DataExport>).applications ?? [];
    const profile = withDefaults(data.profile, ctx.now().toISOString());
    return ctx.db.tx(() => {
      s.profile.replace(profile);
      return {
        profile: true,
        savedSearches: s.savedSearches.importAll(data.savedSearches),
        applications: s.applications.importAll(applications),
        userCompanies: s.companies.importUser(data.userCompanies),
        hiddenJobs: s.userState.importHidden(data.hiddenJobs),
      };
    });
  });

  app.post('/api/data/reset', async (request): Promise<Ok> => {
    const { scope } = parse(dataResetSchema, request.body);
    ctx.db.tx(() => {
      s.jobs.clear();
      ctx.db.run('DELETE FROM sync_state');
      if (scope === 'everything') {
        s.profile.replace(emptyProfile(ctx.now().toISOString()));
        s.savedSearches.clear();
        s.applications.clear();
        s.userState.clear();
        s.search.clearHistory();
        ctx.db.run("DELETE FROM companies WHERE origin = 'user'");
        ctx.db.run("UPDATE companies SET enabled = 0 WHERE origin = 'seed'");
        clearAllSettings(ctx);
      }
    });
    // The reset is committed; failing to notify open tabs must not report it as failed.
    try {
      ctx.events.publish({ type: 'index-changed', index: s.sync.summary() });
    } catch (err) {
      ctx.log.warn('Could not announce the index reset', { err });
    }
    return { ok: true };
  });
}
