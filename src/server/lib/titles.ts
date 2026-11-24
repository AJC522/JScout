/**
 * Job-title understanding backed by the bundled role taxonomy
 * (loadReference('roles') from ../data).
 */
import type { EmploymentType, Seniority } from '../../shared/types';
import { notImplemented } from './not-implemented';

export interface RoleRef {
  id: string;
  title: string;
  familyId: string;
  family: string;
  aliases: string[];
  /** Ids of adjacent roles. */
  related: string[];
  skills: string[];
}

export interface TitleInfo {
  raw: string;
  /**
   * The title with noise removed and seniority stripped, in normalizeText form:
   * "Sr. Software Engineer II (Remote) - Payments" -> "software engineer".
   * Removed: seniority words and levels (I/II/III, L4, "level 2"), parenthetical/bracketed asides,
   * trailing location or team segments after " - ", " | ", " @ ", ", " when the head is already a title,
   * work-arrangement and contract words (remote, hybrid, contract, m/f/d, f/m/x, h/f), requisition ids.
   * Used for de-duplication and for exact-title matching.
   */
  core: string;
  seniority: Seniority;
  /** Taxonomy role the core title maps to (by title or alias), when recognised. */
  role?: RoleRef;
}

/** Analyse a posting title. Pure function of the string; safe to call for every posting at ingest. */
export function analyzeTitle(raw: string): TitleInfo {
  return notImplemented(`analyzeTitle(${raw})`);
}

/**
 * Seniority from the title, falling back to an explicit source value, then (conservatively) to
 * the description ("8+ years of experience" -> senior; "new grad" -> entry). Title rules:
 *  intern: intern, internship, co-op, working student, werkstudent, apprentice, trainee
 *  entry: junior, jr, entry level, graduate, new grad, associate (when leading and not "associate director"), I / 1
 *  mid: II / 2, mid-level, intermediate
 *  senior: senior, sr, III / 3
 *  lead: lead, staff, principal, distinguished, fellow, architect (as a level), IV+ / tech lead
 *  manager: manager, head of (team-level), supervisor, team lead when managing people ("engineering manager")
 *  director: director, senior director, head of <function>
 *  executive: vp, vice president, svp, evp, chief …, cXO, president, founder, partner, managing director, general manager
 * "Product Manager"/"Project Manager"/"Account Manager"/"Program Manager"/"Community Manager" etc. are
 * individual-contributor titles, NOT manager seniority; the taxonomy tells which titles those are.
 */
export function detectSeniority(title: string, sourceValue?: string, descriptionText?: string): Seniority {
  return notImplemented(`detectSeniority(${title}, ${sourceValue ?? ''}, ${descriptionText?.length ?? 0})`);
}

/**
 * Map a source's employment-type value (and, failing that, the title/description) to our enum.
 * Handles: "Full-time", "FULL_TIME", "Permanent", "Part time", "Contract", "Contractor", "C2C", "W2",
 * "Temporary", "Temp", "Seasonal", "Intern", "Internship", "Freelance", "Volunteer", "Vollzeit", "Teilzeit", "CDI", "CDD".
 * Returns 'unknown' rather than guessing.
 */
export function detectEmploymentType(sourceValue: string | undefined, title: string, descriptionText?: string): EmploymentType {
  return notImplemented(`detectEmploymentType(${sourceValue ?? ''}, ${title}, ${descriptionText?.length ?? 0})`);
}

/** Find the taxonomy role for user-typed text or a posting title (title or alias; seniority ignored). */
export function findRole(text: string): RoleRef | undefined {
  return notImplemented(`findRole(${text})`);
}

export function getRole(id: string): RoleRef | undefined {
  return notImplemented(`getRole(${id})`);
}

export interface TitleExpansion {
  role?: RoleRef;
  /** Same-meaning titles (the role's canonical title and aliases), excluding the input itself. */
  synonyms: string[];
  /** Adjacent roles worth offering as opt-in broadening. */
  related: RoleRef[];
}

/** Expand a user-typed title for broadened searching. Unknown titles expand to nothing. */
export function expandTitle(text: string): TitleExpansion {
  return notImplemented(`expandTitle(${text})`);
}

/**
 * Autocomplete for the "what" box: canonical titles and aliases starting with (then containing)
 * the query, best first; canonical titles outrank aliases; diacritic- and case-insensitive.
 */
export function suggestTitles(query: string, limit = 8): Array<{ title: string; roleId: string; family: string }> {
  return notImplemented(`suggestTitles(${query}, ${limit})`);
}

/** Roles whose typical skills overlap most with the given skills (for suggesting target titles from a résumé). */
export function rolesForSkills(skills: string[], limit = 6): RoleRef[] {
  return notImplemented(`rolesForSkills(${skills.length}, ${limit})`);
}
