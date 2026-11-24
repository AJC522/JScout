/**
 * Service interfaces: the seams between server features. Each feature implements
 * its interface in its own directory and is wired together in app.ts. Features
 * depend on each other ONLY through these interfaces (via AppContext.services).
 */
import type {
  ApplicationCreate,
  ApplicationEventCreate,
  ApplicationPatch,
  CompanyBulkUpdate,
  CompanyList,
  CompanyListQuery,
  DataExport,
  DocumentCreate,
  ProfilePatch,
  ResumeResult,
  SearchHistoryEntry,
  SourcePatch,
  SourceTestResult,
} from '../shared/api';
import type {
  AiStatus,
  AnswerDraftRequest,
  AnswerDraftResult,
  AppSettings,
  AppSettingsUpdate,
  Application,
  ApplicationDetail,
  ApplicationDocument,
  ApplicationEvent,
  ApplicationStats,
  ApplicationStatus,
  AtsKind,
  CompanyBoard,
  CompanyDetection,
  CoverLetterRequest,
  DraftResult,
  FitAnalysis,
  IndexSummary,
  IsoDate,
  JobDetail,
  JobPosting,
  JobSourceLink,
  JobUserState,
  LivenessResult,
  Place,
  Profile,
  ProfileCompleteness,
  QuickFillField,
  ResumeAnalysis,
  SavedSearch,
  SearchQuery,
  SearchResponse,
  SkillSuggestion,
  SourceInfo,
  TitleSuggestion,
} from '../shared/types';
import type { AppConfig } from './config';
import type { Db } from './db';
import type { EventBus } from './events';
import type { NormalizedPosting, UpsertStats } from './ingest/types';
import type { BoardRef, HttpClient, UpstreamQuery } from './sources/types';

// --- settings ------------------------------------------------------------------

export interface SourceState {
  /** undefined = use the source's default. */
  enabled?: boolean;
  /** Config values by field key (API keys etc.). Server-side only. */
  config: Record<string, string>;
  ttlMinutes?: number;
}

export interface SettingsService {
  getApp(): AppSettings;
  updateApp(patch: AppSettingsUpdate): AppSettings;
  /** Secrets never leave the server. Known keys: 'ai.apiKey'. */
  getSecret(key: 'ai.apiKey'): string | undefined;
  getSourceState(sourceId: string): SourceState;
  setSourceState(sourceId: string, patch: SourcePatch): SourceState;
  /** Generic JSON key/value storage for features (keys are namespaced, e.g. 'ai.lastError'). */
  getJson<T>(key: string): T | undefined;
  setJson(key: string, value: unknown): void;
  remove(key: string): void;
}

// --- profile -------------------------------------------------------------------

export interface ProfileService {
  get(): Profile;
  patch(patch: ProfilePatch): Profile;
  /** Replace the whole profile (data import). */
  replace(profile: Profile): Profile;
  completeness(): ProfileCompleteness;
  /**
   * The user's skills as canonical names: preferences.skills plus skills found
   * in the résumé text, de-duplicated, preference order first.
   */
  effectiveSkills(): string[];
  /** Résumé text, or '' when none. */
  resumeText(): string;
  setResumeFile(file: { fileName: string; mimeType: string; bytes: Buffer }): Promise<ResumeResult>;
  setResumeText(text: string): ResumeResult;
  analyzeResume(): ResumeAnalysis;
  resumeFile(): { fileName: string; mimeType: string; bytes: Buffer } | undefined;
  deleteResume(): Profile;
  quickFill(): QuickFillField[];
}

// --- job store (the local index) -------------------------------------------------

export interface JobStore {
  /**
   * Insert/update the postings of one feed in a single pass.
   * When `complete` is true, open postings of this feed that are absent from
   * `postings` are marked closed; postings that reappear are re-opened.
   * Keeps jobs, job_places and jobs_fts consistent.
   */
  upsertFeed(
    feed: { feedKey: string; source: string },
    postings: NormalizedPosting[],
    opts: { complete: boolean; now: Date },
  ): UpsertStats;
  /** Insert/update postings without affecting others in the feed (search-mode results). */
  upsertPostings(feed: { feedKey: string; source: string }, postings: NormalizedPosting[], now: Date): UpsertStats;
  getPosting(id: string): JobPosting | undefined;
  getPostings(ids: string[]): JobPosting[];
  /** Sanitised HTML; '' when the description has not been fetched. */
  getDescriptionHtml(id: string): string;
  /** Store a lazily fetched description (also updates snippet, skills and the full-text index). */
  setDescription(id: string, descriptionHtml: string, descriptionText: string): void;
  /** Every posting in a cluster as source links, best first. */
  clusterLinks(clusterKey: string): JobSourceLink[];
  setLiveness(id: string, result: LivenessResult): void;
  getLiveness(id: string): LivenessResult | undefined;
  /** Remove a feed's postings entirely (company removed / source disabled). Tracked jobs keep their snapshot. */
  removeFeed(feedKey: string): number;
  /** Delete postings closed for longer than the retention period. Returns rows removed. */
  purgeClosed(olderThan: Date): number;
  openCount(): number;
  openCountBySource(): Map<string, number>;
  openCountByFeed(feedKeys?: string[]): Map<string, number>;
  /** Distinct companies with at least one open posting. */
  companyCount(): number;
  /** Remove every posting (data reset). */
  clear(): void;
}

// --- companies (ATS boards) -------------------------------------------------------

export interface CompaniesService {
  /** Load the bundled seed registry on first run. Returns rows inserted. */
  seedIfEmpty(): number;
  list(query: CompanyListQuery): CompanyList;
  get(id: string): CompanyBoard | undefined;
  /** Boards to sync, optionally for one ATS. */
  enabledBoards(ats?: AtsKind): BoardRef[];
  /**
   * Work out which ATS board(s) a company name or careers URL refers to
   * (parse known URL shapes, otherwise probe likely tokens on each ATS).
   */
  detect(input: string): Promise<CompanyDetection[]>;
  add(input: { ats: AtsKind; token: string; name: string; industry?: string }): CompanyBoard;
  patch(id: string, patch: { enabled?: boolean; name?: string }): CompanyBoard;
  bulk(update: CompanyBulkUpdate): number;
  remove(id: string): void;
  exportUser(): DataExport['userCompanies'];
  importUser(items: DataExport['userCompanies']): number;
}

// --- syncing ------------------------------------------------------------------------

export interface SyncService {
  /** Start the background scheduler (no-op when syncing is disabled in config). */
  start(): void;
  /** Stop scheduling and wait for in-flight feeds to settle. */
  stop(): Promise<void>;
  summary(): IndexSummary;
  sourceInfos(): SourceInfo[];
  sourceInfo(id: string): SourceInfo | undefined;
  /** Apply enable/config/ttl changes, then return the updated info. */
  updateSource(id: string, patch: SourcePatch): SourceInfo;
  /**
   * Queue feeds for syncing. By default only stale feeds of enabled sources;
   * `force` ignores freshness. Returns the number of feeds queued.
   */
  requestSync(opts?: { sources?: string[]; feedKeys?: string[]; force?: boolean }): number;
  /** Make one small real request to check a source works with the current config. */
  testSource(id: string): Promise<SourceTestResult>;
  /**
   * Run enabled "search"-mode sources for a user query and ingest what they return.
   * Never rejects; resolves with the number of postings added once all have settled.
   */
  searchUpstream(query: UpstreamQuery): Promise<{ added: number }>;
  /** Fetch a missing description from the source and store it. Returns the HTML ('' when unavailable). */
  fetchDescription(jobId: string): Promise<string>;
  /** Check whether a posting is still live at its source. */
  checkLiveness(jobId: string): Promise<LivenessResult>;
  /** Resolves when nothing is queued or running (tests). */
  idle(): Promise<void>;
}

// --- user state on jobs ------------------------------------------------------------------

export interface UserStateService {
  /** State for many clusters at once (hidden, viewed, tracker status). */
  forClusters(clusterKeys: string[]): Map<string, JobUserState>;
  forCluster(clusterKey: string): JobUserState;
  hide(job: { id: string; clusterKey: string }): void;
  unhide(clusterKey: string): void;
  markViewed(job: { id: string; clusterKey: string }): void;
  exportHidden(): DataExport['hiddenJobs'];
  importHidden(items: DataExport['hiddenJobs']): number;
  clear(): void;
}

// --- search ------------------------------------------------------------------------------

export interface SearchService {
  search(query: SearchQuery): SearchResponse;
  /** Number of results a query has, optionally only postings first seen after a date. Deduplicated like search(). */
  count(query: SearchQuery, opts?: { firstSeenAfter?: IsoDate }): number;
  /** Full detail for one posting, scored against `query` (or the profile alone when omitted). */
  jobDetail(id: string, query?: SearchQuery): JobDetail | undefined;
  /** A ready-to-run query built from the saved profile's preferences. */
  queryFromProfile(): SearchQuery;
  /** Translate a user query for upstream "search"-mode sources. */
  toUpstreamQuery(query: SearchQuery): UpstreamQuery;
  suggestTitles(q: string, limit?: number): TitleSuggestion[];
  suggestLocations(q: string, limit?: number): Place[];
  suggestSkills(q: string, limit?: number): SkillSuggestion[];
  suggestCompanies(q: string, limit?: number): Array<{ name: string; count: number }>;
  history(limit?: number): SearchHistoryEntry[];
  recordHistory(query: SearchQuery, total: number): void;
  clearHistory(): void;
}

// --- saved searches ------------------------------------------------------------------------

export interface SavedSearchService {
  list(): SavedSearch[];
  create(input: { name: string; query: SearchQuery }): SavedSearch;
  patch(id: string, patch: { name?: string; query?: SearchQuery; pinned?: boolean }): SavedSearch;
  markViewed(id: string): SavedSearch;
  remove(id: string): void;
  /** Totals for the app shell badge. */
  totals(): { count: number; newResults: number };
  exportAll(): DataExport['savedSearches'];
  importAll(items: DataExport['savedSearches']): number;
  clear(): void;
}

// --- applications --------------------------------------------------------------------------

export interface ApplicationsService {
  list(filter?: { status?: ApplicationStatus; q?: string }): Application[];
  get(id: string): ApplicationDetail | undefined;
  create(input: ApplicationCreate): ApplicationDetail;
  patch(id: string, patch: ApplicationPatch): ApplicationDetail;
  remove(id: string): void;
  addEvent(id: string, input: ApplicationEventCreate): ApplicationEvent;
  removeEvent(id: string, eventId: string): void;
  addDocument(id: string, input: DocumentCreate): ApplicationDocument;
  patchDocument(id: string, docId: string, patch: { title?: string; content?: string }): ApplicationDocument;
  removeDocument(id: string, docId: string): void;
  stats(): ApplicationStats;
  /** Tracker status per job cluster, for decorating search results. */
  stateByCluster(clusterKeys: string[]): Map<string, { applicationId: string; status: ApplicationStatus }>;
  exportAll(): ApplicationDetail[];
  importAll(items: ApplicationDetail[]): number;
  clear(): void;
}

// --- apply kit -------------------------------------------------------------------------------

export interface ApplyKitService {
  analyze(target: { jobId?: string; applicationId?: string }): FitAnalysis;
  coverLetter(request: CoverLetterRequest): Promise<DraftResult>;
  answer(request: AnswerDraftRequest): Promise<AnswerDraftResult>;
  aiStatus(): AiStatus;
  aiTest(): Promise<AiStatus>;
}

// --- container ---------------------------------------------------------------------------------

export interface Services {
  settings: SettingsService;
  profile: ProfileService;
  jobs: JobStore;
  companies: CompaniesService;
  sync: SyncService;
  userState: UserStateService;
  applications: ApplicationsService;
  search: SearchService;
  savedSearches: SavedSearchService;
  applyKit: ApplyKitService;
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

/** Everything a feature needs. `services` is filled in dependency order during startup. */
export interface AppContext {
  config: AppConfig;
  db: Db;
  http: HttpClient;
  events: EventBus;
  log: Logger;
  now(): Date;
  services: Services;
}
