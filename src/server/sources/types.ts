/**
 * The contract every job source adapter implements.
 *
 * Adapters are deliberately dumb: fetch, map fields to RawPosting, return.
 * They do NOT sanitise HTML, parse salaries/locations/dates beyond what the
 * source gives in structured form, deduplicate, or touch the database — the
 * ingest pipeline (src/server/ingest) does all of that in one place.
 */
import type { AtsKind, SalaryPeriod, SourceConfigField, SourceKind, SourceMode } from '../../shared/types';

export interface RawSalary {
  min?: number;
  max?: number;
  /** ISO 4217 code when the source gives one. */
  currency?: string;
  period?: SalaryPeriod;
  /** Free-text salary exactly as given, e.g. "$120k – $150k + equity". */
  text?: string;
}

export interface RawPosting {
  /** Stable id within the source (for ATS boards: unique within the company board). */
  externalId: string;
  /** Canonical human-facing posting URL. */
  url: string;
  /** Direct apply URL when different from `url`. */
  applyUrl?: string;
  title: string;
  company: string;
  companyUrl?: string;
  companyLogo?: string;
  /** Raw location strings exactly as given, e.g. ["New York, NY", "Remote - US"]. [] when unknown. */
  locations: string[];
  /** ONLY when the source states it in a structured field. */
  remote?: 'remote' | 'hybrid' | 'onsite';
  /** Raw HTML as given by the source. */
  descriptionHtml?: string;
  /** Plain text when the source has no HTML. */
  descriptionText?: string;
  /** Publication date: ISO-8601, RFC 2822, or epoch seconds/milliseconds as given. */
  postedAt?: string | number;
  updatedAt?: string | number;
  /** When the source says the posting expires (same formats as postedAt). Expired postings are dropped at ingest. */
  expiresAt?: string | number;
  salary?: RawSalary;
  /** Raw value, e.g. "Full-time", "contract". */
  employmentType?: string;
  /** Raw value when the source provides one, e.g. "Senior", "Mid-Senior level". */
  seniority?: string;
  department?: string;
  /** Categories / skill tags from the source. */
  tags?: string[];
}

export interface SourceDefinition {
  /** kebab-case id, e.g. "remotive", "greenhouse". Also the feed key for non-company sources. */
  id: string;
  name: string;
  kind: SourceKind;
  /** "feed": mirror the current set of postings. "search": query upstream per user search. */
  mode: SourceMode;
  homepage: string;
  /** One or two sentences shown in Settings. */
  description: string;
  /** Credit the source asks for; shown with its postings. */
  attribution?: string;
  /** True for ATS adapters: one feed per company board (feed key "<id>:<token>"). */
  perCompany: boolean;
  /** For perCompany adapters, which ATS this is. */
  ats?: AtsKind;
  /** API keys etc. the user must supply before the source can be used. */
  configFields: SourceConfigField[];
  /** Enabled out of the box (sources needing config are effectively off until configured). */
  defaultEnabled: boolean;
  /** How long a successful sync stays fresh. */
  defaultTtlMinutes: number;
  /**
   * True when a successful feed fetch returns the COMPLETE set of open postings,
   * so anything missing from it can be marked closed.
   */
  fullSnapshot: boolean;
  /**
   * For fullSnapshot sources whose "complete" fetch can still miss postings (e.g. pages
   * cached separately by a CDN): a posting absent from a complete fetch is closed only
   * once it has also not been seen for this many minutes. Default 0 (close immediately).
   */
  closeGraceMinutes?: number;
  /** Minimum gap between requests to this source's host, in ms. */
  minRequestIntervalMs: number;
}

export interface BoardRef {
  ats: AtsKind;
  token: string;
  /** Display name to use as the company for every posting from this board. */
  name: string;
}

export interface FeedCursor {
  etag?: string;
  lastModified?: string;
}

export interface FeedResult {
  postings: RawPosting[];
  /**
   * True when `postings` is the complete open set for this feed (allows closing
   * postings that disappeared). Must be false when pagination was cut short,
   * a page failed, or the source only exposes a window.
   */
  complete: boolean;
  /** True when the server answered 304; `postings` is then empty and must be ignored. */
  notModified?: boolean;
  cursor?: FeedCursor;
}

/** A user search translated for upstream "search"-mode sources. */
export interface UpstreamQuery {
  /** Title/keyword phrases, most important first (already includes chosen synonyms). */
  keywords: string[];
  /** Free-text location as typed by the user. */
  locationText?: string;
  city?: string;
  admin1?: string;
  /** ISO alpha-2. */
  country?: string;
  remoteOnly?: boolean;
  postedWithinDays?: number;
  /** Yearly minimum in `salaryCurrency`. */
  salaryMin?: number;
  salaryCurrency?: string;
  /** Upper bound on postings to return. */
  limit: number;
}

export interface SourceLogger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
}

export interface SourceContext {
  http: HttpClient;
  /** Values for the definition's configFields (only keys that are set). */
  config: Record<string, string>;
  log: SourceLogger;
  signal?: AbortSignal;
  now(): Date;
}

export interface JobSource {
  readonly def: SourceDefinition;
  /**
   * Feed mode. For perCompany sources `board` is always provided.
   * `cursor` carries the validators from the last successful fetch for conditional requests.
   * Throw SourceError on failure; never return partial data as complete.
   */
  fetchFeed?(ctx: SourceContext, board?: BoardRef, cursor?: FeedCursor): Promise<FeedResult>;
  /** Search mode. */
  search?(ctx: SourceContext, query: UpstreamQuery): Promise<RawPosting[]>;
  /**
   * Fetch the full description for a posting whose feed entry lacks one.
   * Return only the fields that were missing; null when the posting no longer exists.
   */
  fetchDetail?(
    ctx: SourceContext,
    posting: { externalId: string; url: string },
    board?: BoardRef,
  ): Promise<Partial<RawPosting> | null>;
  /**
   * For feeds that are NOT complete snapshots (rolling windows): report which of the
   * given postings are still open, so ones that dropped out of the window can be
   * closed when the source says so. Ids missing from the result are left untouched.
   */
  checkOpen?(ctx: SourceContext, externalIds: string[]): Promise<Map<string, boolean>>;
  /**
   * perCompany sources: quick existence probe used when a user adds a company.
   * Resolve with the open-job count and the board's display name when it can be read; null when the board does not exist.
   */
  probeBoard?(ctx: SourceContext, token: string): Promise<{ jobs: number; name?: string } | null>;
}

export type SourceErrorKind =
  | 'network' // DNS/TCP/TLS/timeouts
  | 'http' // unexpected status
  | 'rate-limited' // 429 or equivalent
  | 'not-found' // board/feed does not exist
  | 'auth' // missing/invalid credentials
  | 'blocked' // bot protection, 403 challenge pages
  | 'parse' // payload not in the expected shape
  | 'aborted';

export class SourceError extends Error {
  readonly kind: SourceErrorKind;
  readonly status?: number;
  /** Seconds the server asked us to wait, when given. */
  readonly retryAfter?: number;

  constructor(kind: SourceErrorKind, message: string, opts: { status?: number; retryAfter?: number; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'SourceError';
    this.kind = kind;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
  }
}

// --- HTTP ---------------------------------------------------------------------

export interface HttpRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Appended to the URL; undefined values are skipped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON-encoded when an object. */
  body?: unknown;
  timeoutMs?: number;
  /** Retries on network errors, 5xx and 429 (honouring Retry-After up to a cap). Default 2. */
  retries?: number;
  /** Abort and fail when the body exceeds this many bytes. Default 40 MB. */
  maxBytes?: number;
  /** Minimum gap between requests to this host, in ms. Default 1000. */
  minIntervalMs?: number;
  /** Conditional request validators. */
  etag?: string;
  lastModified?: string;
  /** Statuses to return instead of throwing (e.g. [404]). 304 is always returned. */
  allowStatus?: number[];
  signal?: AbortSignal;
}

export interface HttpResponse<T> {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  /** Parsed body; undefined for 304 and for allowed statuses whose body is not parseable. */
  data: T | undefined;
  /** Raw body text ('' for 304). */
  text: string;
  url: string;
}

/**
 * The only way adapters talk to the network. Implementations enforce per-host
 * pacing, timeouts, size limits and retries, and translate failures into SourceError.
 * Tests replace it with a fake that serves fixtures.
 */
export interface HttpClient {
  getJson<T = unknown>(url: string, opts?: HttpRequestOptions): Promise<HttpResponse<T>>;
  getText(url: string, opts?: HttpRequestOptions): Promise<HttpResponse<string>>;
  postJson<T = unknown>(url: string, body: unknown, opts?: HttpRequestOptions): Promise<HttpResponse<T>>;
}
