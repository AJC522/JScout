/**
 * Hacker News "Ask HN: Who is hiring?" — monthly threads posted by the
 * `whoishiring` account on the first weekday of each month. Every top-level
 * comment is one hiring company's post, written by someone at that company.
 *
 * Read through the HN Search API by Algolia (https://hn.algolia.com/api, no key):
 * 1. GET /api/v1/search_by_date?tags=story,author_whoishiring — newest stories
 *    of the account (it also posts "Who wants to be hired?"), filtered by title.
 * 2. GET /api/v1/search?tags=comment,story_<id>&numericFilters=parent_id=<id>
 *    — the thread's top-level comments. hitsPerPage is capped at 1000 by the API
 *    and a query serves at most 1000 hits; a thread has 200–400.
 * A new thread is thin for its first days, so the previous month's thread is
 * included while the current one has fewer than THIN_THREAD top-level comments.
 *
 * Comments are free text. The first paragraph usually reads
 * "Company | Role | Location | REMOTE/ONSITE | Salary | URL"; it is parsed
 * heuristically below. Comments whose header yields no company and role (job
 * seekers, prose-only posts, "position filled" edits) are skipped: about 15%.
 * The comment HTML is kept as the description.
 */
import {
  type FeedResult,
  type JobSource,
  type RawPosting,
  type SourceContext,
  SourceError,
} from './types';
import { absoluteUrl, asNumber, asRecord, asString, requireArray, requireRecord } from './util';

const API = 'https://hn.algolia.com/api/v1';
const MIN_INTERVAL_MS = 1_500;
/** Algolia's maximum page size; one page holds a whole thread. */
const HITS_PER_PAGE = 1_000;
const MAX_PAGES_PER_THREAD = 3;
/** Below this many top-level comments the current thread is "thin" and last month's is added. */
const THIN_THREAD = 150;
const STORY_HITS = 12;
const THREAD_TITLE = /^Ask HN:\s*Who is hiring\?/i;
const COMMENT_FIELDS = 'author,comment_text,created_at_i,parent_id,story_id';

interface Thread {
  id: string;
  title: string;
  createdAt: number;
}

interface ThreadComments {
  hits: unknown[];
  total: number;
  complete: boolean;
}

export const hnHiringSource: JobSource = {
  def: {
    id: 'hn-hiring',
    name: 'Hacker News: Who is hiring?',
    kind: 'community',
    mode: 'feed',
    homepage: 'https://news.ycombinator.com/submitted?id=whoishiring',
    description:
      'Monthly "Ask HN: Who is hiring?" threads: tech jobs posted by the hiring companies themselves, often with salaries. ' +
      'Company, title and location are read from each post\'s first line, so some are imperfect, and posts without a ' +
      'recognisable company and role are left out.',
    attribution: 'Posted on Hacker News (news.ycombinator.com); each job links to its original comment',
    perCompany: false,
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 6 * 60,
    fullSnapshot: true,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx): Promise<FeedResult> {
    const threads = await findThreads(ctx);
    const current = threads[0];
    if (!current) throw new SourceError('parse', 'Hacker News: no "Ask HN: Who is hiring?" thread found');

    const batches: Array<{ thread: Thread; comments: ThreadComments }> = [
      { thread: current, comments: await fetchThread(ctx, current) },
    ];
    const previous = threads[1];
    const first = batches[0];
    if (previous && first && first.comments.total < THIN_THREAD) {
      try {
        batches.push({ thread: previous, comments: await fetchThread(ctx, previous) });
      } catch (err) {
        if (!(err instanceof SourceError) || err.kind === 'aborted') throw err;
        ctx.log.warn('hn-hiring: the previous thread failed; returning the current one only', {
          thread: previous.id,
          error: err.message,
        });
        return { postings: mapBatches(ctx, batches), complete: false };
      }
    }

    const postings = mapBatches(ctx, batches);
    const complete = batches.every((b) => b.comments.complete) && postings.length > 0;
    return { postings, complete };
  },
};

async function findThreads(ctx: SourceContext): Promise<Thread[]> {
  const res = await ctx.http.getJson(`${API}/search_by_date`, {
    query: {
      tags: 'story,author_whoishiring',
      hitsPerPage: STORY_HITS,
      attributesToRetrieve: 'title,created_at_i,num_comments',
      attributesToHighlight: 'title',
    },
    minIntervalMs: MIN_INTERVAL_MS,
    signal: ctx.signal,
  });
  const envelope = requireRecord(res.data, 'Hacker News story search');
  const hits = requireArray(envelope.hits, 'Hacker News story search "hits"');
  const threads: Thread[] = [];
  for (const hit of hits) {
    const story = asRecord(hit);
    const id = asString(story?.objectID);
    const title = asString(story?.title);
    const createdAt = asNumber(story?.created_at_i);
    if (!id || !/^\d+$/.test(id) || !title || !THREAD_TITLE.test(title) || createdAt === undefined) continue;
    threads.push({ id, title, createdAt });
  }
  return threads.sort((a, b) => b.createdAt - a.createdAt);
}

async function fetchThread(ctx: SourceContext, thread: Thread): Promise<ThreadComments> {
  const hits: unknown[] = [];
  let total = 0;
  let exhaustive = true;
  let allPages = false;

  for (let page = 0; page < MAX_PAGES_PER_THREAD; page++) {
    if (ctx.signal?.aborted) throw new SourceError('aborted', 'Hacker News sync was cancelled');
    let envelope: Record<string, unknown>;
    let pageHits: unknown[];
    try {
      const res = await ctx.http.getJson(`${API}/search`, {
        query: {
          tags: `comment,story_${thread.id}`,
          numericFilters: `parent_id=${thread.id}`,
          hitsPerPage: HITS_PER_PAGE,
          page,
          attributesToRetrieve: COMMENT_FIELDS,
          attributesToHighlight: 'author',
        },
        minIntervalMs: MIN_INTERVAL_MS,
        signal: ctx.signal,
      });
      envelope = requireRecord(res.data, `Hacker News thread ${thread.id}`);
      pageHits = requireArray(envelope.hits, `Hacker News thread ${thread.id} "hits"`);
    } catch (err) {
      if (page === 0 || !(err instanceof SourceError) || err.kind === 'aborted') throw err;
      ctx.log.warn('hn-hiring: a page of comments failed; keeping the pages read so far', {
        thread: thread.id,
        page,
        error: err.message,
      });
      break;
    }

    hits.push(...pageHits);
    total = asNumber(envelope.nbHits) ?? total;
    if (envelope.exhaustiveNbHits === false || asRecord(envelope.exhaustive)?.nbHits === false) exhaustive = false;
    const nbPages = asNumber(envelope.nbPages) ?? 0;
    if (pageHits.length === 0 || page + 1 >= nbPages) {
      allPages = true;
      break;
    }
  }

  const complete = allPages && exhaustive && hits.length >= total;
  if (!complete) {
    ctx.log.warn('hn-hiring: not every top-level comment of the thread was read', {
      thread: thread.id,
      read: hits.length,
      total,
    });
  }
  return { hits, total, complete };
}

function mapBatches(ctx: SourceContext, batches: Array<{ thread: Thread; comments: ThreadComments }>): RawPosting[] {
  const postings: RawPosting[] = [];
  const seen = new Set<string>();
  for (const { thread, comments } of batches) {
    let skipped = 0;
    comments.hits.forEach((hit, index) => {
      try {
        const posting = mapComment(hit, thread.id);
        if (!posting) {
          skipped++;
          return;
        }
        if (seen.has(posting.externalId)) return;
        seen.add(posting.externalId);
        postings.push(posting);
      } catch (err) {
        ctx.log.warn('hn-hiring: skipped a malformed comment', {
          thread: thread.id,
          index,
          id: asString(asRecord(hit)?.objectID),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });
    if (skipped > 0) {
      ctx.log.info('hn-hiring: skipped comments without a recognisable company and role', {
        thread: thread.id,
        skipped,
        of: comments.hits.length,
      });
    }
  }
  return postings;
}

/** Throws on a malformed hit; null for a comment that is not a parseable job post. */
function mapComment(value: unknown, threadId: string): RawPosting | null {
  const hit = requireRecord(value, 'comment');
  const id = asString(hit.objectID);
  if (!id || !/^\d+$/.test(id)) throw new Error('missing objectID');
  const parent = asString(hit.parent_id);
  if (parent !== undefined && parent !== threadId) return null; // a reply, not a post
  const html = asString(hit.comment_text);
  if (!html) return null; // deleted or empty

  const header = parseHiringHeader(html);
  if (!header) return null;

  const applyUrl = firstExternalLink(html);
  const createdAt = asNumber(hit.created_at_i);
  return {
    externalId: id,
    url: `https://news.ycombinator.com/item?id=${id}`,
    ...(applyUrl ? { applyUrl } : {}),
    title: header.title,
    company: header.company,
    locations: header.locations,
    ...(header.remote ? { remote: header.remote } : {}),
    descriptionHtml: html,
    ...(createdAt !== undefined ? { postedAt: createdAt } : {}),
    ...(header.salaryText ? { salary: { text: header.salaryText } } : {}),
    ...(header.employmentType ? { employmentType: header.employmentType } : {}),
  };
}

function firstExternalLink(html: string): string | undefined {
  for (const match of html.matchAll(/<a\s[^>]*?href="([^"]*)"/gi)) {
    const url = absoluteUrl(decodeEntities(match[1] ?? ''));
    if (url && new URL(url).hostname !== 'news.ycombinator.com') return url;
  }
  return undefined;
}

// --- Header parsing ------------------------------------------------------------

export interface HiringHeader {
  company: string;
  /** One role, or several joined with ", " as the post lists them. */
  title: string;
  /** Raw place strings from the header, e.g. ["New York, NY", "REMOTE (US)"]. */
  locations: string[];
  remote?: 'remote' | 'hybrid' | 'onsite';
  salaryText?: string;
  employmentType?: string;
}

interface Segment {
  text: string;
  url: boolean;
  salary: boolean;
  employment: boolean;
  place: boolean;
  strongRole: boolean;
  weakRole: boolean;
  remoteWord: boolean;
}

const STRONG_ROLE = new RegExp(
  '(?<![\\p{L}\\d])(?:' +
    [
      'engineer(?:s|ing)?', 'developers?', 'programmers?', 'designers?', 'managers?', 'scientists?', 'analysts?',
      'architects?', 'directors?', 'officers?', 'researchers?', 'specialists?', 'consultants?', 'administrators?',
      'sysadmins?', 'technicians?', 'recruiters?', 'sourcers?', '(?:copy)?writers?', 'editors?', 'marketers?',
      'accountants?', 'controllers?', 'coordinators?', 'executives?', 'representatives?', 'strategists?', 'testers?',
      'advocates?', 'evangelists?', 'mathematicians?', 'physicists?', 'chemists?', 'biologists?', 'economists?',
      'statisticians?', 'teachers?', 'instructors?', 'tutors?', 'nurses?', 'physicians?', 'attorneys?', 'lawyers?',
      'paralegals?', 'counsel', 'generalists?', 'artists?', 'animators?', 'illustrators?', 'translators?',
      '(?:co-?)?founders?', 'cto', 'ceo', 'coo', 'cfo', 'cpo', 'cmo', 'ciso', 's?vp', 'president', 'devops',
      'member of technical staff', 'phd', 'postdocs?', 'fellows?', 'apprentices?', 'builders?', 'hackers?',
      'experts?', 'producers?', 'operators?', 'associates?', 'assistants?', 'technologists?',
    ].join('|') +
    ')(?![\\p{L}\\d])',
  'iu',
);
/** Role words that also appear in other kinds of segment, or that say little on their own. */
const WEAK_ROLE =
  /(?<![\p{L}\d])(?:leads?|head|hires?|sales|interns?|internships?|devs?|owners?|roles|positions|openings|jobs)(?![\p{L}\d])/iu;
const ROLE_ABBREVIATION = /(?<![\p{L}\d])(?:MTS|SREs?|SDETs?|SWEs?|FDEs?|AEs?|PMs?|TPMs?|EMs?|SDRs?|BDRs?|CSMs?|QA)(?![\p{L}\d])/u;

const PLACE_NAMES = [
  // regions
  'north america', 'south america', 'latin america', 'americas', 'europe', 'asia', 'africa', 'oceania', 'middle east',
  'emea', 'apac', 'latam', 'nordics', 'dach', 'benelux', 'worldwide', 'anywhere', 'bay area', 'silicon valley',
  'east coast', 'west coast',
  // countries
  'united states', 'america', 'canada', 'mexico', 'brazil', 'argentina', 'chile', 'colombia', 'peru', 'uruguay',
  'united kingdom', 'england', 'scotland', 'wales', 'ireland', 'germany', 'france', 'spain', 'portugal', 'italy',
  'netherlands', 'belgium', 'switzerland', 'austria', 'poland', 'czech republic', 'czechia', 'slovakia', 'hungary',
  'romania', 'bulgaria', 'greece', 'croatia', 'serbia', 'slovenia', 'ukraine', 'sweden', 'norway', 'denmark',
  'finland', 'estonia', 'latvia', 'lithuania', 'iceland', 'luxembourg', 'cyprus', 'malta', 'north macedonia',
  'turkey', 'israel', 'egypt', 'nigeria', 'kenya', 'south africa', 'morocco', 'india', 'pakistan', 'bangladesh',
  'sri lanka', 'nepal', 'china', 'japan', 'korea', 'taiwan', 'vietnam', 'thailand', 'indonesia', 'philippines',
  'malaysia', 'singapore', 'australia', 'new zealand', 'saudi arabia', 'qatar',
  // US states
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida',
  'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
  'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma',
  'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah',
  'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
  // cities
  'san francisco', 'brooklyn', 'manhattan', 'los angeles', 'seattle', 'bellevue', 'redmond', 'portland', 'boston',
  'cambridge', 'chicago', 'austin', 'dallas', 'houston', 'denver', 'boulder', 'atlanta', 'miami', 'philadelphia',
  'pittsburgh', 'baltimore', 'detroit', 'minneapolis', 'salt lake city', 'phoenix', 'san diego', 'san jose',
  'palo alto', 'mountain view', 'menlo park', 'sunnyvale', 'santa clara', 'redwood city', 'oakland', 'berkeley',
  'toronto', 'vancouver', 'montreal', 'ottawa', 'waterloo', 'london', 'manchester', 'edinburgh', 'oxford',
  'bristol', 'dublin', 'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne', 'köln', 'stuttgart',
  'freiburg', 'paris', 'lyon', 'toulouse', 'amsterdam', 'rotterdam', 'utrecht', 'brussels', 'zurich', 'zürich',
  'geneva', 'lausanne', 'basel', 'bern', 'vienna', 'lisbon', 'porto', 'madrid', 'barcelona', 'milan', 'rome',
  'stockholm', 'copenhagen', 'oslo', 'helsinki', 'espoo', 'tallinn', 'riga', 'vilnius', 'warsaw', 'krakow',
  'kraków', 'wroclaw', 'prague', 'brno', 'budapest', 'bucharest', 'sofia', 'athens', 'istanbul', 'tel aviv',
  'dubai', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'gurgaon', 'noida', 'hyderabad', 'pune', 'chennai',
  'tokyo', 'osaka', 'seoul', 'beijing', 'shanghai', 'shenzhen', 'hong kong', 'taipei', 'sydney', 'melbourne',
  'auckland', 'são paulo', 'sao paulo', 'mexico city', 'buenos aires', 'bogotá', 'bogota', 'santiago', 'lima',
  'cape town', 'lagos', 'nairobi', 'cairo',
];
const PLACE_NAME = new RegExp(`(?<![\\p{L}\\d])(?:${PLACE_NAMES.join('|')})(?![\\p{L}\\d])`, 'iu');
const PLACE_ABBREVIATION = /(?<![\p{L}\d])(?:US|USA|U\.S\.(?:A\.)?|UK|EU|EEA|NYC|SF|DC|LA|UAE)(?![\p{L}\d])/u;
const REGION_CODES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|' +
  'PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|AB|BC|MB|NB|NL|NS|ON|PE|QC|SK|CH|FR|ES|PT|IT|BE|AT|PL|CZ|SE|NO|DK|' +
  'FI|EE|IE|GR|JP|SG|AU|NZ|BR|MX|UK|US';
/** "Beaverton, OR", "Lausanne, CH". */
const CITY_REGION = new RegExp(`\\p{Lu}[\\p{L}.'’-]*(?:\\s+\\p{Lu}[\\p{L}.'’-]*)*,\\s*(?:${REGION_CODES})(?![\\p{L}\\d])`, 'u');
/** Words that name a remote scope but are too vague to mark a place on their own. */
const REMOTE_SCOPE = /(?<![\p{L}\d])(?:global|international|world)(?![\p{L}\d])/iu;

const REMOTE_WORD = /(?<![\p{L}])remote(?![\p{L}])/iu;
const NO_REMOTE = /(?<![\p{L}])(?:no|not|non)[\s-]+remote(?![\p{L}])/iu;
const PART_REMOTE = /(?<![\p{L}])part(?:ial(?:ly)?)?[\s-]*remote(?![\p{L}])/iu;
const HYBRID_WORD = /(?<![\p{L}])hybrid(?![\p{L}])/iu;
const ONSITE_WORD = /(?<![\p{L}])(?:on[\s-]?site|in[\s-]office|in[\s-]person|work[\s-]from[\s-]office)(?![\p{L}])/iu;
/** "2-3 days", "3x": fewer than five days in the office is hybrid work. */
const FEW_DAYS = /(?<![\p{L}\d])[1-4](?:\s*[-–]\s*[1-4])?\s*\+?\s*(?:days?|x)(?![\p{L}])/iu;

const CURRENCY_AMOUNT = /[$€£¥₹]\s?\d|\d\s?[$€£]|(?<![\p{L}\d])(?:USD|EUR|GBP|CHF|CAD|AUD|SEK|NOK|DKK|PLN|INR|JPY|SGD)(?![\p{L}])/u;
const THOUSANDS = /(?<![\p{L}\d])\d{2,3}(?:[.,]\d+)?\s?[kK](?![\p{L}\d])/u;
const SALARY_WORD = /(?<![\p{L}])(?:salary|compensation|comp|OTE)(?![\p{L}])/iu;
const EMPLOYMENT =
  /(?<![\p{L}])(?:full[\s-]?time|part[\s-]?time|contract(?:or)?s?|freelance(?:r)?|internships?|temporary|permanent|fractional|fixed[\s-]term|W-?2|1099|CDI)(?![\p{L}])/iu;
const URL_ONLY = /^(?:https?:\/\/\S+|www\.\S+|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/\S*)?)$/i;
const LINK = /https?:\/\/\S+|www\.\S+/gi;
/** Openers of posts that are not one company's job ad (seekers, edits, prose). */
const NOT_A_COMPANY =
  /^(?:location|remote|willing|seeking|looking|hi|hey|hello|i'm|i am|my name|backed by|update[ds]?|edit(?:ed)?|apply|closed|filled|we're|we are|who's|who is|this is|hiring|full[\s-]?time|part[\s-]?time|on[\s-]?site|hybrid)(?![\p{L}])/iu;
/** Where run-on prose starts after the header fields: "Full Time LiveKit is building ...". */
const PROSE_START =
  /\s(?=(?:[\p{Lu}][\p{L}\d.'’&-]*\s+){0,3}(?:is|are|was|we|we're|i|i'm|our|has|have|helps?|builds?|makes?|processes|provides|powers?)\s)/u;
const SENTENCE_OPENER = /^(?:i|i'm|we|we're|our|my|you|you'll|if|this|the)(?![\p{L}])/iu;

const MAX_SEGMENT = 120;
const MAX_PLACE_SEGMENT = 100;
const MAX_COMPANY = 80;

/**
 * Parse the first line of a "Who is hiring?" comment. Returns null when it does not
 * yield both a company and a role. Exported for tests.
 */
export function parseHiringHeader(commentHtml: string): HiringHeader | null {
  const paragraphs = commentParagraphs(commentHtml);
  const { parts, rest } = splitSegments(paragraphs[0] ?? []);
  const segments = parts.map(classify);
  const first = segments.shift();
  if (!first) return null;

  const locations: string[] = [];
  let companySegment = first;
  // "Cologne, Germany | UMH | Product Engineer": a place first, then a plain name.
  const second = segments[0];
  if (first.place && !first.strongRole && second && isPlain(second)) {
    locations.push(first.text);
    companySegment = second;
    segments.shift();
  }
  const company = companyName(companySegment.text);
  if (!company) return null;
  const companyPlace = parenthesesPlace(companySegment.text);

  // Posts without a role in the header often list the roles just below it.
  const title =
    pickTitle(segments) ??
    (companySegment.strongRole || companySegment.weakRole ? undefined : bodyRoles([...rest, ...paragraphs.slice(1).flat()]));
  if (!title) return null;

  let remote: HiringHeader['remote'];
  let hasHybrid = false;
  let hasOnsite = false;
  for (const seg of segments) {
    const text = seg.text;
    if (REMOTE_WORD.test(text) && !NO_REMOTE.test(text) && !PART_REMOTE.test(text)) remote = 'remote';
    if (HYBRID_WORD.test(text) || PART_REMOTE.test(text)) hasHybrid = true;
    if (ONSITE_WORD.test(text)) {
      if (FEW_DAYS.test(text)) hasHybrid = true;
      else hasOnsite = true;
    }
  }
  if (!remote) remote = hasHybrid ? 'hybrid' : hasOnsite ? 'onsite' : undefined;

  for (const seg of segments) {
    if (seg.text === title.source || seg.strongRole || seg.url || seg.text.length > MAX_PLACE_SEGMENT) continue;
    if (seg.place) locations.push(seg.text);
  }
  if (companyPlace) locations.push(companyPlace);

  const salary = segments.find((s) => s.salary && s.text !== title.source);
  const employment = segments.find((s) => s.employment && s.text !== title.source && s.text.length <= 60);
  return {
    company,
    title: title.text,
    locations: dedupe(locations),
    ...(remote ? { remote } : {}),
    ...(salary ? { salaryText: salary.text } : {}),
    ...(employment ? { employmentType: employment.text } : {}),
  };
}

/** Non-empty paragraphs as lines of plain text, links replaced by their targets. */
function commentParagraphs(html: string): string[][] {
  return html
    .split(/<p>/i)
    .map((raw) =>
      decodeEntities(
        raw
          .replace(/<a\s[^>]*?href="([^"]*)"[^>]*>[\s\S]*?<\/a>/gi, (_m, href: string) => ` ${decodeEntities(href)} `)
          .replace(/<[^>]*>/g, ' '),
      )
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line !== ''),
    )
    .filter((lines) => lines.length > 0);
}

/** Header fields, plus the header paragraph's remaining lines (body text run on without a blank line). */
function splitSegments(lines: string[]): { parts: string[]; rest: string[] } {
  const text = lines.join(' ');
  let parts: string[];
  let rest: string[] = [];
  const lastPiped = lines.reduce((last, line, i) => (line.includes('|') ? i : last), -1);
  if (lastPiped >= 0) {
    parts = lines.slice(0, lastPiped + 1).join(' ').split('|');
    rest = lines.slice(lastPiped + 1);
  } else if (/[•·]/.test(text)) {
    parts = text.split(/[•·]/);
  } else if (lines.length >= 2 && lines.length <= 8 && (lines[0]?.length ?? 0) <= MAX_COMPANY) {
    parts = lines;
  } else {
    parts = joinRanges(text.split(/\s+[-–—]+\s+/));
  }
  return { parts: parts.map(cleanSegment).filter((s) => s !== ''), rest };
}

/** Undo splits inside amounts: "$100k - $150k". */
function joinRanges(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /\d[kK]?$/.test(prev) && /^[$€£]?\d/.test(part)) out[out.length - 1] = `${prev} - ${part}`;
    else out.push(part);
  }
  return out;
}

function cleanSegment(segment: string): string {
  let s = segment.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[*_]+|[*_]+$/g, '').trim();
  if (s.length > 80) {
    const cut = PROSE_START.exec(s);
    if (cut && cut.index >= 3) s = s.slice(0, cut.index).trim();
  }
  return s.replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').trim();
}

function classify(text: string): Segment {
  // Long segments are mostly prose; only their start is read for markers.
  const head = text.length > MAX_SEGMENT ? text.slice(0, 40) : text;
  const remoteWord = REMOTE_WORD.test(head);
  const url = URL_ONLY.test(text);
  // Role words are looked for outside links: "estuary.dev" is not a dev.
  const words = url ? '' : text.replace(LINK, ' ');
  const place =
    !url &&
    (PLACE_NAME.test(head) || PLACE_ABBREVIATION.test(head) || CITY_REGION.test(head) || (remoteWord && REMOTE_SCOPE.test(head)));
  return {
    text,
    url,
    salary: !url && (CURRENCY_AMOUNT.test(text) || (THOUSANDS.test(text) && !/401\s?\(?k/i.test(text)) || SALARY_WORD.test(text)),
    employment: EMPLOYMENT.test(head),
    place,
    // Role abbreviations ("AE", "PM") inside a place segment are about the place: "London (and NYC for US AE)".
    strongRole: STRONG_ROLE.test(words) || (ROLE_ABBREVIATION.test(words) && !place),
    // "Full time + Internships" is about the contract; "Part-time Sales Lead" still names a role.
    weakRole: WEAK_ROLE.test(words.replace(new RegExp(EMPLOYMENT.source, 'giu'), ' ')),
    remoteWord: remoteWord || HYBRID_WORD.test(head) || ONSITE_WORD.test(head),
  };
}

function isPlain(seg: Segment): boolean {
  return !(seg.url || seg.salary || seg.employment || seg.place || seg.strongRole || seg.weakRole || seg.remoteWord);
}

/**
 * Role segments, best first: strong role words outside work-mode segments; else weaker
 * role words in segments that are nothing else; else a work-mode segment that names a role
 * ("REMOTE backend dev"), with the work-mode words removed.
 */
function pickTitle(segments: Segment[]): { text: string; source: string } | undefined {
  const usable = segments.filter(
    (s) => !s.url && s.text.length <= MAX_SEGMENT && !SENTENCE_OPENER.test(s.text) && (s.strongRole || s.weakRole),
  );
  // "Salary ranges for the Java Engineers ..." names a role but is about pay.
  let chosen = usable.filter((s) => s.strongRole && !s.remoteWord && !SALARY_WORD.test(s.text));
  if (chosen.length === 0) chosen = usable.filter((s) => s.weakRole && !s.remoteWord && !s.place && !s.salary);
  if (chosen.length === 0) chosen = usable.filter((s) => s.strongRole || (!s.place && !s.salary));
  if (chosen.length === 0) return undefined;

  const titles = chosen.map((s) => cleanTitle(s.text, s.remoteWord)).filter((t) => t !== '');
  if (titles.length === 0) return undefined;
  return { text: titles.join(', '), source: chosen[0]?.text ?? '' };
}

function cleanTitle(text: string, stripWorkMode: boolean): string {
  let t = text.replace(/^(?:we(?:'re| are) hiring|hiring|roles?|positions?|title)\s*[:\-–]?\s+/i, '');
  if (stripWorkMode) {
    t = t
      .replace(new RegExp(REMOTE_WORD.source, 'giu'), ' ')
      .replace(new RegExp(HYBRID_WORD.source, 'giu'), ' ')
      .replace(new RegExp(ONSITE_WORD.source, 'giu'), ' ')
      .replace(/\(\s*\)/g, ' ');
  }
  return t.replace(/\s+/g, ' ').replace(/^[\s,;:/–—-]+|[\s,;:/–—-]+$/g, '').trim();
}

/** Not a role line: prose, requirements, contact lines. */
const NOT_A_ROLE_LINE =
  /(?<![\p{L}])(?:is|are|was|were|has|have|had|we|you|our|i'm|hi|hey|hello|years?|experience|with|who|will|here|hiring|looking|salary|ranges?)(?![\p{L}])|@/iu;
const MAX_BODY_LINES = 15;
const MAX_BODY_ROLES = 5;

/**
 * Roles listed in the first lines of the body: "* Fullstack Engineer - https://...",
 * "Infrastructure Engineer: ...", "Senior iOS Engineer ($150k)".
 */
function bodyRoles(lines: string[]): { text: string; source: string } | undefined {
  const roles: string[] = [];
  for (const line of lines.slice(0, MAX_BODY_LINES)) {
    const item = line.replace(/^(?:[*•·>+\-–—]+|\d+[.)])\s*/, '').replace(/^(?:roles?|positions?|title)\s*:\s*/i, '');
    const name = (item.split(/\s*(?::|\s[-–—]+\s|[([|$€£]|https?:\/\/|\.\s)/)[0] ?? '').replace(/[\s,;.\-–—]+$/, '');
    if (name.length < 3 || name.length > 60 || name.split(' ').length > 7) continue;
    if (!(STRONG_ROLE.test(name) || ROLE_ABBREVIATION.test(name)) || SENTENCE_OPENER.test(name) || NOT_A_ROLE_LINE.test(name)) continue;
    if (!roles.some((r) => r.toLowerCase() === name.toLowerCase())) roles.push(name);
    if (roles.length === MAX_BODY_ROLES) break;
  }
  return roles.length > 0 ? { text: roles.join(', '), source: '' } : undefined;
}

function companyName(segment: string): string | undefined {
  if (NOT_A_COMPANY.test(segment) || segment.length > 2 * MAX_COMPANY) return undefined;
  let name = segment
    .replace(LINK, ' ')
    .replace(/\([^)]*\)?|\[[^\]]*\]?/g, ' ')
    .replace(/^company\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:*_–—-]+|[\s,;:*_–—-]+$/g, '')
    .trim();
  if (name === '') {
    // "https://acme.com | ...": the host names the company.
    const link = segment.match(LINK)?.[0];
    const url = link ? absoluteUrl(link.startsWith('www.') ? `https://${link}` : link) : undefined;
    name = url ? new URL(url).hostname.replace(/^www\./, '') : '';
  }
  if (name === '' || name.length > MAX_COMPANY || REMOTE_WORD.test(name) && name.split(' ').length <= 2) return undefined;
  return name;
}

/** "Flowstate (London, UK)" → "London, UK". */
function parenthesesPlace(segment: string): string | undefined {
  for (const match of segment.matchAll(/\(([^)]*)\)/g)) {
    const inner = (match[1] ?? '').trim();
    if (inner && inner.length <= 60 && (PLACE_NAME.test(inner) || CITY_REGION.test(inner))) return inner;
  }
  return undefined;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}
