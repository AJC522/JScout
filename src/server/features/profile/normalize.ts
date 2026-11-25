import { randomUUID } from 'node:crypto';
import { EMPLOYMENT_TYPES, REMOTE_MODES, SENIORITY_ORDER, emptyProfile } from '../../../shared/constants';
import type {
  EducationEntry,
  EmploymentType,
  ExperienceEntry,
  PersonalInfo,
  Profile,
  RemoteMode,
  ResumeInfo,
  SavedAnswer,
  SearchPreferences,
  Seniority,
  WorkDetails,
} from '../../../shared/types';
import { badRequest } from '../../errors';
import { normalizeSkillList } from '../../lib/skills';
import { clamp, uniqueFolded } from '../../lib/text';

/** List caps. The route schemas reject longer lists; the service truncates as a last line of defence. */
export const LIMITS = {
  targetTitles: 60,
  skills: 300,
  locations: 50,
  excludeCompanies: 200,
  excludeTerms: 100,
  otherLinks: 20,
  experience: 60,
  highlights: 30,
  education: 30,
  answers: 200,
  tags: 20,
} as const;

export const LINK_FIELDS = ['linkedin', 'github', 'portfolio', 'website'] as const;

const YEAR_MONTH = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
const SENIORITIES: readonly Seniority[] = [...SENIORITY_ORDER, 'unknown'];

/**
 * Normalise a user-typed web address: '' stays '', a missing scheme becomes "https://".
 * Returns null when the result is not a plausible http(s) URL.
 */
export function normalizeLink(raw: string): string | null {
  const value = raw.trim();
  if (!value) return '';
  if (/\s/.test(value)) return null;
  // "example.com:8080/x" has a colon but no scheme; a scheme is letters followed by ":" and not a port number.
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value);
  const withScheme = value.startsWith('//') ? `https:${value}` : hasScheme ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  return withScheme;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Overlay a stored (possibly older-format) value on defaults. The stored JSON was written by
 * normalizeProfile, so its field types are trusted; only missing fields are filled in.
 */
function overlay<T extends object>(base: T, value: unknown): T {
  return isRecord(value) ? { ...base, ...(value as Partial<T>) } : base;
}

export const emptyExperience = (): ExperienceEntry => ({
  id: '',
  title: '',
  company: '',
  location: '',
  start: '',
  end: '',
  current: false,
  summary: '',
  highlights: [],
});

export const emptyEducation = (): EducationEntry => ({ id: '', school: '', degree: '', field: '', start: '', end: '' });

const emptyAnswer = (): SavedAnswer => ({ id: '', question: '', answer: '', tags: [], updatedAt: '' });

/** A stored profile (any version) deep-merged over the empty profile, so every field exists. */
export function withDefaults(stored: unknown, now: string): Profile {
  const base = emptyProfile(now);
  if (!isRecord(stored)) return base;
  const resume = isRecord(stored.resume)
    ? overlay<ResumeInfo>({ fileName: '', mimeType: 'text/plain', text: '', updatedAt: now, sizeBytes: 0, hasFile: false }, stored.resume)
    : null;
  return {
    personal: overlay(base.personal, stored.personal),
    work: overlay(base.work, stored.work),
    preferences: overlay(base.preferences, stored.preferences),
    experience: asArray(stored.experience).map((e) => overlay(emptyExperience(), e)),
    education: asArray(stored.education).map((e) => overlay(emptyEducation(), e)),
    answers: asArray(stored.answers).map((a) => overlay(emptyAnswer(), a)),
    resume,
    onboardedAt: typeof stored.onboardedAt === 'string' ? stored.onboardedAt : null,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : now,
  };
}

export interface NormalizeOptions {
  now: string;
  /** The stored profile before this write, to keep SavedAnswer.updatedAt for unchanged answers. */
  previous?: Profile;
  /**
   * 'reject' (interactive edits): an invalid link is a 400.
   * 'import' (restoring a backup): invalid links are dropped, and answer timestamps from the file are kept.
   */
  mode: 'reject' | 'import';
}

const str = (v: unknown, max = 10_000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoOr = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback;
const yearMonth = (v: unknown): string => {
  const s = str(v, 7);
  return YEAR_MONTH.test(s) ? s : '';
};
const nullableBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const finiteOrNull = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

function textList(values: unknown, max: number, itemMax = 200): string[] {
  return uniqueFolded(asArray(values).map((v) => str(v, itemMax))).slice(0, max);
}

function enumList<T extends string>(values: unknown, allowed: readonly T[]): T[] {
  return [...new Set(asArray(values).filter((v): v is T => allowed.includes(v as T)))];
}

/** Gives every entry a unique id, generating one where it is missing or repeated. */
function ensureIds<T extends { id: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.map((e) => {
    const id = e.id && !seen.has(e.id) ? e.id : randomUUID();
    seen.add(id);
    return id === e.id ? e : { ...e, id };
  });
}

function normalizePersonal(p: PersonalInfo, mode: NormalizeOptions['mode']): PersonalInfo {
  const link = (field: string, raw: unknown): string => {
    const fixed = normalizeLink(str(raw, 500));
    if (fixed !== null) return fixed;
    if (mode === 'import') return '';
    throw badRequest(`personal.${field}: must be a web address starting with http:// or https://`);
  };
  const email = str(p.email, 254).toLowerCase();
  const otherLinks = ensureIds(
    asArray(p.otherLinks)
      .filter(isRecord)
      .map((l, i) => ({ id: str(l.id, 100), label: str(l.label, 100), url: link(`otherLinks.${i}.url`, l.url) }))
      .filter((l) => l.url),
  );
  const seenUrls = new Set<string>();
  return {
    fullName: str(p.fullName, 200),
    preferredName: str(p.preferredName, 100),
    email: mode === 'import' && email && !isValidEmail(email) ? '' : email,
    phone: str(p.phone, 50).replace(/\s+/g, ' '),
    location: str(p.location, 200),
    linkedin: link('linkedin', p.linkedin),
    github: link('github', p.github),
    portfolio: link('portfolio', p.portfolio),
    website: link('website', p.website),
    otherLinks: otherLinks
      .filter((l) => {
        const key = l.url.toLowerCase();
        if (seenUrls.has(key)) return false;
        seenUrls.add(key);
        return true;
      })
      .slice(0, LIMITS.otherLinks),
  };
}

function normalizeWork(w: WorkDetails): WorkDetails {
  const years = finiteOrNull(w.yearsExperience, 0, 70);
  return {
    currentTitle: str(w.currentTitle, 200),
    currentCompany: str(w.currentCompany, 200),
    yearsExperience: years === null ? null : Math.round(years * 10) / 10,
    workAuthorization: str(w.workAuthorization, 200),
    requiresSponsorship: nullableBool(w.requiresSponsorship),
    willingToRelocate: nullableBool(w.willingToRelocate),
    noticePeriod: str(w.noticePeriod, 100),
    earliestStart: str(w.earliestStart, 100),
    summary: str(w.summary, 5000),
  };
}

function normalizePreferences(p: SearchPreferences): SearchPreferences {
  const radius = finiteOrNull(p.radiusKm, 0, Number.POSITIVE_INFINITY);
  const salary = finiteOrNull(p.salaryMin, 0, 10_000_000);
  const currency = str(p.salaryCurrency, 3).toUpperCase();
  const skills = asArray(p.skills)
    .map((s) => str(s, 80))
    .filter(Boolean);
  return {
    targetTitles: textList(p.targetTitles, LIMITS.targetTitles, 120),
    skills: skills.length ? normalizeSkillList(skills).slice(0, LIMITS.skills) : [],
    locations: textList(p.locations, LIMITS.locations),
    radiusKm: radius === null ? 50 : clamp(Math.round(radius), 0, 500),
    remote: enumList<RemoteMode>(p.remote, REMOTE_MODES),
    salaryMin: salary === null ? null : Math.round(salary),
    salaryCurrency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
    employmentTypes: enumList<EmploymentType>(p.employmentTypes, EMPLOYMENT_TYPES),
    seniority: enumList<Seniority>(p.seniority, SENIORITIES),
    excludeCompanies: textList(p.excludeCompanies, LIMITS.excludeCompanies, 120),
    excludeTerms: textList(p.excludeTerms, LIMITS.excludeTerms, 80),
  };
}

function normalizeExperience(entries: ExperienceEntry[]): ExperienceEntry[] {
  const cleaned = entries.filter(isRecord).map((e): ExperienceEntry => {
    const current = e.current === true;
    return {
      id: str(e.id, 100),
      title: str(e.title, 200),
      company: str(e.company, 200),
      location: str(e.location, 200),
      start: yearMonth(e.start),
      end: current ? '' : yearMonth(e.end),
      current,
      summary: str(e.summary, 5000),
      highlights: asArray(e.highlights)
        .map((h) => str(h, 1000))
        .filter(Boolean)
        .slice(0, LIMITS.highlights),
    };
  });
  return ensureIds(cleaned.filter((e) => e.title || e.company || e.summary || e.highlights.length)).slice(0, LIMITS.experience);
}

function normalizeEducation(entries: EducationEntry[]): EducationEntry[] {
  const cleaned = entries.filter(isRecord).map(
    (e): EducationEntry => ({
      id: str(e.id, 100),
      school: str(e.school, 200),
      degree: str(e.degree, 200),
      field: str(e.field, 200),
      start: yearMonth(e.start),
      end: yearMonth(e.end),
    }),
  );
  return ensureIds(cleaned.filter((e) => e.school || e.degree || e.field)).slice(0, LIMITS.education);
}

function normalizeAnswers(answers: SavedAnswer[], opts: NormalizeOptions): SavedAnswer[] {
  const before = new Map((opts.previous?.answers ?? []).map((a) => [a.id, a]));
  const cleaned = answers
    .filter(isRecord)
    .map((a) => ({
      id: str(a.id, 100),
      question: str(a.question, 500),
      answer: str(a.answer, 10_000),
      tags: textList(a.tags, LIMITS.tags, 50),
      updatedAt: str(a.updatedAt, 40),
    }))
    .filter((a) => a.question || a.answer);
  return ensureIds(cleaned)
    .slice(0, LIMITS.answers)
    .map((a) => {
      const prev = before.get(a.id);
      const unchanged =
        prev !== undefined &&
        prev.question === a.question &&
        prev.answer === a.answer &&
        prev.tags.join('\u0000') === a.tags.join('\u0000');
      const updatedAt = unchanged ? prev.updatedAt : opts.mode === 'import' ? isoOr(a.updatedAt, opts.now) : opts.now;
      return { ...a, updatedAt };
    });
}

/** Trim, canonicalise, de-duplicate and cap every user-editable part of a profile. */
export function normalizeProfile(profile: Profile, opts: NormalizeOptions): Profile {
  return {
    personal: normalizePersonal(profile.personal, opts.mode),
    work: normalizeWork(profile.work),
    preferences: normalizePreferences(profile.preferences),
    experience: normalizeExperience(asArray(profile.experience) as ExperienceEntry[]),
    education: normalizeEducation(asArray(profile.education) as EducationEntry[]),
    answers: normalizeAnswers(asArray(profile.answers) as SavedAnswer[], opts),
    resume: profile.resume,
    onboardedAt: profile.onboardedAt ? isoOr(profile.onboardedAt, opts.now) : null,
    updatedAt: opts.now,
  };
}
