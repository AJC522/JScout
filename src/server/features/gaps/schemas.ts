/** zod schema for the skill-gap request body (see src/shared/api.ts). */
import { z } from 'zod';
import { searchQuerySchema } from '../../../shared/schemas';

export const gapRequestSchema = z
  .strictObject({
    scope: z.enum(['profile', 'applications', 'search']),
    query: searchQuerySchema.optional(),
  })
  .refine((body) => body.scope !== 'search' || body.query !== undefined, { message: 'query is required for the search scope' });
