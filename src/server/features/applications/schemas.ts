/** zod schemas for the tracker's HTTP bodies and for imported backups. */
import { z } from 'zod';
import { applicationStatusSchema, employmentTypeSchema, isoDateSchema, remoteModeSchema } from '../../../shared/schemas';

export const NOTES_MAX = 20_000;
export const DOCUMENT_CONTENT_MAX = 100_000;
export const TITLE_MAX = 200;
/** Pasted job descriptions can be long; sanitizeHtml caps its own input far above this. */
export const DESCRIPTION_MAX = 200_000;

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => text(max).min(1);
/** '' clears the field; anything else must be an http(s) URL. */
const urlOrEmpty = text(2000).refine((s) => s === '' || isHttpUrl(s), 'must be an http(s) URL');

const snapshotFields = {
  title: required(TITLE_MAX),
  company: required(TITLE_MAX),
  locationText: text(200),
  remote: remoteModeSchema,
  url: urlOrEmpty,
  applyUrl: urlOrEmpty,
  source: text(60),
  sourceName: text(100),
  salaryText: text(120),
  employmentType: employmentTypeSchema,
  postedAt: isoDateSchema,
  skills: z.array(required(80)).max(100),
  descriptionHtml: z.string().max(DESCRIPTION_MAX),
};

/** A job typed in by hand: title and company are required, everything else optional. */
export const manualJobSchema = z.strictObject(snapshotFields).partial().required({ title: true, company: true });

/** Partial edits to an application's job snapshot. */
export const jobSnapshotPatchSchema = z.strictObject(snapshotFields).partial();

const notesSchema = z.string().max(NOTES_MAX);

/** Ids are optional on input ('' or missing = new entry); the service assigns them. */
export const contactSchema = z.strictObject({
  id: text(100).default(''),
  name: text(200).default(''),
  role: text(200).default(''),
  email: text(320).default(''),
  phone: text(60).default(''),
  linkedin: text(500).default(''),
  notes: z.string().max(5000).default(''),
});

export const checklistItemSchema = z.strictObject({
  id: text(100).default(''),
  label: required(200),
  done: z.boolean().default(false),
});

const prioritySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const applicationCreateSchema = z
  .strictObject({
    jobId: required(200).optional(),
    job: manualJobSchema.optional(),
    status: applicationStatusSchema.optional(),
    notes: notesSchema.optional(),
  })
  .refine((v) => (v.jobId === undefined) !== (v.job === undefined), 'Provide either jobId or job details (not both)');

export const applicationPatchSchema = z.strictObject({
  status: applicationStatusSchema.optional(),
  notes: notesSchema.optional(),
  priority: prioritySchema.optional(),
  contacts: z.array(contactSchema).max(50).optional(),
  checklist: z.array(checklistItemSchema).max(100).optional(),
  followUpAt: isoDateSchema.nullable().optional(),
  appliedAt: isoDateSchema.nullable().optional(),
  sortOrder: z.number().min(-1e12).max(1e12).optional(),
  job: jobSnapshotPatchSchema.optional(),
});

export const applicationEventTypeSchema = z.enum(['created', 'status', 'note', 'interview', 'follow-up', 'document', 'contact']);
export const documentKindSchema = z.enum(['cover-letter', 'answer', 'resume', 'resume-notes', 'email', 'other']);
export const generatedBySchema = z.enum(['manual', 'template', 'ai']);

export const eventCreateSchema = z.strictObject({
  type: applicationEventTypeSchema,
  title: required(TITLE_MAX),
  detail: notesSchema.optional(),
  at: isoDateSchema.optional(),
});

export const documentCreateSchema = z.strictObject({
  kind: documentKindSchema,
  title: required(TITLE_MAX),
  content: z.string().max(DOCUMENT_CONTENT_MAX),
  generatedBy: generatedBySchema,
});

export const documentPatchSchema = z.strictObject({
  title: required(TITLE_MAX).optional(),
  content: z.string().max(DOCUMENT_CONTENT_MAX).optional(),
});

/** Query strings may carry extra keys (cache busters); they are ignored. */
export const applicationListQuerySchema = z.object({
  status: applicationStatusSchema.optional(),
  q: text(200).optional(),
});

const idSchema = required(200);
export const idParamsSchema = z.object({ id: idSchema });
export const eventParamsSchema = z.object({ id: idSchema, eventId: idSchema });
export const documentParamsSchema = z.object({ id: idSchema, docId: idSchema });

// --- backups -----------------------------------------------------------------------
// Imports come from a file on disk, possibly written by another JScout version or edited
// by hand: unknown keys are dropped, missing optional values get defaults, and a URL
// that is not http(s) is dropped rather than failing the whole import.

const importedUrl = z
  .string()
  .max(2000)
  .transform((s) => (isHttpUrl(s.trim()) ? s.trim() : ''));

const importedSnapshotSchema = z.object({
  title: required(TITLE_MAX),
  company: required(TITLE_MAX),
  locationText: text(200).default(''),
  remote: remoteModeSchema.catch('unknown'),
  url: importedUrl.default(''),
  applyUrl: importedUrl.optional(),
  source: text(60).default('manual'),
  sourceName: text(100).default(''),
  salaryText: text(120).optional(),
  employmentType: employmentTypeSchema.catch('unknown'),
  postedAt: isoDateSchema.optional(),
  skills: z.array(required(80)).max(100).default([]),
  descriptionHtml: z.string().max(DESCRIPTION_MAX).default(''),
});

const importedEventSchema = z.object({
  id: idSchema,
  at: isoDateSchema,
  type: applicationEventTypeSchema.catch('note'),
  title: required(TITLE_MAX),
  detail: notesSchema.default(''),
});

const importedDocumentSchema = z.object({
  id: idSchema,
  kind: documentKindSchema.catch('other'),
  title: required(TITLE_MAX),
  content: z.string().max(DOCUMENT_CONTENT_MAX),
  generatedBy: generatedBySchema.catch('manual'),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema.optional(),
});

export const applicationImportSchema = z.object({
  id: idSchema,
  jobId: text(200).nullish(),
  clusterKey: text(200).nullish(),
  status: applicationStatusSchema,
  job: importedSnapshotSchema,
  notes: notesSchema.default(''),
  priority: prioritySchema.catch(0),
  contacts: z.array(contactSchema.strip()).max(50).default([]),
  checklist: z.array(checklistItemSchema.strip()).max(100).default([]),
  followUpAt: isoDateSchema.nullish(),
  appliedAt: isoDateSchema.nullish(),
  statusChangedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema.optional(),
  sortOrder: z.number().min(-1e12).max(1e12).catch(0),
  events: z.array(importedEventSchema).max(5000).default([]),
  documents: z.array(importedDocumentSchema).max(1000).default([]),
});

export type ApplicationImport = z.infer<typeof applicationImportSchema>;
