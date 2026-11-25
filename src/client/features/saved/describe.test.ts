import { describe, expect, it } from 'vitest';
import { describeQuery } from './describe';

describe('describeQuery', () => {
  it('describes an empty query', () => {
    expect(describeQuery({ q: '' })).toBe('Any job · Anywhere');
  });

  it('describes a clearance filter', () => {
    expect(describeQuery({ q: 'analyst', clearance: ['none', 'preferred', 'sponsored'] })).toContain('No clearance of your own needed');
    expect(describeQuery({ q: 'analyst', clearance: ['active'] })).toContain('Must already hold a clearance');
    expect(describeQuery({ q: 'analyst', clearance: ['sponsored', 'none'] })).toContain('Clearance: not needed or sponsored');
  });

  it('reads comma-separated titles as alternatives', () => {
    expect(describeQuery({ q: 'Product designer, UX designer' })).toBe('Product designer or UX designer · Anywhere');
    expect(describeQuery({ q: 'a, b, c, d, e' })).toBe('a, b, c +2 more · Anywhere');
  });

  it('describes location, radius and remote', () => {
    expect(describeQuery({ q: 'Nurse', location: 'Austin, TX', radiusKm: 25 })).toBe('Nurse · Austin, TX within 25 km or remote');
    expect(describeQuery({ q: 'Nurse', location: 'Austin, TX', includeRemote: false })).toBe('Nurse · Austin, TX');
    expect(describeQuery({ q: 'Nurse', location: 'Austin, TX', remote: ['onsite'] })).toBe('Nurse · Austin, TX · On-site');
    expect(describeQuery({ q: 'Dev', remote: ['remote', 'hybrid'] })).toBe('Dev · Anywhere · Remote or hybrid');
    expect(describeQuery({ q: 'Dev', remote: ['remote', 'hybrid', 'onsite', 'unknown'] })).toBe('Dev · Anywhere');
  });

  it('describes a location with only remote jobs as remote jobs open to it, without the radius', () => {
    expect(describeQuery({ q: 'Dev', location: 'Berlin, Germany', radiusKm: 50, remote: ['remote'] })).toBe('Dev · Remote jobs open to Berlin, Germany');
    expect(describeQuery({ q: 'Dev', location: 'Berlin', radiusKm: 50, remote: ['remote'], includeRemote: false })).toBe('Dev · Remote jobs in Berlin within 50 km');
    expect(describeQuery({ q: 'Dev', location: 'Berlin', radiusKm: 50, remote: ['remote', 'hybrid'] })).toBe('Dev · Berlin within 50 km or remote · Remote or hybrid');
    expect(describeQuery({ q: 'Dev', remote: ['remote'] })).toBe('Dev · Anywhere · Remote');
  });

  it('describes salary and filters', () => {
    const text = describeQuery({
      q: 'Engineer',
      salaryMin: 120000,
      salaryCurrency: 'USD',
      includeNoSalary: false,
      seniority: ['senior', 'lead'],
      employmentTypes: ['full-time'],
      postedWithinDays: 7,
      companies: ['Acme', 'Globex', 'Initech'],
      excludeCompanies: ['Umbrella'],
      excludeTerms: ['clearance'],
      relatedRoles: ['frontend'],
      sources: ['remotive', 'arbeitnow'],
      includeApplied: false,
      includeClosed: true,
    });
    expect(text).toBe(
      [
        'Engineer',
        'Anywhere',
        'From $120k/yr, salary listed',
        'Senior or Lead / Staff / Principal',
        'Full-time',
        'Past week',
        'At Acme, Globex +1 more',
        'Not at Umbrella',
        'Without “clearance”',
        '+1 related role',
        '2 sources only',
        'Hiding jobs you applied to',
        'Including closed postings',
      ].join(' · '),
    );
  });

  it('labels unusual posted-within values', () => {
    expect(describeQuery({ q: 'x', postedWithinDays: 10 })).toBe('x · Anywhere · Past 10 days');
  });
});
