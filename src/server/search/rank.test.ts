import { describe, expect, it } from 'vitest';
import type { Place } from '../../shared/types';
import { resolvePlace } from '../lib/location';
import { ageLabel, recency, type ScoreContext, type ScoreInput, scorePosting, textRelevance, titleTier } from './rank';
import { understandQuery } from './understand';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const input = (o: Partial<ScoreInput> = {}): ScoreInput => ({
  title: 'Software Engineer', titleCore: 'software engineer', roleId: 'software-engineer', tags: [], skills: [], snippet: '',
  location: { places: [], remote: 'onsite', remoteScope: [] }, seniority: 'mid', ts: '2026-11-22T12:00:00.000Z', closed: false, rank: -5, ...o,
});
const ctx = (q: string, o: Partial<ScoreContext> = {}): ScoreContext => ({
  understanding: understandQuery({ q, relatedRoles: ['backend-engineer'] }), bestRank: -5, preferredSeniority: [], now: NOW, ...o,
});

describe('titleTier', () => {
  const u = understandQuery({ q: 'software engineer', relatedRoles: ['backend-engineer'] });
  it.each([
    ['Software Engineer', 'software engineer', 'exact', 40],
    ['Senior Software Engineer, Payments', 'software engineer payments', 'exact', 36],
    ['Software Developer', 'software developer', 'synonym', 34],
    ['Lead SWE (Infra)', 'swe infra', 'synonym', 30],
    ['Backend Engineer', 'backend engineer', 'related', 22],
    ['Engineer, Data', 'engineer data', 'partial', 12],
    ['Nurse', 'nurse', 'none', 0],
  ] as const)('%s -> %s', (title, titleCore, kind, points) => {
    expect(titleTier({ title, titleCore }, u)).toMatchObject({ kind, points });
  });
});

describe('scorePosting', () => {
  it('scores a perfect match near 100 and explains it on the same scale', () => {
    const { score, match } = scorePosting(input({ ts: NOW.toISOString(), salary: { min: 90_000, max: 130_000, annualMin: 90_000, annualMax: 130_000, currency: 'USD', period: 'year' } }), ctx('software engineer'));
    expect(score).toBeGreaterThanOrEqual(98);
    expect(match.titleMatch).toBe('exact');
    expect(match.reasons.map((r) => r.label)).toEqual(['Title matches “Software Engineer”', 'Strong keyword match', 'Posted today', 'Salary listed: $90k–$130k/yr']);
    expect(match.reasons.reduce((n, r) => n + r.points, 0)).toBeCloseTo(score, -1);
  });

  it('explains skills, seniority and location against the profile', () => {
    const austin = resolvePlace('Austin, TX') as Place;
    const roundRock = resolvePlace('Round Rock, TX') as Place;
    const { match } = scorePosting(
      input({ skills: ['TypeScript', 'React', 'Go'], seniority: 'senior', location: { places: [roundRock], remote: 'onsite', remoteScope: [] } }),
      ctx('software engineer', {
        profileSkills: new Map([['typescript', 'TypeScript'], ['react', 'React']]),
        preferredSeniority: ['senior'],
        location: { place: austin, radiusKm: 50, includeRemote: true },
      }),
    );
    expect(match).toMatchObject({ skillsMatched: ['TypeScript', 'React'], skillsMissing: ['Go'] });
    const labels = match.reasons.map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(['You have 2 of 3 listed skills', 'Senior, as you prefer']));
    expect(labels.find((l) => l.startsWith('In Round Rock'))).toMatch(/^In Round Rock, TX \(\d+ km\)$/);
  });

  it('penalises closed and very old postings, and stays within 0–100', () => {
    const closed = scorePosting(input({ closed: true }), ctx('software engineer'));
    expect(closed.match.reasons.at(-1)).toEqual({ key: 'closed', label: 'This posting is closed', points: -20 });
    const old = scorePosting(input({ ts: '2026-08-01T00:00:00.000Z', title: 'Nurse', titleCore: 'nurse', roleId: undefined, rank: null }), ctx('software engineer'));
    expect(old.match.reasons.at(-1)).toMatchObject({ key: 'age', points: -5 });
    expect(old.score).toBe(0);
  });

  it('skips the costly explanation parts when not explaining, without changing the score', () => {
    const i = input({ snippet: 'We build software', salary: { annualMax: 100_000, currency: 'USD' } });
    const full = scorePosting(i, ctx('software engineer'));
    const fast = scorePosting(i, ctx('software engineer'), { explain: false });
    expect(fast.score).toBe(full.score);
    expect(fast.match.matchedTerms).toEqual([]);
    expect(full.match.matchedTerms).toEqual(['software engineer']);
  });
});

describe('helpers', () => {
  it('normalises bm25 and decays recency smoothly', () => {
    expect(textRelevance(-5, -10)).toBe(0.5);
    expect(textRelevance(null, -10)).toBe(0);
    expect(recency(NOW.toISOString(), NOW)).toBe(1);
    expect(recency('2026-10-25T12:00:00.000Z', NOW)).toBeCloseTo(Math.exp(-1), 5);
    expect([0, 1, 5, 20, 90].map(ageLabel)).toEqual(['Posted today', 'Posted yesterday', 'Posted 5 days ago', 'Posted 3 weeks ago', 'Posted 3 months ago']);
  });
});
