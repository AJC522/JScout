/**
 * The HTTP API contract. Every route the server exposes is listed in `ApiRoutes`
 * with its params, query, body and response types. The server implements exactly
 * these; the client calls them through the typed helper in src/client/api/client.ts.
 *
 * Conventions:
 *  - JSON in, JSON out (except the résumé upload/download and the SSE stream).
 *  - Errors are `ApiErrorBody` with an appropriate 4xx/5xx status.
 *  - `:name` segments in a route key are path params and appear in `params`.
 */
import type {
  AiStatus,
  AnswerDraftRequest,
  AnswerDraftResult,
  AppSettings,
  AppSettingsUpdate,
  Application,
  ApplicationContact,
  ApplicationDetail,
  ApplicationDocument,
  ApplicationEvent,
  ApplicationEventType,
  ApplicationStats,
  ApplicationStatus,
  AtsKind,
  Bootstrap,
  ChecklistItem,
  CompanyBoard,
  CompanyDetection,
  CoverLetterRequest,
  DocumentKind,
  DraftResult,
  EducationEntry,
  ExperienceEntry,
  FitAnalysis,
  GeneratedBy,
  IndexSummary,
  IsoDate,
  JobDetail,
  JobSnapshot,
  JobUserState,
  LivenessResult,
  PersonalInfo,
  Place,
  Profile,
  ProfileCompleteness,
  QuickFillField,
  ResumeAnalysis,
  ResumeInfo,
  ResumeReview,
  ResumeReviewRequest,
  ResumeReworkRequest,
  ResumeReworkResult,
  ResumeScoreSummary,
  SavedAnswer,
  SavedSearch,
  SearchPreferences,
  SearchQuery,
  SearchResponse,
  SkillSuggestion,
  SourceInfo,
  TitleSuggestion,
  WorkDetails,
} from './types';

export interface Ok {
  ok: true;
}

export interface SuggestQuery {
  q: string;
  limit?: number;
}

export interface ProfilePatch {
  personal?: Partial<PersonalInfo>;
  work?: Partial<WorkDetails>;
  preferences?: Partial<SearchPreferences>;
  /** Arrays replace the stored array wholesale. */
  experience?: ExperienceEntry[];
  education?: EducationEntry[];
  answers?: SavedAnswer[];
  onboardedAt?: IsoDate | null;
}

export interface ResumeResult {
  resume: ResumeInfo;
  analysis: ResumeAnalysis;
}

export interface SourcePatch {
  enabled?: boolean;
  /** Config values by field key; null clears a value. */
  config?: Record<string, string | null>;
  ttlMinutes?: number;
}

export interface SourceTestResult {
  ok: boolean;
  message: string;
  /** Postings returned by the test request. */
  sample?: number;
}

export interface CompanyListQuery {
  q?: string;
  ats?: AtsKind;
  enabled?: boolean;
  origin?: 'seed' | 'user';
  industry?: string;
  limit?: number;
  offset?: number;
}

export interface CompanyList {
  total: number;
  enabledTotal: number;
  items: CompanyBoard[];
  industries: Array<{ value: string; count: number }>;
}

export interface CompanyBulkUpdate {
  enabled: boolean;
  /** Limit to these ids; otherwise applies to every board matching the other filters. */
  ids?: string[];
  industry?: string;
  origin?: 'seed' | 'user';
}

export interface ApplicationCreate {
  /** Create from an indexed job… */
  jobId?: string;
  /** …or from details typed in by hand (title and company required). */
  job?: Partial<JobSnapshot> & { title: string; company: string };
  status?: ApplicationStatus;
  notes?: string;
}

export interface ApplicationPatch {
  status?: ApplicationStatus;
  notes?: string;
  priority?: 0 | 1 | 2 | 3;
  contacts?: ApplicationContact[];
  checklist?: ChecklistItem[];
  followUpAt?: IsoDate | null;
  appliedAt?: IsoDate | null;
  sortOrder?: number;
  job?: Partial<JobSnapshot>;
}

export interface ApplicationEventCreate {
  type: ApplicationEventType;
  title: string;
  detail?: string;
  at?: IsoDate;
}

export interface DocumentCreate {
  kind: DocumentKind;
  title: string;
  content: string;
  generatedBy: GeneratedBy;
}

export interface SearchHistoryEntry {
  query: SearchQuery;
  ranAt: IsoDate;
  total: number;
}

/** Everything the user owns, for backup and moving between machines. */
export interface DataExport {
  app: 'jscout';
  formatVersion: 1;
  exportedAt: IsoDate;
  profile: Profile;
  savedSearches: Array<Pick<SavedSearch, 'id' | 'name' | 'query' | 'pinned' | 'createdAt' | 'updatedAt' | 'lastViewedAt'>>;
  applications: ApplicationDetail[];
  userCompanies: Array<Pick<CompanyBoard, 'name' | 'ats' | 'token' | 'industry' | 'enabled'>>;
  hiddenJobs: Array<{ clusterKey: string; hiddenAt: IsoDate }>;
}

export interface DataImportResult {
  profile: boolean;
  savedSearches: number;
  applications: number;
  userCompanies: number;
  hiddenJobs: number;
}

export interface ApiRoutes {
  // --- app ---------------------------------------------------------------
  'GET /api/health': { res: { ok: true; version: string } };
  'GET /api/bootstrap': { res: Bootstrap };
  'GET /api/settings': { res: AppSettings };
  'PATCH /api/settings': { body: AppSettingsUpdate; res: AppSettings };
  // GET /api/events is a text/event-stream of ServerEvent (see client/api/events.ts)

  // --- search ------------------------------------------------------------
  'POST /api/search': { body: SearchQuery; res: SearchResponse };
  'GET /api/search/from-profile': { res: SearchQuery };
  'GET /api/search/history': { res: SearchHistoryEntry[] };
  'DELETE /api/search/history': { res: Ok };
  'GET /api/suggest/titles': { query: SuggestQuery; res: TitleSuggestion[] };
  'GET /api/suggest/locations': { query: SuggestQuery; res: Place[] };
  'GET /api/suggest/skills': { query: SuggestQuery; res: SkillSuggestion[] };
  /** Skills of the certification-license category only ("Sec" -> CompTIA Security+). */
  'GET /api/suggest/certifications': { query: SuggestQuery; res: SkillSuggestion[] };
  'GET /api/suggest/companies': { query: SuggestQuery; res: Array<{ name: string; count: number }> };
  /**
   * Optional query string `?query=<JSON.stringify(SearchQuery)>` (see JobDetailQuery): score and explain
   * the job against the search it was opened from; without it, against the profile.
   */
  'GET /api/jobs/:id': { params: { id: string }; res: JobDetail };
  'POST /api/jobs/:id/view': { params: { id: string }; res: JobUserState };
  'POST /api/jobs/:id/hide': { params: { id: string }; res: JobUserState };
  'DELETE /api/jobs/:id/hide': { params: { id: string }; res: JobUserState };
  'POST /api/jobs/:id/check': { params: { id: string }; res: LivenessResult };

  // --- sources, companies, syncing --------------------------------------
  'GET /api/sources': { res: SourceInfo[] };
  'PATCH /api/sources/:id': { params: { id: string }; body: SourcePatch; res: SourceInfo };
  'POST /api/sources/:id/test': { params: { id: string }; res: SourceTestResult };
  'GET /api/sync': { res: IndexSummary };
  'POST /api/sync': { body: { sources?: string[]; force?: boolean }; res: { queued: number } };
  'GET /api/companies': { query: CompanyListQuery; res: CompanyList };
  'POST /api/companies/detect': { body: { input: string }; res: CompanyDetection[] };
  'POST /api/companies': { body: { ats: AtsKind; token: string; name: string; industry?: string }; res: CompanyBoard };
  'POST /api/companies/bulk': { body: CompanyBulkUpdate; res: { updated: number } };
  'PATCH /api/companies/:id': { params: { id: string }; body: { enabled?: boolean; name?: string }; res: CompanyBoard };
  'DELETE /api/companies/:id': { params: { id: string }; res: Ok };

  // --- profile -----------------------------------------------------------
  'GET /api/profile': { res: Profile };
  'PATCH /api/profile': { body: ProfilePatch; res: Profile };
  'GET /api/profile/completeness': { res: ProfileCompleteness };
  // POST /api/profile/resume is multipart/form-data with one "file" field -> ResumeResult
  'PUT /api/profile/resume/text': { body: { text: string }; res: ResumeResult };
  'GET /api/profile/resume/analysis': { res: ResumeAnalysis };
  // GET /api/profile/resume/file downloads the original upload
  'DELETE /api/profile/resume': { res: Profile };
  'GET /api/profile/quick-fill': { res: QuickFillField[] };
  'GET /api/data/export': { res: DataExport };
  'POST /api/data/import': { body: DataExport; res: DataImportResult };
  'POST /api/data/reset': { body: { scope: 'index' | 'everything' }; res: Ok };

  // --- saved searches ----------------------------------------------------
  'GET /api/saved-searches': { res: SavedSearch[] };
  'POST /api/saved-searches': { body: { name: string; query: SearchQuery }; res: SavedSearch };
  'PATCH /api/saved-searches/:id': {
    params: { id: string };
    body: { name?: string; query?: SearchQuery; pinned?: boolean };
    res: SavedSearch;
  };
  'POST /api/saved-searches/:id/viewed': { params: { id: string }; res: SavedSearch };
  'DELETE /api/saved-searches/:id': { params: { id: string }; res: Ok };

  // --- applications ------------------------------------------------------
  'GET /api/applications': { query: { status?: ApplicationStatus; q?: string }; res: Application[] };
  'GET /api/applications/stats': { res: ApplicationStats };
  'POST /api/applications': { body: ApplicationCreate; res: ApplicationDetail };
  'GET /api/applications/:id': { params: { id: string }; res: ApplicationDetail };
  'PATCH /api/applications/:id': { params: { id: string }; body: ApplicationPatch; res: ApplicationDetail };
  'DELETE /api/applications/:id': { params: { id: string }; res: Ok };
  'POST /api/applications/:id/events': { params: { id: string }; body: ApplicationEventCreate; res: ApplicationEvent };
  'DELETE /api/applications/:id/events/:eventId': { params: { id: string; eventId: string }; res: Ok };
  'POST /api/applications/:id/documents': { params: { id: string }; body: DocumentCreate; res: ApplicationDocument };
  'PATCH /api/applications/:id/documents/:docId': {
    params: { id: string; docId: string };
    body: { title?: string; content?: string };
    res: ApplicationDocument;
  };
  'DELETE /api/applications/:id/documents/:docId': { params: { id: string; docId: string }; res: Ok };

  // --- apply kit ---------------------------------------------------------
  'POST /api/applykit/analyze': { body: { jobId?: string; applicationId?: string }; res: FitAnalysis };
  'POST /api/applykit/cover-letter': { body: CoverLetterRequest; res: DraftResult };
  'POST /api/applykit/answer': { body: AnswerDraftRequest; res: AnswerDraftResult };
  /** Score the saved résumé (or a draft) against a job, application or pasted posting. */
  'POST /api/applykit/resume-review': { body: ResumeReviewRequest; res: ResumeReview };
  /** A tailored résumé draft for that target; returned, never saved. */
  'POST /api/applykit/resume-rework': { body: ResumeReworkRequest; res: ResumeReworkResult };
  /** The saved résumé scored against every active application. */
  'GET /api/applykit/resume-scores': { res: ResumeScoreSummary[] };
  'GET /api/ai/status': { res: AiStatus };
  'POST /api/ai/test': { res: AiStatus };
}

export type RouteKey = keyof ApiRoutes;
export type RouteRes<K extends RouteKey> = ApiRoutes[K]['res'];
export type RouteBody<K extends RouteKey> = ApiRoutes[K] extends { body: infer B } ? B : undefined;
export type RouteParams<K extends RouteKey> = ApiRoutes[K] extends { params: infer P } ? P : undefined;
export type RouteQuery<K extends RouteKey> = ApiRoutes[K] extends { query: infer Q } ? Q : undefined;

/** Query-string parameter of GET /api/jobs/:id carrying the search (JSON) to score the job against. */
export const JOB_DETAIL_QUERY_PARAM = 'query';

/** The optional query string of GET /api/jobs/:id. */
export interface JobDetailQuery {
  /** JSON.stringify of the SearchQuery the job was opened from. */
  [JOB_DETAIL_QUERY_PARAM]?: string;
}

/** Routes that do not fit the JSON contract above. */
export const RESUME_UPLOAD_PATH = '/api/profile/resume';
export const RESUME_FILE_PATH = '/api/profile/resume/file';
export const EVENTS_PATH = '/api/events';
