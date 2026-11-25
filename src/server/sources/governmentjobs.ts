/**
 * GovernmentJobs.com (NEOGOV) — job boards of state, county and city governments, police and
 * sheriff's departments, courts, transit and utility districts. One feed per agency.
 *
 * Each agency's postings are read from its public RSS feed,
 * https://www.governmentjobs.com/SearchEngine/JobsFeed?agency={agency}, the syndication format NEOGOV
 * documents for its customers (the older agency.governmentjobs.com/{agency}/default.cfm?format=xml
 * feeds were retired in July 2025). The agency key is the name in the agency's career-page address,
 * governmentjobs.com/careers/{agency}. Only these feeds are read: the site's robots.txt asks crawlers
 * to stay off its HTML pages, so JScout never fetches them.
 *
 * One response holds every open posting with its full bulletin (description, duties, qualifications,
 * supplemental information), pay range and interval, job type, department, location, posting and
 * closing dates (verified live 2026-11-25: 612 postings / 16 MB for the State of Washington, 416 /
 * 11 MB for Los Angeles County). There is no paging, so a successful response is a complete snapshot.
 * The feed sends no validators, so no conditional requests are made.
 *
 * Quirks handled here:
 *  - An unknown agency answers 200 with `<Error>Invalid agency or RSS feed not enabled…</Error>`.
 *  - The channel title ends with the agency's state ("State of Washington, WA"); item locations
 *    rarely name it ("Thurston County – Olympia", "Lansing", "Various"), so it is added.
 *  - Dates come as "Wed, 25 Nov 2026 08:00:00:0" (a trailing milliseconds field); the *UTC variants
 *    are used. Open-until-filled postings say "Continuous" instead of a closing date.
 *  - Some agencies write titles in capitals ("INFORMATION TECHNOLOGY SPECIALIST II"); those are
 *    re-cased, keeping acronyms and Roman numerals.
 *  - Postings whose exam type is "Promotional" are open to the agency's own employees only and are
 *    skipped (the feed already leaves out promotional-only job lists).
 */
import { XMLParser } from 'fast-xml-parser';
import type { SalaryPeriod } from '../../shared/types';
import { type BoardRef, type FeedResult, type JobSource, type RawPosting, type RawSalary, type SourceContext, SourceError } from './types';
import { usStateCode } from './us-states';
import { absoluteUrl, asArray, asNumber, asRecord, asString, compactStrings } from './util';

const FEED_URL = 'https://www.governmentjobs.com/SearchEngine/JobsFeed';
const MIN_INTERVAL_MS = 1_000;
/** Large agencies' feeds are several megabytes and take a few seconds to generate. */
const FEED_TIMEOUT_MS = 90_000;
const MAX_BYTES = 60 * 1024 * 1024;

// XML entities only (htmlEntities: false): the bulletins are escaped HTML, and "&amp;nbsp;" must
// become the HTML entity "&nbsp;", not a space.
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  processEntities: true,
  htmlEntities: false,
  trimValues: true,
  isArray: (name) => name === 'item' || name === 'joblisting:category',
});

const PERIODS: Record<string, SalaryPeriod> = {
  hour: 'hour',
  hourly: 'hour',
  day: 'day',
  daily: 'day',
  week: 'week',
  weekly: 'week',
  month: 'month',
  monthly: 'month',
  year: 'year',
  yearly: 'year',
  annual: 'year',
  annually: 'year',
};

/** "…/careers/washington/jobs/5398503-0" -> "5398503-0" (job id and revision). */
const JOB_PATH = /\/jobs\/(\d+(?:-\d+)?)(?:[/?#]|$)/;
/** Locations that name no place: the posting is somewhere in the agency's state. */
const NO_PLACE =
  /^(?:various|multiple|several|all|numerous|statewide|state-wide|state wide|countywide|county-wide|county wide|citywide|city-wide|city wide|tbd|to be determined|see (?:job )?(?:bulletin|posting|description|below)|n\/?a)\b|\b(?:various|multiple|several) (?:locations?|sites?|work ?sites?|offices?|facilities|counties|departments?)\b|\bstatewide\b/i;

export const governmentjobsSource: JobSource = {
  def: {
    id: 'governmentjobs',
    name: 'GovernmentJobs',
    kind: 'ats',
    mode: 'feed',
    homepage: 'https://www.governmentjobs.com',
    description:
      'Career pages of state, county and city governments, police and sheriff’s departments and other public agencies that hire ' +
      'through GovernmentJobs.com (NEOGOV), read from each agency’s public job feed: complete bulletins with pay ranges and closing dates. ' +
      'Follow agencies on the Companies page, or add one by pasting its governmentjobs.com/careers link.',
    attribution: 'Jobs from the agency’s GovernmentJobs.com career page',
    perCompany: true,
    ats: 'governmentjobs',
    configFields: [],
    defaultEnabled: true,
    // Bulletins stay open for weeks and the feeds carry no validators: twice a day is plenty.
    defaultTtlMinutes: 720,
    fullSnapshot: true,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx, board): Promise<FeedResult> {
    const ref = requireBoard(board);
    const feed = await readFeed(ctx, ref.token);
    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    let failed = 0;
    feed.items.forEach((item, index) => {
      try {
        const posting = mapItem(item, feed.state);
        if (!posting || seen.has(posting.externalId)) return;
        seen.add(posting.externalId);
        postings.push(posting);
      } catch (err) {
        failed++;
        ctx.log.warn('governmentjobs: skipped a malformed posting', {
          board: ref.token,
          index,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });
    if (failed > 0 && failed === feed.items.length) {
      throw new SourceError('parse', `GovernmentJobs feed for ${ref.token}: none of the ${failed} items is a posting`);
    }
    return { postings, complete: true };
  },

  /** The feed is the only machine-readable view of a posting: re-read it and look the posting up. */
  async fetchDetail(ctx, posting, board) {
    const ref = requireBoard(board);
    const feed = await readFeed(ctx, ref.token);
    for (const item of feed.items) {
      let found: RawPosting | null;
      try {
        found = mapItem(item, feed.state);
      } catch {
        continue; // a malformed neighbour says nothing about this posting
      }
      if (found?.externalId === posting.externalId) {
        const detail: Partial<RawPosting> = {};
        if (found.descriptionHtml) detail.descriptionHtml = found.descriptionHtml;
        if (found.salary) detail.salary = found.salary;
        return detail;
      }
    }
    return null;
  },

  async probeBoard(ctx, token) {
    let feed: Feed;
    try {
      feed = await readFeed(ctx, token);
    } catch (err) {
      if (err instanceof SourceError && err.kind === 'not-found') return null;
      throw err;
    }
    const jobs = feed.items.filter((item) => !isPromotionalOnly(asRecord(item) ?? {})).length;
    return { jobs, ...(feed.title ? { name: feed.title } : {}) };
  },
};

interface Feed {
  /** Channel title as given, e.g. "State of Washington, WA". */
  title?: string;
  /** Two-letter state code from the channel title, when it has one. */
  state?: string;
  items: unknown[];
}

function requireBoard(board: BoardRef | undefined): BoardRef {
  if (!board) throw new SourceError('parse', 'GovernmentJobs needs an agency to read');
  return board;
}

function throwIfAborted(ctx: SourceContext): void {
  if (ctx.signal?.aborted) throw new SourceError('aborted', 'GovernmentJobs request was cancelled');
}

async function readFeed(ctx: SourceContext, agency: string): Promise<Feed> {
  throwIfAborted(ctx);
  const res = await ctx.http.getText(FEED_URL, {
    query: { agency },
    headers: { accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8' },
    minIntervalMs: MIN_INTERVAL_MS,
    timeoutMs: FEED_TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    signal: ctx.signal,
  });
  throwIfAborted(ctx);
  const body = (res.data ?? res.text).replace(/^﻿/, '');
  const head = body.trimStart().slice(0, 600);
  if (/<Error>[^<]*(?:invalid agency|not enabled)/i.test(head)) {
    throw new SourceError('not-found', `GovernmentJobs has no job feed for "${agency}"`, { status: 404 });
  }
  if (/^<!doctype html|^<html[\s>]/i.test(head)) {
    throw new SourceError('blocked', 'GovernmentJobs sent an HTML page instead of the job feed');
  }
  let doc: unknown;
  try {
    doc = parser.parse(body);
  } catch (err) {
    throw new SourceError('parse', 'GovernmentJobs feed: invalid XML', { cause: err });
  }
  const root = asRecord(doc);
  const error = asString(root?.Error);
  if (error) throw new SourceError(/agency/i.test(error) ? 'not-found' : 'parse', `GovernmentJobs: ${error}`);
  const channel = asRecord(asRecord(root?.rss)?.channel);
  if (!channel) throw new SourceError('parse', 'GovernmentJobs feed: not an RSS channel');
  const title = cleanText(asString(channel.title));
  const state = title ? usStateCode(/,\s*([A-Za-z]{2})\s*$/.exec(title)?.[1]) : undefined;
  return { ...(title ? { title } : {}), ...(state ? { state } : {}), items: asArray(channel.item) };
}

/** A posting, or null when it is not open to the public. Throws (with the reason) when it cannot be used. */
function mapItem(value: unknown, state: string | undefined): RawPosting | null {
  const item = asRecord(value);
  if (!item) throw new Error('not an object');
  if (isPromotionalOnly(item)) return null;

  const url = absoluteUrl(asString(item.link) ?? asString(item.guid));
  if (!url) throw new Error('no http(s) link');
  const jobId = asString(field(item, 'jobId'));
  const externalId = JOB_PATH.exec(url)?.[1] ?? jobId;
  if (!externalId) throw new Error('no job id');
  const rawTitle = cleanText(asString(item.title));
  if (!rawTitle) throw new Error('no title');

  const department = recase(cleanText(asString(field(item, 'department'))));
  const division = recase(cleanText(asString(field(item, 'division'))));
  const closes = utcDate(field(item, 'advertiseToDateTimeUTC'));
  const continuous = asString(field(item, 'continuous'))?.toLowerCase() === 'yes';

  return {
    externalId,
    url,
    title: recaseTitle(rawTitle),
    // The board's name replaces this for every posting (see normalizePosting).
    company: department ?? 'GovernmentJobs',
    locations: mapLocations(cleanText(asString(field(item, 'location'))), state),
    descriptionHtml: bulletin(item),
    postedAt: utcDate(field(item, 'advertiseFromDateUTC')) ?? asString(item.pubDate),
    updatedAt: asString(item.pubDate),
    ...(closes && !continuous ? { expiresAt: closes } : {}),
    salary: mapSalary(item),
    employmentType: cleanText(asString(field(item, 'jobType'))),
    department: department && division && !department.toLowerCase().includes(division.toLowerCase()) ? `${department} – ${division}` : (department ?? division),
    tags: compactStrings(asArray(asRecord(field(item, 'categories'))?.['joblisting:category']).map((c) => cleanText(asString(asRecord(c)?.Category)))),
  };
}

function field(item: Record<string, unknown>, name: string): unknown {
  return item[`joblisting:${name}`];
}

/** "Promotional" exams are open only to the agency's current employees ("Open & Promotional" is open to all). */
function isPromotionalOnly(item: Record<string, unknown>): boolean {
  return asString(field(item, 'examtype'))?.toLowerCase() === 'promotional';
}

/** The bulletin as NEOGOV shows it: description, then duties, qualifications and supplemental information. */
function bulletin(item: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  const add = (heading: string | undefined, value: unknown) => {
    const html = typeof value === 'string' ? value.trim() : '';
    if (!html || !/[\p{L}\p{N}]/u.test(html.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' '))) return;
    parts.push(heading ? `<h3>${heading}</h3>\n${html}` : html);
  };
  add(undefined, item.description);
  add('Duties', field(item, 'examplesofduties'));
  add('Qualifications', field(item, 'qualifications'));
  add('Supplemental information', field(item, 'supplementalinformation'));
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * The location as given with the agency's state added when it is missing; just the state when the
 * location names no place ("Various", "Multiple Locations Statewide") or is blank. A state on its own
 * is written "GA, US": "Georgia" alone is the country and "New York" the city.
 */
export function mapLocations(location: string | undefined, state: string | undefined): string[] {
  if (!location || NO_PLACE.test(location)) return state ? [`${state}, US`] : [];
  if (!state) return [location];
  const last = location.split(',').pop()?.trim();
  if (last && location.includes(',') && usStateCode(last)) return [location];
  return [`${location}, ${state}`];
}

function mapSalary(item: Record<string, unknown>): RawSalary | undefined {
  const min = positive(field(item, 'minimumSalary'));
  const max = positive(field(item, 'maximumSalary'));
  if (min === undefined && max === undefined) return undefined;
  const interval = asString(field(item, 'salaryInterval'))?.toLowerCase().replace(/[^a-z]/g, '');
  const currency = asString(field(item, 'salaryCurrency'));
  const period = interval ? PERIODS[interval] : undefined;
  return {
    min,
    max: max !== undefined && min !== undefined && max < min ? undefined : max,
    currency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : undefined,
    period,
    // Bi-weekly and other intervals have no SalaryPeriod: say so in words rather than guess.
    ...(interval && !period ? { text: `per ${asString(field(item, 'salaryInterval'))!.toLowerCase()}` } : {}),
  };
}

function positive(value: unknown): number | undefined {
  const n = asNumber(value);
  return n !== undefined && n > 0 ? n : undefined;
}

/** "Wed, 25 Nov 2026 08:00:00:0" (UTC) -> "Wed, 25 Nov 2026 08:00:00 GMT"; "Continuous" and others -> undefined. */
export function utcDate(value: unknown): string | undefined {
  const s = asString(value);
  const m = s ? /^([A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{1,2}:\d{2}:\d{2})(?::\d+)?$/.exec(s) : null;
  return m ? `${m[1]} GMT` : undefined;
}

const recase = (value: string | undefined): string | undefined => (value ? recaseTitle(value) : undefined);

function cleanText(value: string | undefined): string | undefined {
  const s = value?.replace(/\s+/g, ' ').trim();
  return s || undefined;
}

/** Words kept in capitals when a title written in capitals is re-cased. */
const ACRONYMS = new Set(
  (
    'I II III IV V VI VII VIII IX X XI XII XIII XIV XV IT GIS CAD RMS HR EMS EMT EMD ADA ATS CDL CPA CSI DA DNA DOT DPW DUI ' +
    'ERP FBI HVAC ICU ID IS LAN WAN LVN LPN RN CNA MD NCIC PC PIO PW QA QC SQL TV UAS US USA VA WIC 911 K9 AV IV CJIS ' +
    'CIO CTO CFO CISO OIT DOIT ITS IOD NCMEC MSM CSA GEMS MARS OCFO DMV DHS DOC DPS DJJ EOC PSAP RTCC SWAT UC'
  ).split(' '),
);
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/** "INFORMATION TECHNOLOGY SPECIALIST II / EMERGENCY APPOINTMENT" -> "Information Technology Specialist II / Emergency Appointment". */
export function recaseTitle(title: string): string {
  if (/\p{Ll}/u.test(title) || (title.match(/\p{L}/gu)?.length ?? 0) < 4) return title;
  let first = true;
  return title.replace(/[\p{L}\p{N}][\p{L}\p{N}'’.]*/gu, (word) => {
    const isFirst = first;
    first = false;
    const bare = word.replace(/[.'’]+$/, '');
    if (ACRONYMS.has(bare) || /\d/.test(word)) return word;
    const lower = word.toLowerCase();
    if (!isFirst && SMALL_WORDS.has(lower)) return lower;
    return lower.replace(/^\p{L}/u, (c) => c.toUpperCase());
  });
}
