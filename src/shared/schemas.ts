/** zod schemas for values that cross feature boundaries. Feature-specific schemas live with the feature. */
import { z } from 'zod';
import { SEARCH_MAX_LIMIT } from './constants';

export const remoteModeSchema = z.enum(['remote', 'hybrid', 'onsite', 'unknown']);
export const employmentTypeSchema = z.enum([
  'full-time',
  'part-time',
  'contract',
  'temporary',
  'internship',
  'freelance',
  'volunteer',
  'unknown',
]);
export const senioritySchema = z.enum([
  'intern',
  'entry',
  'mid',
  'senior',
  'lead',
  'manager',
  'director',
  'executive',
  'unknown',
]);
export const applicationStatusSchema = z.enum([
  'saved',
  'applied',
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
]);
export const atsKindSchema = z.enum(['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable']);

const shortList = (max: number, itemMax = 120) => z.array(z.string().trim().min(1).max(itemMax)).max(max);

/** Validates a SearchQuery (see shared/types.ts); unknown keys are rejected. */
export const searchQuerySchema = z.strictObject({
  q: z.string().max(300).default(''),
  titleOnly: z.boolean().optional(),
  location: z.string().max(200).optional(),
  radiusKm: z.number().min(0).max(500).optional(),
  remote: z.array(remoteModeSchema).max(4).optional(),
  includeRemote: z.boolean().optional(),
  salaryMin: z.number().min(0).max(10_000_000).optional(),
  salaryCurrency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((s) => s.toUpperCase())
    .optional(),
  includeNoSalary: z.boolean().optional(),
  employmentTypes: z.array(employmentTypeSchema).max(8).optional(),
  seniority: z.array(senioritySchema).max(9).optional(),
  postedWithinDays: z.number().int().min(1).max(365).optional(),
  sources: shortList(50, 60).optional(),
  companies: shortList(50).optional(),
  excludeCompanies: shortList(100).optional(),
  excludeTerms: shortList(50, 80).optional(),
  synonyms: z.boolean().optional(),
  relatedRoles: shortList(40, 80).optional(),
  useProfile: z.boolean().optional(),
  includeHidden: z.boolean().optional(),
  includeApplied: z.boolean().optional(),
  includeClosed: z.boolean().optional(),
  sort: z.enum(['relevance', 'date', 'salary']).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
  limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
});

export const isoDateSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO-8601 date');
