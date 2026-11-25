/** Validation and normalisation of company board input (add, import, seed). */
import type { AtsKind } from '../../../shared/types';
import { badRequest } from '../../errors';

export const ATS_LABELS: Record<AtsKind, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
};

/**
 * Board tokens as each ATS allows them in its URLs and APIs. Tokens end up in
 * request paths, so anything outside these sets is refused rather than encoded.
 * SmartRecruiters identifiers are case-sensitive; the others are folded to lower case.
 */
const TOKEN_RULES: Record<AtsKind, { pattern: RegExp; keepCase: boolean }> = {
  greenhouse: { pattern: /^[a-z0-9][a-z0-9_-]{0,99}$/, keepCase: false },
  lever: { pattern: /^[a-z0-9][a-z0-9._-]{0,99}$/, keepCase: false },
  ashby: { pattern: /^[a-z0-9][a-z0-9._-]{0,99}$/, keepCase: false },
  smartrecruiters: { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, keepCase: true },
  workable: { pattern: /^[a-z0-9][a-z0-9_-]{0,99}$/, keepCase: false },
};

const MAX_NAME = 200;
const MAX_INDUSTRY = 60;

export interface BoardInput {
  ats: AtsKind;
  token: string;
  name: string;
  industry?: string;
}

/** The token in its canonical form, or null when the ATS would not accept it. */
export function normalizeToken(ats: AtsKind, token: string): string | null {
  const rule = TOKEN_RULES[ats];
  const t = token.trim();
  const canonical = rule.keepCase ? t : t.toLowerCase();
  return rule.pattern.test(canonical) ? canonical : null;
}

/**
 * Clean board input. `syncable` lists the ATSs JScout has an adapter for: a board
 * on any other ATS could be stored but never synced, so it is refused.
 * Throws a 400 ApiError describing the first problem.
 */
export function normalizeBoardInput(input: BoardInput, syncable: ReadonlySet<AtsKind>): BoardInput {
  const label = ATS_LABELS[input.ats];
  if (!label) throw badRequest('Unknown applicant tracking system');
  if (!syncable.has(input.ats)) throw badRequest(`JScout cannot sync ${label} boards yet`);
  const token = normalizeToken(input.ats, String(input.token ?? ''));
  if (!token) throw badRequest(`"${String(input.token).trim().slice(0, 100)}" is not a valid ${label} board name`);
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw badRequest('Enter the company name');
  if (name.length > MAX_NAME) throw badRequest(`The company name must be at most ${MAX_NAME} characters`);
  const industry = input.industry?.trim();
  if (industry && industry.length > MAX_INDUSTRY) throw badRequest(`The industry must be at most ${MAX_INDUSTRY} characters`);
  return { ats: input.ats, token, name, ...(industry ? { industry } : {}) };
}
