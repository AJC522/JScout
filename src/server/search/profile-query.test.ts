import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../../shared/constants';
import { queryFromPreferences, upstreamQuery } from './profile-query';

describe('queryFromPreferences', () => {
  it('turns saved preferences into a ready-to-run query', () => {
    const profile = emptyProfile('2026-11-24T00:00:00.000Z');
    Object.assign(profile.preferences, {
      targetTitles: ['Data Engineer', 'Analytics Engineer, BI', 'ML Engineer', 'Statistician'],
      locations: ['', 'Denver, CO', 'Boulder'], radiusKm: 40, remote: ['remote', 'hybrid'], salaryMin: 120_000, salaryCurrency: 'USD',
      employmentTypes: ['full-time'], seniority: ['senior'], excludeCompanies: ['Initech'], excludeTerms: ['clearance'],
    });
    expect(queryFromPreferences(profile)).toEqual({
      q: 'Data Engineer, Analytics Engineer BI, ML Engineer',
      location: 'Denver, CO; Boulder', radiusKm: 40, remote: ['remote', 'hybrid'], salaryMin: 120_000, salaryCurrency: 'USD',
      employmentTypes: ['full-time'], seniority: ['senior'], excludeCompanies: ['Initech'], excludeTerms: ['clearance'],
    });
  });

  it('an empty profile gives an empty query', () => {
    expect(queryFromPreferences(emptyProfile('2026-11-24T00:00:00.000Z'))).toEqual({ q: '' });
  });
});

describe('upstreamQuery', () => {
  it('sends the parsed phrases plus a few synonyms and the resolved place', () => {
    const u = upstreamQuery({ q: 'software engineer -senior', location: 'Austin, TX', remote: ['remote'], postedWithinDays: 7, salaryMin: 100_000, salaryCurrency: 'USD' });
    expect(u.keywords[0]).toBe('software engineer');
    expect(u.keywords.length).toBe(3);
    expect(u.keywords).not.toContain('senior');
    expect(u).toMatchObject({ locationText: 'Austin, TX', city: 'Austin', admin1: 'TX', country: 'US', remoteOnly: true, postedWithinDays: 7, salaryMin: 100_000, salaryCurrency: 'USD', limit: 60 });
    // Upstream sources take one place: the first of several.
    expect(upstreamQuery({ q: 'nurse', location: 'Austin, TX; Denver, CO' })).toMatchObject({ locationText: 'Austin, TX', city: 'Austin' });
  });

  it('keeps keywords as typed for keyword searches and leaves regions as text', () => {
    const u = upstreamQuery({ q: 'kubernetes', location: 'EMEA', remote: ['remote', 'hybrid'], synonyms: true });
    expect(u).toEqual({ keywords: ['kubernetes'], locationText: 'EMEA', limit: 60 });
    expect(upstreamQuery({ q: 'software engineer', synonyms: false }).keywords).toEqual(['software engineer']);
  });
});
