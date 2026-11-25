import { describe, expect, it } from 'vitest';
import type { SearchQuery } from '../../../shared/types';
import {
  applyPatch,
  clearFilters,
  countActiveFilters,
  isBlankQuery,
  normalizeQuery,
  paramsToQuery,
  queryToParams,
  querySignature,
} from './url-state';

const roundTrip = (query: Partial<SearchQuery>) => paramsToQuery(new URLSearchParams(queryToParams(query).toString()));

describe('URL <-> SearchQuery', () => {
  it('round-trips every field with non-default values', () => {
    const query: SearchQuery = {
      q: '"staff engineer" OR principal -manager, SRE',
      titleOnly: false,
      location: 'Austin, TX',
      radiusKm: 50,
      remote: ['remote', 'hybrid'],
      includeRemote: false,
      salaryMin: 140000,
      salaryCurrency: 'USD',
      includeNoSalary: false,
      employmentTypes: ['full-time', 'contract'],
      seniority: ['senior', 'lead'],
      postedWithinDays: 7,
      sources: ['greenhouse', 'remotive'],
      companies: ['Acme, Inc.', 'Globex & Sons'],
      excludeCompanies: ['Initech'],
      excludeTerms: ['clearance', 'on call'],
      synonyms: false,
      relatedRoles: ['site-reliability-engineer'],
      useProfile: false,
      includeHidden: true,
      includeApplied: false,
      includeClosed: true,
      sort: 'date',
    };
    expect(roundTrip(query)).toEqual(query);
  });

  it('omits defaults and empty values from the URL', () => {
    const params = queryToParams({
      q: 'designer',
      location: '',
      remote: [],
      synonyms: true,
      includeRemote: true,
      includeHidden: false,
      includeApplied: true,
      includeClosed: false,
      useProfile: true,
      sort: 'match',
      offset: 30,
      limit: 30,
    });
    expect(params.toString()).toBe('q=designer');
    expect(queryToParams({ q: 'designer', sort: 'relevance' }).toString()).toBe('q=designer&sort=relevance');
  });

  it('round-trips the clearance filter, and drops it when every requirement is ticked', () => {
    const query = paramsToQuery(queryToParams({ q: 'analyst', clearance: ['sponsored', 'none', 'bogus' as never] }));
    expect(query.clearance).toEqual(['none', 'sponsored']);
    expect(queryToParams({ q: 'analyst', clearance: ['none', 'sponsored'] }).get('clr')).toBe('none,sponsored');
    expect(queryToParams({ q: 'analyst', clearance: ['none', 'preferred', 'sponsored', 'required', 'active'] }).has('clr')).toBe(false);
    expect(countActiveFilters({ q: '', clearance: ['none'] })).toBe(1);
  });

  it('keeps commas inside free-text list values', () => {
    const params = queryToParams({ q: '', companies: ['Acme, Inc.'] });
    expect(params.getAll('co')).toEqual(['Acme, Inc.']);
    expect(roundTrip({ q: '', companies: ['Acme, Inc.'] }).companies).toEqual(['Acme, Inc.']);
  });

  it('drops malformed and unknown values from a hand-edited URL', () => {
    const query = paramsToQuery(
      new URLSearchParams('q=x&r=abc&wm=remote,moon&et=full-time,,nope&sen=senior&d=-3&smin=0&sort=random&hid=maybe&cur=dollars&other=1'),
    );
    expect(query).toEqual({ q: 'x', remote: ['remote'], employmentTypes: ['full-time'], seniority: ['senior'] });
  });

  it('drops a radius without a place and treats all arrangements as no restriction', () => {
    expect(normalizeQuery({ q: 'x', radiusKm: 25 })).toEqual({ q: 'x' });
    expect(normalizeQuery({ q: 'x', remote: ['remote', 'hybrid', 'onsite', 'unknown'] })).toEqual({ q: 'x' });
  });

  it('writes enum lists in a stable order and de-duplicates text lists', () => {
    const a = queryToParams({ q: '', remote: ['onsite', 'remote'], excludeTerms: ['Sales', 'sales ', 'ops'] });
    expect(a.get('wm')).toBe('remote,onsite');
    expect(a.getAll('x')).toEqual(['Sales', 'ops']);
  });

  it('ignores salary options without a minimum salary', () => {
    expect(normalizeQuery({ q: '', salaryCurrency: 'EUR', includeNoSalary: false })).toEqual({ q: '' });
    expect(normalizeQuery({ q: '', salaryMin: 50000.4, salaryCurrency: 'eur' })).toEqual({ q: '', salaryMin: 50000, salaryCurrency: 'EUR' });
  });
});

describe('query helpers', () => {
  it('recognises a blank query', () => {
    expect(isBlankQuery({ q: '  ' })).toBe(true);
    expect(isBlankQuery({ q: '', sort: 'date' })).toBe(false);
  });

  it('gives the same signature regardless of sort, order of fields and defaults', () => {
    expect(querySignature({ q: 'pm', location: 'Berlin', sort: 'date' })).toBe(querySignature({ location: 'Berlin', q: 'pm', synonyms: true }));
    expect(querySignature({ q: 'pm' })).not.toBe(querySignature({ q: 'pm', location: 'Berlin' }));
  });

  it('applies a broaden patch and drops paging', () => {
    const next = applyPatch({ q: 'pm', location: 'Berlin', radiusKm: 10 }, { radiusKm: 50, offset: 60 });
    expect(next).toEqual({ q: 'pm', location: 'Berlin', radiusKm: 50 });
    expect(applyPatch({ q: 'pm', location: 'Berlin' }, { location: undefined })).toEqual({ q: 'pm' });
  });

  it('counts and clears filters but keeps what and where', () => {
    const query: SearchQuery = { q: 'pm', location: 'Berlin', remote: ['remote'], salaryMin: 60000, includeApplied: false, sort: 'date' };
    expect(countActiveFilters(query)).toBe(3);
    expect(clearFilters(query)).toEqual({ q: 'pm', location: 'Berlin', sort: 'date' });
  });
});
