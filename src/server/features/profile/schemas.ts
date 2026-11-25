/** Request schemas for the profile routes (PATCH /api/profile, résumé text, data import/reset). */
import { z } from 'zod';
import { MAX_RESUME_BYTES } from '../../../shared/constants';
import {
  atsKindSchema,
  clearanceLevelSchema,
  employmentTypeSchema,
  isoDateSchema,
  polygraphKindSchema,
  remoteModeSchema,
  searchQuerySchema,
  senioritySchema,
} from '../../../shared/schemas';
import { applicationImportSchema } from '../applications/schemas';
import { LIMITS, isValidEmail, normalizeLink } from './normalize';
import { MAX_RESUME_TEXT_CHARS } from './resume-file';

const text = (max: number) => z.string().trim().max(max);
const list = (max: number, itemMax: number) => z.array(z.string().trim().max(itemMax)).max(max);
const id = z.string().trim().max(100);
const yearMonth = z
  .string()
  .trim()
  .regex(/^(\d{4}(-(0[1-9]|1[0-2]))?)?$/, 'must be YYYY or YYYY-MM');

const link = text(500).refine((v) => normalizeLink(v) !== null, 'must be a web address starting with http:// or https://');
const email = text(254).refine((v) => v === '' || isValidEmail(v), 'must be an email address');

// Field schemas per section, shared by the strict PATCH schema and the lenient import schema.
const personalFields = {
  fullName: text(200),
  preferredName: text(100),
  email,
  phone: text(50),
  location: text(200),
  linkedin: link,
  github: link,
  portfolio: link,
  website: link,
  otherLinks: z
    .array(z.object({ id: id.default(''), label: text(100).default(''), url: link }))
    .max(LIMITS.otherLinks),
};

const workFields = {
  currentTitle: text(200),
  currentCompany: text(200),
  yearsExperience: z.number().min(0).max(70).nullable(),
  workAuthorization: text(200),
  requiresSponsorship: z.boolean().nullable(),
  clearance: z
    .strictObject({ level: clearanceLevelSchema, status: z.enum(['active', 'inactive']), polygraph: polygraphKindSchema.optional() })
    .nullable(),
  willingToRelocate: z.boolean().nullable(),
  noticePeriod: text(100),
  earliestStart: text(100),
  summary: text(5000),
};

const preferenceFields = {
  targetTitles: list(LIMITS.targetTitles, 120),
  skills: list(LIMITS.skills, 80),
  certifications: list(LIMITS.certifications, 120),
  locations: list(LIMITS.locations, 200),
  radiusKm: z.number().min(0).max(500),
  remote: z.array(remoteModeSchema).max(4),
  salaryMin: z.number().min(0).max(10_000_000).nullable(),
  salaryCurrency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'must be a 3-letter currency code')
    .transform((s) => s.toUpperCase()),
  employmentTypes: z.array(employmentTypeSchema).max(8),
  seniority: z.array(senioritySchema).max(9),
  excludeCompanies: list(LIMITS.excludeCompanies, 120),
  excludeTerms: list(LIMITS.excludeTerms, 80),
};

// Entries may arrive without an id (new ones) or without optional fields; the service fills them in.
export const experienceEntrySchema = z.object({
  id: id.default(''),
  title: text(200).default(''),
  company: text(200).default(''),
  location: text(200).default(''),
  start: yearMonth.default(''),
  end: yearMonth.default(''),
  current: z.boolean().default(false),
  summary: text(5000).default(''),
  highlights: list(LIMITS.highlights, 1000).default([]),
});

export const educationEntrySchema = z.object({
  id: id.default(''),
  school: text(200).default(''),
  degree: text(200).default(''),
  field: text(200).default(''),
  start: yearMonth.default(''),
  end: yearMonth.default(''),
});

export const savedAnswerSchema = z.object({
  id: id.default(''),
  question: text(500).default(''),
  answer: text(10_000).default(''),
  tags: list(LIMITS.tags, 50).default([]),
  // Maintained by the server; accepted so clients can send answers back unchanged.
  updatedAt: z.string().max(40).default(''),
});

const experienceList = z.array(experienceEntrySchema).max(LIMITS.experience);
const educationList = z.array(educationEntrySchema).max(LIMITS.education);
const answerList = z.array(savedAnswerSchema).max(LIMITS.answers);

/** PATCH /api/profile. Unknown keys are rejected so client typos do not silently vanish. */
export const profilePatchSchema = z.strictObject({
  personal: z.strictObject(personalFields).partial().optional(),
  work: z.strictObject(workFields).partial().optional(),
  preferences: z.strictObject(preferenceFields).partial().optional(),
  experience: experienceList.optional(),
  education: educationList.optional(),
  answers: answerList.optional(),
  onboardedAt: isoDateSchema.nullable().optional(),
});

export const resumeTextSchema = z.strictObject({
  // Generous: the service trims the stored text to its own cap; this only stops absurd bodies.
  text: z.string().max(MAX_RESUME_BYTES),
});

export const dataResetSchema = z.strictObject({ scope: z.enum(['index', 'everything']) });

// --- backups --------------------------------------------------------------------------
// A backup may come from another JScout version or be edited by hand: unknown keys are dropped
// and missing fields take defaults. Invalid links are dropped later by normalizeProfile.

const looseLink = z.object({ id: id.default(''), label: text(100).default(''), url: text(500) });
const importedPersonal = z
  .object({
    ...personalFields,
    email: text(254),
    linkedin: text(500),
    github: text(500),
    portfolio: text(500),
    website: text(500),
    otherLinks: z.array(looseLink).max(LIMITS.otherLinks),
  })
  .partial();

const importedResume = z.object({
  fileName: text(200).default('Résumé'),
  mimeType: text(120).default('text/plain'),
  text: z.string().max(MAX_RESUME_TEXT_CHARS).default(''),
  updatedAt: isoDateSchema.optional(),
  sizeBytes: z.number().int().min(0).max(MAX_RESUME_BYTES).catch(0),
  hasFile: z.boolean().catch(false),
});

export const importedProfileSchema = z.object({
  personal: importedPersonal.optional(),
  work: z.object(workFields).partial().optional(),
  preferences: z.object(preferenceFields).partial().optional(),
  experience: experienceList.optional(),
  education: educationList.optional(),
  answers: answerList.optional(),
  resume: importedResume.nullable().optional(),
  onboardedAt: isoDateSchema.nullable().optional(),
  updatedAt: isoDateSchema.optional(),
});

const importedSavedSearch = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  query: searchQuerySchema,
  pinned: z.boolean().default(false),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema.optional(),
  lastViewedAt: isoDateSchema.nullish().transform((v) => v ?? undefined),
}).transform((item) => ({ ...item, updatedAt: item.updatedAt ?? item.createdAt }));

const importedCompany = z.object({
  name: z.string().trim().min(1).max(200),
  ats: atsKindSchema,
  token: z.string().trim().min(1).max(200),
  industry: z.string().trim().max(100).optional(),
  enabled: z.boolean().default(true),
});

const importedHiddenJob = z.object({
  clusterKey: z.string().trim().min(1).max(200),
  hiddenAt: isoDateSchema,
});

/** POST /api/data/import. Applications use the applications feature's own import schema. */
export const dataImportSchema = z.object({
  app: z.literal('jscout', 'this is not a JScout backup file'),
  formatVersion: z.literal(1, 'this backup was made by an unsupported version of JScout'),
  exportedAt: isoDateSchema.optional(),
  profile: importedProfileSchema,
  savedSearches: z.array(importedSavedSearch).max(1000).default([]),
  applications: z.array(applicationImportSchema).max(5000).default([]),
  userCompanies: z.array(importedCompany).max(5000).default([]),
  hiddenJobs: z.array(importedHiddenJob).max(100_000).default([]),
});
