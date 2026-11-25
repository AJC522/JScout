/**
 * Jobicy (https://jobicy.com) — remote-only job board with a keyless JSON API.
 *
 * The feed is a rolling window: postings published in the last 7 days, visible
 * 3 hours after publication, 100 per page, walked newest-first with an opaque
 * cursor. A posting that leaves the window can still be open, so the feed is
 * never a complete snapshot; `checkOpen` asks the batch status endpoint instead.
 *
 * Limits and terms (https://jobicy.com/jobs-rss-feed): at most 1 request per
 * second per IP across feed pages and status checks; credit Jobicy; every apply
 * button must go to the `url` from the feed, unchanged.
 */
import { decodeHTMLStrict } from 'entities';
import type { SalaryPeriod } from '../../shared/types';
import {
  type FeedCursor,
  type FeedResult,
  type JobSource,
  type RawPosting,
  type RawSalary,
  type SourceContext,
  SourceError,
} from './types';
import { absoluteUrl, asNumber, asRecord, asString, compactStrings, requireArray, requireRecord } from './util';

const FEED_URL = 'https://jobicy.com/api/jobs';
const STATUS_URL = 'https://jobicy.com/api/jobs/status';
/** The API's maximum page size. */
const PAGE_SIZE = 100;
/** Safety cap; the 7-day window is normally about 15 pages. */
const MAX_PAGES = 40;
/** Documented limit is 1 request/second; stay just above it. */
const MIN_INTERVAL_MS = 1_100;
/** The status endpoint accepts 1–100 ids. */
const STATUS_BATCH_SIZE = 100;
/** At most this many status requests per checkOpen call (3,000 ids). */
const MAX_STATUS_BATCHES = 30;

const PERIODS: Record<string, SalaryPeriod> = {
  yearly: 'year',
  monthly: 'month',
  weekly: 'week',
  daily: 'day',
  hourly: 'hour',
};

/** Jobicy ids are positive integers; anything else would make the status endpoint answer 400. */
const NUMERIC_ID = /^[1-9]\d{0,14}$/;

interface FeedPage {
  notModified: boolean;
  jobs: unknown[];
  nextCursor?: string;
  lastModified?: string;
}

export const jobicySource: JobSource = {
  def: {
    id: 'jobicy',
    name: 'Jobicy',
    kind: 'board',
    mode: 'feed',
    homepage: 'https://jobicy.com',
    description:
      'Remote-only job board. Its feed carries postings from the last 7 days (each appears about 3 hours after ' +
      'publication); older ones stay listed here until Jobicy reports them closed. Apply links open the posting on Jobicy.',
    attribution: 'Source: Jobicy (jobicy.com)',
    perCompany: false,
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 6 * 60,
    fullSnapshot: false,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx, _board, cursor): Promise<FeedResult> {
    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    const followed = new Set<string>();
    let pageCursor: string | undefined;
    let validators: FeedCursor | undefined;

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      let page: FeedPage;
      try {
        // Only the first page is conditional: if it is unchanged there is nothing new to walk to.
        page = await fetchPage(ctx, pageCursor, pageNo === 1 ? cursor?.lastModified : undefined);
      } catch (err) {
        if (pageNo === 1 || !(err instanceof SourceError) || err.kind === 'aborted') throw err;
        // Keep what was read. No validators are returned, so the next sync walks the window again.
        ctx.log.warn('jobicy: a page failed; returning the pages read so far', {
          page: pageNo,
          error: err.message,
          postings: postings.length,
        });
        return { postings, complete: false };
      }

      if (page.notModified) {
        if (pageNo === 1) {
          return { postings: [], complete: false, notModified: true, cursor: page.lastModified ? { lastModified: page.lastModified } : cursor };
        }
        // Later pages are never conditional; a 304 there carries no postings, so stop with what was read.
        ctx.log.warn('jobicy: unexpected 304 for a later page; returning the pages read so far', { page: pageNo });
        return { postings, complete: false };
      }
      if (pageNo === 1 && page.lastModified) validators = { lastModified: page.lastModified };

      page.jobs.forEach((job, index) => {
        try {
          const posting = mapJob(job);
          if (seen.has(posting.externalId)) return;
          seen.add(posting.externalId);
          postings.push(posting);
        } catch (err) {
          ctx.log.warn('jobicy: skipped a malformed posting', {
            page: pageNo,
            index,
            id: asString(asRecord(job)?.id),
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      });

      if (!page.nextCursor) break; // end of the window
      if (followed.has(page.nextCursor)) {
        ctx.log.warn('jobicy: the API returned a cursor that was already followed; stopping', { page: pageNo });
        break;
      }
      if (pageNo === MAX_PAGES) {
        ctx.log.warn('jobicy: page cap reached before the end of the feed', { pages: MAX_PAGES, postings: postings.length });
        break;
      }
      followed.add(page.nextCursor);
      pageCursor = page.nextCursor;
    }

    // A rolling window is never the complete open set, however far the walk got.
    return { postings, complete: false, cursor: validators };
  },

  /**
   * Batch status check. "active" -> true, "closed" -> false. "unknown" (deleted, never
   * public, or not confirmable) is left out, as are ids that are not Jobicy ids:
   * Jobicy asks that only an explicit "closed" be treated as closed.
   */
  async checkOpen(ctx, externalIds): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    const ids = [...new Set(externalIds.map((id) => id.trim()).filter((id) => NUMERIC_ID.test(id)))];
    const batches = Math.min(Math.ceil(ids.length / STATUS_BATCH_SIZE), MAX_STATUS_BATCHES);
    if (ids.length > batches * STATUS_BATCH_SIZE) {
      ctx.log.info('jobicy: more ids than one status pass covers; the rest are left for a later pass', {
        requested: ids.length,
        checking: batches * STATUS_BATCH_SIZE,
      });
    }

    for (let b = 0; b < batches; b++) {
      const batch = ids.slice(b * STATUS_BATCH_SIZE, (b + 1) * STATUS_BATCH_SIZE);
      try {
        throwIfAborted(ctx);
        // Built by hand so the commas stay literal, as in the documented form of the request.
        const res = await ctx.http.getJson(`${STATUS_URL}?ids=${batch.join(',')}`, {
          minIntervalMs: MIN_INTERVAL_MS,
          signal: ctx.signal,
        });
        const envelope = requireRecord(res.data, 'Jobicy status response');
        const asked = new Set(batch);
        for (const item of requireArray(envelope.jobs, 'Jobicy status response "jobs"')) {
          const record = asRecord(item);
          const id = asString(record?.id);
          if (!id || !asked.has(id)) continue;
          const status = asString(record?.status)?.toLowerCase();
          if (status === 'active') result.set(id, true);
          else if (status === 'closed') result.set(id, false);
        }
      } catch (err) {
        if (b === 0 || !(err instanceof SourceError) || err.kind === 'aborted') throw err;
        // Ids that were not checked are simply absent from the result and stay untouched.
        ctx.log.warn('jobicy: a status batch failed; returning the batches checked so far', {
          batch: b + 1,
          error: err.message,
        });
        break;
      }
    }
    return result;
  },
};

function throwIfAborted(ctx: SourceContext): void {
  if (ctx.signal?.aborted) throw new SourceError('aborted', 'Jobicy sync was cancelled');
}

async function fetchPage(ctx: SourceContext, pageCursor: string | undefined, lastModified: string | undefined): Promise<FeedPage> {
  throwIfAborted(ctx);
  const res = await ctx.http.getJson(FEED_URL, {
    // No filters: the cursor is only valid with the parameters of the first request.
    query: { count: PAGE_SIZE, cursor: pageCursor },
    lastModified,
    minIntervalMs: MIN_INTERVAL_MS,
    signal: ctx.signal,
  });
  const headerLastModified = asString(res.headers['last-modified']);
  if (res.status === 304) return { notModified: true, jobs: [], lastModified: headerLastModified };

  const envelope = requireRecord(res.data, 'Jobicy response');
  if (envelope.success === false) {
    throw new SourceError('parse', `Jobicy reported an error: ${asString(envelope.error) ?? 'no details given'}`);
  }
  const jobs = requireArray(envelope.jobs, 'Jobicy response "jobs"');
  // The last page has nextCursor: null (and hasMore: false).
  return { notModified: false, jobs, nextCursor: asString(envelope.nextCursor), lastModified: headerLastModified };
}

/** Throws (with the reason) when the posting cannot be used. */
function mapJob(value: unknown): RawPosting {
  const job = asRecord(value);
  if (!job) throw new Error('not an object');

  const externalId = asString(job.id);
  if (!externalId) throw new Error('no id');
  const title = plainText(job.jobTitle);
  if (!title) throw new Error('no title');
  const company = plainText(job.companyName);
  if (!company) throw new Error('no company');
  const url = httpUrl(job.url);
  if (!url) throw new Error('no http(s) url');

  const level = asString(job.jobLevel);
  // "Any" is the absence of a level. "Director" is not a level Jobicy can be trusted with: on live
  // data two thirds of the postings it labels so are account executives, BDRs and the like.
  const trustedLevel = level && !/^(?:any|director)$/i.test(level.trim()) ? level : undefined;

  return {
    externalId,
    // Terms: apply must go to this URL, unchanged — so no separate applyUrl.
    url,
    title,
    company,
    companyLogo: httpUrl(job.companyLogo),
    // Taxonomy names joined with a comma and two spaces: "Canada,  USA", "Anywhere".
    locations: compactStrings((asString(job.jobGeo) ?? '').split(',')),
    // Remote-only board.
    remote: 'remote',
    descriptionHtml: rawHtml(job.jobDescription),
    postedAt: asString(job.pubDate),
    salary: mapSalary(job),
    employmentType: compactStrings(listOf(job.jobType)).join(', ') || undefined,
    seniority: trustedLevel,
    tags: compactStrings(listOf(job.jobIndustry)),
  };
}

/** The salary keys are simply absent on postings without one; the currency can be missing on its own. */
function mapSalary(job: Record<string, unknown>): RawSalary | undefined {
  const min = positive(job.salaryMin);
  const max = positive(job.salaryMax);
  if (min === undefined && max === undefined) return undefined;

  const rawPeriod = asString(job.salaryPeriod)?.toLowerCase();
  const currency = asString(job.salaryCurrency);
  return {
    min,
    max,
    currency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : undefined,
    // A period this adapter does not know is left unset rather than guessed.
    period: rawPeriod ? PERIODS[rawPeriod] : undefined,
  };
}

function positive(value: unknown): number | undefined {
  const n = asNumber(value);
  return n !== undefined && n > 0 ? n : undefined;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Titles and company names arrive as plain text, but the occasional entity leaks
 * through from Jobicy's CMS ("Zone &#038; Co"). Only well-formed entities are decoded,
 * so "AT&T" and "Sales&regional" are left alone.
 */
function plainText(value: unknown): string | undefined {
  const s = asString(value);
  return s?.includes('&') ? asString(decodeHTMLStrict(s)) : s;
}

/** The URL exactly as given (trimmed), or undefined unless it is an absolute http(s) URL. */
function httpUrl(value: unknown): string | undefined {
  const s = asString(value);
  return s && absoluteUrl(s) ? s : undefined;
}

/** HTML exactly as given; undefined when missing or blank. */
function rawHtml(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
