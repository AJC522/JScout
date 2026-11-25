/** Deterministic résumé analysis: suggestions the user confirms, never invented data. */
import type { ResumeAnalysis } from '../../../shared/types';
import { extractSkills, skillCategory } from '../../lib/skills';
import { findRole, rolesForSkills } from '../../lib/titles';
import { foldText } from '../../lib/text';
import { yearsCovered } from './resume-dates';
import { type ParsedExperience, parseEducation, parseExperience } from './resume-entries';
import { MAX_RESUME_TEXT_CHARS, RESUME_MIME } from './resume-file';
import { extractContact, splitSections } from './resume-parse';

const MAX_SKILLS = 100;
const MAX_SUGGESTED_TITLES = 8;
/** Fewer visible characters than this means the text layer is (nearly) empty. */
const LITTLE_TEXT_CHARS = 150;

export const WARNINGS = {
  noResume: 'There is no résumé yet. Upload one or paste its text to get suggestions.',
  scanned:
    'This PDF has little or no selectable text; it looks scanned or image-only, so JScout cannot read it. Paste your résumé text instead.',
  littleText: 'Very little text was found in your résumé, so the suggestions may be incomplete.',
  noExperienceSection: 'No work-experience section was found, so no jobs were suggested. Add your experience by hand.',
  noDatedJobs: 'An experience section was found but no jobs with date ranges (like "Jan 2020 – Present") could be read from it.',
  truncated: 'Your résumé is very long; only the first 200,000 characters were kept.',
} as const;

const emptyAnalysis = (warnings: string[]): ResumeAnalysis => ({
  contact: {},
  skills: [],
  certifications: [],
  titles: [],
  suggestedTitles: [],
  experience: [],
  education: [],
  yearsExperience: null,
  warnings,
});

/** Most recent first: current jobs, then by end date, then by start date. */
function byRecency(a: ParsedExperience, b: ParsedExperience): number {
  const key = (p: ParsedExperience) => {
    const end = p.range.current || !p.range.end ? 1e9 : p.range.end.year * 12 + (p.range.end.month ?? 6);
    return [end, p.range.start.year * 12 + (p.range.start.month ?? 6)] as const;
  };
  const [ea, sa] = key(a);
  const [eb, sb] = key(b);
  return eb - ea || sb - sa;
}

export function analyzeResumeText(text: string, opts: { now: Date; mimeType?: string }): ResumeAnalysis {
  const visible = text.replace(/\s+/g, '').length;
  const isPdf = opts.mimeType === RESUME_MIME.pdf;
  if (!visible) return emptyAnalysis([isPdf ? WARNINGS.scanned : WARNINGS.noResume]);
  const warnings: string[] = [];
  const substantial = visible >= LITTLE_TEXT_CHARS;
  if (!substantial) warnings.push(isPdf ? WARNINGS.scanned : WARNINGS.littleText);
  if (text.length >= MAX_RESUME_TEXT_CHARS * 0.99) warnings.push(WARNINGS.truncated);

  const sections = splitSections(text);
  const experienceSections = sections.filter((s) => s.kind === 'experience');
  const parsed = experienceSections.flatMap((s) => parseExperience(s.lines, opts.now));
  if (substantial && !experienceSections.length) warnings.push(WARNINGS.noExperienceSection);
  else if (substantial && !parsed.length) warnings.push(WARNINGS.noDatedJobs);

  const found = extractSkills(text);
  const isCert = (s: string) => skillCategory(s) === 'certification-license';
  const skills = found.filter((s) => !isCert(s)).slice(0, MAX_SKILLS);
  const certifications = found.filter(isCert);

  const seen = new Set<string>();
  const titles: ResumeAnalysis['titles'] = [];
  const recognised: string[] = [];
  for (const { entry } of [...parsed].sort(byRecency)) {
    if (!entry.title) continue;
    const key = foldText(entry.title);
    if (seen.has(key)) continue;
    seen.add(key);
    const role = findRole(entry.title);
    titles.push(role ? { title: entry.title, roleId: role.id } : { title: entry.title });
    if (role) recognised.push(role.title);
  }
  const suggested = new Map<string, string>();
  for (const title of [...recognised, ...rolesForSkills(skills, MAX_SUGGESTED_TITLES).map((r) => r.title)]) {
    if (suggested.size >= MAX_SUGGESTED_TITLES) break;
    if (!suggested.has(foldText(title))) suggested.set(foldText(title), title);
  }

  return {
    contact: extractContact(sections, text),
    skills,
    certifications,
    titles,
    suggestedTitles: [...suggested.values()],
    experience: parsed.map((p) => p.entry),
    education: sections.filter((s) => s.kind === 'education').flatMap((s) => parseEducation(s.lines, opts.now)),
    yearsExperience: yearsCovered(
      parsed.map((p) => p.range),
      opts.now,
    ),
    warnings,
  };
}
