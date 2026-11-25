import { describe, expect, it } from 'vitest';
import { normalizePosting } from '../ingest/normalize';
import { smartrecruitersSource } from './smartrecruiters';
import { fakeHttp, readFixture, testContext } from './testing';
import { type BoardRef, SourceError } from './types';

const API = 'https://api.smartrecruiters.com/v1/companies';
const SF = 'CityAndCountyOfSanFrancisco1';

function board(token: string, name = `${token} (board name)`): BoardRef {
  return { ats: 'smartrecruiters', token, name };
}

describe('smartrecruitersSource.def', () => {
  it('describes a per-company, full-snapshot feed', () => {
    expect(smartrecruitersSource.def).toMatchObject({
      id: 'smartrecruiters',
      kind: 'ats',
      mode: 'feed',
      perCompany: true,
      ats: 'smartrecruiters',
      fullSnapshot: true,
      defaultEnabled: true,
      configFields: [],
    });
  });
});

describe('smartrecruitersSource.fetchFeed', () => {
  it('reads the postings list and maps every field (City and County of San Francisco)', async () => {
    const http = fakeHttp([{ match: `${API}/${SF}/postings`, body: readFixture('smartrecruiters', `list-${SF.toLowerCase()}.json`) }]);
    const result = await smartrecruitersSource.fetchFeed!(testContext(http), board(SF, 'City and County of San Francisco'));
    expect(http.requests.map((r) => r.url)).toEqual([`${API}/${SF}/postings?limit=100&offset=0`]);
    expect(result.complete).toBe(true);
    expect(result.postings).toHaveLength(4);
    expect(result.postings[1]).toMatchObject({
      externalId: '3743990017001756',
      url: `https://jobs.smartrecruiters.com/${SF}/3743990017001756`,
      title: 'IT Operations Support Administrator IV - Department of Emergency Management (1094)',
      company: 'City and County of San Francisco',
      locations: ['San Francisco, CA, United States'],
      postedAt: expect.stringMatching(/^2026-/),
      employmentType: 'Full-time',
    });
    expect(result.postings[1]!.descriptionHtml).toBeUndefined();
    // Structured hybrid flag.
    expect(result.postings[2]!.remote).toBe('hybrid');
    expect(result.postings[0]!.remote).toBeUndefined();
  });

  it('pages with offset until totalFound is reached', async () => {
    const item = (n: number) => ({ id: String(1000 + n), name: `Analyst ${n}`, company: { name: 'Acme' }, location: { fullLocation: 'Austin, TX, United States' } });
    const http = fakeHttp([
      { match: 'offset=0', body: { offset: 0, limit: 100, totalFound: 130, content: Array.from({ length: 100 }, (_, i) => item(i)) } },
      { match: 'offset=100', body: { offset: 100, limit: 100, totalFound: 130, content: Array.from({ length: 30 }, (_, i) => item(100 + i)) } },
    ]);
    const result = await smartrecruitersSource.fetchFeed!(testContext(http), board('Acme'));
    expect(http.requests).toHaveLength(2);
    expect(result.postings).toHaveLength(130);
    expect(result.complete).toBe(true);
  });

  it('never vouches for an empty board (an unknown identifier looks the same)', async () => {
    const http = fakeHttp([{ match: API, body: readFixture('smartrecruiters', 'list-unknown-company.json') }]);
    expect(await smartrecruitersSource.fetchFeed!(testContext(http), board('nosuchcompany'))).toEqual({ postings: [], complete: false });
  });

  it('normalises with the board name as company', async () => {
    const http = fakeHttp([{ match: API, body: readFixture('smartrecruiters', `list-${SF.toLowerCase()}.json`) }]);
    const result = await smartrecruitersSource.fetchFeed!(testContext(http), board(SF, 'City and County of San Francisco'));
    const n = normalizePosting(result.postings[0]!, { source: smartrecruitersSource.def, feedKey: `smartrecruiters:${SF}`, board: board(SF, 'City and County of San Francisco'), now: new Date('2026-11-25T12:00:00Z') });
    expect(n?.company).toBe('City and County of San Francisco');
    expect(n?.location.places[0]).toMatchObject({ city: 'San Francisco', admin1: 'CA', country: 'US' });
  });
});

describe('smartrecruitersSource.fetchDetail', () => {
  it('fetches the job ad sections and the apply link', async () => {
    const http = fakeHttp([{ match: `${API}/${SF}/postings/3743990017080516`, body: readFixture('smartrecruiters', 'detail-3743990017080516.json') }]);
    const detail = await smartrecruitersSource.fetchDetail!(testContext(http), { externalId: '3743990017080516', url: 'x' }, board(SF));
    expect(detail?.descriptionHtml).toMatch(/^<h3>Job Description<\/h3>/);
    expect(detail?.descriptionHtml).toContain('<h3>Qualifications</h3>');
    expect(detail?.applyUrl).toMatch(/^https:\/\/jobs\.smartrecruiters\.com\/CityAndCountyOfSanFrancisco1\/3743990017080516-/);
  });

  it('reports a posting that is gone', async () => {
    const http = fakeHttp([{ match: API, status: 404, body: readFixture('smartrecruiters', 'error-unknown-posting-404.json') }]);
    expect(await smartrecruitersSource.fetchDetail!(testContext(http), { externalId: '123', url: 'x' }, board(SF))).toBeNull();
  });
});

describe('smartrecruitersSource.probeBoard', () => {
  it('counts the postings and names the company, or answers null for an empty board', async () => {
    const http = fakeHttp([{ match: `${API}/${SF}/postings`, body: { offset: 0, limit: 1, totalFound: 213, content: [{ id: '1', name: 'x', company: { name: 'City and County of San Francisco' } }] } }]);
    expect(await smartrecruitersSource.probeBoard!(testContext(http), SF)).toEqual({ jobs: 213, name: 'City and County of San Francisco' });
    expect(http.requests[0]!.url).toBe(`${API}/${SF}/postings?limit=1&offset=0`);
    const none = fakeHttp([{ match: API, body: readFixture('smartrecruiters', 'list-unknown-company.json') }]);
    expect(await smartrecruitersSource.probeBoard!(testContext(none), 'nosuchcompany')).toBeNull();
  });

  it('passes errors on', async () => {
    const http = fakeHttp([{ match: API, error: new SourceError('rate-limited', 'HTTP 429', { status: 429 }) }]);
    await expect(smartrecruitersSource.probeBoard!(testContext(http), SF)).rejects.toMatchObject({ kind: 'rate-limited' });
  });
});
