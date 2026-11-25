import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../../../shared/constants';
import type { GapRecommendation, LevelFit } from '../../../shared/types';
import {
  addToProfilePatch,
  categoryLabel,
  formatGain,
  gapsUrl,
  levelRows,
  profileHas,
  recommendationLink,
  requestFromParams,
  skillSearchUrl,
} from './model';

const profile = (() => {
  const p = emptyProfile('2026-11-25T00:00:00.000Z');
  p.preferences.skills = ['Python', 'Café Ops'];
  p.preferences.certifications = ['CompTIA Security+'];
  return p;
})();

describe('gaps URL', () => {
  it('round-trips each scope, the search in the Search page’s own parameters', () => {
    expect(gapsUrl('profile')).toBe('/gaps');
    expect(gapsUrl('applications')).toBe('/gaps?scope=applications');
    const url = gapsUrl('search', { q: 'Security Analyst', location: 'Austin, TX' });
    const params = new URL(url, 'http://x').searchParams;
    expect(params.get('scope')).toBe('search');
    const { request, search } = requestFromParams(params);
    expect(request.scope).toBe('search');
    expect(search).toMatchObject({ q: 'Security Analyst', location: 'Austin, TX' });
    expect(request.query).toEqual(search);
  });

  it('falls back to the profile for an unknown scope or an empty search', () => {
    expect(requestFromParams(new URLSearchParams('scope=nonsense')).request).toEqual({ scope: 'profile' });
    expect(requestFromParams(new URLSearchParams('scope=search')).request).toEqual({ scope: 'profile' });
    expect(requestFromParams(new URLSearchParams()).request).toEqual({ scope: 'profile' });
  });

  it('links a skill to a search for it', () => {
    expect(skillSearchUrl('C++')).toBe('/search?q=C%2B%2B');
  });
});

describe('levelRows', () => {
  const level: LevelFit = { below: 1, at: 3, above: 6, wellAbove: 2, unknown: 5, yours: ['mid'], years: 4 };

  it('gives shares of the jobs that state a level', () => {
    expect(levelRows(level).map((r) => [r.key, r.count, r.share])).toEqual([
      ['above', 6, 60],
      ['at', 3, 30],
      ['below', 1, 10],
    ]);
  });

  it('is empty when no job states a level', () => {
    expect(levelRows({ ...level, below: 0, at: 0, above: 0 })).toEqual([]);
  });
});

describe('adding a gap to the profile', () => {
  it('knows what the profile already lists, ignoring case and accents', () => {
    expect(profileHas(profile, { name: 'python', kind: 'skill' })).toBe(true);
    expect(profileHas(profile, { name: 'Cafe Ops', kind: 'skill' })).toBe(true);
    expect(profileHas(profile, { name: 'CompTIA Security+', kind: 'certification' })).toBe(true);
    expect(profileHas(profile, { name: 'CompTIA Security+', kind: 'skill' })).toBe(false);
    expect(profileHas(undefined, { name: 'Python', kind: 'skill' })).toBe(false);
  });

  it('adds a skill to the skills and a certification to the certifications', () => {
    expect(addToProfilePatch(profile, { name: 'Kubernetes', kind: 'skill' })).toEqual({ preferences: { skills: ['Python', 'Café Ops', 'Kubernetes'] } });
    expect(addToProfilePatch(profile, { name: 'CISSP', kind: 'certification' })).toEqual({
      preferences: { certifications: ['CompTIA Security+', 'CISSP'] },
    });
    expect(addToProfilePatch(profile, { name: 'Python', kind: 'skill' })).toEqual({});
  });
});

describe('labels', () => {
  it('names categories, and leaves unknown ones out', () => {
    expect(categoryLabel('cloud-devops')).toBe('Cloud and DevOps');
    expect(categoryLabel('made-up')).toBeUndefined();
    expect(categoryLabel(undefined)).toBeUndefined();
  });

  it('formats a match rise in whole points', () => {
    expect(formatGain(5.6)).toBe('+6');
    expect(formatGain(0.3)).toBe('+1');
    expect(formatGain(0)).toBe('±0');
  });

  it('sends each recommendation to where it is acted on', () => {
    const rec = (kind: GapRecommendation['kind']): GapRecommendation => ({ id: kind, kind, priority: 'high', title: '', detail: '' });
    expect(recommendationLink(rec('add-resume'))?.to).toBe('/profile#resume');
    expect(recommendationLink(rec('resume-skills'))?.to).toBe('/resume');
    expect(recommendationLink(rec('add-experience'))?.to).toBe('/profile#work');
    expect(recommendationLink(rec('learn-skill'))).toBeUndefined();
  });
});
