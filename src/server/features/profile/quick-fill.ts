/** The copy-paste panel used while filling in application forms. */
import { capitalize, describeHeld } from '../../../shared/clearance';
import type { EducationEntry, Profile, QuickFillField } from '../../../shared/types';

const PARTICLES = new Set(['de', 'da', 'del', 'della', 'der', 'den', 'di', 'du', 'la', 'le', 'van', 'von', 'bin', 'al', 'dos', 'das', 'st.']);

/** "Mary Ann de la Cruz" -> first "Mary", last "de la Cruz" (surname particles stay with the last name). */
export function splitName(fullName: string): { first: string; last: string } {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { first: words[0] ?? '', last: '' };
  let lastStart = words.length - 1;
  while (lastStart > 1 && PARTICLES.has(words[lastStart - 1]!.toLowerCase())) lastStart--;
  return { first: words[0]!, last: words.slice(lastStart).join(' ') };
}

const yesNo = (v: boolean | null): string => (v === null ? '' : v ? 'Yes' : 'No');

export function formatSalary(amount: number | null, currency: string): string {
  if (amount === null) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString('en-US')} ${currency}`;
  }
}

/** Most recent education: latest end (or start) year; an entry without dates ranks last. */
function mostRecentEducation(entries: EducationEntry[]): EducationEntry | undefined {
  const year = (e: EducationEntry) => Number((e.end || e.start).slice(0, 4)) || 0;
  return entries.reduce<EducationEntry | undefined>((best, e) => (!best || year(e) > year(best) ? e : best), undefined);
}

export function buildQuickFill(profile: Profile): QuickFillField[] {
  const { personal, work, preferences } = profile;
  const fields: QuickFillField[] = [];
  const add = (group: QuickFillField['group'], key: string, label: string, value: string) => {
    if (value.trim()) fields.push({ key, label, value: value.trim(), group });
  };

  const { first, last } = splitName(personal.fullName);
  add('contact', 'fullName', 'Full name', personal.fullName);
  add('contact', 'firstName', 'First name', first);
  add('contact', 'lastName', 'Last name', last);
  add('contact', 'preferredName', 'Preferred name', personal.preferredName);
  add('contact', 'email', 'Email', personal.email);
  add('contact', 'phone', 'Phone', personal.phone);
  add('contact', 'location', 'Location', personal.location);

  add('links', 'linkedin', 'LinkedIn', personal.linkedin);
  add('links', 'github', 'GitHub', personal.github);
  add('links', 'portfolio', 'Portfolio', personal.portfolio);
  add('links', 'website', 'Website', personal.website);
  for (const link of personal.otherLinks) add('links', `link:${link.id}`, link.label || 'Link', link.url);

  // Fall back to the job marked current in the experience list, never to an older one.
  const currentJob = profile.experience.find((e) => e.current);
  add('work', 'currentTitle', 'Current title', work.currentTitle || currentJob?.title || '');
  add('work', 'currentCompany', 'Current company', work.currentCompany || currentJob?.company || '');
  add('work', 'yearsExperience', 'Years of experience', work.yearsExperience === null ? '' : String(work.yearsExperience));
  add('work', 'workAuthorization', 'Work authorisation', work.workAuthorization);
  add('work', 'requiresSponsorship', 'Requires visa sponsorship', yesNo(work.requiresSponsorship));
  if (work.clearance) add('work', 'clearance', 'Security clearance', capitalize(describeHeld(work.clearance)));
  add('work', 'willingToRelocate', 'Willing to relocate', yesNo(work.willingToRelocate));
  add('work', 'noticePeriod', 'Notice period', work.noticePeriod);
  add('work', 'earliestStart', 'Earliest start date', work.earliestStart);
  add('work', 'salaryExpectation', 'Salary expectation', formatSalary(preferences.salaryMin, preferences.salaryCurrency));

  const school = mostRecentEducation(profile.education);
  if (school) {
    add('education', 'school', 'School', school.school);
    add('education', 'degree', 'Degree', school.degree);
    add('education', 'fieldOfStudy', 'Field of study', school.field);
  }

  add('other', 'summary', 'Professional summary', work.summary);
  return fields;
}
