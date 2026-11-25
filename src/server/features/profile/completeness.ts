import type { Profile, ProfileCompleteness } from '../../../shared/types';

type Section = ProfileCompleteness['missing'][number]['section'];

interface Check {
  key: string;
  label: string;
  section: Section;
  weight: number;
  done: (p: Profile) => boolean;
}

export const MIN_SAVED_ANSWERS = 3;

/** Weights sum to exactly 100. */
const CHECKS: Check[] = [
  { key: 'name', label: 'Your name', section: 'personal', weight: 10, done: (p) => !!p.personal.fullName },
  { key: 'email', label: 'Email address', section: 'personal', weight: 10, done: (p) => !!p.personal.email },
  { key: 'phone', label: 'Phone number', section: 'personal', weight: 5, done: (p) => !!p.personal.phone },
  { key: 'location', label: 'Where you live', section: 'personal', weight: 5, done: (p) => !!p.personal.location },
  { key: 'resume', label: 'Résumé', section: 'resume', weight: 15, done: (p) => !!p.resume?.text },
  { key: 'targetTitles', label: 'Job titles you are looking for', section: 'preferences', weight: 10, done: (p) => p.preferences.targetTitles.length > 0 },
  { key: 'skills', label: 'Your skills', section: 'preferences', weight: 10, done: (p) => p.preferences.skills.length > 0 },
  {
    key: 'locations',
    label: 'Preferred locations or remote preference',
    section: 'preferences',
    weight: 5,
    done: (p) => p.preferences.locations.length > 0 || p.preferences.remote.length > 0,
  },
  { key: 'workAuthorization', label: 'Work authorisation', section: 'work', weight: 5, done: (p) => !!p.work.workAuthorization },
  { key: 'summary', label: 'Professional summary', section: 'work', weight: 5, done: (p) => !!p.work.summary },
  { key: 'experience', label: 'At least one job in your experience', section: 'work', weight: 10, done: (p) => p.experience.length > 0 },
  {
    key: 'answers',
    label: `Answers to a few common application questions (${MIN_SAVED_ANSWERS} or more)`,
    section: 'answers',
    weight: 10,
    done: (p) => p.answers.filter((a) => a.question && a.answer).length >= MIN_SAVED_ANSWERS,
  },
];

export function computeCompleteness(profile: Profile): ProfileCompleteness {
  let percent = 0;
  const missing: ProfileCompleteness['missing'] = [];
  for (const check of CHECKS) {
    if (check.done(profile)) percent += check.weight;
    else missing.push({ key: check.key, label: check.label, section: check.section });
  }
  return { percent, missing };
}
