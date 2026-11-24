/**
 * Himalayas (https://himalayas.app) — remote-only job board, queried per search.
 *
 * With well over 100,000 open postings at 20 per page the board cannot be
 * mirrored, so this source only runs upstream searches. Anonymous access is
 * limited to almost nothing, so a free API key is required; it is sent as
 * `Authorization: Bearer <key>` and never placed in a URL (keyed limits:
 * 60 requests/minute, 10,000 per UTC day).
 *
 * Terms (https://himalayas.app/terms, API users): every Apply action must use
 * the `applicationLink` from the API unchanged; credit Himalayas with a link to
 * the posting; remove postings once they expire.
 *
 * Docs: https://himalayas.app/api and https://himalayas.app/docs/openapi.json
 */
import type { SalaryPeriod } from '../../shared/types';
import { type JobSource, type RawPosting, type RawSalary, type SourceContext, SourceError, type UpstreamQuery } from './types';
import { absoluteUrl, asArray, asNumber, asRecord, asString, compactStrings, requireArray, requireRecord } from './util';

const SEARCH_URL = 'https://himalayas.app/jobs/api/search';
/** A posting's API address is this plus the path of its guid ("companies/<company>/jobs/<slug>"). */
const JOB_API_BASE = 'https://himalayas.app/jobs/api/';
const KEY_SIGNUP_URL = 'https://himalayas.app/signup/developer';

/** One upstream query per keyword phrase, for the first few phrases only. */
const MAX_PHRASES = 3;
/** 20 postings per page, so at most 60 per phrase. */
const MAX_PAGES_PER_PHRASE = 3;
/** Keyed limit is 60 requests per minute. */
const MIN_INTERVAL_MS = 1_000;
/** The liveness endpoint takes one posting per request; keep a single pass small. */
const MAX_LIVENESS_CHECKS = 20;

/** guid of every posting seen: https://himalayas.app/companies/<companySlug>/jobs/<jobSlug> */
const GUID = /^https:\/\/himalayas\.app\/(companies\/[^/?#\s]+\/jobs\/[^/?#\s]+)\/?$/;
const LISTING_PATH = /^companies\/[^/?#\s]+\/jobs\/[^/?#\s]+$/;

/**
 * "A job with no timezone restriction usually lists every offset" (38 exist). With no
 * country restriction either, a list at least this long is taken to mean worldwide.
 */
const UNRESTRICTED_TIMEZONES = 30;

const PERIODS: Record<string, SalaryPeriod> = {
  annual: 'year',
  monthly: 'month',
  weekly: 'week',
  hourly: 'hour',
};

export const himalayasSource: JobSource = {
  def: {
    id: 'himalayas',
    name: 'Himalayas',
    kind: 'board',
    mode: 'search',
    homepage: 'https://himalayas.app',
    description:
      'Remote-only job board with over 100,000 postings. Too large to copy, so it is searched live with your ' +
      'keywords each time you search. Needs a free Himalayas API key; Apply opens the posting on Himalayas.',
    attribution: 'Source: Himalayas (himalayas.app)',
    perCompany: false,
    configFields: [
      {
        key: 'apiKey',
        label: 'Himalayas API key',
        secret: true,
        required: true,
        help:
          `Free. Create a developer account at ${KEY_SIGNUP_URL} and paste the key here (it starts with "hml_"). ` +
          'It allows 60 requests a minute and 10,000 a day.',
      },
    ],
    defaultEnabled: false,
    defaultTtlMinutes: 60,
    fullSnapshot: false,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  /**
   * Runs one upstream query per keyword phrase (the first three), page by page across
   * the phrases — page 1 of each, then page 2 of each — so the best matches of every
   * phrase arrive before `query.limit` is reached. Every posting on Himalayas is
   * remote, so `remoteOnly` needs no parameter.
   */
  async search(ctx, query): Promise<RawPosting[]> {
    const headers = authHeaders(ctx);
    const limit = Number.isFinite(query.limit) ? Math.floor(query.limit) : 0;
    if (limit <= 0) return [];

    // No keywords: a single query on the filters alone (Himalayas then ranks by recent activity).
    const keywords = compactStrings(query.keywords).slice(0, MAX_PHRASES);
    const phrases: Array<string | undefined> = keywords.length > 0 ? keywords : [undefined];
    const country = countryParam(query);
    const nowMs = ctx.now().getTime();

    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    const exhausted = new Set<number>();
    let pagesRead = 0;

    walk: for (let page = 1; page <= MAX_PAGES_PER_PHRASE; page++) {
      for (let p = 0; p < phrases.length; p++) {
        if (postings.length >= limit) break walk;
        if (exhausted.has(p)) continue;

        let jobs: unknown[];
        try {
          jobs = await fetchSearchPage(ctx, headers, phrases[p], country, page);
        } catch (err) {
          const fatal = pagesRead === 0 || !(err instanceof SourceError) || err.kind === 'aborted' || err.kind === 'auth';
          if (fatal) throw err;
          // Something is better than nothing for a search: keep the pages already read.
          ctx.log.warn('himalayas: a search page failed; returning the results read so far', {
            page,
            error: err.message,
            postings: postings.length,
          });
          break walk;
        }
        pagesRead++;

        // Pages can be short before the end; only an empty page ends a query.
        if (jobs.length === 0) {
          exhausted.add(p);
          continue;
        }
        jobs.forEach((job, index) => {
          try {
            if (isExpired(job, nowMs)) return;
            const posting = mapJob(job);
            // Results shift between pages and phrases overlap: de-duplicate on the guid.
            if (seen.has(posting.externalId)) return;
            seen.add(posting.externalId);
            postings.push(posting);
          } catch (err) {
            ctx.log.warn('himalayas: skipped a malformed posting', {
              page,
              index,
              guid: asString(asRecord(job)?.guid),
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        });
      }
      if (exhausted.size === phrases.length) break;
    }

    return postings.slice(0, limit);
  },

  /**
   * Liveness of single postings: 200 -> open, 410 -> closed. A 404 ("not in the API")
   * says nothing certain and is left out, as is any id that is not a Himalayas listing
   * path. One request per posting, so only the first 20 ids are checked per call.
   */
  async checkOpen(ctx, externalIds): Promise<Map<string, boolean>> {
    const headers = authHeaders(ctx);
    const result = new Map<string, boolean>();
    const ids = [...new Set(externalIds)].filter((id) => LISTING_PATH.test(id)).slice(0, MAX_LIVENESS_CHECKS);

    for (const [i, id] of ids.entries()) {
      try {
        throwIfAborted(ctx);
        const res = await ctx.http.getJson(JOB_API_BASE + id, {
          headers,
          allowStatus: [404, 410],
          minIntervalMs: MIN_INTERVAL_MS,
          retries: 1,
          signal: ctx.signal,
        });
        if (res.status === 410) result.set(id, false);
        else if (res.status === 200 && asRecord(asRecord(res.data)?.job)) result.set(id, true);
      } catch (err) {
        const fatal = i === 0 || !(err instanceof SourceError) || err.kind === 'aborted' || err.kind === 'auth';
        if (fatal) throw explainAuth(err);
        ctx.log.warn('himalayas: a liveness check failed; returning the postings checked so far', { error: err.message });
        break;
      }
    }
    return result;
  },
};

function throwIfAborted(ctx: SourceContext): void {
  if (ctx.signal?.aborted) throw new SourceError('aborted', 'Himalayas request was cancelled');
}

/** The key goes in the Authorization header only — never in a URL. */
function authHeaders(ctx: SourceContext): Record<string, string> {
  const key = (ctx.config.apiKey ?? '').trim().replace(/^Bearer\s+/i, '');
  if (!key) {
    throw new SourceError(
      'auth',
      `Himalayas needs a free API key. Create one at ${KEY_SIGNUP_URL} and add it to the Himalayas source in Settings.`,
    );
  }
  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw new SourceError(
      'auth',
      'The Himalayas API key contains spaces or other characters a key cannot have. Copy it again from your Himalayas account.',
    );
  }
  return { Authorization: `Bearer ${key}` };
}

/** Turn the HTTP client's generic 401 into something the user can act on. */
function explainAuth(err: unknown): unknown {
  if (err instanceof SourceError && err.kind === 'auth' && err.status === 401) {
    return new SourceError(
      'auth',
      `Himalayas rejected the API key (HTTP 401). Check the key on the Himalayas source in Settings, or create a new one at ${KEY_SIGNUP_URL}.`,
      { status: 401, cause: err },
    );
  }
  return err;
}

/** ISO alpha-2 only; the filter also returns worldwide roles open to that country. */
function countryParam(query: UpstreamQuery): string | undefined {
  const country = asString(query.country);
  return country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : undefined;
}

async function fetchSearchPage(
  ctx: SourceContext,
  headers: Record<string, string>,
  phrase: string | undefined,
  country: string | undefined,
  page: number,
): Promise<unknown[]> {
  throwIfAborted(ctx);
  let res;
  try {
    res = await ctx.http.getJson(SEARCH_URL, {
      query: { q: phrase, country, sort: 'relevant', page },
      headers,
      minIntervalMs: MIN_INTERVAL_MS,
      // Someone is waiting for these results, and a 429 here can mean "come back tomorrow".
      retries: 1,
      signal: ctx.signal,
    });
  } catch (err) {
    throw explainAuth(err);
  }
  const envelope = requireRecord(res.data, 'Himalayas search response');
  if (!Array.isArray(envelope.jobs) && envelope.ok === false) {
    throw new SourceError('parse', `Himalayas reported an error: ${asString(envelope.errors) ?? 'no details given'}`);
  }
  return requireArray(envelope.jobs, 'Himalayas search response "jobs"');
}

/** expiryDate is "the latest the job stays listed" (unix seconds); the terms ask that expired jobs are not shown. */
function isExpired(job: unknown, nowMs: number): boolean {
  const expiry = asNumber(asRecord(job)?.expiryDate);
  return expiry !== undefined && expiry > 0 && expiry * 1000 <= nowMs;
}

/** Throws (with the reason) when the posting cannot be used. */
function mapJob(value: unknown): RawPosting {
  const job = asRecord(value);
  if (!job) throw new Error('not an object');

  const guid = httpUrl(job.guid);
  if (!guid) throw new Error('no http(s) guid');
  const title = asString(job.title);
  if (!title) throw new Error('no title');
  const company = asString(job.companyName);
  if (!company) throw new Error('no company');

  // pubDate is "when the job was last updated" (unix seconds); Himalayas publishes no
  // original posting date, so it is the best value available for both fields.
  const pubDate = asNumber(job.pubDate);

  return {
    // There is no numeric id. The path of the guid is unique and is also what the
    // liveness endpoint takes; an unexpected guid is used whole.
    externalId: GUID.exec(guid)?.[1] ?? guid,
    url: guid,
    // Terms: Apply must use applicationLink exactly as given.
    applyUrl: httpUrl(job.applicationLink),
    title,
    company,
    // An empty string when the company has no logo.
    companyLogo: httpUrl(job.companyLogo),
    locations: mapLocations(job),
    // Remote-only board.
    remote: 'remote',
    descriptionHtml: rawHtml(job.description),
    postedAt: pubDate,
    updatedAt: pubDate,
    salary: mapSalary(job),
    employmentType: asString(job.employmentType),
    seniority: compactStrings(listOf(job.seniority)).join(', ') || undefined,
    // Job functions ("Data Science") first, then role slugs ("Business-Intelligence-Analyst") as words.
    tags: compactStrings([
      ...asArray(job.parentCategories),
      ...asArray(job.categories).map((c) => (typeof c === 'string' ? c.replace(/-/g, ' ') : c)),
    ]),
  };
}

/**
 * locationRestrictions lists the countries candidates must be in (full English names).
 * An empty list means no country restriction, but the posting can still be limited by
 * timezoneRestrictions (one such posting allowed only UTC+3:30). So "Worldwide" is
 * stated only when the timezones are unrestricted too; otherwise the scope is left unknown.
 */
function mapLocations(job: Record<string, unknown>): string[] {
  const countries = compactStrings(asArray(job.locationRestrictions));
  if (countries.length > 0) return countries;
  // Anything but the two documented lists says nothing about the scope.
  if (!Array.isArray(job.locationRestrictions) || job.locationRestrictions.length > 0) return [];
  if (!Array.isArray(job.timezoneRestrictions)) return [];
  const offsets = new Set(job.timezoneRestrictions.filter((o) => typeof o === 'number'));
  return offsets.size === 0 || offsets.size >= UNRESTRICTED_TIMEZONES ? ['Worldwide'] : [];
}

/**
 * Amounts are in the stated period (not annualised) and can be fractional. currency and
 * salaryPeriod are filled in even when there are no amounts, so they only count with one.
 */
function mapSalary(job: Record<string, unknown>): RawSalary | undefined {
  const min = positive(job.minSalary);
  const max = positive(job.maxSalary);
  if (min === undefined && max === undefined) return undefined;

  const rawPeriod = asString(job.salaryPeriod)?.toLowerCase();
  const currency = asString(job.currency);
  return {
    min,
    max,
    currency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : undefined,
    // A period with no SalaryPeriod equivalent is left unset rather than converted.
    period: rawPeriod ? PERIODS[rawPeriod] : undefined,
    // "fortnightly" is documented but SalaryPeriod has no fortnight: say so in words.
    text: rawPeriod === 'fortnightly' ? 'per fortnight' : undefined,
  };
}

function positive(value: unknown): number | undefined {
  const n = asNumber(value);
  return n !== undefined && n > 0 ? n : undefined;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
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
