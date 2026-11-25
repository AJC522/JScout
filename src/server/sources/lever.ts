/**
 * Lever Postings API (https://api.lever.co/v0/postings/{company}) — one feed per employer.
 *
 * GET /v0/postings/{company}?mode=json returns a bare JSON array of every published posting
 * with full descriptions. Without `limit` there is no cap (verified live: 305 postings for
 * palantir, 246 for zoox, each in one response), so a 200 is a complete snapshot; skip/limit
 * paging is deliberately not used because pages can shift while they are being read. Responses
 * carry a weak ETag and honour If-None-Match (304). robots.txt asks for `Crawl-delay: 1`, hence
 * the 1 s host gap. Latency is erratic (0.2 s to 13 s observed), hence the long timeout.
 *
 * Only the global instance is supported; companies hosted on Lever's EU instance
 * (api.eu.lever.co) answer 404 here.
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

const API = 'https://api.lever.co/v0/postings';
const MIN_INTERVAL_MS = 1_000;
const FEED_TIMEOUT_MS = 60_000;

const UUID_HREF = /href\s*=\s*["'][^"']*\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/apply)?\/?["']/gi;

export const leverSource: JobSource = {
  def: {
    id: 'lever',
    name: 'Lever',
    kind: 'ats',
    mode: 'feed',
    homepage: 'https://www.lever.co',
    description:
      'Job boards of employers that hire with Lever, read straight from each company’s public postings: ' +
      'complete and current, with structured remote/hybrid/on-site status and pay ranges where the employer publishes them. ' +
      'Add the companies you want to follow; companies on Lever’s EU servers cannot be read yet.',
    attribution: 'Jobs from the employer’s Lever job site',
    perCompany: true,
    ats: 'lever',
    configFields: [],
    defaultEnabled: true,
    defaultTtlMinutes: 360,
    fullSnapshot: true,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx, board, cursor): Promise<FeedResult> {
    const ref = requireBoard(board);
    checkAborted(ctx);
    const res = await ctx.http.getJson(companyUrl(ref.token), {
      query: { mode: 'json' },
      etag: cursor?.etag,
      minIntervalMs: MIN_INTERVAL_MS,
      timeoutMs: FEED_TIMEOUT_MS,
      signal: ctx.signal,
    });
    if (res.status === 304) {
      return { postings: [], complete: false, notModified: true, cursor: validators(res, cursor) };
    }

    const items = requireArray(res.data, 'Lever postings response');
    checkAborted(ctx);
    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    let failed = 0;
    items.forEach((item, index) => {
      try {
        const posting = mapPosting(item, ref);
        if (seen.has(posting.externalId)) return;
        seen.add(posting.externalId);
        postings.push(posting);
      } catch (err) {
        failed++;
        ctx.log.warn('lever: skipped a malformed posting', {
          board: ref.token,
          index,
          id: asString(asRecord(item)?.id),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });
    if (failed > 0 && failed === items.length) {
      throw new SourceError('parse', `Lever postings response: none of the ${failed} entries is a posting`);
    }
    return { postings, complete: true, cursor: validators(res) };
  },

  async fetchDetail(ctx, posting, board) {
    const ref = requireBoard(board);
    checkAborted(ctx);
    const res = await ctx.http.getJson(`${companyUrl(ref.token)}/${encodeURIComponent(posting.externalId)}`, {
      allowStatus: [404],
      minIntervalMs: MIN_INTERVAL_MS,
      timeoutMs: FEED_TIMEOUT_MS,
      signal: ctx.signal,
    });
    if (res.status === 404) return null;
    const item = requireRecord(res.data, 'Lever posting response');
    const detail: Partial<RawPosting> = {};
    const html = descriptionHtmlOf(item);
    if (html) detail.descriptionHtml = html;
    else {
      const text = asString(item.descriptionPlain);
      if (text) detail.descriptionText = text;
    }
    const salary = salaryOf(item.salaryRange);
    if (salary) detail.salary = salary;
    return detail;
  },

  /**
   * Lever reports no count and no company name. The `mode=html` listing is the cheapest complete
   * view (36 KB for zoox's 246 postings, against 2.5 MB of JSON): count the distinct posting ids linked.
   */
  async probeBoard(ctx, token) {
    checkAborted(ctx);
    const res = await ctx.http.getText(companyUrl(token), {
      query: { mode: 'html' },
      allowStatus: [404],
      minIntervalMs: MIN_INTERVAL_MS,
      timeoutMs: FEED_TIMEOUT_MS,
      signal: ctx.signal,
    });
    if (res.status === 404) return null;
    const ids = new Set<string>();
    for (const m of res.text.matchAll(UUID_HREF)) ids.add(m[1]!.toLowerCase());
    if (ids.size === 0 && !/<(ul|div|body)\b/i.test(res.text)) {
      throw new SourceError('parse', 'Lever listing: expected an HTML list of postings');
    }
    return { jobs: ids.size };
  },
};

function companyUrl(token: string): string {
  return `${API}/${encodeURIComponent(token.trim())}`;
}

function requireBoard(board: BoardRef | undefined): BoardRef {
  if (!board || !board.token.trim()) throw new SourceError('not-found', 'Lever needs a company token');
  return board;
}

function checkAborted(ctx: SourceContext): void {
  if (ctx.signal?.aborted) throw new SourceError('aborted', 'Lever request was cancelled');
}

function validators(res: HttpResponse<unknown>, previous?: FeedCursor): FeedCursor | undefined {
  const etag = asString(res.headers.etag) ?? previous?.etag;
  return etag ? { etag } : undefined;
}

function mapPosting(value: unknown, board: BoardRef): RawPosting {
  const item = asRecord(value);
  if (!item) throw new Error('not an object');
  const externalId = asString(item.id);
  const title = asString(item.text);
  const url = absoluteUrl(item.hostedUrl);
  if (!externalId) throw new Error('missing id');
  if (!title) throw new Error('missing text (title)');
  if (!url) throw new Error('missing or non-http hostedUrl');

  const categories = asRecord(item.categories) ?? {};
  const allLocations = compactStrings(asArray(categories.allLocations));
  const posting: RawPosting = {
    externalId,
    url,
    title,
    company: board.name.trim() || board.token,
    locations: allLocations.length > 0 ? allLocations : compactStrings([categories.location]),
  };
  const applyUrl = absoluteUrl(item.applyUrl);
  if (applyUrl && applyUrl !== url) posting.applyUrl = applyUrl;

  const workplace = asString(item.workplaceType)?.toLowerCase().replace(/[\s_-]+/g, '');
  if (workplace === 'remote' || workplace === 'hybrid' || workplace === 'onsite') posting.remote = workplace;

  const html = descriptionHtmlOf(item);
  if (html) posting.descriptionHtml = html;
  else {
    const text = asString(item.descriptionPlain);
    if (text) posting.descriptionText = text;
  }

  const createdAt = asNumber(item.createdAt) ?? asString(item.createdAt);
  if (createdAt !== undefined) posting.postedAt = createdAt;
  const salary = salaryOf(item.salaryRange);
  if (salary) posting.salary = salary;

  const commitment = asString(categories.commitment);
  if (commitment) posting.employmentType = commitment;
  const level = asString(categories.level);
  if (level) posting.seniority = level;
  const department = asString(categories.department);
  const team = asString(categories.team);
  if (department ?? team) posting.department = department ?? team;
  if (department && team && team.toLowerCase() !== department.toLowerCase()) posting.tags = [team];
  return posting;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The posting as Lever's hosted page lays it out: description, then each list as
 * <h3>heading</h3><ul>items</ul> (list `content` is already a run of <li> HTML; `text` is plain
 * text and is escaped), then the salary note, then `additional` (closing text, often EEO).
 */
function descriptionHtmlOf(item: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  const description = asString(item.description);
  if (description) parts.push(description);
  for (const entry of asArray(item.lists)) {
    const list = asRecord(entry);
    if (!list) continue;
    const heading = asString(list.text);
    const content = asString(list.content);
    if (!heading && !content) continue;
    if (heading) parts.push(`<h3>${escapeText(heading)}</h3>`);
    if (content) parts.push(`<ul>${content}</ul>`);
  }
  const salaryNote = asString(item.salaryDescription);
  if (salaryNote) parts.push(salaryNote);
  const additional = asString(item.additional);
  if (additional) parts.push(additional);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

const INTERVALS: Record<string, SalaryPeriod> = { year: 'year', month: 'month', week: 'week', day: 'day', hour: 'hour' };

/** salaryRange {min, max, currency, interval: "per-year-salary" | "per-hour-wage" | ...}. */
function salaryOf(value: unknown): RawSalary | undefined {
  const range = asRecord(value);
  if (!range) return undefined;
  const min = asNumber(range.min);
  const max = asNumber(range.max);
  if (min === undefined && max === undefined) return undefined;
  const salary: RawSalary = {};
  if (min !== undefined) salary.min = min;
  if (max !== undefined) salary.max = max;
  const currency = asString(range.currency)?.toUpperCase();
  if (currency) salary.currency = currency;
  const unit = /^per-(year|month|week|day|hour)\b/i.exec(asString(range.interval) ?? '')?.[1]?.toLowerCase();
  const period = unit ? INTERVALS[unit] : undefined;
  if (period) salary.period = period;
  return salary;
}
