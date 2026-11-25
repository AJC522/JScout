/** zod schemas for the apply kit's HTTP bodies (see src/shared/api.ts). */
import { z } from 'zod';
import { LETTER_LENGTHS, LETTER_TONES } from '../../../shared/constants';

export const TEXT_MAX = 2_000;
export const MAX_WORDS_MIN = 30;
export const MAX_WORDS_MAX = 800;

const id = z.string().trim().min(1).max(200);
const targetFields = { jobId: id.optional(), applicationId: id.optional() };
const needsTarget = (body: { jobId?: string; applicationId?: string }) =>
  body.jobId !== undefined || body.applicationId !== undefined;
const targetMessage = { message: 'jobId or applicationId is required' };

export const analyzeBodySchema = z.strictObject(targetFields).refine(needsTarget, targetMessage);

export const coverLetterBodySchema = z
  .strictObject({
    ...targetFields,
    tone: z.enum(LETTER_TONES),
    length: z.enum(LETTER_LENGTHS),
    mode: z.enum(['template', 'ai']),
    notes: z.string().max(TEXT_MAX).optional(),
  })
  .refine(needsTarget, targetMessage);

/** A question may be answered without a job (generic answers for the bank). */
export const answerBodySchema = z.strictObject({
  ...targetFields,
  question: z.string().trim().min(1).max(TEXT_MAX),
  mode: z.enum(['bank', 'ai']),
  maxWords: z.number().int().min(MAX_WORDS_MIN).max(MAX_WORDS_MAX).optional(),
});

/** A pasted description can be long (benefits, legal text); anything beyond this is not needed. */
export const POSTING_MAX = 60_000;
/** A draft résumé sent for review or rework. */
export const RESUME_TEXT_MAX = 100_000;

const postingSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().max(200).optional(),
  description: z.string().trim().min(1).max(POSTING_MAX),
});
const resumeTargetFields = { ...targetFields, posting: postingSchema.optional() };
const needsResumeTarget = (body: { jobId?: string; applicationId?: string; posting?: unknown }) =>
  needsTarget(body) || body.posting !== undefined;
const resumeTargetMessage = { message: 'jobId, applicationId or posting is required' };
const resumeText = z.string().max(RESUME_TEXT_MAX).optional();

export const resumeReviewBodySchema = z
  .strictObject({ ...resumeTargetFields, resumeText })
  .refine(needsResumeTarget, resumeTargetMessage);

export const resumeReworkBodySchema = z
  .strictObject({ ...resumeTargetFields, resumeText, mode: z.enum(['template', 'ai']) })
  .refine(needsResumeTarget, resumeTargetMessage);
