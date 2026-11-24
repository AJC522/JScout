/**
 * We Work Remotely (https://weworkremotely.com) — remote-only job board.
 *
 * Reads WWR's public per-category RSS feeds, one after another at least 2 s
 * apart. Each category feed holds every open posting in that category (no
 * pagination; the all-jobs feed is only the newest 10 per category, so it is not
 * used). The merged result is complete only when every category feed was fetched
 * and validated; when some fail, the rest is returned as incomplete, and when all
 * fail the first error is thrown. A 429 or a bot challenge stops the run early.
 *
 * Quirks handled here:
 *  - Titles are "Company: Role" (split at the first ": ").
 *  - Different postings can share one guid/link (same page, different location):
 *    they are merged, with their locations combined.
 *  - The ETag changes on every response, so no conditional requests are made.
 *  - An unknown category slug answers 301 with no Location header (an error here).
 *
 * The description is passed on exactly as given after one round of XML entity
 * decoding (it still carries WWR's "Headquarters:" header and "To apply:" footer);
 * the header is only read, to pick up the company URL and a job-location string.
 *
 * WWR's terms could not be read from an automated client (bot challenge on the
 * HTML pages); the feeds carry no licence element.
 */
import { XMLParser } from 'fast-xml-parser';
import type { FeedResult, JobSource, RawPosting, SourceContext } from './types';
import { SourceError } from './types';
import { absoluteUrl, asArray, asRecord, asString, compactStrings } from './util';

const BASE_URL = 'https://weworkremotely.com/categories/';
const MIN_INTERVAL_MS = 2_000;
/** The largest category feed seen was 2.7 MB. */
const MAX_BYTES = 10 * 1024 * 1024;

interface Category {
  /** The `<category>` value; the channel title is "We Work Remotely: <name> Jobs". */
  name: string;
  slug: string;
}

/** All ten categories; every slug was fetched live and its channel title checked (2026-11-24). */
const CATEGORIES: readonly Category[] = [
  { name: 'Back-End Programming', slug: 'remote-back-end-programming-jobs' },
  { name: 'Front-End Programming', slug: 'remote-front-end-programming-jobs' },
  { name: 'Full-Stack Programming', slug: 'remote-full-stack-programming-jobs' },
  { name: 'DevOps and Sysadmin', slug: 'remote-devops-sysadmin-jobs' },
  { name: 'Design', slug: 'remote-design-jobs' },
  { name: 'Product', slug: 'remote-product-jobs' },
  { name: 'Customer Support', slug: 'remote-customer-support-jobs' },
  { name: 'Sales and Marketing', slug: 'remote-sales-and-marketing-jobs' },
  { name: 'Management and Finance', slug: 'remote-management-and-finance-jobs' },
  { name: 'All Other Remote', slug: 'all-other-remote-jobs' },
];

// XML entities only (htmlEntities: false): "&amp;nbsp;" must become the HTML entity "&nbsp;", not a space.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => name === 'item',
});

/** WWR's header paragraph: optional logo, "Headquarters:" text, optional company URL. */
const PREFIX =
  /^\s*(?:<img src="([^"]+)" \/>\s*)?<p>\s*<strong>Headquarters:<\/strong>([^<]*?)\s*(?:<br \/>\s*<strong>URL:<\/strong>\s*<a href="([^"]*)">[^<]*<\/a>[^<]*)?<\/p>/;
const ANYWHERE = /^anywhere in the world$/i;

export const weworkremotelySource: JobSource = {
  def: {
    id: 'weworkremotely',
    name: 'We Work Remotely',
    kind: 'board',
    mode: 'feed',
    homepage: 'https://weworkremotely.com',
    description:
      'Remote-only job board, read through its public per-category RSS feeds (ten requests per sync). ' +
      'Many listings are syndicated from employer job boards, and its category and region labels are often inaccurate.',
    attribution: 'Source: We Work Remotely (weworkremotely.com)',
    perCompany: false,
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 3 * 60,
    fullSnapshot: true,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx): Promise<FeedResult> {
    const merged = new Map<string, RawPosting>();
    const failures: { category: string; error: SourceError }[] = [];
    const notFetched: string[] = [];
    let fetched = 0;

    for (const category of CATEGORIES) {
      if (failures.some((f) => f.error.kind === 'rate-limited' || f.error.kind === 'blocked')) {
        notFetched.push(category.name); // stop hammering a host that is pushing back
        continue;
      }
      throwIfAborted(ctx);
      let items: unknown[];
      try {
        items = await fetchCategory(ctx, category);
      } catch (err) {
        throwIfAborted(ctx);
        if (err instanceof SourceError && err.kind === 'aborted') throw err;
        const error =
          err instanceof SourceError
            ? err
            : new SourceError('parse', `${category.name} feed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        failures.push({ category: category.name, error });
        continue;
      }
      fetched++;
      items.forEach((item, index) => {
        try {
          addPosting(merged, mapItem(item));
        } catch (err) {
          ctx.log.warn('weworkremotely: skipped a malformed posting', {
            category: category.name,
            index,
            guid: xmlText(asRecord(item)?.guid),
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }

    const first = failures[0];
    if (fetched === 0 && first) throw first.error;
    if (failures.length > 0) {
      ctx.log.warn('weworkremotely: some category feeds failed; returning an incomplete result', {
        failed: failures.map((f) => ({ category: f.category, kind: f.error.kind, status: f.error.status, error: f.error.message })),
        notFetched,
      });
    }

    const postings = [...merged.values()];
    // Never vouch for an empty board: that would close every indexed posting.
    const complete = failures.length === 0 && postings.length > 0;
    if (failures.length === 0 && postings.length === 0) {
      ctx.log.warn('weworkremotely: every category feed was empty; not treating it as a complete snapshot');
    }
    return { postings, complete };
  },
};

function throwIfAborted(ctx: SourceContext): void {
  if (ctx.signal?.aborted) throw new SourceError('aborted', 'We Work Remotely sync was cancelled');
}

/** Fetch and validate one category feed; returns its `<item>` elements. */
async function fetchCategory(ctx: SourceContext, category: Category): Promise<unknown[]> {
  const res = await ctx.http.getText(`${BASE_URL}${category.slug}.rss`, {
    headers: { accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8' },
    minIntervalMs: MIN_INTERVAL_MS,
    maxBytes: MAX_BYTES,
    signal: ctx.signal,
  });
  if (res.status !== 200) {
    throw new SourceError('http', `${category.name} feed: unexpected HTTP ${res.status}`, { status: res.status });
  }
  const body = res.data ?? res.text;
  const head = body.trimStart().slice(0, 1000);
  if (head === '') throw new SourceError('parse', `${category.name} feed: empty response`);
  if (/^<!doctype html|^<html[\s>]/i.test(head) || (!/<rss[\s>]/i.test(head) && /<html[\s>]/i.test(head))) {
    throw new SourceError('blocked', `${category.name} feed: got an HTML page instead of RSS (bot protection?)`);
  }

  let doc: unknown;
  try {
    doc = parser.parse(body);
  } catch (err) {
    throw new SourceError('parse', `${category.name} feed: invalid XML`, { cause: err });
  }
  const channel = asRecord(asRecord(asRecord(doc)?.rss)?.channel);
  if (!channel) throw new SourceError('parse', `${category.name} feed: not an RSS channel`);
  // Guards against being served some other feed (e.g. the all-jobs one), which must not count as complete.
  const title = xmlText(channel.title);
  const expected = `We Work Remotely: ${category.name} Jobs`;
  if (title?.toLowerCase() !== expected.toLowerCase()) {
    throw new SourceError('parse', `${category.name} feed: unexpected channel title ${JSON.stringify(title ?? null)}`);
  }
  return asArray(channel.item);
}

/** Same guid = same page: keep the first item, combine locations and tags. */
function addPosting(merged: Map<string, RawPosting>, posting: RawPosting): void {
  const existing = merged.get(posting.externalId);
  if (!existing) {
    merged.set(posting.externalId, posting);
    return;
  }
  const locations = compactStrings([...existing.locations, ...posting.locations]);
  // "Anywhere in the World" is WWR's default region; drop it once a real location is known.
  existing.locations = locations.some((l) => !ANYWHERE.test(l)) ? locations.filter((l) => !ANYWHERE.test(l)) : locations;
  existing.tags = compactStrings([...(existing.tags ?? []), ...(posting.tags ?? [])]);
}

function mapItem(value: unknown): RawPosting {
  const item = asRecord(value);
  if (!item) throw new Error('not an element');

  const url = httpUrl(xmlText(item.link) ?? xmlText(item.guid));
  if (!url) throw new Error('no http(s) link');
  const externalId = idFrom(xmlText(item.guid) ?? url);
  if (!externalId) throw new Error('no guid');

  // "Company: Role" — the role itself may contain ": " ("Backend Engineer (Python),AI Engineering: Agent Foundations").
  const fullTitle = xmlText(item.title);
  if (!fullTitle) throw new Error('no title');
  const split = fullTitle.indexOf(': ');
  if (split < 0) throw new Error('title has no "Company: " prefix');
  const company = asString(fullTitle.slice(0, split));
  const title = asString(fullTitle.slice(split + 2));
  if (!company) throw new Error('no company before ": " in the title');
  if (!title) throw new Error('no role after ": " in the title');

  const descriptionHtml = xmlText(item.description);
  const header = descriptionHtml ? PREFIX.exec(descriptionHtml) : null;
  const headquarters = header?.[2] === undefined ? undefined : asString(decodeText(header[2]));

  return {
    externalId,
    // The "To apply" link in every description is this same page, so there is no applyUrl.
    url,
    title,
    company,
    companyUrl: httpUrl(header?.[3] === undefined ? undefined : decodeText(header[3])),
    companyLogo: mediaUrl(item['media:content']) ?? httpUrl(header?.[1] === undefined ? undefined : decodeText(header[1])),
    locations: locations(xmlText(item.country), headquarters, xmlText(item.region)),
    // Remote-only board.
    remote: 'remote',
    descriptionHtml,
    postedAt: xmlText(item.pubDate),
    expiresAt: xmlText(item.expires_at),
    employmentType: xmlText(item.type),
    tags: compactStrings([xmlText(item.category), ...splitSkills(xmlText(item.skills))]),
  };
}

/**
 * Raw location strings, most specific first:
 *  1. each country from `<country>` ("🇨🇦 Canada, 🇵🇱 Poland, and 🇬🇧 United Kingdom of …"), flags dropped;
 *  2. the "Headquarters:" text when it mentions remote/hybrid — for imported listings it is the job's
 *     location string ("Remote - US"); otherwise it is the company's address and is not used;
 *  3. `<region>` ("USA Only", "Europe Only") unless it is the default "Anywhere in the World",
 *     which is only used when nothing else is known.
 * `<state>` is the company's state, not a job location, and is ignored.
 */
function locations(country: string | undefined, headquarters: string | undefined, region: string | undefined): string[] {
  const out = splitCountries(country);
  if (headquarters && /remote|hybrid/i.test(headquarters)) out.push(headquarters);
  if (region && !ANYWHERE.test(region)) out.push(region);
  if (out.length === 0 && region) out.push(region);
  return compactStrings(out);
}

/** Each entry starts with a flag emoji (a regional-indicator pair); entries are joined as an English list. */
function splitCountries(value: string | undefined): string[] {
  if (!value) return [];
  const parts = value.split(/\p{Regional_Indicator}{2}/u);
  // Without flags the value cannot be split safely ("Bosnia and Herzegovina"); keep it whole.
  if (parts.length === 1) return [value];
  return parts.map((p) => p.replace(/[\s,]*(?:\band)?[\s,]*$/, '').trim()).filter((p) => p !== '');
}

/** "AWS, Java, Agile, and API Design" / "Azure and DevOps" / "Power BI". */
function splitSkills(value: string | undefined): string[] {
  if (!value) return [];
  if (!value.includes(',')) return value.split(/\s+and\s+/i);
  const parts = value.split(',');
  return parts.map((p, i) => (i === parts.length - 1 ? p.trim().replace(/^and\s+/i, '') : p));
}

/** `<media:content url="…"/>` (the company logo); may repeat. */
function mediaUrl(value: unknown): string | undefined {
  for (const media of Array.isArray(value) ? value : [value]) {
    const url = httpUrl(asString(asRecord(media)?.['@_url']));
    if (url) return url;
  }
  return undefined;
}

/** Last path segment of the guid URL ("…/remote-jobs/<slug>"), or the guid itself when it is not a URL. */
function idFrom(guid: string): string | undefined {
  if (!absoluteUrl(guid)) return asString(guid);
  const segments = new URL(guid).pathname.split('/').filter((s) => s !== '');
  return asString(segments[segments.length - 1]);
}

/** Text of an element (or of its `#text` when it has attributes), trimmed; undefined when blank. */
function xmlText(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return asString(value);
  return asString(asRecord(value)?.['#text']);
}

/** The string as given when it is an absolute http(s) URL. */
function httpUrl(value: string | undefined): string | undefined {
  const s = asString(value);
  return s && absoluteUrl(s) ? s : undefined;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decode the few HTML entities that occur in text and attribute values pulled out of the header. */
function decodeText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}
