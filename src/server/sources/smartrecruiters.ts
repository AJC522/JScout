/**
 * SmartRecruiters Posting API (https://api.smartrecruiters.com/v1/companies/{company}/postings) —
 * one feed per employer. Used by large employers and some governments (the City and County of San
 * Francisco hires through it).
 *
 * The list pages (100 per request, `offset`/`limit`, `totalFound`) carry title, location with
 * structured remote/hybrid flags, department, function, employment type, experience level and the
 * release date, but no description: that comes from the single-posting endpoint
 * (/postings/{id}, about 20 KB) and is fetched when a posting is first opened. A complete walk of the
 * pages is a complete snapshot. An unknown company answers 200 with `totalFound: 0`, so a board with no
 * open postings and a misspelt identifier look the same; identifiers are case-sensitive.
 * Verified live 2026-11-25 (CityAndCountyOfSanFrancisco1: 213 postings, BoschGroup: 5,173).
 */
import { type BoardRef, type FeedResult, type JobSource, type RawPosting, type SourceContext, SourceError } from './types';
import { asArray, asNumber, asRecord, asString, compactStrings, requireArray, requireRecord } from './util';

const API = 'https://api.smartrecruiters.com/v1/companies';
const PAGE_SIZE = 100;
/** 10,000 postings; larger boards are read partially and not treated as complete. */
const MAX_PAGES = 100;
const MIN_INTERVAL_MS = 1_000;
const TIMEOUT_MS = 60_000;

const SECTIONS: ReadonlyArray<[key: string, heading: string]> = [
  ['jobDescription', 'Job description'],
  ['qualifications', 'Qualifications'],
  ['additionalInformation', 'Additional information'],
  ['companyDescription', 'About the employer'],
];

export const smartrecruitersSource: JobSource = {
  def: {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    kind: 'ats',
    mode: 'feed',
    homepage: 'https://www.smartrecruiters.com',
    description:
      'Job boards of employers and public agencies that hire with SmartRecruiters, read from each one’s public postings, with structured ' +
      'remote/hybrid status. Descriptions are fetched when you open a posting. Add one by pasting its jobs.smartrecruiters.com link.',
    attribution: 'Jobs from the employer’s SmartRecruiters job site',
    perCompany: true,
    ats: 'smartrecruiters',
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 360,
    fullSnapshot: true,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx, board): Promise<FeedResult> {
    const ref = requireBoard(board);
    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    let total = Number.POSITIVE_INFINITY;
    let read = 0;
    let complete = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await fetchPage(ctx, ref.token, page * PAGE_SIZE);
      const items = requireArray(body.content, 'SmartRecruiters postings "content"');
      const found = asNumber(body.totalFound);
      if (found !== undefined) total = found;
      read += items.length;
      items.forEach((item, index) => {
        try {
          const posting = mapPosting(item, ref);
          if (seen.has(posting.externalId)) return;
          seen.add(posting.externalId);
          postings.push(posting);
        } catch (err) {
          ctx.log.warn('smartrecruiters: skipped a malformed posting', {
            board: ref.token,
            index,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      });
      if (items.length < PAGE_SIZE || read >= total) {
        complete = true;
        break;
      }
    }
    if (!complete) ctx.log.warn('smartrecruiters: board too large to read completely', { board: ref.token, read, total });
    // An empty answer is also what an unknown identifier gets: never vouch for it.
    return { postings, complete: complete && postings.length > 0 };
  },

  async fetchDetail(ctx, posting, board) {
    const ref = requireBoard(board);
    throwIfAborted(ctx);
    const res = await ctx.http.getJson(`${API}/${encodeURIComponent(ref.token)}/postings/${encodeURIComponent(posting.externalId)}`, {
      allowStatus: [404],
      minIntervalMs: MIN_INTERVAL_MS,
      timeoutMs: TIMEOUT_MS,
      signal: ctx.signal,
    });
    if (res.status === 404) return null;
    const item = requireRecord(res.data, 'SmartRecruiters posting');
    if (item.active === false) return null;
    const detail: Partial<RawPosting> = {};
    const html = descriptionHtml(item);
    if (html) detail.descriptionHtml = html;
    const apply = asString(item.applyUrl);
    if (apply && /^https:\/\//.test(apply)) detail.applyUrl = apply;
    return detail;
  },

  async probeBoard(ctx, token) {
    const body = await fetchPage(ctx, token, 0, 1);
    const total = asNumber(body.total ?? body.totalFound) ?? 0;
    if (total <= 0) return null;
    const name = asString(asRecord(asRecord(asArray(body.content)[0])?.company)?.name);
    return { jobs: total, ...(name ? { name } : {}) };
  },
};

function requireBoard(board: BoardRef | undefined): BoardRef {
  if (!board) throw new SourceError('parse', 'SmartRecruiters needs a company to read');
  return board;
}

function throwIfAborted(ctx: SourceContext): void {
  if (ctx.signal?.aborted) throw new SourceError('aborted', 'SmartRecruiters request was cancelled');
}

async function fetchPage(ctx: SourceContext, company: string, offset: number, limit = PAGE_SIZE): Promise<Record<string, unknown>> {
  throwIfAborted(ctx);
  const res = await ctx.http.getJson(`${API}/${encodeURIComponent(company)}/postings`, {
    query: { limit, offset },
    minIntervalMs: MIN_INTERVAL_MS,
    timeoutMs: TIMEOUT_MS,
    signal: ctx.signal,
  });
  return requireRecord(res.data, 'SmartRecruiters postings');
}

function label(value: unknown): string | undefined {
  return asString(asRecord(value)?.label);
}

/** Throws (with the reason) when the posting cannot be used. */
function mapPosting(value: unknown, board: BoardRef): RawPosting {
  const item = asRecord(value);
  if (!item) throw new Error('not an object');
  const id = asString(item.id);
  if (!id || !/^[A-Za-z0-9-]+$/.test(id)) throw new Error('no id');
  const title = asString(item.name);
  if (!title) throw new Error('no title');
  const loc = asRecord(item.location) ?? {};
  const remote = loc.remote === true ? 'remote' : loc.hybrid === true ? 'hybrid' : undefined;
  const place = asString(loc.fullLocation) ?? compactStrings([loc.city, loc.region, asString(loc.country)?.toUpperCase()]).join(', ');
  return {
    externalId: id,
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(board.token)}/${id}`,
    title,
    company: asString(asRecord(item.company)?.name) ?? board.name,
    locations: place ? [place] : remote ? ['Remote'] : [],
    ...(remote ? { remote } : {}),
    postedAt: asString(item.releasedDate),
    employmentType: label(item.typeOfEmployment),
    seniority: label(item.experienceLevel),
    department: label(item.department),
    tags: compactStrings([label(item.function), label(item.industry)]),
  };
}

function descriptionHtml(item: Record<string, unknown>): string | undefined {
  const sections = asRecord(asRecord(item.jobAd)?.sections);
  if (!sections) return undefined;
  const parts: string[] = [];
  for (const [key, heading] of SECTIONS) {
    const text = asString(asRecord(sections[key])?.text);
    if (text) parts.push(`<h3>${asString(asRecord(sections[key])?.title) ?? heading}</h3>\n${text}`);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}
