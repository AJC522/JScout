/**
 * Turning a résumé analysis into profile changes. The analysis is only a suggestion: the user
 * reviews a `ResumeSelection` (edited contact fields, kept skills, picked titles) and
 * `buildResumePatch` turns what they confirmed into one PATCH /api/profile body.
 */
import type { ProfilePatch } from '../../../shared/api';
import type { EducationEntry, ExperienceEntry, PersonalInfo, Profile, ResumeAnalysis } from '../../../shared/types';
import { mergeUnique, newId } from './profile-model';

export const CONTACT_FIELDS = ['fullName', 'email', 'phone', 'location', 'linkedin', 'github', 'website'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export const CONTACT_LABELS: Record<ContactField, string> = {
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  location: 'Location',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  website: 'Website',
};

export interface ResumeSelection {
  contact: Partial<Record<ContactField, string>>;
  skills: string[];
  titles: string[];
  /** Typed text; parsed when applied. */
  years: string;
  addExperience: boolean;
  addEducation: boolean;
}

/** Suggested titles picked by default: a few to get a first search going when the user has none yet. */
const DEFAULT_TITLE_PICKS = 3;

export function initialSelection(analysis: ResumeAnalysis, profile: Profile): ResumeSelection {
  const contact: ResumeSelection['contact'] = {};
  for (const field of CONTACT_FIELDS) {
    const found = analysis.contact[field]?.trim();
    if (found) contact[field] = found;
  }
  const targets = profile.preferences.targetTitles.map((t) => t.toLowerCase());
  const alreadyTargeted = analysis.suggestedTitles.filter((t) => targets.includes(t.toLowerCase()));
  return {
    contact,
    skills: mergeUnique([], analysis.skills),
    titles: targets.length > 0 ? alreadyTargeted : analysis.suggestedTitles.slice(0, DEFAULT_TITLE_PICKS),
    years: analysis.yearsExperience === null ? '' : String(analysis.yearsExperience),
    addExperience: profile.experience.length === 0 && analysis.experience.length > 0,
    addEducation: profile.education.length === 0 && analysis.education.length > 0,
  };
}

const entryKey = (...parts: string[]) => parts.map((p) => p.trim().toLowerCase()).join('|');

/** Résumé entries the profile does not have yet (same title and company, or school and degree). */
export function newExperience(existing: readonly ExperienceEntry[], found: readonly ExperienceEntry[]): ExperienceEntry[] {
  const have = new Set(existing.map((e) => entryKey(e.title, e.company)));
  return found.filter((e) => !have.has(entryKey(e.title, e.company)));
}

export function newEducation(existing: readonly EducationEntry[], found: readonly EducationEntry[]): EducationEntry[] {
  const have = new Set(existing.map((e) => entryKey(e.school, e.degree)));
  return found.filter((e) => !have.has(entryKey(e.school, e.degree)));
}

function parseYears(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 70 ? value : null;
}

/** The profile changes the user confirmed. Only fields that actually change are included. */
export function buildResumePatch(selection: ResumeSelection, analysis: ResumeAnalysis, profile: Profile): ProfilePatch {
  const patch: ProfilePatch = {};

  const personal: Partial<PersonalInfo> = {};
  for (const field of CONTACT_FIELDS) {
    const value = selection.contact[field]?.trim();
    if (value && value !== profile.personal[field]) personal[field] = value;
  }
  if (Object.keys(personal).length > 0) patch.personal = personal;

  const skills = mergeUnique(profile.preferences.skills, selection.skills);
  const titles = mergeUnique(profile.preferences.targetTitles, selection.titles);
  if (skills.length !== profile.preferences.skills.length || titles.length !== profile.preferences.targetTitles.length) {
    patch.preferences = { skills, targetTitles: titles };
  }

  const added = selection.addExperience ? newExperience(profile.experience, analysis.experience) : [];
  if (added.length > 0) {
    patch.experience = [...profile.experience, ...added.map((e) => ({ ...e, id: newId() }))];
  }
  const addedSchools = selection.addEducation ? newEducation(profile.education, analysis.education) : [];
  if (addedSchools.length > 0) {
    patch.education = [...profile.education, ...addedSchools.map((e) => ({ ...e, id: newId() }))];
  }

  const work: ProfilePatch['work'] = {};
  const years = parseYears(selection.years);
  if (years !== null && years !== profile.work.yearsExperience) work.yearsExperience = years;
  // Fill the current job from the résumé only where the user has not typed one.
  const current = (patch.experience ?? profile.experience).find((e) => e.current);
  if (current && !profile.work.currentTitle && current.title) work.currentTitle = current.title;
  if (current && !profile.work.currentCompany && current.company) work.currentCompany = current.company;
  if (Object.keys(work).length > 0) patch.work = work;

  return patch;
}

/** Warnings that mean the text could not be read, so pasting it is the way forward. */
export function suggestsPaste(analysis: ResumeAnalysis): boolean {
  return analysis.warnings.some((w) => /scann|no text|could not (be )?(read|extract)|image/i.test(w));
}
