/**
 * Arbeitnow (https://www.arbeitnow.com) — general job board for Germany and the
 * rest of Europe: many on-site jobs, many written in German.
 *
 * Endpoint: GET https://www.arbeitnow.com/api/job-board-api?page=N (no key).
 * Observed November 2026:
 * - 300 postings per page, about 35 pages (~10,000 postings, ~2 MB of JSON per
 *   page). `meta.from` claims pages advance by 100, but consecutive pages share
 *   no postings, so it is not used. No other parameter (per_page, limit, search,
 *   tags, location, remote) changes the result.
 * - The last page has `links.next: null`; a page past the end has `data: []`.
 * - Ordered newest first (roughly by created_at); refreshed hourly upstream.
 * - Cloudflare caches each page separately (age up to ~1 hour seen) and answers
 *   If-Modified-Since with 304. Pages can therefore come from different hours,
 *   so a walk can miss postings that moved across a page boundary in between.
 * - Rate limit header: 50 requests (per minute); requests here are 2 s apart.
 *
 * Terms (meta.terms and arbeitnow.com/terms §11): "free public API for jobs,
 * please do not abuse"; users agree to link back to Arbeitnow.com.
 */
import {
  type FeedCursor,
  type FeedResult,
  type HttpResponse,
  type JobSource,
  type RawPosting,
  type SourceContext,
  SourceError,
} from './types';
import { absoluteUrl, asArray, asNumber, asRecord, asString, compactStrings, requireArray, requireRecord } from './util';

const FEED_URL = 'https://www.arbeitnow.com/api/job-board-api';
const MIN_INTERVAL_MS = 2_000;
/** About 35 pages exist; the cap leaves room for growth without walking forever. */
const MAX_PAGES = 40;

interface Page {
  jobs: unknown[];
  hasNext: boolean;
}

export const arbeitnowSource: JobSource = {
  def: {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    kind: 'board',
    mode: 'feed',
    homepage: 'https://www.arbeitnow.com',
    description:
      'General job board for Germany and the rest of Europe (about 10,000 jobs, many on-site and many in German). ' +
      'A full sync downloads about 35 large pages, so it refreshes twice a day.',
    attribution: 'Jobs from Arbeitnow (arbeitnow.com)',
    perCompany: false,
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 12 * 60,
    fullSnapshot: true,
    // Pages are cached separately by Cloudflare (up to ~1 h apart), so a posting that shifts
    // across a page boundary can be missing from one complete walk: wait a day before closing.
    closeGraceMinutes: 24 * 60,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx, _board, cursor): Promise<FeedResult> {
    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    let validators: FeedCursor | undefined;
    let reachedEnd = false;

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      if (ctx.signal?.aborted) throw new SourceError('aborted', 'Arbeitnow sync was cancelled');

      let res: HttpResponse<unknown>;
      let page: Page;
      try {
        // Only page 1 is conditional: unchanged newest postings mean nothing new to walk to.
        res = await ctx.http.getJson(FEED_URL, {
          query: { page: pageNo },
          minIntervalMs: MIN_INTERVAL_MS,
          signal: ctx.signal,
          ...(pageNo === 1 ? { etag: cursor?.etag, lastModified: cursor?.lastModified } : {}),
        });
        if (res.status === 304) {
          if (pageNo === 1) return { postings: [], complete: false, notModified: true, cursor: readValidators(res, cursor) };
          throw new SourceError('http', `unexpected 304 for page ${pageNo}`, { status: 304 });
        }
        page = readPage(res.data, pageNo);
      } catch (err) {
        if (pageNo === 1 || !(err instanceof SourceError) || err.kind === 'aborted' || err.kind === 'auth') throw err;
        // Keep what was read, without validators so the next sync walks every page again.
        ctx.log.warn('arbeitnow: a page failed; returning the pages read so far', {
          page: pageNo,
          error: err.message,
          postings: postings.length,
        });
        return { postings, complete: false };
      }
      if (pageNo === 1) validators = readValidators(res, undefined);

      page.jobs.forEach((job, index) => {
        try {
          const posting = mapJob(job);
          if (seen.has(posting.externalId)) return; // a posting that moved down a page between requests
          seen.add(posting.externalId);
          postings.push(posting);
        } catch (err) {
          ctx.log.warn('arbeitnow: skipped a malformed posting', {
            page: pageNo,
            index,
            slug: asString(asRecord(job)?.slug),
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      });

      if (page.jobs.length === 0 || !page.hasNext) {
        reachedEnd = true;
        break;
      }
    }

    if (!reachedEnd) {
      ctx.log.warn('arbeitnow: page cap reached before the last page', { pages: MAX_PAGES, postings: postings.length });
      return { postings, complete: false };
    }
    // An empty board is far more likely an upstream fault than a real state: never close everything on it.
    const complete = postings.length > 0;
    return { postings, complete, cursor: complete ? validators : undefined };
  },
};

function readPage(data: unknown, pageNo: number): Page {
  const envelope = requireRecord(data, `Arbeitnow page ${pageNo}`);
  const jobs = requireArray(envelope.data, `Arbeitnow page ${pageNo} "data"`);
  const links = asRecord(envelope.links);
  // Without a links block, a non-empty page gives no proof of being the last one: keep walking
  // until an empty page (bounded by MAX_PAGES).
  const hasNext = links ? asString(links.next) !== undefined : true;
  return { jobs, hasNext };
}

function mapJob(value: unknown): RawPosting {
  const job = requireRecord(value, 'posting');
  const externalId = asString(job.slug);
  const title = asString(job.title);
  const company = asString(job.company_name);
  const url = absoluteUrl(job.url);
  if (!externalId) throw new Error('missing slug');
  if (!title) throw new Error('missing title');
  if (!company) throw new Error('missing company_name');
  if (!url) throw new Error('missing or non-http url');

  const location = asString(job.location);
  const description = asString(job.description);
  const jobTypes = compactStrings(asArray(job.job_types));
  const tags = compactStrings(asArray(job.tags));
  const createdAt = asNumber(job.created_at);

  return {
    externalId,
    url,
    title,
    company,
    locations: location ? [location] : [],
    // `remote: false` does not prove on-site work (many such postings are hybrid), so it stays unset.
    ...(job.remote === true ? { remote: 'remote' as const } : {}),
    ...(description ? { descriptionHtml: description } : {}),
    ...(createdAt !== undefined ? { postedAt: createdAt } : {}),
    // job_types mixes contract type and experience level ("Full Time", "berufserfahren"); passed through raw.
    ...(jobTypes.length > 0 ? { employmentType: jobTypes.join(', ') } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function readValidators(res: HttpResponse<unknown>, previous: FeedCursor | undefined): FeedCursor | undefined {
  const etag = res.headers.etag ?? previous?.etag;
  const lastModified = res.headers['last-modified'] ?? previous?.lastModified;
  if (!etag && !lastModified) return undefined;
  return { ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) };
}
