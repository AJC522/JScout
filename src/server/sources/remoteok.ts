/**
 * Remote OK (https://remoteok.com) — remote-only job board.
 *
 * One GET of https://remoteok.com/api returns the newest 100 postings (about 3–4
 * days' worth) behind a legal-notice element. There is no pagination and no
 * conditional request support (no ETag / Last-Modified), so this is a rolling
 * window: the result is never a complete snapshot, and a posting leaving the
 * window means "pushed out by newer ones", not "closed". The `tag` filter is not
 * used here.
 *
 * Two description rewrites are done here, and only these:
 *  - Mojibake repair: the API emits every UTF-8 byte as its own Latin-1 code
 *    point ("MÃ¼nchen" for "München"); strings are re-decoded as UTF-8 when that
 *    decodes cleanly (applied to every string field, not just the description).
 *  - Privacy: every description ends with a per-request anti-spam trailer whose
 *    tag is "R" + base64 of the CALLER'S IP address. It is removed, together with
 *    any other base64 token that decodes to an IP address, so the user's address
 *    never reaches the local index.
 *
 * Terms (the `legal` element of every response): link back to the posting on
 * Remote OK with a followed link, mention Remote OK as the source, never use the
 * Remote OK logo. robots.txt asks for a 1 s crawl delay.
 */
import type { FeedResult, JobSource, RawPosting, RawSalary } from './types';
import { SourceError } from './types';
import { absoluteUrl, asArray, asNumber, asRecord, asString, compactStrings, requireArray } from './util';

const FEED_URL = 'https://remoteok.com/api';
const MIN_INTERVAL_MS = 1_000;

export const remoteokSource: JobSource = {
  def: {
    id: 'remoteok',
    name: 'Remote OK',
    kind: 'board',
    mode: 'feed',
    homepage: 'https://remoteok.com',
    description:
      'Remote-only job board. Its free public API returns only the newest 100 postings (about the last 3–4 days, ' +
      'published roughly a day after they appear on the site); salaries are rare and tags/categories are noisy.',
    attribution:
      'Source: Remote OK (remoteok.com). Per Remote OK’s API terms, every posting links back to its Remote OK page ' +
      'with a followed link (no rel="nofollow"), and the Remote OK logo is not used.',
    perCompany: false,
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 6 * 60,
    fullSnapshot: false,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx): Promise<FeedResult> {
    if (ctx.signal?.aborted) throw new SourceError('aborted', 'Remote OK sync was cancelled');
    const res = await ctx.http.getJson(FEED_URL, { minIntervalMs: MIN_INTERVAL_MS, signal: ctx.signal });
    const elements = requireArray(res.data, 'Remote OK response');

    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    elements.forEach((element, index) => {
      const record = asRecord(element);
      // The legal notice ({ last_updated, legal }) has no id; skip it by shape, not position.
      if (record && !('id' in record) && ('legal' in record || 'last_updated' in record)) return;
      try {
        const posting = mapJob(element);
        if (seen.has(posting.externalId)) return;
        seen.add(posting.externalId);
        postings.push(posting);
      } catch (err) {
        ctx.log.warn('remoteok: skipped a malformed posting', {
          index,
          id: asString(record?.id),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Newest-100 window only: never a complete snapshot.
    return { postings, complete: false };
  },
};

function mapJob(value: unknown): RawPosting {
  const job = asRecord(value);
  if (!job) throw new Error('not an object');

  const externalId = asString(job.id);
  if (!externalId) throw new Error('no id');
  const title = text(job.position);
  if (!title) throw new Error('no title');
  const company = text(job.company);
  if (!company) throw new Error('no company');
  const url = postingUrl(job.url, job.slug);
  if (!url) throw new Error('no remoteok.com posting url');

  // "Chennai, " / "Saint-Python, ": drop the one dangling comma; "" means unknown.
  const location = text(job.location)?.replace(/\s*,\s*$/, '');

  return {
    externalId,
    // Terms: link back to the Remote OK page. `apply_url` always equals `url`, so no applyUrl.
    url,
    title,
    company,
    // Never observed non-empty; kept in case Remote OK starts sending company logos.
    companyLogo: absoluteUrl(job.company_logo) ?? absoluteUrl(job.logo),
    locations: location ? [location] : [],
    // Remote-only board; `location` is the region/country restriction ("US Only", "Worldwide").
    remote: 'remote',
    descriptionHtml: description(job.description),
    postedAt: asString(job.date) ?? asNumber(job.epoch),
    salary: salary(job.salary_min, job.salary_max),
    tags: compactStrings(asArray(job.tags).map((t) => (typeof t === 'string' ? fixMojibake(t).toLowerCase() : t))),
  };
}

/** Trimmed, mojibake-repaired string; undefined when missing or blank. */
function text(value: unknown): string | undefined {
  const s = asString(value);
  return s === undefined ? undefined : asString(fixMojibake(s));
}

/** The posting's remoteok.com page ("https://remoteOK.com/remote-jobs/<slug>", host lower-cased). */
function postingUrl(url: unknown, slug: unknown): string | undefined {
  const given = absoluteUrl(url); // URL parsing lower-cases the host
  if (given && isRemoteOkHost(new URL(given).hostname)) return given;
  const s = asString(slug);
  return s && /^[\w-]+$/.test(s) ? `https://remoteok.com/remote-jobs/${s}` : undefined;
}

function isRemoteOkHost(host: string): boolean {
  return host === 'remoteok.com' || host.endsWith('.remoteok.com');
}

/** `salary_min` / `salary_max` in an unstated currency and period; 0 means unknown. */
function salary(minValue: unknown, maxValue: unknown): RawSalary | undefined {
  const min = asNumber(minValue);
  const max = asNumber(maxValue);
  const out: RawSalary = {};
  if (min !== undefined && min > 0) out.min = min;
  if (max !== undefined && max > 0) out.max = max;
  return out.min === undefined && out.max === undefined ? undefined : out;
}

function description(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const html = stripTrailer(fixMojibake(value));
  return html.trim() === '' ? undefined : html;
}

/**
 * Undo "UTF-8 bytes served as Latin-1 code points". Only strings made entirely of
 * code points <= U+00FF that decode as valid UTF-8 are changed; anything else
 * (plain ASCII, genuine Latin-1 text, real wide characters) is returned as is.
 * Must be Latin-1, not windows-1252: C1 controls (U+0080–U+009F) occur.
 */
function fixMojibake(s: string): string {
  if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(s, 'latin1'));
  } catch {
    return s;
  }
}

/** The exact trailer, observed on 201/201 descriptions. */
const TRAILER =
  /(?:<br\s*\/?>\s*)*Please mention the word \*\*[^*]+\*\* and tag \S+ when applying to show you read the job post completely \(#\S+\)\. This is a beta feature to avoid spam applicants\. Companies can search these words to find applicants that read this and see they're human\.\s*$/;
const TRAILER_START = /Please mention the word\b/gi;
/** "R" + base64, the shape of the IP-bearing tag. */
const TAG_TOKEN = /\(?#?\bR([A-Za-z0-9+/]{6,}={0,2})(?![A-Za-z0-9+/=])\)?/g;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^(?=.*:)[0-9a-f:.]{2,45}$/i;

/**
 * Remove the per-request anti-spam trailer, which embeds the caller's IP address.
 * Falls back to cutting from the last "Please mention the word" if the wording
 * drifts, then removes any remaining "R<base64>" token that decodes to an IP.
 */
function stripTrailer(html: string): string {
  let out = html.replace(TRAILER, '');
  if (out === html) {
    let cut = -1;
    for (const m of html.matchAll(TRAILER_START)) cut = m.index;
    if (cut >= 0) out = html.slice(0, cut).replace(/(?:\s*<br\s*\/?>)*\s*$/i, '');
  }
  return out.replace(TAG_TOKEN, (token, b64: string) => {
    const decoded = Buffer.from(b64, 'base64').toString('latin1');
    return IPV4.test(decoded) || IPV6.test(decoded) ? '' : token;
  });
}
