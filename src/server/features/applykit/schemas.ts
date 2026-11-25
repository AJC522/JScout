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
