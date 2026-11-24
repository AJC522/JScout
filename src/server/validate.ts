import { z } from 'zod';
import { badRequest } from './errors';

/** Parse request input with a zod schema, turning failures into a 400 with readable details. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = issues[0];
  throw badRequest(first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid input', issues);
}

/** Query-string booleans: "true"/"1" -> true, "false"/"0" -> false. */
export const queryBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const queryInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
