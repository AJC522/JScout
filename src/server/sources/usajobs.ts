/**
 * USAJOBS (https://www.usajobs.gov) — the U.S. federal government's official job site.
 *
 * Read through the public USAJOBS data API at data.usajobs.gov, which needs no key:
 *  - GET /api/historicjoa?StartPositionCloseDate={today}&EndPositionOpenDate={today} lists every job
 *    opportunity announcement that has opened and not yet closed (12,499 on 2026-11-25), 500 per page,
 *    with agency, title, occupational series, grades, pay range, locations, schedule, appointment type,
 *    security clearance, hiring paths (who may apply) and opening status. Further pages are linked from
 *    `paging.next` (a continuation token); the last page has no `paging`.
 *  - GET /api/historicjoa/announcementtext takes the same filters (plus PositionSeries, one series per
 *    request) or USAJOBSControlNumbers and returns the announcement text: summary, duties,
 *    qualifications, education, conditions of employment, how to apply… (about 19 KB per announcement).
 *
 * Downloading every announcement's text would be ~235 MB per sync, so full text is fetched in bulk only
 * for the occupational series named in the source settings (by default IT, computer science, data,
 * engineering, GIS, intelligence, security, investigation and law-enforcement series, ~1,300
 * announcements); every other posting gets its text when it is first opened (fetchDetail).
 *
 * Left out: announcements no longer accepting applications ("Applications under review", "Job closed",
 * "Job canceled", "Candidate selected"), sign-up registers (series 9999, "RPL"), OPM's test
 * announcements, and — unless the setting asks for them — announcements open only to current or former
 * federal employees.
 *
 * Quirks handled here:
 *  - The API sits behind Akamai, which refuses curl's default user agent (403); the app's agent works.
 *  - Pages occasionally fail with a 503 HTML page; the HTTP client retries those.
 *  - teleworkEligible is "N" on every announcement, so it is not used.
 *  - Overseas installation names are rarely in the place list and some collide with other places
 *    ("Zama, Camp Zama, Japan" also names a town in Mexico), so only the country is given for
 *    locations outside the United States.
 */
import type { SalaryPeriod } from '../../shared/types';
import { type FeedResult, type JobSource, type RawPosting, type RawSalary, type SourceContext, SourceError } from './types';
import { usStateCode } from './us-states';
import { asArray, asNumber, asRecord, asString, compactStrings, requireArray, requireRecord } from './util';

const API = 'https://data.usajobs.gov';
const LIST_PATH = '/api/historicjoa';
const TEXT_PATH = '/api/historicjoa/announcementtext';
const MIN_INTERVAL_MS = 1_000;
/** Pages take 1–8 s to build. */
const PAGE_TIMEOUT_MS = 120_000;
const MAX_PAGES = 80;
const MAX_TEXT_PAGES_PER_SERIES = 10;
const MAX_LOCATIONS = 25;

/**
 * Occupational series whose announcements are downloaded with their full text: IT and computing,
 * data and statistics, engineering, GIS, intelligence, security, investigation and law enforcement.
 */
export const DEFAULT_FULL_TEXT_SERIES: readonly string[] = [
  '2210', // Information Technology Management (IT Specialist)
  '1550', // Computer Science
  '0854', // Computer Engineering
  '0855', // Electronics Engineering
  '0856', // Electronics Technical
  '0391', // Telecommunications
  '0332', // Computer Operation
  '0335', // Computer Clerk and Assistant
  '1560', // Data Science
  '1515', // Operations Research
  '1529', // Mathematical Statistics
  '1530', // Statistics
  '0801', // General Engineering
  '0850', // Electrical Engineering
  '1370', // Cartography
  '0150', // Geography
  '0132', // Intelligence
  '0080', // Security Administration
  '0083', // Police
  '0089', // Emergency Management
  '1801', // General Inspection, Investigation, Enforcement, and Compliance
  '1805', // Investigative Analysis
  '1810', // General Investigation
  '1811', // Criminal Investigation
];

/** Names of the series above and other common ones, for tags ("2210 Information Technology Management"). */
const SERIES_NAMES: Record<string, string> = {
  '0080': 'Security Administration',
  '0083': 'Police',
  '0089': 'Emergency Management',
  '0132': 'Intelligence',
  '0150': 'Geography',
  '0201': 'Human Resources Management',
  '0301': 'Miscellaneous Administration and Program',
  '0332': 'Computer Operation',
  '0335': 'Computer Clerk and Assistant',
  '0343': 'Management and Program Analysis',
  '0391': 'Telecommunications',
  '0510': 'Accounting',
  '0602': 'Medical Officer',
  '0610': 'Nurse',
  '0801': 'General Engineering',
  '0850': 'Electrical Engineering',
  '0854': 'Computer Engineering',
  '0855': 'Electronics Engineering',
  '0856': 'Electronics Technical',
  '0905': 'General Attorney',
  '1102': 'Contracting',
  '1370': 'Cartography',
  '1515': 'Operations Research',
  '1529': 'Mathematical Statistics',
  '1530': 'Statistics',
  '1550': 'Computer Science',
  '1560': 'Data Science',
  '1801': 'General Inspection, Investigation, Enforcement, and Compliance',
  '1805': 'Investigative Analysis',
  '1810': 'General Investigation',
  '1811': 'Criminal Investigation',
  '1896': 'Border Patrol Enforcement',
  '2210': 'Information Technology Management',
};

/** Hiring paths that are open only to current or former federal employees. */
const FEDERAL_ONLY_PATHS = new Set(
  [
    'Internal to an agency',
    'Federal employees - Competitive service',
    'Federal employees - Excepted service',
    'Career transition (CTAP, ICTAP, RPL)',
    'Land and base management',
    'Senior executives',
    'Family of overseas employees',
  ].map((p) => p.toLowerCase()),
);

const OPEN_STATUSES = new Set(['accepting applications']);

const PERIODS: Record<string, SalaryPeriod> = {
  'per year': 'year',
  'per hour': 'hour',
  'per day': 'day',
  'per week': 'week',
  'per month': 'month',
};

/** Announcement text sections in the order USAJOBS shows them. */
const TEXT_SECTIONS: ReadonlyArray<[key: string, heading: string]> = [
  ['summary', 'Summary'],
  ['duties', 'Duties'],
  ['majorDutiesList', 'Major duties'],
  ['requirementsConditionsOfEmployment', 'Conditions of employment'],
  ['requirementsQualifications', 'Qualifications'],
  ['requirementsEducation', 'Education'],
  ['requirements', 'Additional information'],
  ['evaluations', 'How you will be evaluated'],
  ['benefits', 'Benefits'],
  ['requiredDocuments', 'Required documents'],
  ['howToApply', 'How to apply'],
  ['howToApplyNextSteps', 'Next steps'],
  ['otherInformation', 'Other information'],
];

export const usajobsSource: JobSource = {
  def: {
    id: 'usajobs',
    name: 'USAJOBS',
    kind: 'board',
    mode: 'feed',
    homepage: 'https://www.usajobs.gov',
    description:
      'Every open U.S. federal government job (over 10,000: IT, cybersecurity, engineering, intelligence, law enforcement and every ' +
      'other occupation) from the official USAJOBS data API, with grades, pay, clearance and who may apply. No key needed. Full job ' +
      'text is downloaded for technology, intelligence and law-enforcement series and fetched for other jobs when you open them.',
    attribution: 'Source: USAJOBS (usajobs.gov), the U.S. federal government’s official job site',
    perCompany: false,
    configFields: [
      {
        key: 'fullTextSeries',
        label: 'Download full job text for these occupational series',
        secret: false,
        required: false,
        help:
          'Optional. Four-digit OPM series codes separated by commas, e.g. "2210, 1550, 1811". Replaces the default list: ' +
          `${DEFAULT_FULL_TEXT_SERIES.join(', ')} (IT, computing, data, engineering, GIS, intelligence, security, investigation, police). ` +
          'Jobs in other series still appear; their text is fetched when you open them.',
      },
      {
        key: 'includeFederalOnly',
        label: 'Include jobs open only to current federal employees',
        secret: false,
        required: false,
        help: 'Optional. Type "yes" to also list announcements open only to current or former federal employees (internal, merit promotion and career-transition jobs).',
      },
    ],
    defaultEnabled: true,
    defaultTtlMinutes: 12 * 60,
    fullSnapshot: true,
    // Pages are read with continuation tokens over a live data set, so a posting can slip between two pages.
    closeGraceMinutes: 24 * 60,
    minRequestIntervalMs: MIN_INTERVAL_MS,
  },

  async fetchFeed(ctx): Promise<FeedResult> {
    const today = isoDay(ctx.now());
    const filters = { StartPositionCloseDate: today, EndPositionOpenDate: today };
    const { rows, complete } = await readAll(ctx, LIST_PATH, filters, MAX_PAGES, 'announcements');

    const includeFederalOnly = /^(?:y|yes|true|1|on)$/i.test(ctx.config.includeFederalOnly?.trim() ?? '');
    const kept = rows.flatMap((row) => {
      const r = asRecord(row);
      return r && isListable(r, today, includeFederalOnly) ? [r] : [];
    });

    const texts = await readTexts(ctx, kept, fullTextSeries(ctx.config.fullTextSeries), filters);

    const postings: RawPosting[] = [];
    const seen = new Set<string>();
    for (const row of kept) {
      try {
        const posting = mapRow(row, texts.get(String(asNumber(row.usajobsControlNumber))));
        if (seen.has(posting.externalId)) continue;
        seen.add(posting.externalId);
        postings.push(posting);
      } catch (err) {
        ctx.log.warn('usajobs: skipped a malformed announcement', {
          id: asString(row.usajobsControlNumber),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Never vouch for an empty list: that would close every indexed federal job.
    return { postings, complete: complete && postings.length > 0 };
  },

  /** Announcement text for one posting; null once it has closed. */
  async fetchDetail(ctx, posting) {
    const id = posting.externalId.trim();
    if (!/^\d+$/.test(id)) return null;
    throwIfAborted(ctx);
    const res = await ctx.http.getJson(API + TEXT_PATH, {
      query: { USAJOBSControlNumbers: id },
      minIntervalMs: MIN_INTERVAL_MS,
      timeoutMs: PAGE_TIMEOUT_MS,
      signal: ctx.signal,
    });
    const record = requireArray(requireRecord(res.data, 'USAJOBS announcement text').data, 'USAJOBS announcement text "data"')
      .map(asRecord)
      .find((r) => r && String(asNumber(r.usajobsControlNumber)) === id);
    if (!record) return null;
    const closes = asString(record.positionCloseDate);
    if (closes && closes < isoDay(ctx.now())) return null;
    const html = textHtml(record);
    return html ? { descriptionHtml: html } : {};
  },
};

function throwIfAborted(ctx: SourceContext): void {
  if (ctx.signal?.aborted) throw new SourceError('aborted', 'USAJOBS request was cancelled');
}

/** "YYYY-MM-DD" for the date in Washington, D.C. (announcements open and close on Eastern dates). */
function isoDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Every page of a historic JOA listing. Incomplete (with what was read) when a later page fails;
 * throws when the first one does.
 */
async function readAll(
  ctx: SourceContext,
  path: string,
  query: Record<string, string>,
  maxPages: number,
  what: string,
): Promise<{ rows: unknown[]; complete: boolean }> {
  const rows: unknown[] = [];
  let url = API + path;
  let params: Record<string, string> | undefined = query;
  for (let page = 0; page < maxPages; page++) {
    throwIfAborted(ctx);
    let body: Record<string, unknown>;
    try {
      const res = await ctx.http.getJson(url, {
        ...(params ? { query: params } : {}),
        minIntervalMs: MIN_INTERVAL_MS,
        timeoutMs: PAGE_TIMEOUT_MS,
        retries: 3,
        signal: ctx.signal,
      });
      body = requireRecord(res.data, `USAJOBS ${what}`);
      rows.push(...requireArray(body.data, `USAJOBS ${what} "data"`));
    } catch (err) {
      if (page === 0 || (err instanceof SourceError && err.kind === 'aborted')) throw err;
      ctx.log.warn(`usajobs: a page of ${what} failed; keeping the ${rows.length} read so far`, {
        page,
        error: err instanceof Error ? err.message : String(err),
      });
      return { rows, complete: false };
    }
    const next = asString(asRecord(body.paging)?.next);
    if (!next) return { rows, complete: true };
    const nextUrl = new URL(next, API);
    if (nextUrl.origin !== API) throw new SourceError('parse', `USAJOBS ${what}: unexpected next page ${nextUrl.origin}`);
    url = nextUrl.toString();
    params = undefined;
  }
  ctx.log.warn(`usajobs: stopped after ${maxPages} pages of ${what}`);
  return { rows, complete: false };
}

/** Announcement texts for the kept rows in the given series, by control number. Failures only cost the text. */
async function readTexts(
  ctx: SourceContext,
  rows: Record<string, unknown>[],
  series: readonly string[],
  filters: Record<string, string>,
): Promise<Map<string, Record<string, unknown>>> {
  const present = new Set(rows.flatMap(seriesOf));
  const wanted = new Set(rows.map((r) => String(asNumber(r.usajobsControlNumber))));
  const texts = new Map<string, Record<string, unknown>>();
  for (const code of series) {
    if (!present.has(code)) continue;
    try {
      const { rows: records } = await readAll(ctx, TEXT_PATH, { ...filters, PositionSeries: code }, MAX_TEXT_PAGES_PER_SERIES, `series ${code} text`);
      for (const value of records) {
        const record = asRecord(value);
        const id = record ? String(asNumber(record.usajobsControlNumber)) : '';
        if (record && wanted.has(id)) texts.set(id, record);
      }
    } catch (err) {
      if (err instanceof SourceError && err.kind === 'aborted') throw err;
      ctx.log.warn(`usajobs: could not download the text of series ${code}; it is fetched when a job is opened`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return texts;
}

/** The configured series, or the default list. */
export function fullTextSeries(config: string | undefined): readonly string[] {
  const codes = compactStrings((config ?? '').split(/[\s,;]+/).map((c) => (/^\d{1,4}$/.test(c) ? c.padStart(4, '0') : undefined)));
  return codes.length > 0 ? codes : DEFAULT_FULL_TEXT_SERIES;
}

function seriesOf(row: Record<string, unknown>): string[] {
  return compactStrings(asArray(row.jobcategories).map((c) => asString(asRecord(c)?.series)));
}

function hiringPaths(row: Record<string, unknown>): string[] {
  return compactStrings(asArray(row.hiringpaths).map((h) => asString(asRecord(h)?.hiringPath)));
}

/** True when the announcement is a job a member of the public (or, with the setting, a federal employee) can apply for today. */
export function isListable(row: Record<string, unknown>, today: string, includeFederalOnly: boolean): boolean {
  const status = asString(row.positionOpeningStatus)?.toLowerCase();
  if (status && !OPEN_STATUSES.has(status)) return false;
  const closes = asString(row.positionCloseDate);
  if (closes && closes < today) return false;
  const opens = asString(row.positionOpenDate);
  if (opens && opens > today) return false;
  const title = asString(row.positionTitle) ?? '';
  // Sign-up registers and reemployment priority lists, not jobs.
  if (seriesOf(row).includes('9999') || /^(?:RPL|PRL)$/i.test(title) || /\bregister$/i.test(title)) return false;
  // OPM's own test announcements ("green test - don't let it expire", "PD Prod Deploy 0426").
  if (asString(row.hiringAgencyCode) === 'OM00' && /\b(?:test|deploy)\b/i.test(title)) return false;
  if (!includeFederalOnly) {
    const paths = hiringPaths(row).map((p) => p.toLowerCase());
    if (paths.length > 0 && paths.every((p) => FEDERAL_ONLY_PATHS.has(p))) return false;
  }
  return true;
}

function mapRow(row: Record<string, unknown>, text: Record<string, unknown> | undefined): RawPosting {
  const id = asNumber(row.usajobsControlNumber);
  if (id === undefined || !Number.isInteger(id) || id <= 0) throw new Error('no control number');
  const title = asString(row.positionTitle);
  if (!title) throw new Error('no title');
  const agency = asString(row.hiringAgencyName) ?? asString(row.hiringDepartmentName);
  if (!agency) throw new Error('no agency');
  const department = asString(row.hiringSubelementName) ?? asString(row.hiringDepartmentName);
  const closes = asString(row.positionCloseDate);
  const url = `https://www.usajobs.gov/job/${id}`;

  return {
    externalId: String(id),
    url,
    title,
    company: agency,
    locations: mapLocations(row),
    ...(text ? { descriptionHtml: factsHtml(row) + textHtml(text) } : {}),
    postedAt: asString(row.positionOpenDate),
    // The whole closing day, Eastern time.
    ...(closes && /^\d{4}-\d{2}-\d{2}$/.test(closes) ? { expiresAt: `${closes}T23:59:59-05:00` } : {}),
    salary: mapSalary(row),
    employmentType: employmentType(row),
    ...(department && department !== agency && department !== 'Other Agencies and Independent Organizations' ? { department } : {}),
    tags: tagsOf(row),
  };
}

function mapLocations(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const value of asArray(row.positionlocations)) {
    const loc = asRecord(value);
    if (!loc) continue;
    const city = asString(loc.positionLocationCity);
    const state = asString(loc.positionLocationState);
    const country = asString(loc.positionLocationCountry) ?? 'United States';
    const placeless = !city || /negotiable|anywhere|various|multiple|nationwide/i.test(city);
    const code = usStateCode(state);
    if (country !== 'United States') out.push(country);
    // A state on its own as "NY, US": "New York" alone is the city, "Georgia" the country.
    else if (placeless) out.push(code ? `${code}, US` : 'United States');
    else out.push(compactStrings([city, state, 'United States']).join(', '));
  }
  return compactStrings(out).slice(0, MAX_LOCATIONS);
}

function mapSalary(row: Record<string, unknown>): RawSalary | undefined {
  const type = asString(row.salaryType)?.toLowerCase();
  const period = type ? PERIODS[type] : undefined;
  // "Without Compensation", "Fee Basis", "Student Stipend Paid" and the like carry no comparable amount.
  if (!period) return undefined;
  const min = positive(row.minimumSalary);
  const max = positive(row.maximumSalary);
  if (min === undefined && max === undefined) return undefined;
  return { min, max: max !== undefined && min !== undefined && max < min ? undefined : max, currency: 'USD', period };
}

function positive(value: unknown): number | undefined {
  const n = asNumber(value);
  return n !== undefined && n > 0 ? n : undefined;
}

/** "Full-time, Permanent"; temporary appointments and internships first, so they win over the schedule. */
function employmentType(row: Record<string, unknown>): string | undefined {
  const schedule = asString(row.workSchedule);
  const appointment = asString(row.appointmentType);
  if (appointment && /^(?:temporary|term|seasonal|summer)$/i.test(appointment)) return compactStrings(['Temporary', schedule]).join(', ');
  if (appointment && /^internships?$/i.test(appointment)) return 'Internship';
  return compactStrings([schedule, appointment]).join(', ') || undefined;
}

/** "GS 9–13", series, clearance, supervisory and who may apply: searchable facts the list gives for every posting. */
function tagsOf(row: Record<string, unknown>): string[] {
  const tags: string[] = ['Federal government'];
  const scale = asString(row.payScale);
  const low = asString(row.minimumGrade);
  const high = asString(row.maximumGrade);
  if (scale && low) tags.push(`${scale} ${low}${high && high !== low ? `–${high}` : ''}`);
  for (const code of seriesOf(row)) tags.push(SERIES_NAMES[code] ? `${code} ${SERIES_NAMES[code]}` : `Series ${code}`);
  const clearance = asString(row.securityClearance);
  if (clearance && !/^(?:not required|other)$/i.test(clearance)) tags.push(`${clearance} clearance`);
  if (asString(row.supervisoryStatus) === 'Y') tags.push('Supervisory');
  const paths = hiringPaths(row);
  if (paths.some((p) => p.toLowerCase() === 'the public')) tags.push('Open to the public');
  else if (paths.length > 0 && paths.every((p) => FEDERAL_ONLY_PATHS.has(p.toLowerCase()))) tags.push('Federal employees only');
  for (const p of paths) if (/^(?:veterans|military spouses|individuals with disabilities|students|recent graduates|native americans)$/i.test(p)) tags.push(`Open to ${p.toLowerCase()}`);
  return compactStrings(tags);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** A short list of the announcement's key facts, shown above its text. */
function factsHtml(row: Record<string, unknown>): string {
  const facts: Array<[string, string | undefined]> = [];
  const scale = asString(row.payScale);
  const low = asString(row.minimumGrade);
  const high = asString(row.maximumGrade);
  const potential = asString(row.promotionPotential);
  if (scale && low) {
    const grades = `${scale}-${low}${high && high !== low ? ` to ${high}` : ''}`;
    facts.push(['Grade', potential && potential !== 'None' && potential !== high ? `${grades} (promotion potential ${potential})` : grades]);
  }
  const salary = mapSalary(row);
  if (salary) {
    const range = [salary.min, salary.max].filter((n): n is number => n !== undefined).map(money).join(' – ');
    facts.push(['Pay', `${range} ${asString(row.salaryType)?.toLowerCase() ?? ''}`.trim()]);
  }
  facts.push(['Appointment', compactStrings([asString(row.appointmentType), asString(row.workSchedule)]).join(' · ') || undefined]);
  facts.push(['Series', seriesOf(row).map((c) => (SERIES_NAMES[c] ? `${c} ${SERIES_NAMES[c]}` : c)).join(', ') || undefined]);
  const clearance = asString(row.securityClearance);
  facts.push(['Security clearance', clearance && clearance !== 'Other' ? clearance : undefined]);
  facts.push(['Open to', hiringPaths(row).join('; ') || undefined]);
  facts.push(['Travel', asString(row.travelRequirement)]);
  facts.push(['Closes', asString(row.positionCloseDate)]);
  const items = facts.filter((f): f is [string, string] => Boolean(f[1])).map(([k, v]) => `<li><strong>${k}:</strong> ${esc(v)}</li>`);
  return items.length > 0 ? `<ul>${items.join('')}</ul>\n` : '';
}

/** The announcement text as HTML, section by section. */
export function textHtml(record: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, heading] of TEXT_SECTIONS) {
    const raw = asString(record[key]);
    if (!raw) continue;
    let html: string;
    if (key === 'requirementsConditionsOfEmployment' && raw.includes(' | ') && !/<[a-z]/i.test(raw)) {
      html = `<ul>${raw.split(' | ').map((s) => `<li>${esc(s.trim())}</li>`).join('')}</ul>`;
    } else if (/<(?:p|br|ul|ol|li|div|strong|b|em|h\d)\b/i.test(raw)) html = raw;
    else html = raw.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    parts.push(`<h3>${heading}</h3>\n${html}`);
  }
  return parts.join('\n');
}
