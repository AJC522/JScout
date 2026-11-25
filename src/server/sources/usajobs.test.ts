import { describe, expect, it } from 'vitest';
import { normalizePosting } from '../ingest/normalize';
import { fakeHttp, readFixture, testContext } from './testing';
import { type RawPosting, SourceError } from './types';
import { DEFAULT_FULL_TEXT_SERIES, fullTextSeries, isListable, textHtml, usajobsSource } from './usajobs';

const API = 'https://data.usajobs.gov';
/** The fixtures were captured on this day. */
const NOW = new Date('2026-11-25T15:00:00Z');

function routes() {
  return fakeHttp([
    { match: (u) => u.startsWith(`${API}/api/historicjoa?`) && u.includes('continuationtoken='), body: readFixture('usajobs', 'joa-page2.json') },
    { match: (u) => u.startsWith(`${API}/api/historicjoa?`), body: readFixture('usajobs', 'joa-page1.json') },
    { match: 'PositionSeries=2210', body: readFixture('usajobs', 'text-series-2210.json') },
    { match: 'PositionSeries=1811', body: readFixture('usajobs', 'text-series-1811.json') },
    { match: 'PositionSeries=0083', body: readFixture('usajobs', 'text-series-0083.json') },
  ]);
}

function byId(postings: RawPosting[], id: string): RawPosting {
  const p = postings.find((x) => x.externalId === id);
  if (!p) throw new Error(`posting ${id} not found`);
  return p;
}

describe('usajobsSource.def', () => {
  it('is a keyless, full-snapshot feed with optional settings', () => {
    expect(usajobsSource.def).toMatchObject({
      id: 'usajobs',
      kind: 'board',
      mode: 'feed',
      perCompany: false,
      fullSnapshot: true,
      defaultEnabled: true,
      minRequestIntervalMs: 1000,
    });
    expect(usajobsSource.def.configFields.every((f) => !f.required && !f.secret)).toBe(true);
    expect(usajobsSource.def.closeGraceMinutes).toBeGreaterThan(0);
  });
});

describe('usajobsSource.fetchFeed', () => {
  it('pages through every open announcement and fetches full text for the technology and law-enforcement series', async () => {
    const http = routes();
    const result = await usajobsSource.fetchFeed!(testContext(http, {}, NOW));

    const urls = http.requests.map((r) => r.url);
    expect(urls[0]).toBe(`${API}/api/historicjoa?StartPositionCloseDate=2026-11-25&EndPositionOpenDate=2026-11-25`);
    expect(urls[1]).toBe(`${API}/api/historicjoa?continuationtoken=Zm9yLXRlc3Rz&startpositionclosedate=2026-11-25&endpositionopendate=2026-11-25`);
    // Only series that are both present and on the full-text list, one request each.
    expect(urls.slice(2).sort()).toEqual(
      ['0083', '1811', '2210'].map((s) => `${API}/api/historicjoa/announcementtext?StartPositionCloseDate=2026-11-25&EndPositionOpenDate=2026-11-25&PositionSeries=${s}`),
    );
    expect(result.complete).toBe(true);

    // Canceled, register, OPM test and federal-employees-only announcements are left out.
    expect(result.postings.map((p) => p.externalId).sort()).toEqual(
      ['757411800', '759326100', '835811200', '851394000', '855084200', '859389800', '863124000', '881807100'].sort(),
    );
  });

  it('maps an announcement with its facts and text (CIA Data Engineer)', async () => {
    const result = await usajobsSource.fetchFeed!(testContext(routes(), {}, NOW));
    const p = byId(result.postings, '759326100');
    expect(p).toMatchObject({
      url: 'https://www.usajobs.gov/job/759326100',
      title: 'Data Engineer',
      company: 'Central Intelligence Agency',
      locations: ['Washington, District of Columbia, United States'],
      postedAt: '2026-09-01',
      expiresAt: '2027-01-31T23:59:59-05:00',
      salary: { min: 74584, max: 156755, currency: 'USD', period: 'year' },
      employmentType: 'Full-time, Permanent',
    });
    expect(p.department).toBeUndefined();
    expect(p.tags).toEqual(
      expect.arrayContaining(['Federal government', 'GS 9–13', '2210 Information Technology Management', 'Sensitive Compartmented Information clearance', 'Open to the public']),
    );
    expect(p.descriptionHtml).toContain('<li><strong>Grade:</strong> GS-9 to 13 (promotion potential 15)</li>');
    expect(p.descriptionHtml).toContain('<li><strong>Pay:</strong> $74,584 – $156,755 per year</li>');
    expect(p.descriptionHtml).toContain('<h3>Summary</h3>');
    expect(p.descriptionHtml).toContain('<h3>Conditions of employment</h3>');
  });

  it('lists every location of a multi-site job and fetches its text through its series (criminal investigator)', async () => {
    const result = await usajobsSource.fetchFeed!(testContext(routes(), {}, NOW));
    const p = byId(result.postings, '881807100');
    expect(p.locations.length).toBeGreaterThanOrEqual(3);
    expect(p.locations[0]).toMatch(/^Chicago, Illinois, United States$/);
    expect(p.descriptionHtml).toContain('<h3>Duties</h3>');
    expect(p.tags).toContain('1811 Criminal Investigation');
  });

  it('leaves jobs outside the full-text series without a description, to be fetched when opened', async () => {
    const result = await usajobsSource.fetchFeed!(testContext(routes(), {}, NOW));
    const nurse = byId(result.postings, '757411800');
    expect(nurse.descriptionHtml).toBeUndefined();
    expect(nurse.tags).toContain('0610 Nurse');
    const hourly = byId(result.postings, '835811200');
    expect(hourly.salary?.period).toBe('hour');
    // "Without Compensation" carries no salary; student volunteer is open to students.
    const volunteer = byId(result.postings, '855084200');
    expect(volunteer.salary).toBeUndefined();
    expect(volunteer.tags).toContain('Open to students');
  });

  it('gives only the country for overseas jobs and the country for negotiable locations', async () => {
    const result = await usajobsSource.fetchFeed!(testContext(routes(), {}, NOW));
    expect(byId(result.postings, '859389800').locations).toEqual(['South Korea']);
    expect(byId(result.postings, '863124000').locations).toEqual(['United States']);
  });

  it('includes federal-employees-only jobs when the setting asks for them', async () => {
    const result = await usajobsSource.fetchFeed!(testContext(routes(), { includeFederalOnly: 'yes' }, NOW));
    const internal = byId(result.postings, '874600500');
    expect(internal.tags).toContain('Federal employees only');
    expect(internal.descriptionHtml).toContain('<h3>Summary</h3>');
  });

  it('downloads text only for the configured series', async () => {
    const http = routes();
    const result = await usajobsSource.fetchFeed!(testContext(http, { fullTextSeries: '83' }, NOW));
    expect(http.requests.filter((r) => r.url.includes('announcementtext')).map((r) => r.url)).toEqual([
      `${API}/api/historicjoa/announcementtext?StartPositionCloseDate=2026-11-25&EndPositionOpenDate=2026-11-25&PositionSeries=0083`,
    ]);
    expect(byId(result.postings, '759326100').descriptionHtml).toBeUndefined();
    expect(byId(result.postings, '851394000').descriptionHtml).toContain('<h3>');
  });

  it('keeps the postings when a text download fails', async () => {
    const http = routes();
    http.on({ match: 'PositionSeries=2210', error: new SourceError('http', 'HTTP 503', { status: 503 }) });
    const result = await usajobsSource.fetchFeed!(testContext(http, {}, NOW));
    expect(result.complete).toBe(true);
    expect(byId(result.postings, '759326100').descriptionHtml).toBeUndefined();
  });

  it('returns what it read, as incomplete, when a later page fails; throws when the first does', async () => {
    const http = routes();
    http.on({ match: 'continuationtoken=', error: new SourceError('http', 'HTTP 503', { status: 503 }) });
    const partial = await usajobsSource.fetchFeed!(testContext(http, {}, NOW));
    expect(partial.complete).toBe(false);
    expect(partial.postings.length).toBe(6);

    const down = fakeHttp([{ match: API, error: new SourceError('http', 'HTTP 503', { status: 503 }) }]);
    await expect(usajobsSource.fetchFeed!(testContext(down, {}, NOW))).rejects.toMatchObject({ kind: 'http' });
  });

  it('normalises with a parsed place and annual salary', async () => {
    const result = await usajobsSource.fetchFeed!(testContext(routes(), {}, NOW));
    const n = normalizePosting(byId(result.postings, '759326100'), { source: usajobsSource.def, feedKey: 'usajobs', now: NOW });
    expect(n).not.toBeNull();
    expect(n!.company).toBe('Central Intelligence Agency');
    expect(n!.location.places[0]).toMatchObject({ city: 'Washington', admin1: 'DC', country: 'US' });
    expect(n!.employmentType).toBe('full-time');
    expect(n!.salary).toMatchObject({ currency: 'USD', period: 'year' });
  });
});

describe('usajobsSource.fetchDetail', () => {
  it('fetches the announcement text of one job', async () => {
    const http = fakeHttp([{ match: 'USAJOBSControlNumbers=757411800', body: readFixture('usajobs', 'text-single-757411800.json') }]);
    const detail = await usajobsSource.fetchDetail!(testContext(http, {}, NOW), { externalId: '757411800', url: 'https://www.usajobs.gov/job/757411800' });
    expect(detail?.descriptionHtml).toContain('<h3>Summary</h3>');
    expect(http.requests[0]!.url).toBe(`${API}/api/historicjoa/announcementtext?USAJOBSControlNumbers=757411800`);
  });

  it('reports a job as gone once it has closed or is unknown', async () => {
    const http = fakeHttp([
      { match: 'USAJOBSControlNumbers=757411800', body: readFixture('usajobs', 'text-single-757411800.json') },
      { match: 'USAJOBSControlNumbers=1', body: { data: [] } },
    ]);
    const later = new Date('2030-01-01T12:00:00Z');
    expect(await usajobsSource.fetchDetail!(testContext(http, {}, later), { externalId: '757411800', url: 'x' })).toBeNull();
    expect(await usajobsSource.fetchDetail!(testContext(http, {}, NOW), { externalId: '1', url: 'x' })).toBeNull();
    expect(await usajobsSource.fetchDetail!(testContext(http, {}, NOW), { externalId: 'abc', url: 'x' })).toBeNull();
  });
});

describe('usajobs helpers', () => {
  it('reads the series setting', () => {
    expect(fullTextSeries(undefined)).toBe(DEFAULT_FULL_TEXT_SERIES);
    expect(fullTextSeries('  ')).toBe(DEFAULT_FULL_TEXT_SERIES);
    expect(fullTextSeries('2210, 83; 1811 nonsense')).toEqual(['2210', '0083', '1811']);
  });

  it('decides which announcements are jobs the public can apply for today', () => {
    const base = {
      positionOpeningStatus: 'Accepting applications',
      positionOpenDate: '2026-11-01',
      positionCloseDate: '2026-12-01',
      positionTitle: 'IT Specialist (INFOSEC)',
      jobcategories: [{ series: '2210' }],
      hiringpaths: [{ hiringPath: 'The public' }],
    };
    expect(isListable(base, '2026-11-25', false)).toBe(true);
    expect(isListable({ ...base, positionOpeningStatus: null }, '2026-11-25', false)).toBe(true);
    expect(isListable({ ...base, positionOpeningStatus: 'Applications under review' }, '2026-11-25', false)).toBe(false);
    expect(isListable({ ...base, positionCloseDate: '2026-11-24' }, '2026-11-25', false)).toBe(false);
    expect(isListable({ ...base, positionOpenDate: '2026-11-26' }, '2026-11-25', false)).toBe(false);
    expect(isListable({ ...base, positionTitle: 'RPL' }, '2026-11-25', false)).toBe(false);
    expect(isListable({ ...base, positionTitle: 'Schedule A Register' }, '2026-11-25', false)).toBe(false);
    expect(isListable({ ...base, positionTitle: 'Registered Nurse' }, '2026-11-25', false)).toBe(true);
    const internal = { ...base, hiringpaths: [{ hiringPath: 'Internal to an agency' }] };
    expect(isListable(internal, '2026-11-25', false)).toBe(false);
    expect(isListable(internal, '2026-11-25', true)).toBe(true);
  });

  it('lists " | "-separated conditions of employment', () => {
    expect(textHtml({ requirementsConditionsOfEmployment: 'U.S. citizenship | Background check' })).toBe(
      '<h3>Conditions of employment</h3>\n<ul><li>U.S. citizenship</li><li>Background check</li></ul>',
    );
  });

  it('writes plain-text sections as paragraphs and keeps HTML ones', () => {
    expect(textHtml({ summary: 'One.\n\nTwo & three', duties: '<p>Do things</p>' })).toBe('<h3>Summary</h3>\n<p>One.</p><p>Two &amp; three</p>\n<h3>Duties</h3>\n<p>Do things</p>');
  });
});
