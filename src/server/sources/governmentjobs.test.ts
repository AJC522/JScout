import { describe, expect, it } from 'vitest';
import { normalizePosting } from '../ingest/normalize';
import { governmentjobsSource, mapLocations, recaseTitle, utcDate } from './governmentjobs';
import { fakeHttp, readFixture, testContext } from './testing';
import { type BoardRef, type RawPosting, SourceError } from './types';

const FEED = 'https://www.governmentjobs.com/SearchEngine/JobsFeed';

function board(token: string, name = `${token} (board name)`): BoardRef {
  return { ats: 'governmentjobs', token, name };
}

function serve(file: string) {
  return fakeHttp([{ match: FEED, body: readFixture('governmentjobs', file) }]);
}

function byId(postings: RawPosting[], id: string): RawPosting {
  const p = postings.find((x) => x.externalId === id);
  if (!p) throw new Error(`posting ${id} not found`);
  return p;
}

describe('governmentjobsSource.def', () => {
  it('describes a per-agency, full-snapshot feed', () => {
    expect(governmentjobsSource.def).toMatchObject({
      id: 'governmentjobs',
      kind: 'ats',
      mode: 'feed',
      perCompany: true,
      ats: 'governmentjobs',
      fullSnapshot: true,
      defaultEnabled: true,
      configFields: [],
      minRequestIntervalMs: 1000,
    });
  });
});

describe('governmentjobsSource.fetchFeed', () => {
  it("reads one agency's RSS feed and maps every field (State of Washington)", async () => {
    const http = serve('feed-washington.xml');
    const result = await governmentjobsSource.fetchFeed!(testContext(http), board('washington', 'State of Washington'));

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]!.url).toBe(`${FEED}?agency=washington`);
    expect(http.requests[0]!.options).toMatchObject({ minIntervalMs: 1000 });
    expect(result.complete).toBe(true);
    expect(result.postings).toHaveLength(5);

    const it = byId(result.postings, '5557612-0');
    expect(it).toMatchObject({
      url: 'https://www.governmentjobs.com/careers/washington/jobs/5557612-0',
      title: 'IT System Administration – Specialist (Ref# OFM26937)',
      locations: ['Thurston County – Olympia, WA'],
      postedAt: 'Sun, 22 Nov 2026 08:00:00 GMT',
      updatedAt: 'Tue, 24 Nov 2026 21:30:35 GMT',
      expiresAt: 'Sun, 29 Nov 2026 08:00:00 GMT',
      salary: { min: 124128, max: 127248, currency: 'USD', period: 'year' },
      employmentType: 'Full Time - Permanent',
      department: 'Office of Financial Management – Information Technology Services',
      tags: ['IT and Computers'],
    });
    // The bulletin: description, then duties, qualifications and supplemental information under headings
    // (empty sections are left out: this posting puts everything in its description).
    expect(it.descriptionHtml).not.toContain('<h3>Duties</h3>');
    expect(it.descriptionHtml).toContain('<h3>Supplemental information</h3>');
    expect(it.descriptionHtml).not.toMatch(/&amp;nbsp;/);
    const nurse = byId(result.postings, '5398503-0').descriptionHtml!;
    expect(nurse.indexOf('<h3>Duties</h3>')).toBeGreaterThan(0);
    expect(nurse.indexOf('<h3>Qualifications</h3>')).toBeGreaterThan(nurse.indexOf('<h3>Duties</h3>'));
    expect(nurse.indexOf('<h3>Supplemental information</h3>')).toBeGreaterThan(nurse.indexOf('<h3>Qualifications</h3>'));
  });

  it('puts "Multiple Locations Statewide" and blank locations in the agency state, and keeps open-until-filled postings', async () => {
    // (written as a state code: "Washington" alone would read as the city of Washington, D.C.)
    const result = await governmentjobsSource.fetchFeed!(testContext(serve('feed-washington.xml')), board('washington'));
    expect(byId(result.postings, '5559705-0').locations).toEqual(['WA, US']);
    const continuous = byId(result.postings, '5499426-0');
    expect(continuous.expiresAt).toBeUndefined();
    expect(byId(result.postings, '5398503-0').salary).toEqual({ min: 42.82, max: 69.35, currency: 'USD', period: 'hour' });
  });

  it('re-cases titles and departments written in capitals (Los Angeles County)', async () => {
    const result = await governmentjobsSource.fetchFeed!(testContext(serve('feed-lacounty.xml')), board('lacounty'));
    expect(result.postings.map((p) => p.title)).toEqual([
      'Student Professional Worker, Information Technology',
      'Student Worker, Information Technology',
      'Information Technology Supervisor / Emergency Appointment Homelessness',
    ]);
    expect(result.postings[0]!.department).toBe('Human Resources Countywide Exams');
    expect(result.postings[0]!.locations).toEqual(['Los Angeles County, CA']);
    expect(result.postings[2]!.salary).toMatchObject({ period: 'month', min: 10402.64, max: 14019.18 });
  });

  it("reads a police department's feed, with categories as tags and minimum-only pay (Honolulu PD)", async () => {
    const result = await governmentjobsSource.fetchFeed!(testContext(serve('feed-honolulupd.xml')), board('honolulupd'));
    expect(result.postings).toHaveLength(10);
    const dispatcher = byId(result.postings, '4550695-0');
    expect(dispatcher).toMatchObject({
      title: 'Police Communications Officer I (SR-17)',
      locations: ['Honolulu, HI'],
      salary: { min: 54756, currency: 'USD', period: 'year' },
      department: 'Support Services Bureau – Police Radio Dispatch',
    });
    expect(dispatcher.tags).toEqual(expect.arrayContaining(['Law Enforcement', 'Dispatch', '911 Telecommunications']));
    // "Not Displayed" is not a number.
    expect(byId(result.postings, '4462181-0').salary).toBeUndefined();
  });

  it('normalises into postings with the board name as company and a parsed place', async () => {
    const result = await governmentjobsSource.fetchFeed!(testContext(serve('feed-washington.xml')), board('washington', 'State of Washington'));
    const raw = byId(result.postings, '5557612-0');
    const now = new Date('2026-11-25T12:00:00Z');
    const normalized = normalizePosting(raw, { source: governmentjobsSource.def, feedKey: 'governmentjobs:washington', board: board('washington', 'State of Washington'), now });
    expect(normalized).not.toBeNull();
    expect(normalized!.company).toBe('State of Washington');
    expect(normalized!.location.places[0]).toMatchObject({ city: 'Olympia', admin1: 'WA', country: 'US' });
    expect(normalized!.postedAt).toBe('2026-11-22T08:00:00.000Z');
    expect(normalized!.salary).toMatchObject({ currency: 'USD', period: 'year' });
  });

  it('returns an empty complete snapshot for an agency with no open postings', async () => {
    const result = await governmentjobsSource.fetchFeed!(testContext(serve('feed-empty-arlingtontx.xml')), board('arlingtontx'));
    expect(result).toEqual({ postings: [], complete: true });
  });

  it('reports an unknown agency as not-found', async () => {
    const http = serve('error-invalid-agency.xml');
    await expect(governmentjobsSource.fetchFeed!(testContext(http), board('nosuchagency'))).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('skips postings open only to current employees ("Promotional" exams)', async () => {
    const xml = readFixture('governmentjobs', 'feed-honolulupd.xml').replace(
      /(<joblisting:jobId>5540922<\/joblisting:jobId>[\s\S]*?<joblisting:examtype>)Open(<\/joblisting:examtype>)/,
      '$1Promotional$2',
    );
    const http = fakeHttp([{ match: FEED, body: xml }]);
    const result = await governmentjobsSource.fetchFeed!(testContext(http), board('honolulupd'));
    expect(result.postings.map((p) => p.externalId)).not.toContain('5540922-0');
    expect(result.postings).toHaveLength(9);
  });

  it('treats an HTML page as blocked and other non-feeds as parse errors', async () => {
    const html = fakeHttp([{ match: FEED, body: '<!DOCTYPE html><html><body>Object moved</body></html>' }]);
    await expect(governmentjobsSource.fetchFeed!(testContext(html), board('x'))).rejects.toMatchObject({ kind: 'blocked' });
    const junk = fakeHttp([{ match: FEED, body: '<?xml version="1.0"?><feed></feed>' }]);
    await expect(governmentjobsSource.fetchFeed!(testContext(junk), board('x'))).rejects.toBeInstanceOf(SourceError);
  });
});

describe('governmentjobsSource.probeBoard', () => {
  it('counts the open postings and names the agency from the channel title', async () => {
    expect(await governmentjobsSource.probeBoard!(testContext(serve('feed-honolulupd.xml')), 'honolulupd')).toEqual({
      jobs: 10,
      name: 'Honolulu Police Department, HI',
    });
  });

  it('answers null for an unknown agency', async () => {
    expect(await governmentjobsSource.probeBoard!(testContext(serve('error-invalid-agency.xml')), 'nosuchagency')).toBeNull();
  });
});

describe('governmentjobsSource.fetchDetail', () => {
  it('finds the posting in the feed again, or reports it gone', async () => {
    const http = serve('feed-honolulupd.xml');
    const detail = await governmentjobsSource.fetchDetail!(testContext(http), { externalId: '3499599-0', url: 'https://example.com' }, board('honolulupd'));
    expect(detail?.descriptionHtml).toBeTruthy();
    expect(await governmentjobsSource.fetchDetail!(testContext(http), { externalId: '1-0', url: 'https://example.com' }, board('honolulupd'))).toBeNull();
  });
});

describe('governmentjobs helpers', () => {
  it('adds the agency state to locations that lack it', () => {
    expect(mapLocations('Lansing', 'MI')).toEqual(['Lansing, MI']);
    expect(mapLocations('Winston-Salem, NC', 'NC')).toEqual(['Winston-Salem, NC']);
    expect(mapLocations('Various', 'CA')).toEqual(['CA, US']);
    expect(mapLocations('Multiple Locations - Western Washington', 'WA')).toEqual(['WA, US']);
    expect(mapLocations(undefined, 'GA')).toEqual(['GA, US']);
    expect(mapLocations('Downtown', undefined)).toEqual(['Downtown']);
    expect(mapLocations(undefined, undefined)).toEqual([]);
  });

  it('reads NEOGOV dates', () => {
    expect(utcDate('Wed, 25 Nov 2026 08:00:00:0')).toBe('Wed, 25 Nov 2026 08:00:00 GMT');
    expect(utcDate('Continuous')).toBeUndefined();
    expect(utcDate(undefined)).toBeUndefined();
  });

  it('re-cases only titles written entirely in capitals', () => {
    expect(recaseTitle('POLICE OFFICER II - K9 UNIT')).toBe('Police Officer II - K9 Unit');
    expect(recaseTitle("SHERIFF'S TECHNOLOGY SPECIALIST")).toBe("Sheriff's Technology Specialist");
    expect(recaseTitle('GIS ANALYST FOR THE DEPARTMENT OF PUBLIC WORKS')).toBe('GIS Analyst for the Department of Public Works');
    expect(recaseTitle('IT Specialist (INFOSEC)')).toBe('IT Specialist (INFOSEC)');
    expect(recaseTitle('911')).toBe('911');
  });
});
