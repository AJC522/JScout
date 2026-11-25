import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../../../shared/constants';
import type { ExperienceEntry, Profile, ResumeAnalysis } from '../../../shared/types';
import { filterAnswers, unansweredCommon } from './answers-model';
import { LIST_LIMITS, arrangementHint, formatSalaryInput, placeRecap, preferencesErrors, radiusLabel, toggle } from './preferences-model';
import { applyProfilePatch, isEmptyPatch, mergeUnique, missingFrom, moveItem, upsertById } from './profile-model';
import { buildResumePatch, initialSelection, newExperience, suggestsPaste } from './resume-apply';
import { checkResumeFile, isValidEmail, isValidLink, isYearMonth, parseOptionalNumber, validatePersonal } from './validation';

const NOW = '2026-11-25T10:00:00.000Z';
const profile = (changes: (p: Profile) => void = () => {}): Profile => {
  const p = emptyProfile(NOW);
  changes(p);
  return p;
};

const job = (title: string, company: string, extra: Partial<ExperienceEntry> = {}): ExperienceEntry => ({
  id: '',
  title,
  company,
  location: '',
  start: '2020-01',
  end: '',
  current: false,
  summary: '',
  highlights: [],
  ...extra,
});

const analysis = (changes: Partial<ResumeAnalysis> = {}): ResumeAnalysis => ({
  contact: {},
  skills: [],
  titles: [],
  suggestedTitles: [],
  experience: [],
  education: [],
  yearsExperience: null,
  warnings: [],
  ...changes,
});

describe('profile-model', () => {
  it('merges section patches and replaces lists wholesale', () => {
    const before = profile((p) => {
      p.personal.fullName = 'Ana';
      p.experience = [job('A', 'X')];
    });
    const after = applyProfilePatch(before, { personal: { email: 'a@b.co' }, experience: [], onboardedAt: NOW });
    expect(after.personal).toMatchObject({ fullName: 'Ana', email: 'a@b.co' });
    expect(after.experience).toEqual([]);
    expect(after.onboardedAt).toBe(NOW);
    expect(applyProfilePatch(after, { onboardedAt: null }).onboardedAt).toBeNull();
    expect(applyProfilePatch(after, {}).onboardedAt).toBe(NOW);
  });

  it('detects empty patches', () => {
    expect(isEmptyPatch({})).toBe(true);
    expect(isEmptyPatch({ personal: undefined })).toBe(true);
    expect(isEmptyPatch({ answers: [] })).toBe(false);
  });

  it('merges strings case-insensitively, trimming and skipping blanks', () => {
    expect(mergeUnique(['React', 'SQL'], [' react ', 'Go', '', 'go', 'SQL'])).toEqual(['React', 'SQL', 'Go']);
    expect(missingFrom(['React'], ['react', 'Vue'])).toEqual(['Vue']);
  });

  it('moves and upserts list items', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b'], 1, 5)).toEqual(['a', 'b']);
    const list = [{ id: '1', v: 1 }];
    expect(upsertById(list, { id: '1', v: 2 })).toEqual([{ id: '1', v: 2 }]);
    expect(upsertById(list, { id: '2', v: 3 })).toHaveLength(2);
  });
});

describe('validation', () => {
  it('accepts emails and web addresses the server accepts', () => {
    expect(isValidEmail('jane@example.com')).toBe(true);
    expect(isValidEmail('jane@localhost')).toBe(false);
    expect(isValidLink('')).toBe(true);
    expect(isValidLink('github.com/jane')).toBe(true);
    expect(isValidLink('https://jane.dev')).toBe(true);
    expect(isValidLink('example.com:8080/x')).toBe(true);
    expect(isValidLink('javascript:alert(1)')).toBe(false);
    expect(isValidLink('not a link')).toBe(false);
    expect(isValidLink('https://user:pw@site.com')).toBe(false);
    expect(isValidLink('jane')).toBe(false);
  });

  it('reports personal field errors, including other links by id', () => {
    const p = profile().personal;
    p.email = 'nope';
    p.github = 'not a url';
    p.otherLinks = [
      { id: 'a', label: 'Blog', url: '' },
      { id: 'b', label: 'Talk', url: 'talks.example.org' },
    ];
    expect(validatePersonal(p)).toEqual({ email: expect.any(String), github: expect.any(String), otherLinks: { a: expect.any(String) } });
  });

  it('checks dates and numbers', () => {
    expect(['', '2021', '2021-04'].every(isYearMonth)).toBe(true);
    expect(['2021-13', '21', 'April'].some(isYearMonth)).toBe(false);
    expect(parseOptionalNumber('', 0, 70)).toBeNull();
    expect(parseOptionalNumber('85,000', 0, 1e7)).toBe(85000);
    expect(parseOptionalNumber('abc', 0, 70)).toBeUndefined();
    expect(parseOptionalNumber('71', 0, 70)).toBeUndefined();
  });

  it('checks résumé files before upload', () => {
    expect(checkResumeFile({ name: 'cv.PDF', size: 2000 })).toBeNull();
    expect(checkResumeFile({ name: 'cv.doc', size: 2000 })).toMatch(/\.docx/);
    expect(checkResumeFile({ name: 'cv.png', size: 2000 })).toMatch(/PDF/);
    expect(checkResumeFile({ name: 'cv.txt', size: 0 })).toMatch(/empty/);
    expect(checkResumeFile({ name: 'cv.pdf', size: 50 * 1024 * 1024 })).toMatch(/larger/);
  });
});

describe('resume-apply', () => {
  const found = analysis({
    contact: { fullName: 'Jane Doe', email: 'jane@example.com' },
    skills: ['TypeScript', 'React', 'typescript'],
    suggestedTitles: ['Frontend Engineer', 'Software Engineer', 'UI Engineer', 'Web Developer'],
    experience: [job('Frontend Engineer', 'Acme', { current: true }), job('Developer', 'Beta')],
    yearsExperience: 6,
  });

  it('preselects a few titles and the new entries for an empty profile', () => {
    const selection = initialSelection(found, profile());
    expect(selection.skills).toEqual(['TypeScript', 'React']);
    expect(selection.titles).toEqual(['Frontend Engineer', 'Software Engineer', 'UI Engineer']);
    expect(selection).toMatchObject({ years: '6', addExperience: true, addEducation: false });
  });

  it('keeps existing target titles instead of adding defaults', () => {
    const selection = initialSelection(found, profile((p) => (p.preferences.targetTitles = ['software engineer'])));
    expect(selection.titles).toEqual(['Software Engineer']);
  });

  it('builds a patch with only what changes', () => {
    const current = profile((p) => {
      p.personal.email = 'jane@example.com';
      p.preferences.skills = ['react'];
      p.experience = [job('Developer', 'Beta', { id: 'x' })];
    });
    const selection = { ...initialSelection(found, current), addExperience: true };
    const patch = buildResumePatch(selection, found, current);
    expect(patch.personal).toEqual({ fullName: 'Jane Doe' });
    expect(patch.preferences?.skills).toEqual(['react', 'TypeScript']);
    expect(patch.experience?.map((e) => e.title)).toEqual(['Developer', 'Frontend Engineer']);
    expect(patch.experience?.[1]?.id).not.toBe('');
    expect(patch.work).toEqual({ yearsExperience: 6, currentTitle: 'Frontend Engineer', currentCompany: 'Acme' });
  });

  it('returns an empty patch when the profile already has everything', () => {
    const current = profile((p) => {
      p.personal.fullName = 'Jane Doe';
      p.personal.email = 'jane@example.com';
      p.preferences.skills = ['TypeScript', 'React'];
      p.preferences.targetTitles = ['Frontend Engineer'];
      p.experience = found.experience.map((e, i) => ({ ...e, id: String(i) }));
      p.work = { ...p.work, yearsExperience: 6, currentTitle: 'Lead', currentCompany: 'Acme' };
    });
    expect(isEmptyPatch(buildResumePatch(initialSelection(found, current), found, current))).toBe(true);
    expect(newExperience(current.experience, found.experience)).toEqual([]);
  });

  it('spots warnings that call for pasting the text', () => {
    expect(suggestsPaste(analysis({ warnings: ['No text could be extracted; is this a scanned PDF?'] }))).toBe(true);
    expect(suggestsPaste(analysis({ warnings: ['No dates found for one job'] }))).toBe(false);
  });
});

describe('answers and preferences', () => {
  const answers = [
    { id: '1', question: 'Why do you want to work here?', answer: 'Mission.', tags: ['motivation'], updatedAt: NOW },
    { id: '2', question: 'Salary expectations?', answer: 'Around 120k', tags: ['salary'], updatedAt: NOW },
  ];

  it('filters answers by every word across question, answer and tags', () => {
    expect(filterAnswers(answers, '  ').map((a) => a.id)).toEqual(['1', '2']);
    expect(filterAnswers(answers, 'MOTIV').map((a) => a.id)).toEqual(['1']);
    expect(filterAnswers(answers, 'salary 120k').map((a) => a.id)).toEqual(['2']);
    expect(filterAnswers(answers, 'salary mission')).toEqual([]);
  });

  it('offers only common questions not answered yet', () => {
    const left = unansweredCommon(answers).map((q) => q.question);
    expect(left).not.toContain('Why do you want to work here?');
    expect(left.length).toBeGreaterThan(3);
  });

  it('formats preference controls', () => {
    expect(radiusLabel(0)).toBe('Only that place');
    expect(radiusLabel(50)).toBe('Within 50 km (31 mi)');
    expect(formatSalaryInput(85000)).toBe('85,000');
    expect(formatSalaryInput(null)).toBe('');
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('recaps a location with only "Remote" ticked as remote jobs open to it, not local ones too', () => {
    expect(placeRecap('Berlin, Germany', ['remote'])).toBe('Remote jobs open to Berlin, Germany');
    expect(placeRecap('Berlin, Germany', [])).toBe('In Berlin, Germany, or remote');
    expect(placeRecap('Berlin, Germany', ['remote', 'hybrid'])).toBe('In Berlin, Germany, or remote');
    expect(placeRecap('Berlin, Germany', ['onsite'])).toBe('In Berlin, Germany');
    expect(placeRecap('', ['remote'])).toBe('Remote jobs');
    expect(placeRecap('', [])).toBe('Any location');
  });

  it('warns under the arrangement chips when "Remote" alone hides local jobs', () => {
    expect(arrangementHint({ locations: ['Berlin'], remote: ['remote'] })).toMatch(/^Only remote jobs will show/);
    expect(arrangementHint({ locations: [], remote: ['remote'] })).toBe('Pick none to see every kind.');
    expect(arrangementHint({ locations: ['Berlin'], remote: ['remote', 'hybrid'] })).toBe('Pick none to see every kind.');
  });

  it('flags preference lists longer than the server keeps', () => {
    const titles = Array.from({ length: LIST_LIMITS.targetTitles + 2 }, (_, i) => `Title ${i}`);
    expect(preferencesErrors({ targetTitles: titles, skills: ['Go'] })).toEqual({ targetTitles: 'Keep it to 60 or fewer (remove 2)' });
    expect(preferencesErrors({ targetTitles: titles.slice(0, LIST_LIMITS.targetTitles) })).toEqual({});
    expect(preferencesErrors({})).toEqual({});
  });
});
