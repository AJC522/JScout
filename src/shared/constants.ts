import type {
  ApplicationStatus,
  EmploymentType,
  LetterLength,
  LetterTone,
  Profile,
  RemoteMode,
  SearchQuery,
  Seniority,
} from './types';

export const APP_NAME = 'JScout';
export const DEFAULT_PORT = 4310;

export const REMOTE_MODES: RemoteMode[] = ['remote', 'hybrid', 'onsite', 'unknown'];
export const REMOTE_LABELS: Record<RemoteMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unknown: 'Not stated',
};

export const EMPLOYMENT_TYPES: EmploymentType[] = [
  'full-time',
  'part-time',
  'contract',
  'temporary',
  'internship',
  'freelance',
  'volunteer',
  'unknown',
];
export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
  temporary: 'Temporary',
  internship: 'Internship',
  freelance: 'Freelance',
  volunteer: 'Volunteer',
  unknown: 'Not stated',
};

/** Least to most senior. `unknown` is not part of the ordering. */
export const SENIORITY_ORDER: Seniority[] = [
  'intern',
  'entry',
  'mid',
  'senior',
  'lead',
  'manager',
  'director',
  'executive',
];
export const SENIORITY_LABELS: Record<Seniority, string> = {
  intern: 'Internship',
  entry: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior',
  lead: 'Lead / Staff / Principal',
  manager: 'Manager',
  director: 'Director',
  executive: 'Executive',
  unknown: 'Not stated',
};

/** Tracker columns, in pipeline order. */
export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'saved',
  'applied',
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
];
export const ACTIVE_STATUSES: ApplicationStatus[] = ['saved', 'applied', 'screening', 'interviewing', 'offer'];
export const CLOSED_STATUSES: ApplicationStatus[] = ['accepted', 'rejected', 'withdrawn'];
export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  screening: 'Screening',
  interviewing: 'Interviewing',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const LETTER_TONES: LetterTone[] = ['professional', 'warm', 'concise', 'enthusiastic'];
export const LETTER_LENGTHS: LetterLength[] = ['short', 'medium', 'long'];

export const POSTED_WITHIN_OPTIONS = [
  { days: 1, label: 'Past 24 hours' },
  { days: 3, label: 'Past 3 days' },
  { days: 7, label: 'Past week' },
  { days: 14, label: 'Past 2 weeks' },
  { days: 30, label: 'Past month' },
] as const;

export const RADIUS_OPTIONS_KM = [0, 10, 25, 50, 100, 200] as const;

export const SEARCH_PAGE_SIZE = 30;
export const SEARCH_MAX_LIMIT = 100;

/** Defaults applied by the server when a field is omitted from a SearchQuery. */
export const SEARCH_DEFAULTS = {
  includeRemote: true,
  includeNoSalary: true,
  synonyms: true,
  useProfile: true,
  includeHidden: false,
  includeApplied: true,
  includeClosed: false,
  sort: 'match',
  offset: 0,
  limit: SEARCH_PAGE_SIZE,
} as const satisfies Partial<SearchQuery>;

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';

export const MAX_RESUME_BYTES = 8 * 1024 * 1024;
export const RESUME_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
] as const;

export function emptyProfile(now: string): Profile {
  return {
    personal: {
      fullName: '',
      preferredName: '',
      email: '',
      phone: '',
      location: '',
      linkedin: '',
      github: '',
      portfolio: '',
      website: '',
      otherLinks: [],
    },
    work: {
      currentTitle: '',
      currentCompany: '',
      yearsExperience: null,
      workAuthorization: '',
      requiresSponsorship: null,
      willingToRelocate: null,
      noticePeriod: '',
      earliestStart: '',
      summary: '',
    },
    preferences: {
      targetTitles: [],
      skills: [],
      certifications: [],
      locations: [],
      radiusKm: 50,
      remote: [],
      salaryMin: null,
      salaryCurrency: 'USD',
      employmentTypes: [],
      seniority: [],
      excludeCompanies: [],
      excludeTerms: [],
    },
    experience: [],
    education: [],
    answers: [],
    resume: null,
    onboardedAt: null,
    updatedAt: now,
  };
}
