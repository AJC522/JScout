import { describe, expect, it } from 'vitest';
import type { SearchQuery } from '../../shared/types';
import { broadenCandidates, rankSuggestions } from './broaden';
import { buildPlan } from './plan';

const env = { now: new Date('2026-11-24T12:00:00.000Z'), maxPostingAgeDays: 0, defaultCurrency: 'USD' };
const candidates = (q: SearchQuery, maxAge = 0) => broadenCandidates(q, buildPlan(q, env), maxAge);
const byId = (q: SearchQuery, maxAge = 0) => new Map(candidates(q, maxAge).map((c) => [c.id, c]));

describe('broadenCandidates', () => {
  it('offers synonyms, the top related roles and all of them for a recognised title', () => {
    const c = byId({ q: 'software engineer', synonyms: false });
    expect(c.get('synonyms')?.patch).toEqual({ synonyms: true });
    const related = [...c.values()].filter((x) => x.kind === 'related-role');
    expect(related).toHaveLength(3);
    expect(related[0]).toMatchObject({ label: 'Add “Backend Engineer”', patch: { relatedRoles: ['backend-engineer'] } });
    expect(c.get('all-related-roles')!.patch.relatedRoles!.length).toBeGreaterThan(3);
    expect(c.get('any-keyword-position')?.patch).toEqual({ titleOnly: false });
    // Roles already chosen are not offered again.
    expect(byId({ q: 'software engineer', relatedRoles: ['backend-engineer'] }).has('related-role:backend-engineer')).toBe(false);
  });

  it('widens a city step by step: remote, radius, state, country, anywhere', () => {
    const c = byId({ q: 'nurse', location: 'Austin, TX', radiusKm: 25, includeRemote: false });
    expect(c.get('include-remote')?.patch).toEqual({ includeRemote: true });
    expect(c.get('radius:50')?.patch).toEqual({ radiusKm: 50 });
    expect(c.get('wider-area')?.patch).toEqual({ location: 'Texas, United States' });
    expect(c.get('drop-location')?.patch).toEqual({ location: '' });
    expect(byId({ q: 'nurse', location: 'Texas' }).get('wider-area')?.patch).toEqual({ location: 'United States' });
    expect(byId({ q: 'nurse', location: 'Austin, TX', radiusKm: 200 }).has('radius:200')).toBe(false);
  });

  it('relaxes filters one at a time', () => {
    const q: SearchQuery = {
      q: 'nurse -travel', postedWithinDays: 7, salaryMin: 100_000, includeNoSalary: false, seniority: ['senior'],
      employmentTypes: ['full-time'], remote: ['onsite'], excludeCompanies: ['Acme'],
    };
    const c = byId(q);
    expect(c.get('date:14')?.patch).toEqual({ postedWithinDays: 14 });
    expect(c.get('salary:no-salary')?.patch).toEqual({ includeNoSalary: true });
    expect(c.get('salary:lower')?.patch).toEqual({ salaryMin: 80_000 });
    expect(c.get('seniority')).toMatchObject({ label: 'Include Mid level and Lead / Staff / Principal', patch: { seniority: ['senior', 'mid', 'lead'] } });
    expect(c.get('employment-type')?.patch).toEqual({ employmentTypes: [] });
    expect(c.get('work-mode')?.patch).toEqual({ remote: [] });
    expect(c.get('drop-exclusions')?.patch).toEqual({ excludeTerms: [], excludeCompanies: [], q: 'nurse' });
  });

  it('widens a clearance filter without adding jobs that need a clearance of your own', () => {
    expect(byId({ q: 'analyst', clearance: ['none'] }).get('clearance')).toMatchObject({
      label: 'Any job you can get without a clearance of your own',
      patch: { clearance: ['none', 'preferred', 'sponsored', 'required'] },
    });
    expect(byId({ q: 'analyst', clearance: ['none', 'preferred', 'sponsored'] }).get('clearance')).toMatchObject({
      label: 'Include “clearance required” jobs',
      patch: { clearance: ['none', 'preferred', 'sponsored', 'required'] },
    });
    expect(byId({ q: 'analyst', clearance: ['none', 'preferred', 'sponsored', 'required'] }).has('clearance')).toBe(false);
    expect(byId({ q: 'analyst', clearance: ['active'] }).get('clearance')?.patch).toEqual({ clearance: [] });
  });

  it('offers older postings when the max-age setting is what limits the search', () => {
    expect(byId({ q: 'nurse' }, 30).get('date:90')?.patch).toEqual({ postedWithinDays: 90 });
    expect(byId({ q: 'nurse' }).has('date:90')).toBe(false);
  });
});

describe('rankSuggestions', () => {
  const all = candidates({ q: 'software engineer', location: 'Austin, TX', remote: ['onsite'] });
  const gains: Record<string, number> = { 'related-role:backend-engineer': 4, 'drop-location': 9, 'work-mode': 4, 'radius:10': 0 };
  const counter = (base: number) => (patch: Partial<SearchQuery>) => {
    const c = all.find((x) => x.patch === patch)!;
    return base + (gains[c.id] ?? 1);
  };

  it('keeps changes that add results, best gain first, smaller change first on ties, at most six', () => {
    const s = rankSuggestions(all, 3, counter(3));
    expect(s.length).toBeLessThanOrEqual(6);
    expect(s[0]).toMatchObject({ id: 'drop-location', extraResults: 9 });
    expect(s.slice(1, 3).map((x) => x.id)).toEqual(['related-role:backend-engineer', 'work-mode']);
    expect(s.some((x) => x.id === 'radius:10')).toBe(false);
  });

  it('only counts the cheap role suggestions when there are already plenty of results', () => {
    const counted: string[] = [];
    const s = rankSuggestions(all, 40, (patch) => {
      counted.push(all.find((x) => x.patch === patch)!.kind);
      return 41;
    });
    expect(new Set(counted)).toEqual(new Set(['related-role']));
    expect(s.every((x) => x.kind === 'related-role' && x.extraResults === 1)).toBe(true);
  });
});
