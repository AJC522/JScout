/**
 * Working Nomads (https://www.workingnomads.com) — remote-only job board.
 *
 * Uses only the official, public endpoint GET /api/exposed_jobs/ (trailing slash
 * required; without it the server answers 301). It returns, in one response with
 * no parameters or pagination, the board's complete set of "exposed" postings:
 * the premium/featured listings only (about 37, under 1% of the board). Postings
 * that disappear from it have stopped being featured; that is the snapshot this
 * source can vouch for. The site's internal search backend is deliberately NOT
 * used. No ETag/Last-Modified, so no conditional requests.
 *
 * Each posting's `url` (/job/go/<id>/) is Working Nomads' tracking redirect to the
 * employer's page: it is the only link the API offers, and the one they want
 * clicked. No terms or attribution wording is published for the endpoint.
 */
import type { FeedResult, JobSource, RawPosting } from './types';
import { SourceError } from './types';
import { absoluteUrl, asRecord, asString, compactStrings, requireArray } from './util';

const FEED_URL = 'https://www.workingnomads.com/api/exposed_jobs/';
const MIN_INTERVAL_MS = 1_000;
const JOB_ID = /\/job\/go\/(\d+)(?:\/|$)/;

export const workingnomadsSource: JobSource = {
  def: {
    id: 'workingnomads',
    name: 'Working Nomads',
    kind: 'board',
    mode: 'feed',
    homepage: 'https://www.workingnomads.com',
    description:
      'Remote-only job board. Its official public feed carries only the featured (premium) listings, about 40 ' +
      'postings and under 1% of the site, many from talent marketplaces; links go through Working Nomads to the employer.',
    attribution: 'Source: Working Nomads (workingnomads.com)',
    perCompany: false,
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 12 * 60,
    fullSnapshot: true,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx): Promise<FeedResult> {
    if (ctx.signal?.aborted) throw new SourceError('aborted', 'Working Nomads sync was cancelled');
    const res = await ctx.http.getJson(FEED_URL, { minIntervalMs: MIN_INTERVAL_MS, signal: ctx.signal });
    const jobs = requireArray(res.data, 'Working Nomads response');

    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    jobs.forEach((job, index) => {
      try {
        const posting = mapJob(job);
        if (seen.has(posting.externalId)) return;
        seen.add(posting.externalId);
        postings.push(posting);
      } catch (err) {
        ctx.log.warn('workingnomads: skipped a malformed posting', {
          index,
          url: asString(asRecord(job)?.url),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // One response holds the whole exposed set. An empty list is suspicious (the set
    // has never been observed empty), so it must not close every indexed posting.
    const complete = jobs.length > 0;
    if (!complete) ctx.log.warn('workingnomads: the feed came back empty; not treating it as a complete snapshot');
    return { postings, complete };
  },
};

function mapJob(value: unknown): RawPosting {
  const job = asRecord(value);
  if (!job) throw new Error('not an object');

  const url = asString(job.url);
  if (!url || !absoluteUrl(url)) throw new Error('no http(s) url');
  // The API has no id field; the id only exists in the url (/job/go/2043539/).
  const externalId = JOB_ID.exec(new URL(url).pathname)?.[1];
  if (!externalId) throw new Error('no job id in the url');
  const title = asString(job.title);
  if (!title) throw new Error('no title');
  const company = asString(job.company_name);
  if (!company) throw new Error('no company');

  const location = asString(job.location);
  const tags = typeof job.tags === 'string' ? job.tags.split(',') : [];

  return {
    externalId,
    url,
    title,
    company,
    // One free-text restriction string: "USA only", "Time zone: CET (+/- 3 hours)", "Global".
    locations: location ? [location] : [],
    // Remote-only board.
    remote: 'remote',
    descriptionHtml: typeof job.description === 'string' && job.description.trim() !== '' ? job.description : undefined,
    postedAt: asString(job.pub_date),
    tags: compactStrings([job.category_name, ...tags]),
  };
}
