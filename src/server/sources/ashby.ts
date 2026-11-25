/**
 * Ashby public Job Posting API (https://api.ashbyhq.com/posting-api/job-board/{name}) — one feed
 * per employer board.
 *
 * One GET with includeCompensation=true returns every listed posting of the board, descriptions
 * and pay included, as {"jobs":[...],"apiVersion":"1"}: no pagination, so a 200 is a complete
 * snapshot (876 postings for the largest board probed). Responses come from Cloudflare's cache
 * (`cache-control: public, max-age=60`) with a weak ETag that honours If-None-Match (304), so a
 * 500 ms host gap is polite. An unknown board is a plain-text 404. There is no public
 * single-posting endpoint (the obvious path answers 401), so fetchDetail re-reads the board.
 * Research notes: ashby.md.
 */
import type { SalaryPeriod } from '../../shared/types';
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

const API = 'https://api.ashbyhq.com/posting-api/job-board';
const MIN_INTERVAL_MS = 500;
/** The largest board seen is 15 MB of JSON (1.8 MB compressed). */
const FEED_TIMEOUT_MS = 60_000;

export const ashbySource: JobSource = {
  def: {
    id: 'ashby',
    name: 'Ashby',
    kind: 'ats',
    mode: 'feed',
    homepage: 'https://www.ashbyhq.com',
    description:
      'Job boards of employers that hire with Ashby, read straight from each company’s public board: ' +
      'complete and current, with remote/hybrid/on-site status and pay ranges where the employer publishes them. ' +
      'Add the companies you want to follow.',
    attribution: 'Jobs from the employer’s Ashby job board',
    perCompany: true,
    ats: 'ashby',
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 360,
    fullSnapshot: true,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx, board, cursor): Promise<FeedResult> {
    const ref = requireBoard(board);
    checkAborted(ctx);
    const res = await ctx.http.getJson(boardUrl(ref.token), {
      query: { includeCompensation: 'true' },
      etag: cursor?.etag,
      minIntervalMs: MIN_INTERVAL_MS,
      timeoutMs: FEED_TIMEOUT_MS,
      signal: ctx.signal,
    });
    if (res.status === 304) {
      return { postings: [], complete: false, notModified: true, cursor: validators(res, cursor) };
    }

    const jobs = jobsOf(res.data);
    checkAborted(ctx);
    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    let failed = 0;
    jobs.forEach((job, index) => {
      try {
        const posting = mapJob(job, ref);
        if (!posting || seen.has(posting.externalId)) return;
        seen.add(posting.externalId);
        postings.push(posting);
      } catch (err) {
        failed++;
        ctx.log.warn('ashby: skipped a malformed posting', {
          board: ref.token,
          index,
          id: asString(asRecord(job)?.id),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });
    if (failed > 0 && failed === jobs.length) {
      throw new SourceError('parse', `Ashby job board response: none of the ${failed} entries is a posting`);
    }
    return { postings, complete: true, cursor: validators(res) };
  },

  /** Re-reads the board (Ashby has no public per-posting endpoint); null when the posting or board is gone. */
  async fetchDetail(ctx, posting, board) {
    const ref = requireBoard(board);
    checkAborted(ctx);
    const res = await ctx.http.getJson(boardUrl(ref.token), {
      query: { includeCompensation: 'true' },
      allowStatus: [404],
      minIntervalMs: MIN_INTERVAL_MS,
      timeoutMs: FEED_TIMEOUT_MS,
      signal: ctx.signal,
    });
    if (res.status === 404) return null;
    const job = jobsOf(res.data)
      .map((j) => asRecord(j))
      .find((j) => j !== undefined && asString(j.id) === posting.externalId && j.isListed !== false);
    if (!job) return null;
    const detail: Partial<RawPosting> = {};
    Object.assign(detail, descriptionOf(job));
    const salary = salaryOf(job.compensation);
    if (salary) detail.salary = salary;
    return detail;
  },

  /** No cheaper request exists than the board itself; Ashby does not expose the company's display name. */
  async probeBoard(ctx, token) {
    checkAborted(ctx);
    const res = await ctx.http.getJson(boardUrl(token), {
      allowStatus: [404],
      minIntervalMs: MIN_INTERVAL_MS,
      timeoutMs: FEED_TIMEOUT_MS,
      signal: ctx.signal,
    });
    if (res.status === 404) return null;
    const jobs = jobsOf(res.data).filter((j) => asRecord(j)?.isListed !== false);
    return { jobs: jobs.length };
  },
};

function boardUrl(token: string): string {
  return `${API}/${encodeURIComponent(token.trim())}`;
}

function requireBoard(board: BoardRef | undefined): BoardRef {
  if (!board || !board.token.trim()) throw new SourceError('not-found', 'Ashby needs a job board name');
  return board;
}

function checkAborted(ctx: SourceContext): void {
  if (ctx.signal?.aborted) throw new SourceError('aborted', 'Ashby request was cancelled');
}

function validators(res: HttpResponse<unknown>, previous?: FeedCursor): FeedCursor | undefined {
  const etag = asString(res.headers.etag) ?? previous?.etag;
  return etag ? { etag } : undefined;
}

function jobsOf(data: unknown): unknown[] {
  const envelope = requireRecord(data, 'Ashby job board response');
  return requireArray(envelope.jobs, 'Ashby job board response "jobs"');
}

/** Null for postings the board marks unlisted (never seen in research, but not meant to be public). */
function mapJob(value: unknown, board: BoardRef): RawPosting | null {
  const job = asRecord(value);
  if (!job) throw new Error('not an object');
  if (job.isListed === false) return null;
  const externalId = asString(job.id);
  const title = asString(job.title);
  const url = absoluteUrl(job.jobUrl);
  if (!externalId) throw new Error('missing id');
  if (!title) throw new Error('missing title');
  if (!url) throw new Error('missing or non-http jobUrl');

  const posting: RawPosting = {
    externalId,
    url,
    title,
    company: board.name.trim() || board.token,
    locations: locationsOf(job),
  };
  const applyUrl = absoluteUrl(job.applyUrl);
  if (applyUrl && applyUrl !== url) posting.applyUrl = applyUrl;
  const remote = workplaceOf(job.workplaceType);
  if (remote) posting.remote = remote;
  Object.assign(posting, descriptionOf(job));
  const postedAt = asString(job.publishedAt);
  if (postedAt) posting.postedAt = postedAt;
  const salary = salaryOf(job.compensation);
  if (salary) posting.salary = salary;
  const employmentType = asString(job.employmentType);
  if (employmentType) posting.employmentType = employmentType;
  const department = asString(job.department);
  const team = asString(job.team);
  if (department ?? team) posting.department = department ?? team;
  if (department && team && team.toLowerCase() !== department.toLowerCase()) posting.tags = [team];
  return posting;
}

function descriptionOf(job: Record<string, unknown>): Pick<RawPosting, 'descriptionHtml' | 'descriptionText'> {
  if (typeof job.descriptionHtml === 'string' && job.descriptionHtml.trim() !== '') return { descriptionHtml: job.descriptionHtml };
  const text = asString(job.descriptionPlain);
  return text ? { descriptionText: text } : {};
}

/** Primary location then secondary ones, raw; an entry without a location string falls back to its postal address. */
function locationsOf(job: Record<string, unknown>): string[] {
  const entries = [job, ...asArray(job.secondaryLocations).map((s) => asRecord(s) ?? {})];
  return compactStrings(entries.map((entry) => asString(entry.location) ?? addressText(entry.address)));
}

function addressText(value: unknown): string | undefined {
  const postal = asRecord(asRecord(value)?.postalAddress);
  if (!postal) return undefined;
  const parts = compactStrings([postal.addressLocality, postal.addressRegion, postal.addressCountry]);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** workplaceType only: `isRemote` is also true for hybrid jobs, so it cannot tell remote from hybrid. */
function workplaceOf(value: unknown): RawPosting['remote'] {
  const v = asString(value)?.toLowerCase().replace(/[\s_-]+/g, '');
  if (v === 'remote') return 'remote';
  if (v === 'hybrid') return 'hybrid';
  if (v === 'onsite') return 'onsite';
  return undefined;
}

const INTERVALS: Record<string, SalaryPeriod> = { YEAR: 'year', MONTH: 'month', WEEK: 'week', DAY: 'day', HOUR: 'hour' };

/**
 * Base salary from `summaryComponents` (its Salary entry spans every tier: lowest min, highest max),
 * else the first tier's Salary component. `compensationTierSummary` ("$216K – $240K • Offers Equity
 * • Multiple Ranges") is kept as the text.
 */
function salaryOf(value: unknown): RawSalary | undefined {
  const comp = asRecord(value);
  if (!comp) return undefined;
  const isSalary = (c: unknown) => asString(asRecord(c)?.compensationType)?.toLowerCase() === 'salary';
  const tierComponents = asArray(comp.compensationTiers).flatMap((t) => asArray(asRecord(t)?.components));
  const component = asRecord(asArray(comp.summaryComponents).find(isSalary) ?? tierComponents.find(isSalary));
  const text = asString(comp.compensationTierSummary);

  const salary: RawSalary = {};
  const min = asNumber(component?.minValue);
  const max = asNumber(component?.maxValue);
  if (min !== undefined) salary.min = min;
  if (max !== undefined) salary.max = max;
  if (min !== undefined || max !== undefined) {
    const currency = asString(component?.currencyCode)?.toUpperCase();
    if (currency) salary.currency = currency;
    const unit = /^1\s+(YEAR|MONTH|WEEK|DAY|HOUR)$/i.exec(asString(component?.interval) ?? '')?.[1]?.toUpperCase();
    const period = unit ? INTERVALS[unit] : undefined;
    if (period) salary.period = period;
  }
  if (text) salary.text = text;
  return Object.keys(salary).length > 0 ? salary : undefined;
}
