/**
 * Greenhouse Job Board API (https://boards-api.greenhouse.io) — one feed per employer board.
 *
 * GET /v1/boards/{token}/jobs?content=true&pay_transparency=true returns every published post of
 * the board in one response (no pagination, no filters), with descriptions and pay ranges, so a
 * 200 is a complete snapshot. Responses carry a weak ETag and honour If-None-Match (304, empty
 * body); there is no Last-Modified. Responses are `cache-control: private, max-age=0` and never
 * served from the CDN, so every request reaches Greenhouse's origin: hence a 1 s host gap.
 *
 * Quirks handled here (research spec: greenhouse.md):
 *  - `content` is HTML that was entity-escaped once ("&lt;p&gt;…"). It is passed through
 *    unchanged; the central sanitiser detects escaped markup and decodes it exactly once.
 *  - pay_input_ranges amounts are in the currency's minor units (cents for USD, yen for JPY).
 *  - `location.name` is free text; only ";" is a safe list separator. `offices` are the employer's
 *    office tree, not the job's location, so they are used only when the location says nothing.
 *  - No structured remote flag, except a customer-defined "Workplace Type" metadata field.
 */
import {
  type BoardRef,
  type FeedCursor,
  type FeedResult,
  type HttpResponse,
  type JobSource,
  type RawPosting,
  type RawSalary,
  type SourceContext,
  SourceError,
} from './types';
import { absoluteUrl, asArray, asNumber, asRecord, asString, compactStrings, requireArray, requireRecord } from './util';

const API = 'https://boards-api.greenhouse.io/v1/boards';
const MIN_INTERVAL_MS = 1_000;
/** Most boards are a few MB of JSON; allow slow links. */
const FEED_TIMEOUT_MS = 60_000;
/**
 * With descriptions, the largest boards are tens of MB (Anduril's ~2,600 posts passed the HTTP
 * client's 40 MB default on 2026-11-25). Above this the board is read without descriptions instead,
 * and each description is fetched when its posting is opened.
 */
const FEED_MAX_BYTES = 150 * 1024 * 1024;
const LARGE_FEED_TIMEOUT_MS = 180_000;

/** ISO 4217 currencies whose minor unit is not 1/100 (Greenhouse's *_cents are minor units). */
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export const greenhouseSource: JobSource = {
  def: {
    id: 'greenhouse',
    name: 'Greenhouse',
    kind: 'ats',
    mode: 'feed',
    homepage: 'https://www.greenhouse.com',
    description:
      'Job boards of employers that hire with Greenhouse, read straight from each company’s public board: ' +
      'complete and current, with pay ranges where the employer publishes them. Add the companies you want to follow; ' +
      'remote status is rarely stated in a structured way, so it is mostly inferred from the location text.',
    attribution: 'Jobs from the employer’s Greenhouse job board',
    perCompany: true,
    ats: 'greenhouse',
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 360,
    fullSnapshot: true,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx, board, cursor): Promise<FeedResult> {
    const ref = requireBoard(board);
    checkAborted(ctx);
    let res: HttpResponse<unknown>;
    try {
      res = await ctx.http.getJson(`${boardUrl(ref.token)}/jobs`, {
        query: { content: 'true', pay_transparency: 'true' },
        etag: cursor?.etag,
        minIntervalMs: MIN_INTERVAL_MS,
        timeoutMs: LARGE_FEED_TIMEOUT_MS,
        maxBytes: FEED_MAX_BYTES,
        signal: ctx.signal,
      });
    } catch (err) {
      if (!(err instanceof SourceError && err.kind === 'parse' && /exceeded|too large/i.test(err.message))) throw err;
      ctx.log.warn('greenhouse: board too large to read with descriptions; reading it without them', { board: ref.token });
      checkAborted(ctx);
      res = await ctx.http.getJson(`${boardUrl(ref.token)}/jobs`, {
        query: { pay_transparency: 'true' },
        minIntervalMs: MIN_INTERVAL_MS,
        timeoutMs: FEED_TIMEOUT_MS,
        signal: ctx.signal,
      });
    }
    if (res.status === 304) {
      return { postings: [], complete: false, notModified: true, cursor: validators(res, cursor) };
    }

    const envelope = requireRecord(res.data, 'Greenhouse jobs response');
    const jobs = requireArray(envelope.jobs, 'Greenhouse jobs response "jobs"');
    checkAborted(ctx);

    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    let failed = 0;
    jobs.forEach((job, index) => {
      try {
        const posting = mapJob(job, ref);
        if (seen.has(posting.externalId)) return;
        seen.add(posting.externalId);
        postings.push(posting);
      } catch (err) {
        failed++;
        ctx.log.warn('greenhouse: skipped a malformed posting', {
          board: ref.token,
          index,
          id: asString(asRecord(job)?.id),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });
    if (failed > 0 && failed === jobs.length) {
      throw new SourceError('parse', `Greenhouse jobs response: none of the ${failed} entries is a posting`);
    }

    // meta.total always equalled jobs.length in research; if it ever does not, the list may be
    // truncated and must not be used to close postings.
    const total = asNumber(asRecord(envelope.meta)?.total);
    const complete = total === undefined || total === jobs.length;
    if (!complete) {
      ctx.log.warn('greenhouse: meta.total disagrees with the jobs received; not treating the response as complete', {
        board: ref.token,
        received: jobs.length,
        total,
      });
    }
    return { postings, complete, cursor: validators(res) };
  },

  async fetchDetail(ctx, posting, board) {
    const ref = requireBoard(board);
    checkAborted(ctx);
    const res = await ctx.http.getJson(`${boardUrl(ref.token)}/jobs/${encodeURIComponent(posting.externalId)}`, {
      query: { pay_transparency: 'true' },
      allowStatus: [404],
      minIntervalMs: MIN_INTERVAL_MS,
      signal: ctx.signal,
    });
    if (res.status === 404) return null;
    const job = requireRecord(res.data, 'Greenhouse job response');
    const detail: Partial<RawPosting> = {};
    const html = descriptionOf(job);
    if (html) detail.descriptionHtml = html;
    const salary = salaryOf(job.pay_input_ranges);
    if (salary) detail.salary = salary;
    return detail;
  },

  async probeBoard(ctx, token) {
    checkAborted(ctx);
    const info = await ctx.http.getJson(boardUrl(token), {
      allowStatus: [404],
      minIntervalMs: MIN_INTERVAL_MS,
      signal: ctx.signal,
    });
    if (info.status === 404) return null;
    const name = asString(requireRecord(info.data, 'Greenhouse board response').name);

    // The light list (no content) is the cheapest way to count: ~55 bytes per job gzipped.
    const list = await ctx.http.getJson(`${boardUrl(token)}/jobs`, {
      allowStatus: [404],
      minIntervalMs: MIN_INTERVAL_MS,
      signal: ctx.signal,
    });
    if (list.status === 404) return null;
    const envelope = requireRecord(list.data, 'Greenhouse jobs response');
    const jobs = requireArray(envelope.jobs, 'Greenhouse jobs response "jobs"');
    const total = asNumber(asRecord(envelope.meta)?.total);
    return { jobs: total ?? jobs.length, ...(name ? { name } : {}) };
  },
};

function boardUrl(token: string): string {
  return `${API}/${encodeURIComponent(token.trim())}`;
}

function requireBoard(board: BoardRef | undefined): BoardRef {
  if (!board || !board.token.trim()) throw new SourceError('not-found', 'Greenhouse needs a company board token');
  return board;
}

function checkAborted(ctx: SourceContext): void {
  if (ctx.signal?.aborted) throw new SourceError('aborted', 'Greenhouse request was cancelled');
}

function validators(res: HttpResponse<unknown>, previous?: FeedCursor): FeedCursor | undefined {
  const etag = asString(res.headers.etag) ?? previous?.etag;
  return etag ? { etag } : undefined;
}

function mapJob(value: unknown, board: BoardRef): RawPosting {
  const job = asRecord(value);
  if (!job) throw new Error('not an object');
  const externalId = asString(job.id);
  const title = asString(job.title);
  const url = absoluteUrl(job.absolute_url);
  if (!externalId) throw new Error('missing id');
  if (!title) throw new Error('missing title');
  if (!url) throw new Error('missing or non-http absolute_url');

  const posting: RawPosting = {
    externalId,
    url,
    title,
    company: board.name.trim() || board.token,
    locations: locationsOf(job),
  };
  const remote = workplaceOf(job.metadata);
  if (remote) posting.remote = remote;
  const html = descriptionOf(job);
  if (html) posting.descriptionHtml = html;
  const postedAt = asString(job.first_published);
  if (postedAt) posting.postedAt = postedAt;
  const updatedAt = asString(job.updated_at);
  if (updatedAt) posting.updatedAt = updatedAt;
  const deadline = asString(job.application_deadline);
  if (deadline) posting.expiresAt = deadline;
  const salary = salaryOf(job.pay_input_ranges);
  if (salary) posting.salary = salary;
  const department = asString(asRecord(asArray(job.departments)[0])?.name);
  if (department) posting.department = department;
  return posting;
}

/** `content` exactly as given (still entity-escaped); only blank values are dropped. */
function descriptionOf(job: Record<string, unknown>): string | undefined {
  return typeof job.content === 'string' && job.content.trim() !== '' ? job.content : undefined;
}

const NO_LOCATION = /^(n\/?a|none|tbd|-+)$/i;
const BARE_REMOTE = /^remote$/i;

/**
 * location.name split on ";" (the only separator Greenhouse itself uses). Office names are added
 * only when the location carries no place at all (missing, "N/A", or a bare "Remote"): offices are
 * the employer's office tree and often disagree with the post's real location.
 */
function locationsOf(job: Record<string, unknown>): string[] {
  const name = asString(asRecord(job.location)?.name) ?? '';
  const fromLocation = compactStrings(name.split(';')).filter((s) => !NO_LOCATION.test(s));
  if (fromLocation.some((s) => !BARE_REMOTE.test(s))) return fromLocation;
  const offices = compactStrings(asArray(job.offices).map((o) => asRecord(o)?.name)).filter(
    (s) => !/^no office$/i.test(s) && !BARE_REMOTE.test(s) && !NO_LOCATION.test(s),
  );
  return compactStrings([...fromLocation, ...offices]);
}

/** The customer-defined "Workplace Type" single-select (seen on airbnb: Remote / Hybrid / Onsite). */
function workplaceOf(metadata: unknown): RawPosting['remote'] {
  for (const item of asArray(metadata)) {
    const field = asRecord(item);
    if (!field || !/^workplace[ _-]?type$/i.test(asString(field.name) ?? '')) continue;
    const value = (asString(field.value) ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    if (value === 'remote' || value === 'fullyremote') return 'remote';
    if (value === 'hybrid') return 'hybrid';
    if (value === 'onsite' || value === 'inoffice' || value === 'office') return 'onsite';
  }
  return undefined;
}

/** First pay range (all observed posts have at most one), minor units converted to major units. */
function salaryOf(ranges: unknown): RawSalary | undefined {
  const range = asRecord(asArray(ranges)[0]);
  if (!range) return undefined;
  const currency = asString(range.currency_type)?.toUpperCase();
  const divisor = 10 ** (currency && ZERO_DECIMAL.has(currency) ? 0 : currency && THREE_DECIMAL.has(currency) ? 3 : 2);
  const minCents = asNumber(range.min_cents);
  const maxCents = asNumber(range.max_cents);
  if (minCents === undefined && maxCents === undefined) return undefined;

  const salary: RawSalary = {};
  if (minCents !== undefined) salary.min = minCents / divisor;
  if (maxCents !== undefined) salary.max = maxCents / divisor;
  if (currency) salary.currency = currency;
  // No period field: the employer's free-text title ("Hourly Range for this internship is:",
  // "Salary Range: ", "On Target Earnings") is the only hint. It is kept as the salary text only
  // when it says more than a heading.
  const title = asString(range.title);
  if (title) {
    if (isInformativeTitle(title, currency)) salary.text = title;
    if (/\bhour(ly)?\b/i.test(title)) salary.period = 'hour';
    else if (/\bmonth(ly)?\b/i.test(title)) salary.period = 'month';
    else if (/\bweek(ly)?\b/i.test(title)) salary.period = 'week';
    else if (/\b(day|daily)\b/i.test(title)) salary.period = 'day';
    else if (/\b(year(ly)?|annual(ly)?|per annum)\b/i.test(title)) salary.period = 'year';
  }
  return salary;
}

/** Words that make up bare pay-range headings: "Salary Range:", "Base Salary", "Hourly Range for this internship is:". */
const HEADING_WORDS = new Set(
  ('salary salaries pay compensation comp range ranges band base wage wages rate rates hourly annual annually yearly ' +
    'monthly weekly daily per hour year annum month week day gross expected estimated anticipated starting the a an ' +
    'this our for of is are role position job opening opportunity internship intern transparency information').split(' '),
);

/**
 * A range title worth keeping: it holds an amount, or something besides heading words, such as what the
 * range is ("On Target Earnings") or where it applies ("US Pay Range"). The currency code alone adds nothing.
 */
function isInformativeTitle(title: string, currency: string | undefined): boolean {
  if (/\d/.test(title)) return true;
  const words = title.toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.some((w) => !HEADING_WORDS.has(w) && w !== currency?.toLowerCase());
}
