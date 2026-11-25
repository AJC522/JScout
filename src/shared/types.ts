/**
 * Domain types shared by the server and the client.
 *
 * This file is the contract between every part of JScout. Keep it free of
 * runtime code (types and string-literal unions only) so both sides can import
 * it without pulling anything else in. Runtime constants live in constants.ts.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** ISO-8601 timestamp in UTC, e.g. "2026-11-24T14:17:03.000Z". */
export type IsoDate = string;

export type RemoteMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export type EmploymentType =
  | 'full-time'
  | 'part-time'
  | 'contract'
  | 'temporary'
  | 'internship'
  | 'freelance'
  | 'volunteer'
  | 'unknown';

/** Ordered from least to most senior; see SENIORITY_ORDER in constants.ts. */
export type Seniority =
  | 'intern'
  | 'entry'
  | 'mid'
  | 'senior'
  | 'lead'
  | 'manager'
  | 'director'
  | 'executive'
  | 'unknown';

export type SalaryPeriod = 'year' | 'month' | 'week' | 'day' | 'hour';

// ---------------------------------------------------------------------------
// Places and locations
// ---------------------------------------------------------------------------

export type PlaceKind = 'city' | 'admin1' | 'country' | 'region' | 'anywhere' | 'unknown';

/**
 * A resolved (or unresolved) place.
 *  - city:     city + (admin1) + country, with coordinates
 *  - admin1:   a state/province ("California"), admin1 + country
 *  - country:  country only
 *  - region:   a named multi-country hiring region ("EMEA"); `region` holds the name and `countries` its members
 *  - anywhere: explicitly worldwide ("Anywhere", "Worldwide")
 *  - unknown:  could not be resolved; only `raw` is meaningful
 */
export interface Place {
  kind: PlaceKind;
  /** The text this place was parsed from. */
  raw: string;
  city?: string;
  /** First-level division code as used by the gazetteer (e.g. "CA", "ON", "ENG"). */
  admin1?: string;
  admin1Name?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  countryName?: string;
  /** Region name for kind === 'region' (e.g. "EMEA"). */
  region?: string;
  /** Member countries (ISO alpha-2) for kind === 'region'. */
  countries?: string[];
  lat?: number;
  lon?: number;
  /** City population where known; used to rank suggestions. */
  population?: number;
  /** Human label, e.g. "Austin, TX, United States". */
  label: string;
}

export interface JobLocation {
  /** Every physical place the job is tied to. Empty when unknown or fully remote. */
  places: Place[];
  remote: RemoteMode;
  /**
   * Where a remote/hybrid worker may be based, as ISO alpha-2 country codes.
   * Empty means "not restricted or not stated".
   */
  remoteScope: string[];
}

export interface Salary {
  min?: number;
  max?: number;
  /** ISO 4217 code, e.g. "USD". */
  currency?: string;
  period?: SalaryPeriod;
  /** min/max converted to a yearly amount in the same currency (no FX conversion). */
  annualMin?: number;
  annualMax?: number;
  /** Original text when the salary came from free text. */
  text?: string;
  /** True when parsed out of the description rather than a structured field. */
  inferred?: boolean;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** A posting as stored in the local index (without the full description). */
export interface JobPosting {
  /** Stable internal id: hash of source + feed + external id. */
  id: string;
  /** Postings that are the same job from different sources share a cluster key. */
  clusterKey: string;
  /** Adapter id, e.g. "greenhouse". */
  source: string;
  /** Display name of the source, e.g. "Greenhouse". */
  sourceName: string;
  externalId: string;
  url: string;
  applyUrl?: string;

  title: string;
  /** Taxonomy role this title maps to, when recognised. */
  roleId?: string;
  company: string;
  companyUrl?: string;
  companyLogo?: string;

  location: JobLocation;
  /** Display string for the location, e.g. "Austin, TX · Remote (US)". */
  locationText: string;

  salary?: Salary;
  employmentType: EmploymentType;
  seniority: Seniority;
  department?: string;
  /** Categories/tags provided by the source. */
  tags: string[];
  /** Canonical skills extracted from the title and description. */
  skills: string[];
  /** First ~300 characters of the description as plain text. */
  snippet: string;
  hasDescription: boolean;

  postedAt?: IsoDate;
  firstSeenAt: IsoDate;
  lastSeenAt: IsoDate;
  /** Set when the posting disappeared from a complete feed or failed a liveness check. */
  closedAt?: IsoDate;
}

export interface JobSourceLink {
  jobId: string;
  source: string;
  sourceName: string;
  url: string;
  applyUrl?: string;
  postedAt?: IsoDate;
  /** Set when this copy is closed (gone from its source); the employer's own board closing means the job is gone. */
  closedAt?: IsoDate;
}

/** What the user has done with a job (keyed by cluster, so duplicates share state). */
export interface JobUserState {
  hidden: boolean;
  viewedAt?: IsoDate;
  applicationId?: string;
  applicationStatus?: ApplicationStatus;
}

export type TitleMatchKind = 'exact' | 'synonym' | 'related' | 'partial' | 'none';

export interface MatchReason {
  /** Stable key, e.g. "title", "skills", "location", "recency", "salary", "seniority". */
  key: string;
  /** Short human sentence, e.g. "Title matches “Software Engineer”". */
  label: string;
  /** Contribution to the score in points (can be negative). */
  points: number;
}

export interface MatchExplanation {
  titleMatch: TitleMatchKind;
  /** Query terms/phrases found in the posting. */
  matchedTerms: string[];
  /** Profile skills the posting mentions. */
  skillsMatched: string[];
  /** Skills the posting asks for that the profile lacks. */
  skillsMissing: string[];
  reasons: MatchReason[];
}

/** One component of a profile match. */
export interface FitPart {
  key: 'skills' | 'certifications' | 'role' | 'level';
  /** Short human sentence, e.g. "You have 6 of 9 listed skills". */
  label: string;
  /** 0–100 for this component alone. */
  score: number;
  /** Points out of 100 this component is worth when it can be assessed. */
  weight: number;
}

/**
 * Where a posting is against the user's location preferences, best first when remote work is acceptable:
 * remote (open to the user's country), local (in or near a preferred place), area (elsewhere in the same
 * state), country (elsewhere in the same country), unknown, abroad, remote-elsewhere (remote but limited
 * to other countries). When remote work is not acceptable, local and area come before remote.
 */
export type LocationFitKind = 'remote' | 'local' | 'area' | 'country' | 'unknown' | 'abroad' | 'remote-elsewhere';

export interface LocationFit {
  kind: LocationFitKind;
  /** E.g. "12 km from Austin, TX, United States", "Remote, open to your location". */
  label: string;
  /** Position in the location order (0 = best). */
  rank: number;
  distanceKm?: number;
}

/** How well the user's background (résumé, skills, certifications, roles, level) fits a posting. */
export interface ProfileFit {
  /** 0–100, or null when the profile or posting gives too little to compare. */
  percent: number | null;
  /** The tier used for ordering, e.g. "80–89% tier". */
  band: string;
  parts: FitPart[];
  skillsMatched: string[];
  skillsMissing: string[];
  certsMatched: string[];
  certsMissing: string[];
  location: LocationFit;
  /** Yearly pay used for ordering: the middle of the stated range, in the search currency. */
  pay?: { annual: number; currency: string };
}

export interface SearchResultItem {
  job: JobPosting;
  /** 0–100 overall relevance. */
  score: number;
  match: MatchExplanation;
  /** Profile match; absent when the profile is not used or holds nothing to compare. */
  fit?: ProfileFit;
  /** Other postings of the same job (other sources), best first, excluding `job`. */
  duplicates: JobSourceLink[];
  userState: JobUserState;
}

export interface JobDetail extends SearchResultItem {
  /** Sanitised HTML, safe to inject. */
  descriptionHtml: string;
  /** Result of the most recent liveness check, if any. */
  liveness?: LivenessResult;
}

export interface LivenessResult {
  status: 'open' | 'closed' | 'unknown';
  checkedAt: IsoDate;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * 'match': profile match tier (10-point bands), then location fit, then pay — falls back to 'relevance'
 * when the profile is not used or holds nothing to compare.
 */
export type SearchSort = 'match' | 'relevance' | 'date' | 'salary';

export interface SearchQuery {
  /**
   * What the user is looking for: job titles and/or keywords.
   * Syntax: bare words are ANDed; "quoted phrases"; `OR` between alternatives;
   * a leading `-` excludes a word or phrase; commas separate alternative titles.
   */
  q: string;
  /** Require the keywords to appear in the title (default true when q looks like a job title). */
  titleOnly?: boolean;
  /** Free-text place ("Austin, TX", "Germany", "EMEA"). Empty = anywhere. */
  location?: string;
  /** Radius around a city, in km. 0/undefined = the city itself. */
  radiusKm?: number;
  /** Allowed work arrangements. Empty/undefined = any. */
  remote?: RemoteMode[];
  /**
   * When a location is set, also return remote jobs that can be done from it
   * (remote scope includes the country or is unrestricted). Default true.
   */
  includeRemote?: boolean;
  /** Minimum yearly salary in `salaryCurrency`. */
  salaryMin?: number;
  salaryCurrency?: string;
  /** Keep postings that do not state a salary when salaryMin is set. Default true. */
  includeNoSalary?: boolean;
  employmentTypes?: EmploymentType[];
  seniority?: Seniority[];
  /** Only postings published/first seen within this many days. */
  postedWithinDays?: number;
  /** Restrict to these source ids. */
  sources?: string[];
  /** Restrict to these companies (display names). */
  companies?: string[];
  excludeCompanies?: string[];
  /** Words/phrases that must not appear in the title or description. */
  excludeTerms?: string[];
  /** Match same-meaning titles from the taxonomy (e.g. "SWE" for "Software Engineer"). Default true. */
  synonyms?: boolean;
  /** Adjacent roles (taxonomy role ids) the user opted into. */
  relatedRoles?: string[];
  /** Boost and explain results using the saved profile. Default true. */
  useProfile?: boolean;
  /** Include postings the user has hidden. Default false. */
  includeHidden?: boolean;
  /** Include postings that are already in the tracker with status applied or later. Default true. */
  includeApplied?: boolean;
  /** Include postings known to be closed. Default false. */
  includeClosed?: boolean;
  sort?: SearchSort;
  offset?: number;
  limit?: number;
}

export interface ExpandedTitle {
  title: string;
  via: 'query' | 'synonym' | 'related';
  roleId?: string;
}

export interface SearchInterpretation {
  /** Positive phrases the engine searched for, after parsing. */
  terms: string[];
  excluded: string[];
  /** Taxonomy role the query was recognised as, if any. */
  role?: { id: string; title: string; family: string };
  /** All titles actually searched (query + synonyms + chosen related roles). */
  titles: ExpandedTitle[];
  /** How the location text was understood; undefined when no location given. */
  place?: Place;
  /** True when location text was given but could not be resolved (fell back to text match). */
  placeUnresolved?: boolean;
  titleOnly: boolean;
}

export type BroadenKind =
  | 'synonyms'
  | 'related-role'
  | 'all-related-roles'
  | 'any-keyword-position'
  | 'include-remote'
  | 'radius'
  | 'wider-area'
  | 'drop-location'
  | 'date'
  | 'salary'
  | 'seniority'
  | 'employment-type'
  | 'work-mode'
  | 'drop-exclusions'
  | 'external';

/** A one-click way to widen the current search, with the gain it would bring. */
export interface BroadenSuggestion {
  id: string;
  kind: BroadenKind;
  /** Short chip label, e.g. "Include remote jobs". */
  label: string;
  /** One sentence on what changes. */
  description: string;
  /** Fields to merge into the current query. */
  patch: Partial<SearchQuery>;
  /** How many additional results the change would add (omitted when unknown). */
  extraResults?: number;
}

export interface FacetCount {
  value: string;
  label: string;
  count: number;
}

export interface SearchFacets {
  remote: FacetCount[];
  employmentType: FacetCount[];
  seniority: FacetCount[];
  source: FacetCount[];
  company: FacetCount[];
  postedWithin: FacetCount[];
}

export interface SearchResponse {
  query: SearchQuery;
  total: number;
  items: SearchResultItem[];
  tookMs: number;
  interpretation: SearchInterpretation;
  facets: SearchFacets;
  suggestions: BroadenSuggestion[];
  /** Deep links that run the same search on sites JScout cannot index. */
  externalLinks: ExternalSearchLink[];
  index: IndexSummary;
}

export interface ExternalSearchLink {
  id: string;
  name: string;
  url: string;
}

export interface TitleSuggestion {
  title: string;
  roleId?: string;
  family?: string;
  /** Open postings in the index whose title maps to this role (0 when unknown). */
  count: number;
}

export interface SkillSuggestion {
  name: string;
  category: string;
}

// ---------------------------------------------------------------------------
// Sources, companies and syncing
// ---------------------------------------------------------------------------

export type SourceKind = 'board' | 'ats' | 'aggregator' | 'community';
export type SourceMode = 'feed' | 'search';
export type AtsKind = 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'workable' | 'governmentjobs';

export interface SourceConfigField {
  /** Settings key, e.g. "appId". */
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string;
}

export interface SourceInfo {
  id: string;
  name: string;
  kind: SourceKind;
  mode: SourceMode;
  homepage: string;
  description: string;
  /** Credit line the source asks for, shown wherever its postings appear. */
  attribution?: string;
  /** True for ATS sources, which sync one feed per company board. */
  perCompany: boolean;
  configFields: SourceConfigField[];
  enabled: boolean;
  /** True when every required config field has a value. */
  configured: boolean;
  /** Which config keys currently have a value (values are never sent to the client). */
  configuredKeys: string[];
  ttlMinutes: number;
  /** Open postings currently indexed from this source. */
  jobCount: number;
  sync: SourceSyncSummary;
}

export type SyncStatus = 'idle' | 'queued' | 'running' | 'ok' | 'error' | 'disabled';

export interface SourceSyncSummary {
  status: SyncStatus;
  lastSuccessAt?: IsoDate;
  lastAttemptAt?: IsoDate;
  error?: string;
  /** For per-company sources: boards in each state. */
  feeds?: { total: number; ok: number; error: number; running: number; queued: number };
}

export interface CompanyBoard {
  id: string;
  name: string;
  ats: AtsKind;
  token: string;
  industry?: string;
  origin: 'seed' | 'user';
  enabled: boolean;
  addedAt: IsoDate;
  jobCount: number;
  sync: { status: SyncStatus; lastSuccessAt?: IsoDate; error?: string };
}

export interface CompanyDetection {
  ats: AtsKind;
  token: string;
  /** Best-guess display name. */
  name: string;
  /** Open jobs found when the board was probed. */
  jobs: number;
}

export interface IndexSummary {
  /** Open postings in the index. */
  openJobs: number;
  sources: number;
  companies: number;
  /** Most recent successful sync of any feed. */
  lastSyncAt?: IsoDate;
  syncing: boolean;
  /** Feeds queued or running right now. */
  pendingFeeds: number;
}

/** Server-sent events on GET /api/events. */
export type ServerEvent =
  | { type: 'hello'; index: IndexSummary }
  | { type: 'sync-started'; feeds: number }
  | {
      type: 'feed-finished';
      feedKey: string;
      source: string;
      ok: boolean;
      added: number;
      updated: number;
      closed: number;
      error?: string;
      pendingFeeds: number;
    }
  | { type: 'sync-finished'; index: IndexSummary; added: number; durationMs: number }
  | { type: 'index-changed'; index: IndexSummary };

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface ProfileLink {
  id: string;
  label: string;
  url: string;
}

export interface PersonalInfo {
  fullName: string;
  preferredName: string;
  email: string;
  phone: string;
  /** Where the user lives, free text ("Austin, TX"). */
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
  website: string;
  otherLinks: ProfileLink[];
}

export interface WorkDetails {
  currentTitle: string;
  currentCompany: string;
  yearsExperience: number | null;
  /** Free text, e.g. "US citizen", "H-1B", "EU work permit". */
  workAuthorization: string;
  requiresSponsorship: boolean | null;
  willingToRelocate: boolean | null;
  /** Free text, e.g. "2 weeks". */
  noticePeriod: string;
  /** Free text or date, e.g. "Immediately". */
  earliestStart: string;
  /** Short professional summary / elevator pitch reused in cover letters. */
  summary: string;
}

export interface SearchPreferences {
  targetTitles: string[];
  skills: string[];
  /** Certifications and licences the user holds ("CompTIA Security+", "PMP", "CDL"); canonical names where known. */
  certifications: string[];
  /** Places the user wants to work in, free text each. */
  locations: string[];
  radiusKm: number;
  remote: RemoteMode[];
  salaryMin: number | null;
  salaryCurrency: string;
  employmentTypes: EmploymentType[];
  seniority: Seniority[];
  excludeCompanies: string[];
  excludeTerms: string[];
}

export interface ExperienceEntry {
  id: string;
  title: string;
  company: string;
  location: string;
  /** "YYYY-MM" or "YYYY". */
  start: string;
  end: string;
  current: boolean;
  summary: string;
  highlights: string[];
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  field: string;
  start: string;
  end: string;
}

/** A reusable answer to a common application question. */
export interface SavedAnswer {
  id: string;
  question: string;
  answer: string;
  tags: string[];
  updatedAt: IsoDate;
}

export interface ResumeInfo {
  fileName: string;
  mimeType: string;
  /** Plain text extracted from the résumé (or pasted). */
  text: string;
  updatedAt: IsoDate;
  /** Size of the original upload in bytes (0 when pasted). */
  sizeBytes: number;
  /** True when the original file is stored and can be downloaded. */
  hasFile: boolean;
}

export interface Profile {
  personal: PersonalInfo;
  work: WorkDetails;
  preferences: SearchPreferences;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  answers: SavedAnswer[];
  resume: ResumeInfo | null;
  /** Set once the user has finished (or skipped) first-run setup. */
  onboardedAt: IsoDate | null;
  updatedAt: IsoDate;
}

/** What JScout could read out of a résumé, offered to the user as suggestions. */
export interface ResumeAnalysis {
  contact: Partial<
    Pick<PersonalInfo, 'fullName' | 'email' | 'phone' | 'location' | 'linkedin' | 'github' | 'website'>
  >;
  skills: string[];
  /** Certifications and licences named in the résumé (kept out of `skills`). */
  certifications: string[];
  /** Titles found in the résumé mapped to taxonomy roles where possible. */
  titles: Array<{ title: string; roleId?: string }>;
  /** Roles worth targeting based on titles and skills. */
  suggestedTitles: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  yearsExperience: number | null;
  /** Problems worth telling the user about (e.g. "no text could be extracted; is this a scanned PDF?"). */
  warnings: string[];
}

/** How complete the profile is, to nudge the user. */
export interface ProfileCompleteness {
  percent: number;
  missing: Array<{ key: string; label: string; section: 'personal' | 'work' | 'preferences' | 'resume' | 'answers' }>;
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

export interface SavedSearch {
  id: string;
  name: string;
  query: SearchQuery;
  pinned: boolean;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  /** When the user last looked at this search's results. */
  lastViewedAt?: IsoDate;
  /** Current number of matching open postings. */
  total: number;
  /** Matching postings first seen since lastViewedAt. */
  newCount: number;
}

// ---------------------------------------------------------------------------
// Applications (tracker)
// ---------------------------------------------------------------------------

export type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'screening'
  | 'interviewing'
  | 'offer'
  | 'accepted'
  | 'rejected'
  | 'withdrawn';

/** Copy of the job taken when it entered the tracker, so it survives index clean-up. */
export interface JobSnapshot {
  title: string;
  company: string;
  locationText: string;
  remote: RemoteMode;
  url: string;
  applyUrl?: string;
  source: string;
  sourceName: string;
  salaryText?: string;
  employmentType: EmploymentType;
  postedAt?: IsoDate;
  skills: string[];
  /** Sanitised HTML. */
  descriptionHtml: string;
}

export interface ApplicationContact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin: string;
  notes: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export type ApplicationEventType = 'created' | 'status' | 'note' | 'interview' | 'follow-up' | 'document' | 'contact';

export interface ApplicationEvent {
  id: string;
  applicationId: string;
  at: IsoDate;
  type: ApplicationEventType;
  title: string;
  detail: string;
}

export type DocumentKind = 'cover-letter' | 'answer' | 'resume' | 'resume-notes' | 'email' | 'other';
export type GeneratedBy = 'manual' | 'template' | 'ai';

export interface ApplicationDocument {
  id: string;
  applicationId: string;
  kind: DocumentKind;
  title: string;
  content: string;
  generatedBy: GeneratedBy;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Application {
  id: string;
  /** Index job this came from; undefined for manually added applications. */
  jobId?: string;
  clusterKey?: string;
  status: ApplicationStatus;
  job: JobSnapshot;
  notes: string;
  /** 0 = none, 1 = low, 2 = medium, 3 = high. */
  priority: 0 | 1 | 2 | 3;
  contacts: ApplicationContact[];
  checklist: ChecklistItem[];
  followUpAt?: IsoDate;
  appliedAt?: IsoDate;
  statusChangedAt: IsoDate;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  /** Position within its status column (ascending). */
  sortOrder: number;
  /** True when the underlying posting is known to be closed. */
  jobClosed: boolean;
}

export interface ApplicationDetail extends Application {
  events: ApplicationEvent[];
  documents: ApplicationDocument[];
}

export interface ApplicationStats {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  /** Applications with a follow-up date today or earlier that are still active. */
  followUpsDue: number;
  appliedLast7Days: number;
  appliedLast30Days: number;
  /** Share of applied applications that reached screening or later, 0–1 (null when none applied). */
  responseRate: number | null;
}

// ---------------------------------------------------------------------------
// Apply kit
// ---------------------------------------------------------------------------

export interface KeywordCoverage {
  /** Important terms in the posting. */
  term: string;
  /** Whether the résumé/profile mentions it. */
  present: boolean;
  /** How prominent the term is in the posting, 0–1. */
  weight: number;
}

export interface FitAnalysis {
  /** 0–100 overall fit of the profile to the posting. */
  score: number;
  summary: string;
  skillsMatched: string[];
  skillsMissing: string[];
  /** Profile skills the posting does not mention (worth knowing, not penalised). */
  skillsExtra: string[];
  keywords: KeywordCoverage[];
  titleAlignment: { kind: TitleMatchKind; detail: string };
  seniorityAlignment: { job: Seniority; detail: string };
  locationAlignment: { ok: boolean | null; detail: string };
  salaryAlignment: { ok: boolean | null; detail: string };
  /** Concrete, honest suggestions (never to claim skills the user lacks). */
  suggestions: string[];
  /** Requirements in the posting that may be blockers (e.g. clearance, on-site only, sponsorship not offered). */
  flags: string[];
}

export type LetterTone = 'professional' | 'warm' | 'concise' | 'enthusiastic';
export type LetterLength = 'short' | 'medium' | 'long';

export interface CoverLetterRequest {
  applicationId?: string;
  jobId?: string;
  tone: LetterTone;
  length: LetterLength;
  /** 'ai' requires a configured AI key; 'template' always works. */
  mode: 'template' | 'ai';
  /** Extra points the user wants worked in. */
  notes?: string;
}

export interface DraftResult {
  content: string;
  generatedBy: GeneratedBy;
  /** Set when AI was requested but unavailable and a template was used instead. */
  fallbackReason?: string;
}

export interface AnswerDraftRequest {
  applicationId?: string;
  jobId?: string;
  question: string;
  mode: 'bank' | 'ai';
  maxWords?: number;
}

export interface AnswerDraftResult extends DraftResult {
  /** Saved answers that look relevant to the question, best first. */
  related: SavedAnswer[];
}

/** One field in the copy-paste panel used while filling in an application form. */
export interface QuickFillField {
  key: string;
  label: string;
  value: string;
  group: 'contact' | 'links' | 'work' | 'education' | 'other';
}

// --- résumé review ------------------------------------------------------------

/** A job description pasted by the user, for postings that are not in the index or the tracker. */
export interface PastedPosting {
  title: string;
  company?: string;
  description: string;
}

/** What a résumé review compares against: an indexed job, a tracked application, or a pasted posting. */
export interface ResumeTarget {
  jobId?: string;
  applicationId?: string;
  posting?: PastedPosting;
}

export interface ResumeReviewRequest extends ResumeTarget {
  /** Review this text instead of the saved résumé (an edited or tailored draft). */
  resumeText?: string;
}

export type RequirementLevel = 'required' | 'preferred';
export type RequirementKind = 'skill' | 'experience' | 'education' | 'credential' | 'soft' | 'other';
export type RequirementStatus = 'met' | 'partial' | 'missing';

/** One requirement or "nice to have" from the posting, checked against the résumé. */
export interface RequirementCheck {
  /** As written in the posting. */
  text: string;
  level: RequirementLevel;
  kind: RequirementKind;
  status: RequirementStatus;
  /** Terms from the requirement the résumé shows, and those it does not. */
  matched: string[];
  missing: string[];
  /** The résumé line that best shows the requirement. */
  evidence?: string;
  /** Extra context, e.g. "Your résumé dates cover about 4 years". */
  note?: string;
}

export type ResumeCategoryKey = 'skills' | 'requirements' | 'keywords' | 'title' | 'experience' | 'quality';

export interface ResumeScoreCategory {
  key: ResumeCategoryKey;
  label: string;
  /** 0–100, or null when the posting or résumé gives nothing to compare (left out of the total). */
  score: number | null;
  /** Points out of 100 this category is worth when it can be assessed. */
  weight: number;
  detail: string;
}

export type RecommendationPriority = 'high' | 'medium' | 'low';
export type RecommendationArea = 'skills' | 'requirements' | 'keywords' | 'title' | 'experience' | 'summary' | 'bullets' | 'format' | 'contact';

export interface ResumeRecommendation {
  /** Stable key, e.g. "add-skill:Kubernetes". */
  id: string;
  priority: RecommendationPriority;
  area: RecommendationArea;
  title: string;
  detail: string;
  /** A concrete example of the change. */
  before?: string;
  after?: string;
}

export type BulletIssue = 'weak-start' | 'no-metric' | 'too-long' | 'too-short' | 'first-person' | 'passive';

/** One bullet of the résumé's experience, how relevant it is to the posting, and how it could be stronger. */
export interface BulletReview {
  text: string;
  /** The job or section heading the bullet sits under. */
  context: string;
  /** 0–1: how much of the posting's important vocabulary it covers. */
  relevance: number;
  /** Posting terms this bullet already shows. */
  covers: string[];
  issues: BulletIssue[];
  /** A safer, stronger wording (only when one can be made without changing the facts). */
  rewrite?: string;
}

export interface ResumeCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ResumeReview {
  /** 0–100 match of the résumé to the posting. */
  score: number;
  band: string;
  summary: string;
  job: { title: string; company: string };
  /** Which text was reviewed: the saved résumé or a draft sent with the request. */
  source: 'saved' | 'draft';
  categories: ResumeScoreCategory[];
  requirements: RequirementCheck[];
  skillsMatched: string[];
  skillsMissing: string[];
  /** Skills the posting asks for that your profile lists but your résumé does not show. */
  skillsInProfileOnly: string[];
  keywords: KeywordCoverage[];
  recommendations: ResumeRecommendation[];
  bullets: BulletReview[];
  checks: ResumeCheck[];
  stats: { words: number; bullets: number; bulletsWithNumbers: number; yearsExperience: number | null };
  /** Problems that limit the review (no description, unreadable dates…). */
  warnings: string[];
}

export interface ResumeReworkRequest extends ResumeReviewRequest {
  /** 'ai' requires a configured AI key; 'template' always works. */
  mode: 'template' | 'ai';
}

export interface ResumeReworkResult extends DraftResult {
  /** What was changed, in plain sentences. */
  changes: string[];
}

/** The résumé's score against one tracked application. */
export interface ResumeScoreSummary {
  applicationId: string;
  jobId?: string;
  title: string;
  company: string;
  status: ApplicationStatus;
  score: number;
  band: string;
  requiredMet: number;
  requiredTotal: number;
  /** True when the posting has little or no description, so the score says little. */
  limited: boolean;
}

export interface AiStatus {
  configured: boolean;
  model: string;
  /** Result of the last call or explicit test, if any. */
  lastError?: string;
}

// ---------------------------------------------------------------------------
// Settings and app state
// ---------------------------------------------------------------------------

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppSettings {
  theme: ThemePreference;
  /** Refresh stale feeds automatically while the app is open. */
  autoSync: boolean;
  /** Remove closed postings from the index after this many days. */
  closedRetentionDays: number;
  /** Treat postings older than this as stale and exclude them unless asked. 0 = never. */
  maxPostingAgeDays: number;
  ai: {
    /** The key itself is never sent to the client; `hasKey` reports whether one is available. */
    hasKey: boolean;
    /** Where the key comes from: saved in Settings, or the ANTHROPIC_API_KEY environment variable. */
    keySource: 'saved' | 'environment' | null;
    model: string;
  };
}

export interface AppSettingsUpdate {
  theme?: ThemePreference;
  autoSync?: boolean;
  closedRetentionDays?: number;
  maxPostingAgeDays?: number;
  ai?: { apiKey?: string | null; model?: string };
}

export interface Bootstrap {
  version: string;
  settings: AppSettings;
  index: IndexSummary;
  profile: { onboarded: boolean; name: string; completeness: number };
  tracker: { active: number; followUpsDue: number };
  savedSearches: { count: number; newResults: number };
}

export interface ApiErrorBody {
  error: {
    /** Machine-readable code, e.g. "not_found", "validation", "upstream". */
    code: string;
    message: string;
    details?: unknown;
  };
}
