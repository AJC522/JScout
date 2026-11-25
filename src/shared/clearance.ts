/**
 * How a posting's security clearance requirement compares with the clearance the user holds.
 * Pure functions shared by the server (fit flags, answers) and the client (badges, job detail).
 */
import { CLEARANCE_LEVEL_LABELS, POLYGRAPH_LABELS } from './constants';
import type { ClearanceLevel, HeldClearance, JobClearance, PolygraphKind } from './types';

/**
 * Comparable strength of a level. DOE L is about a Secret and DOE Q about a Top Secret; they are
 * not the same clearance (agencies grant reciprocity case by case), so this is a guide, not a rule.
 */
const STRENGTH: Readonly<Record<ClearanceLevel, number>> = {
  'public-trust': 1,
  confidential: 2,
  'doe-l': 3,
  secret: 3,
  'top-secret': 5,
  'doe-q': 5,
  'ts-sci': 6,
};
const POLY_STRENGTH: Readonly<Record<PolygraphKind, number>> = { polygraph: 1, ci: 1, 'full-scope': 2 };

export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function levelCovers(held: ClearanceLevel, needed: ClearanceLevel): boolean {
  return STRENGTH[held] >= STRENGTH[needed];
}

/** "TS/SCI with full-scope polygraph", "Secret", "a clearance". */
export function describeClearance(c: Pick<JobClearance, 'level' | 'polygraph'>): string {
  const level = c.level ? CLEARANCE_LEVEL_LABELS[c.level] : 'a clearance';
  return c.polygraph ? `${level} with ${POLYGRAPH_LABELS[c.polygraph]}` : level;
}

/** "active Secret", "inactive TS/SCI with CI polygraph" (lower case: it is used mid-sentence). */
export function describeHeld(held: HeldClearance): string {
  return `${held.status} ${describeClearance(held)}`;
}

export type ClearanceStanding =
  /** Nothing asked of the user. */
  | 'clear'
  /** The user holds what the job asks for. */
  | 'meets'
  /** The job wants a clearance the user doesn't hold (or holds at a lower level / lapsed). */
  | 'short'
  /** The user would have to be sponsored (fine, but takes months). */
  | 'sponsored'
  /** The posting doesn't say; the user should ask. */
  | 'ask';

export interface ClearanceFit {
  standing: ClearanceStanding;
  /** One short sentence for the user. */
  note: string;
}

/** Whether the user's clearance (null = none) answers what the posting asks for. */
export function clearanceFit(job: JobClearance | undefined, mine: HeldClearance | null | undefined): ClearanceFit {
  const held = mine ?? null;
  const requirement = job?.requirement ?? 'none';
  if (requirement === 'none') return { standing: 'clear', note: 'No clearance needed.' };
  const what = describeClearance(job ?? {});
  const levelOk = held !== null && (!job?.level || levelCovers(held.level, job.level));
  const polyOk = !job?.polygraph || (held?.polygraph !== undefined && POLY_STRENGTH[held.polygraph] >= POLY_STRENGTH[job.polygraph]);
  const holds = levelOk && polyOk;

  if (holds && held.status === 'active') return { standing: 'meets', note: `Your ${describeHeld(held)} covers this.` };
  switch (requirement) {
    case 'preferred':
      return { standing: 'clear', note: held ? `${what} preferred; yours (${describeHeld(held)}) is a plus.` : `${what} preferred, not required.` };
    case 'sponsored':
      if (holds) return { standing: 'meets', note: `They sponsor ${what}; your ${describeHeld(held)} should speed it up.` };
      return { standing: 'sponsored', note: `They sponsor ${what}: you need to be eligible, not already cleared.` };
    case 'active':
      if (holds) return { standing: 'short', note: `They want an active ${what}; yours is inactive. Ask whether it can be reinstated.` };
      if (held) return { standing: 'short', note: `They want an active ${what}; you hold an ${describeHeld(held)}.` };
      return { standing: 'short', note: `You must already hold an active ${what}.` };
    default:
      if (holds) return { standing: 'ask', note: `Needs ${what}; yours is inactive. Ask whether they'll reinstate or sponsor it.` };
      return { standing: 'ask', note: `Needs ${what}, but doesn't say whether they sponsor it.` };
  }
}
