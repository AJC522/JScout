import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyProfile } from '../../shared/constants';
import type { SearchResponse, SearchResultItem } from '../../shared/types';
import { compareFit } from './profile-match';
import { createSearchTestEnv, FIXTURE_NOW, type SearchTestEnv } from './testing';

let env: SearchTestEnv;
let version = 0;

beforeAll(async () => {
  env = await createSearchTestEnv();
}, 60_000);

afterAll(() => env.close());

/** A software engineer in Austin with four skills and four years of experience. */
function useEngineerProfile(): void {
  Object.assign(env.profile, emptyProfile(FIXTURE_NOW.toISOString()));
  const p = env.profile.preferences;
  p.targetTitles = ['Software Engineer'];
  p.skills = ['TypeScript', 'React', 'PostgreSQL', 'Amazon Web Services'];
  p.locations = ['Austin, TX'];
  p.radiusKm = 50;
  env.profile.work.yearsExperience = 4;
  // The search service rebuilds its view of the profile when updatedAt changes.
  env.profile.updatedAt = `v${++version}`;
}

beforeEach(useEngineerProfile);

const ids = (r: SearchResponse): string[] => r.items.map((i) => i.job.externalId);
const key = (i: SearchResultItem) => ({ percent: i.fit!.percent, locationRank: i.fit!.location.rank, pay: i.fit!.pay?.annual });

describe('"Best match" ordering', () => {
  it('is the default and orders by match tier, then location, then pay', () => {
    const r = env.search.search({ q: 'software engineer', limit: 100 });
    expect(r.items.length).toBeGreaterThan(5);
    for (const i of r.items) expect(i.fit).toBeDefined();
    for (let n = 1; n < r.items.length; n++) {
      const [a, b] = [r.items[n - 1]!, r.items[n]!];
      expect(compareFit(key(a), key(b)), `${a.job.externalId} before ${b.job.externalId}`).toBeLessThanOrEqual(0);
    }
    // All four skills, the target role, in Austin.
    expect(r.items[0]!.job.externalId).toBe('acme-swe-austin');
    expect(r.items[0]!.fit).toMatchObject({ percent: 100, band: '90–100% tier', location: { kind: 'local', rank: 1 }, pay: { annual: 110_000, currency: 'USD' } });
  });

  it('explains each match', () => {
    const top = env.search.search({ q: 'software engineer', limit: 1 }).items[0]!;
    expect(top.fit!.parts.map((p) => p.label)).toEqual(['You have 4 of 4 listed skills', 'Your target role: Software Engineer']);
    expect(top.fit!.skillsMatched).toEqual(['TypeScript', 'React', 'PostgreSQL', 'Amazon Web Services']);
  });

  it('within a tier, puts remote jobs open to you before local ones, and local before elsewhere', () => {
    const r = env.search.search({ q: 'software engineer', limit: 100 });
    const remoteUs = r.items.find((i) => i.job.externalId === 'acme-swe-remote-us')!;
    const roundRock = r.items.find((i) => i.job.externalId === 'acme-dev-roundrock')!;
    const berlin = r.items.find((i) => i.job.externalId === 'acme-swe-berlin')!;
    const germanyOnly = r.items.find((i) => i.job.externalId === 'remotive-swe-de-only')!;
    // Same role, no listed skill in common: the same tier, told apart by location.
    expect(new Set([remoteUs, roundRock, berlin, germanyOnly].map((i) => i.fit!.band)).size).toBe(1);
    expect(remoteUs.fit!.location.kind).toBe('remote');
    expect(roundRock.fit!.location).toMatchObject({ kind: 'local', label: expect.stringMatching(/km from Austin/) });
    expect(berlin.fit!.location.kind).toBe('abroad');
    expect(germanyOnly.fit!.location.kind).toBe('remote-elsewhere');
    const order = ids(r);
    expect(order.indexOf('acme-swe-remote-us')).toBeLessThan(order.indexOf('acme-dev-roundrock'));
    expect(order.indexOf('acme-dev-roundrock')).toBeLessThan(order.indexOf('acme-swe-berlin'));
    expect(order.indexOf('acme-swe-berlin')).toBeLessThan(order.indexOf('remotive-swe-de-only'));
  });

  it('puts local jobs first when the profile does not want remote work', () => {
    env.profile.preferences.remote = ['onsite', 'hybrid'];
    env.profile.updatedAt = `v${++version}`;
    const order = ids(env.search.search({ q: 'software engineer', limit: 100 }));
    expect(order.indexOf('acme-dev-roundrock')).toBeLessThan(order.indexOf('acme-swe-remote-us'));
  });

  it('orders a tier by pay, highest first, converting currencies', () => {
    env.profile.preferences.targetTitles = ['Data Engineer'];
    env.profile.preferences.skills = ['Apache Airflow', 'Apache Spark'];
    env.profile.preferences.locations = ['Berlin, Germany'];
    env.profile.preferences.radiusKm = 600;
    env.profile.preferences.salaryCurrency = 'USD';
    env.profile.work.yearsExperience = null;
    env.profile.updatedAt = `v${++version}`;
    const r = env.search.search({ q: 'data engineer', limit: 100 });
    const low = r.items.find((i) => i.job.externalId === 'remotive-eur-low')!;
    const high = r.items.find((i) => i.job.externalId === 'remotive-eur-high')!;
    expect(low.fit!.band).toBe(high.fit!.band);
    expect(low.fit!.location.kind).toBe(high.fit!.location.kind);
    expect(high.fit!.pay!.annual).toBeGreaterThan(low.fit!.pay!.annual);
    expect(high.fit!.pay!.currency).toBe('USD');
    expect(ids(r).indexOf('remotive-eur-high')).toBeLessThan(ids(r).indexOf('remotive-eur-low'));
  });

  it('counts certifications held', () => {
    env.profile.preferences.certifications = ['AWS Certified Solutions Architect'];
    env.profile.updatedAt = `v${++version}`;
    const detail = env.search.jobDetail(env.id('acme-swe-austin'));
    expect(detail!.fit).toBeDefined();
    expect(detail!.fit!.percent).toBe(100);
  });

  it('falls back to relevance, without match details, when the profile is empty or not used', () => {
    const relevance = ids(env.search.search({ q: 'software engineer', sort: 'relevance', limit: 100 }));
    const off = env.search.search({ q: 'software engineer', useProfile: false, limit: 100 });
    expect(off.items.every((i) => i.fit === undefined)).toBe(true);
    Object.assign(env.profile, emptyProfile(FIXTURE_NOW.toISOString()));
    env.profile.updatedAt = `v${++version}`;
    const empty = env.search.search({ q: 'software engineer', limit: 100 });
    expect(empty.items.every((i) => i.fit === undefined)).toBe(true);
    expect(ids(empty)).toEqual(ids(env.search.search({ q: 'software engineer', sort: 'relevance', limit: 100 })));
    expect(relevance.length).toBe(empty.items.length);
  });

  it('includes the match in job details', () => {
    const detail = env.search.jobDetail(env.id('acme-swe-austin'))!;
    expect(detail.fit).toMatchObject({ percent: 100, location: { kind: 'local' } });
  });

  it('pages through the same order', () => {
    const all = ids(env.search.search({ q: 'software engineer', limit: 100 }));
    const pages = [0, 5, 10].flatMap((offset) => ids(env.search.search({ q: 'software engineer', offset, limit: 5 })));
    expect(pages).toEqual(all.slice(0, 15));
  });
});
