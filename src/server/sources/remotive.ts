/**
 * Remotive (https://remotive.com) — remote-only job board.
 *
 * One GET returns the whole public set: about 15 postings, published 24 hours
 * after they appear on the site. The endpoint has no pagination, and its filter
 * parameters (limit, category, search, company_name) are ignored by the CDN in
 * front of it, so none are sent.
 *
 * Terms (the "0-legal-notice" field of every response): link back to the
 * Remotive URL and credit Remotive; at most ~4 requests a day; excessive
 * requests get blocked. Hence no applyUrl, a 12 h TTL and no retry on 429/403.
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

const FEED_URL = 'https://remotive.com/api/remote-jobs';
const MIN_INTERVAL_MS = 2_000;

/** publication_date has no zone ("2026-11-13T17:29:57"); the RSS feed shows the same instant as GMT. */
const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export const remotiveSource: JobSource = {
  def: {
    id: 'remotive',
    name: 'Remotive',
    kind: 'board',
    mode: 'feed',
    homepage: 'https://remotive.com',
    description:
      'Remote-only job board. Its free public API shares only a small sample of the site (about 15 postings, ' +
      'each published 24 hours late), so expect few results from it.',
    attribution: 'Source: Remotive (remotive.com)',
    perCompany: false,
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 12 * 60,
    fullSnapshot: true,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx, _board, cursor): Promise<FeedResult> {
    const res = await requestFeed(ctx, cursor);

    if (res.status === 304) {
      return { postings: [], complete: false, notModified: true, cursor: validators(res, cursor) };
    }

    const envelope = requireRecord(res.data, 'Remotive response');
    const jobs = requireArray(envelope.jobs, 'Remotive response "jobs"');

    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    jobs.forEach((job, index) => {
      try {
        const posting = mapJob(job);
        if (seen.has(posting.externalId)) return;
        seen.add(posting.externalId);
        postings.push(posting);
      } catch (err) {
        ctx.log.warn('remotive: skipped a malformed posting', {
          index,
          id: asString(asRecord(job)?.id),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // The endpoint returns everything it has, but only vouch for that when its own
    // counters agree with what arrived: an empty or truncated list must never close postings.
    const counts = [asNumber(envelope['job-count']), asNumber(envelope['total-job-count'])];
    const complete = jobs.length > 0 && counts.every((n) => n === undefined || n === jobs.length);
    if (!complete) {
      ctx.log.warn('remotive: response does not look like the full list; not treating it as a complete snapshot', {
        received: jobs.length,
        jobCount: counts[0],
        totalJobCount: counts[1],
      });
    }

    return { postings, complete, cursor: validators(res) };
  },
};

/**
 * A single request, repeated once after a network failure or a 5xx. A 429 or 403
 * is never retried: Remotive's notice says excessive requests are blocked.
 */
async function requestFeed(ctx: SourceContext, cursor: FeedCursor | undefined): Promise<HttpResponse<unknown>> {
  const attempt = () => {
    if (ctx.signal?.aborted) throw new SourceError('aborted', 'Remotive sync was cancelled');
    return ctx.http.getJson(FEED_URL, {
      lastModified: cursor?.lastModified,
      minIntervalMs: MIN_INTERVAL_MS,
      retries: 0,
      signal: ctx.signal,
    });
  };
  try {
    return await attempt();
  } catch (err) {
    const transient =
      err instanceof SourceError && (err.kind === 'network' || (err.kind === 'http' && (err.status ?? 0) >= 500));
    if (!transient) throw err;
    ctx.log.info('remotive: request failed, trying once more', { error: err.message });
    return await attempt();
  }
}

/** The CDN sends Last-Modified (no ETag) and honours If-Modified-Since. */
function validators(res: HttpResponse<unknown>, previous?: FeedCursor): FeedCursor | undefined {
  const lastModified = asString(res.headers['last-modified']) ?? previous?.lastModified;
  return lastModified ? { lastModified } : undefined;
}

/** Throws (with the reason) when the posting cannot be used. */
function mapJob(value: unknown): RawPosting {
  const job = asRecord(value);
  if (!job) throw new Error('not an object');

  const externalId = asString(job.id);
  if (!externalId) throw new Error('no id');
  const title = asString(job.title);
  if (!title) throw new Error('no title');
  const company = asString(job.company_name);
  if (!company) throw new Error('no company');
  const url = httpUrl(job.url);
  if (!url) throw new Error('no http(s) url');

  const salaryText = asString(job.salary);
  const published = asString(job.publication_date);

  return {
    externalId,
    // Terms: link back to the Remotive page, so there is no separate applyUrl.
    url,
    title,
    company,
    // `company_logo` is always present, even where there is no logo (it then serves a
    // placeholder image); `company_logo_url` only exists for real logos.
    companyLogo: httpUrl(job.company_logo_url),
    // A comma-separated list of regions/countries: "USA, Canada", "Worldwide".
    locations: compactStrings((asString(job.candidate_required_location) ?? '').split(',')),
    // Remote-only board.
    remote: 'remote',
    descriptionHtml: rawHtml(job.description),
    postedAt: published && NAIVE_ISO.test(published) ? `${published}Z` : published,
    salary: salaryText ? { text: salaryText } : undefined,
    employmentType: asString(job.job_type),
    tags: compactStrings([job.category, ...asArray(job.tags)]),
  };
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
