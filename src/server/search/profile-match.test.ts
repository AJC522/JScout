import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../../shared/constants';
import type { JobLocation, Profile } from '../../shared/types';
import { resolvePlace } from '../lib/location';
import {
  annualPay,
  bandLabel,
  buildMatchProfile,
  compareFit,
  levelForYears,
  locationFit,
  type LocationPrefs,
  locationPrefs,
  type MatchInput,
  matchBand,
  profileMatch,
} from './profile-match';

const NOW = new Date('2026-11-24T12:00:00.000Z');

function profileWith(edit: (p: Profile) => void): Profile {
  const p = emptyProfile(NOW.toISOString());
  edit(p);
  return p;
}

/** A mid-level software engineer with a security certification. */
const engineer = profileWith((p) => {
  p.preferences.targetTitles = ['Software Engineer'];
  p.preferences.skills = ['TypeScript', 'React', 'PostgreSQL', 'AWS'];
  p.preferences.certifications = ['CompTIA Security+'];
  p.work.yearsExperience = 4;
});
const mp = buildMatchProfile(engineer, [...engineer.preferences.skills, ...engineer.preferences.certifications], NOW);

const job = (o: Partial<MatchInput> = {}): MatchInput => ({
  title: 'Software Engineer',
  titleCore: 'software engineer',
  roleId: 'software-engineer',
  // Postings carry canonical skill names.
  skills: ['TypeScript', 'React', 'PostgreSQL', 'Amazon Web Services'],
  seniority: 'mid',
  ...o,
});

describe('buildMatchProfile', () => {
  it('collects skills, certifications, roles and levels', () => {
    // "AWS" as typed is matched under its canonical name.
    expect([...mp.skills.values()]).toEqual(expect.arrayContaining(['TypeScript', 'Amazon Web Services', 'CompTIA Security+']));
    expect(mp.roles.get('software-engineer')).toEqual({ via: 'target', title: 'Software Engineer' });
    expect(mp.related.has('backend-engineer')).toBe(true);
    expect(mp.levels).toEqual(['mid']);
    expect(mp.usable).toBe(true);
  });

  it('reads past jobs, experience skills and years from the experience entries', () => {
    const p = profileWith((x) => {
      x.experience = [
        { id: 'a', title: 'Data Analyst', company: 'Acme', location: '', start: '2016-01', end: '2019-12', current: false, summary: '', highlights: ['Built dashboards in Tableau and SQL'] },
        { id: 'b', title: 'Data Engineer', company: 'Globex', location: '', start: '2020-01', end: '', current: true, summary: '', highlights: [] },
      ];
    });
    const built = buildMatchProfile(p, [], NOW);
    expect(built.roles.get('data-engineer')).toEqual({ via: 'held', title: 'Data Engineer' });
    expect(built.roles.get('data-analyst')).toMatchObject({ via: 'held' });
    expect([...built.skills.values()]).toEqual(expect.arrayContaining(['Tableau', 'SQL']));
    expect(built.years).toBeCloseTo(10.9, 0);
    expect(built.levels).toEqual(['lead']);
  });

  it('is not usable for an empty profile', () => {
    expect(buildMatchProfile(emptyProfile(NOW.toISOString()), [], NOW).usable).toBe(false);
  });

  it.each([
    [0, 'entry'],
    [1.5, 'entry'],
    [3, 'mid'],
    [6, 'senior'],
    [12, 'lead'],
  ] as const)('%d years -> %s', (years, level) => {
    expect(levelForYears(years)).toBe(level);
  });
});

describe('profileMatch', () => {
  it('scores a posting that fits on every count at 100%', () => {
    const r = profileMatch(job({ skills: ['TypeScript', 'React', 'PostgreSQL', 'Amazon Web Services', 'CompTIA Security+'] }), mp);
    expect(r.percent).toBe(100);
    expect(r.parts.map((p) => p.label)).toEqual([
      'You have 4 of 4 listed skills',
      'You hold the certification it lists',
      'Your target role: Software Engineer',
      'Mid level fits your level (4 yrs of experience)',
    ]);
    expect(r.certsMatched).toEqual(['CompTIA Security+']);
  });

  it('weights the share of listed skills and lists what is missing', () => {
    const r = profileMatch(job({ skills: ['TypeScript', 'React', 'Go', 'Kubernetes'] }), mp);
    // skills 40 × 0.5 + role 30 + level 15, out of 85
    expect(r.percent).toBe(Math.round(((40 * 0.5 + 30 + 15) / 85) * 100));
    expect(r.skillsMatched).toEqual(['TypeScript', 'React']);
    expect(r.skillsMissing).toEqual(['Go', 'Kubernetes']);
  });

  it('counts certifications on their own and only when the posting lists some', () => {
    const missing = profileMatch(job({ skills: ['TypeScript', 'React', 'PostgreSQL', 'Amazon Web Services', 'CISSP'] }), mp);
    expect(missing.certsMissing).toEqual(['CISSP']);
    expect(missing.skillsMissing).toEqual([]);
    expect(missing.parts.find((p) => p.key === 'certifications')).toMatchObject({ score: 0, label: 'You hold 0 of 1 listed certification' });
    expect(missing.percent).toBe(Math.round(((40 + 30 + 15) / 100) * 100));
    expect(profileMatch(job(), mp).parts.some((p) => p.key === 'certifications')).toBe(false);
  });

  it('ignores soft skills', () => {
    const r = profileMatch(job({ skills: ['TypeScript', 'Communication'] }), mp);
    expect(r.parts.find((p) => p.key === 'skills')?.label).toBe('You have 1 of 1 listed skill');
  });

  it('treats a posting with no listed skills as an even chance on skills', () => {
    const r = profileMatch(job({ skills: [] }), mp);
    expect(r.parts.find((p) => p.key === 'skills')).toMatchObject({ score: 50, label: 'The posting lists no specific skills' });
  });

  it.each([
    ['target role', job(), 100],
    ['adjacent role', job({ title: 'Backend Engineer', titleCore: 'backend engineer', roleId: 'backend-engineer' }), 60],
    ['a different line of work', job({ title: 'Registered Nurse', titleCore: 'registered nurse', roleId: 'registered-nurse' }), 0],
  ] as const)('role: %s', (_, input, score) => {
    expect(profileMatch(input, mp).parts.find((p) => p.key === 'role')?.score).toBe(score);
  });

  it('gives a held role slightly less than a target role, and full marks when there are no targets', () => {
    const p = profileWith((x) => {
      x.preferences.targetTitles = ['Product Manager'];
      x.work.currentTitle = 'Software Engineer';
    });
    const withTarget = buildMatchProfile(p, [], NOW);
    expect(profileMatch(job(), withTarget).parts.find((x) => x.key === 'role')).toMatchObject({ score: 90, label: 'You have worked as Software Engineer' });
    const noTarget = buildMatchProfile(profileWith((x) => (x.work.currentTitle = 'Software Engineer')), [], NOW);
    expect(profileMatch(job(), noTarget).parts.find((x) => x.key === 'role')?.score).toBe(100);
  });

  it('falls back to shared title words for titles the taxonomy does not know', () => {
    const r = profileMatch(job({ title: 'Software Wrangler', titleCore: 'software wrangler', roleId: undefined }), mp);
    expect(r.parts.find((p) => p.key === 'role')).toMatchObject({ score: 28, label: 'Title shares “software” with your background' });
  });

  it.each([
    ['mid', 100],
    ['entry', 75],
    ['senior', 60],
    ['intern', 40],
    ['lead', 20],
    ['director', 0],
  ] as const)('level: a %s posting for a mid-level profile scores %d', (seniority, score) => {
    expect(profileMatch(job({ seniority }), mp).parts.find((p) => p.key === 'level')?.score).toBe(score);
  });

  it('leaves the level out when the posting does not state one', () => {
    expect(profileMatch(job({ seniority: 'unknown' }), mp).parts.some((p) => p.key === 'level')).toBe(false);
  });

  it('gives no percentage when only the level could be compared', () => {
    const levelsOnly = buildMatchProfile(profileWith((x) => (x.preferences.seniority = ['senior'])), [], NOW);
    expect(levelsOnly.usable).toBe(false);
    const skillsOnly = buildMatchProfile(profileWith((x) => (x.preferences.skills = ['Python'])), ['Python'], NOW);
    const r = profileMatch(job({ skills: [] }), skillsOnly);
    expect(r.percent).toBeNull();
  });
});

describe('match tiers', () => {
  it.each([
    [100, 9, '90–100% tier'],
    [90, 9, '90–100% tier'],
    [89, 8, '80–89% tier'],
    [5, 0, '0–9% tier'],
    [null, -1, 'Not enough to compare'],
  ] as const)('%s -> tier %d', (percent, band, label) => {
    expect(matchBand(percent)).toBe(band);
    expect(bandLabel(percent)).toBe(label);
  });
});

describe('locationFit', () => {
  const austin = resolvePlace('Austin, TX')!;
  const prefs = (o: Partial<LocationPrefs> = {}): LocationPrefs => ({ places: [austin], radiusKm: 50, acceptsRemote: true, countries: new Set(['US']), ...o });
  const at = (text: string, remote: JobLocation['remote'] = 'onsite'): JobLocation => ({ places: [resolvePlace(text)!], remote, remoteScope: [] });

  it('ranks remote jobs open to you first, then local, then elsewhere in the state and country, then abroad', () => {
    const kinds = [
      locationFit({ places: [], remote: 'remote', remoteScope: ['US'] }, prefs()),
      locationFit(at('Austin, TX'), prefs()),
      locationFit(at('Round Rock, TX', 'hybrid'), prefs()),
      locationFit(at('Dallas, TX'), prefs()),
      locationFit(at('Seattle, WA'), prefs()),
      locationFit({ places: [], remote: 'unknown', remoteScope: [] }, prefs()),
      locationFit(at('Berlin, Germany'), prefs()),
      locationFit({ places: [], remote: 'remote', remoteScope: ['DE'] }, prefs()),
    ];
    expect(kinds.map((k) => k.kind)).toEqual(['remote', 'local', 'local', 'area', 'country', 'unknown', 'abroad', 'remote-elsewhere']);
    expect(kinds.map((k) => k.rank)).toEqual([0, 1, 1, 2, 3, 4, 5, 6]);
    expect(kinds[1]!.label).toBe(`In ${austin.label}`);
    expect(kinds[2]!.label).toMatch(/^\d+ km from Austin/);
    expect(kinds[3]!.label).toMatch(/^Elsewhere in Texas \(\d+ km\)$/);
    expect(kinds[7]!.label).toBe('Remote, but not open to your country');
  });

  it('puts local jobs before remote ones when remote work is not wanted', () => {
    const local = locationFit(at('Austin, TX'), prefs({ acceptsRemote: false }));
    const remote = locationFit({ places: [], remote: 'remote', remoteScope: [] }, prefs({ acceptsRemote: false }));
    expect(local.rank).toBeLessThan(remote.rank);
  });

  it('cannot rank by distance without a location, but still knows remote', () => {
    expect(locationFit(at('Austin, TX'), prefs({ places: [], countries: new Set() }))).toMatchObject({ kind: 'unknown' });
    expect(locationFit({ places: [], remote: 'remote', remoteScope: ['DE'] }, prefs({ places: [], countries: new Set() }))).toMatchObject({ kind: 'remote' });
  });
});

describe('locationPrefs', () => {
  it('prefers the searched place, then saved places, then where the user lives', () => {
    const p = profileWith((x) => {
      x.preferences.locations = ['Denver, CO'];
      x.preferences.radiusKm = 25;
      x.preferences.remote = ['hybrid', 'onsite'];
      x.personal.location = 'Boston, MA';
    });
    const searched = locationPrefs({ searchPlaces: [resolvePlace('Austin, TX')!], searchRadiusKm: 10, profile: p, useSavedPlaces: true });
    expect(searched).toMatchObject({ radiusKm: 10, acceptsRemote: false });
    expect(searched.places[0]!.city).toBe('Austin');
    const saved = locationPrefs({ searchPlaces: [], searchRadiusKm: 0, searchRemote: ['remote'], profile: p, useSavedPlaces: true });
    expect(saved).toMatchObject({ radiusKm: 25, acceptsRemote: true });
    expect(saved.places[0]!.city).toBe('Denver');
    expect([...saved.countries]).toEqual(['US']);
    p.preferences.locations = [];
    expect(locationPrefs({ searchPlaces: [], searchRadiusKm: 0, profile: p, useSavedPlaces: true }).places[0]!.city).toBe('Boston');
    expect(locationPrefs({ searchPlaces: [], searchRadiusKm: 0, profile: p, useSavedPlaces: false }).places).toEqual([]);
  });
});

describe('annualPay', () => {
  it('uses the middle of the range, or the one end given', () => {
    expect(annualPay({ currency: 'USD', annualMin: 100_000, annualMax: 140_000 }, 'USD')).toBe(120_000);
    expect(annualPay({ currency: 'USD', annualMax: 90_000 }, 'USD')).toBe(90_000);
    expect(annualPay(undefined, 'USD')).toBeUndefined();
    expect(annualPay({ currency: 'USD' }, 'USD')).toBeUndefined();
  });

  it('converts other currencies when both rates are known', () => {
    expect(annualPay({ currency: 'EUR', annualMin: 100_000, annualMax: 100_000 }, 'USD')).toBeCloseTo(110_000);
    expect(annualPay({ currency: 'XYZ', annualMin: 100_000 }, 'USD')).toBeUndefined();
  });
});

describe('compareFit', () => {
  const key = (percent: number | null, locationRank: number, pay?: number) => ({ percent, locationRank, pay });

  it('orders by match tier, then location, then pay, then the exact match', () => {
    const rows = [
      key(95, 3, 200_000),
      key(91, 0),
      key(92, 0, 150_000),
      key(99, 1, 90_000),
      key(85, 0, 300_000),
      key(null, 0, 500_000),
      key(87, 0, 300_000),
    ];
    expect(rows.toSorted(compareFit)).toEqual([
      key(92, 0, 150_000), // 90+ tier, remote, paid
      key(91, 0), // 90+ tier, remote, no salary
      key(99, 1, 90_000), // 90+ tier, local
      key(95, 3, 200_000), // 90+ tier, elsewhere
      key(87, 0, 300_000), // 80–89 tier, same pay: higher match first
      key(85, 0, 300_000),
      key(null, 0, 500_000), // nothing to compare: last
    ]);
  });
});
