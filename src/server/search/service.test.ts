import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SearchQuery, SearchResponse } from '../../shared/types';
import { normalizePosting } from '../ingest/normalize';
import { getSource } from '../sources/registry';
import { createSearchTestEnv, FIXTURE_NOW, type SearchTestEnv } from './testing';

let env: SearchTestEnv;

beforeAll(async () => {
  env = await createSearchTestEnv();
}, 60_000);

afterAll(() => env.close());

const run = (q: SearchQuery): SearchResponse => env.search.search({ limit: 100, ...q });
const ids = (r: SearchResponse): string[] => r.items.map((i) => i.job.externalId);
const item = (r: SearchResponse, externalId: string) => r.items.find((i) => i.job.externalId === externalId);
const clusterOf = (externalId: string): string => env.store.getPosting(env.id(externalId))!.clusterKey;
const sum = (facet: Array<{ count: number }>): number => facet.reduce((n, f) => n + f.count, 0);

describe('finding the right titles', () => {
  it('"Software Engineer" finds "Software Developer" and "SWE" postings via synonyms and ranks the exact title first', () => {
    const r = run({ q: 'Software Engineer', location: 'Austin, TX', radiusKm: 50 });
    expect(ids(r)).toEqual(expect.arrayContaining(['acme-swe-austin', 'acme-dev-roundrock', 'acme-swe-remote-us']));
    expect(r.items[0]!.job.externalId).toBe('acme-swe-austin');
    expect(r.items[0]!.match.titleMatch).toBe('exact');
    expect(item(r, 'acme-dev-roundrock')!.match.titleMatch).toBe('synonym');
    expect(r.interpretation).toMatchObject({ titleOnly: true, role: { id: 'software-engineer' } });
    expect(r.interpretation.titles).toEqual(
      expect.arrayContaining([
        { title: 'Software Engineer', via: 'query', roleId: 'software-engineer' },
        { title: 'SWE', via: 'synonym', roleId: 'software-engineer' },
      ]),
    );
  });

  it('without synonyms only titles containing the typed title match', () => {
    const r = run({ q: 'software engineer', synonyms: false });
    expect(ids(r)).toContain('acme-swe-austin');
    expect(ids(r)).not.toContain('acme-dev-roundrock');
    expect(ids(r)).not.toContain('acme-swe-remote-us');
  });

  it('title words keep their spelling: "accountant" does not find "Account Executive", plurals still match', () => {
    const accountant = run({ q: 'accountant' });
    expect(ids(accountant)).toContain('remotive-accountant');
    expect(ids(accountant)).not.toContain('remotive-account-exec');
    expect(env.search.count({ q: 'accountant' })).toBe(accountant.total);
    expect(ids(run({ q: 'account executive' }))).toContain('remotive-account-exec');
    const teacher = run({ q: 'teacher' });
    expect(ids(teacher)).toContain('remotive-teachers');
    expect(teacher.items.every((i) => i.match.titleMatch === 'exact')).toBe(true);
    // Acronyms match as typed: "SWE" must not find "Swedish".
    expect(ids(run({ q: 'swe', synonyms: false }))).toEqual(['acme-swe-remote-us']);
  });

  it('exclusions match words as spelled, not by stem: "intern" keeps "international" postings', () => {
    const all = env.db.all<{ external_id: string; title: string; description_html: string }>(
      'SELECT external_id, title, description_html FROM jobs WHERE closed_at IS NULL',
    );
    const has = (re: RegExp) => new Set(all.filter((r) => re.test(`${r.title} ${r.description_html}`)).map((r) => r.external_id));
    const intern = has(/(?<![\p{L}\p{N}])interns?(?![\p{L}\p{N}])/iu);
    const internationalOnly = [...has(/\binternational\b/i)].filter((id) => !intern.has(id));
    expect(internationalOnly.length).toBeGreaterThan(0);
    const kept = new Set(ids(run({ q: '', excludeTerms: ['intern'], limit: 1000 })));
    const everything = ids(run({ q: '', limit: 1000 }));
    for (const id of internationalOnly) if (everything.includes(id)) expect(kept, id).toContain(id);
    for (const id of everything) if (!kept.has(id)) expect(intern, `${id} was excluded`).toContain(id);
    // "-manager" in a keyword search keeps "management" postings; plurals are still excluded.
    expect(ids(run({ q: 'teachers -teacher' }))).not.toContain('remotive-teachers');
    expect(ids(run({ q: 'accountant -account', titleOnly: false }))).toContain('remotive-accountant');
  });

  it('a title typed in the plural finds the same jobs as the singular', () => {
    for (const [plural, singular] of [
      ['software engineers', 'software engineer'],
      ['registered nurses', 'registered nurse'],
      ['accountants', 'accountant'],
      ['data engineers', 'data engineer'],
    ] as const) {
      const one = run({ q: singular });
      expect(one.total, singular).toBeGreaterThan(0);
      expect(ids(run({ q: plural })).sort(), plural).toEqual(ids(one).sort());
    }
  });

  it('arrangement and place words next to a title are not required in the title', () => {
    const plain = run({ q: 'software engineer' });
    const remote = run({ q: 'remote software engineer' });
    expect(remote.total).toBeGreaterThan(0);
    expect(remote.items.every((i) => i.job.location.remote === 'remote')).toBe(true);
    expect(ids(run({ q: 'software engineer remote' })).sort()).toEqual(ids(remote).sort());
    expect(ids(remote).every((id) => ids(plain).includes(id))).toBe(true);
    expect(remote.interpretation.terms).toContain('remote');
    // The facet, when set, wins over the word.
    expect(run({ q: 'remote software engineer', remote: ['hybrid'] }).items.every((i) => i.job.location.remote === 'hybrid')).toBe(true);
    expect(ids(run({ q: 'software engineer berlin' }))).toContain('acme-swe-berlin');
    const fullTime = run({ q: 'full time software engineer' });
    expect(fullTime.total).toBeGreaterThan(0);
    expect(fullTime.items.every((i) => i.job.employmentType === 'full-time')).toBe(true);
  });

  it('"Search keywords anywhere" only adds results to a title search', () => {
    for (const q of ['software engineer', 'backend engineer']) {
      const title = run({ q, limit: 1000 });
      const anywhere = run({ q, titleOnly: false, limit: 1000 });
      expect(anywhere.total, q).toBeGreaterThanOrEqual(title.total);
      for (const id of ids(title)) expect(ids(anywhere), `${q}: ${id}`).toContain(id);
    }
  });

  it('a leading minus excludes a word', () => {
    const r = run({ q: 'software engineer -senior', location: 'Austin, TX', radiusKm: 50 });
    expect(ids(r)).toContain('acme-swe-austin');
    expect(ids(r)).not.toContain('acme-senior-swe');
    expect(r.interpretation.excluded).toEqual(['senior']);
  });

  it('matches programming languages with symbols: C#, node.js', () => {
    expect(run({ q: 'C#' }).items[0]!.job.externalId).toBe('acme-csharp-dallas');
    expect(run({ q: 'node.js' }).items[0]!.job.externalId).toBe('globex-node-austin');
    expect(ids(run({ q: 'c++' }))).not.toContain('acme-csharp-dallas');
  });

  it('searches keywords anywhere in the posting, titles only in the title', () => {
    const keyword = run({ q: 'kubernetes' });
    expect(keyword.interpretation.titleOnly).toBe(false);
    expect(ids(keyword)).toContain('acme-senior-swe');
    expect(run({ q: 'rust developer' }).interpretation.titleOnly).toBe(true);
    // Forcing title-only keeps "kubernetes" out of descriptions.
    expect(ids(run({ q: 'kubernetes', titleOnly: true }))).not.toContain('acme-senior-swe');
  });

  it('treats commas and OR as alternatives', () => {
    for (const q of ['QA Analyst, Backend Engineer', 'QA Analyst OR Backend Engineer']) {
      expect(ids(run({ q }))).toEqual(expect.arrayContaining(['acme-qa-austin', 'acme-backend-munich']));
    }
  });

  it('adds opted-in related roles', () => {
    const base = run({ q: 'software engineer', location: 'Germany' });
    expect(ids(base)).not.toContain('acme-backend-munich');
    const widened = run({ q: 'software engineer', location: 'Germany', relatedRoles: ['backend-engineer'] });
    expect(ids(widened)).toContain('acme-backend-munich');
    expect(item(widened, 'acme-backend-munich')!.match.titleMatch).toBe('related');
    expect(widened.interpretation.titles).toContainEqual({ title: 'Backend Engineer', via: 'related', roleId: 'backend-engineer' });
  });

  it('never lets user input break the full-text query', () => {
    const hostile = ['"', '""', 'AND OR NOT', 'title:foo', '*', '(', ')', 'NEAR(a b)', '-', '- -"', 'a"b', '{title body}: x', '^start', 'c++ OR', '😀', 'x'.repeat(300), ',,,', '"unclosed phrase'];
    for (const q of hostile) {
      const r = env.search.search({ q });
      expect(env.search.count({ q }), q).toBe(r.total);
    }
    expect(() => run({ q: 'engineer', excludeTerms: ['"', 'NOT', 'col:x'] })).not.toThrow();
  });
});

describe('location', () => {
  it('"Austin, TX" within 50 km includes Round Rock and remote-US jobs, not remote jobs restricted to Germany', () => {
    const r = run({ q: 'software engineer', location: 'Austin, TX', radiusKm: 50 });
    expect(ids(r)).toEqual(expect.arrayContaining(['acme-swe-austin', 'acme-dev-roundrock', 'acme-swe-remote-us']));
    expect(ids(r)).not.toContain('remotive-swe-de-only');
    expect(ids(r)).not.toContain('acme-swe-berlin');
    expect(item(r, 'acme-dev-roundrock')!.match.reasons.find((x) => x.key === 'location')!.label).toMatch(/^In Round Rock, TX \(\d+ km\)$/);
  });

  it('radius 0 means the city itself, and includeRemote: false drops remote jobs', () => {
    const city = run({ q: 'software engineer', location: 'Austin, TX', radiusKm: 0 });
    expect(ids(city)).toContain('acme-swe-austin');
    expect(ids(city)).not.toContain('acme-dev-roundrock');
    const onsite = run({ q: 'software engineer', location: 'Austin, TX', radiusKm: 50, includeRemote: false });
    expect(ids(onsite)).not.toContain('acme-swe-remote-us');
    expect(ids(onsite)).toContain('acme-dev-roundrock');
  });

  it('"Germany" includes Berlin, München and remote-EU jobs, not London or US-only remote jobs', () => {
    const r = run({ q: '', location: 'Germany' });
    expect(ids(r)).toEqual(expect.arrayContaining(['acme-swe-berlin', 'acme-backend-munich', 'remotive-swe-eu', 'remotive-swe-de-only']));
    expect(ids(r)).not.toContain('globex-swe-london');
    expect(ids(r)).not.toContain('acme-swe-remote-us');
    expect(r.interpretation.place).toMatchObject({ kind: 'country', country: 'DE' });
  });

  it('several places (a profile with more than one city) match postings in any of them', () => {
    const r = run({ q: '', location: 'Berlin, Germany; Munich, Germany', includeRemote: false });
    expect(ids(r)).toEqual(expect.arrayContaining(['acme-swe-berlin', 'acme-backend-munich']));
    expect(ids(r)).not.toContain('acme-swe-austin');
    const munich = item(r, 'acme-backend-munich')!;
    expect(munich.match.reasons.find((x) => x.key === 'location')?.label).toMatch(/^In M(ü|u)nich/);
    expect(r.interpretation.place?.city).toBe('Berlin');
  });

  it('"EMEA" covers London and Berlin but not Austin', () => {
    const r = run({ q: 'software engineer', location: 'EMEA' });
    expect(ids(r)).toEqual(expect.arrayContaining(['globex-swe-london', 'acme-swe-berlin']));
    expect(ids(r)).not.toContain('acme-swe-austin');
  });

  it('"Anywhere" applies no location filter; unknown places fall back to a text match', () => {
    expect(run({ q: 'software engineer', location: 'Anywhere' }).total).toBe(run({ q: 'software engineer' }).total);
    const unknown = run({ q: '', location: 'Xyzzyville' });
    expect(unknown.interpretation).toMatchObject({ placeUnresolved: true, place: { kind: 'unknown', raw: 'Xyzzyville' } });
    expect(unknown.total).toBe(0);
  });
});

describe('filters', () => {
  it('salaryMin 100,000 USD keeps a $90k–$130k posting and drops a $60k–$80k one', () => {
    const strict = run({ q: '', location: 'Austin, TX', salaryMin: 100_000, salaryCurrency: 'USD', includeNoSalary: false });
    expect(ids(strict)).toContain('acme-swe-austin');
    expect(ids(strict)).not.toContain('acme-qa-austin');
    expect(ids(strict)).not.toContain('acme-senior-swe');
    const lenient = run({ q: '', location: 'Austin, TX', salaryMin: 100_000, salaryCurrency: 'USD' });
    expect(ids(lenient)).toContain('acme-senior-swe');
    expect(ids(lenient)).not.toContain('acme-qa-austin');
  });

  it('salaryMin compares other currencies roughly instead of treating them as unknown', () => {
    for (const includeNoSalary of [false, true]) {
      const r = run({ q: 'data engineer', salaryMin: 100_000, salaryCurrency: 'USD', includeNoSalary });
      expect(ids(r)).toContain('remotive-eur-high');
      expect(ids(r)).not.toContain('remotive-eur-low');
    }
    expect(ids(run({ q: 'data engineer', salaryMin: 70_000, salaryCurrency: 'EUR', includeNoSalary: false }))).toContain('remotive-eur-low');
  });

  it('hidden clusters disappear unless asked for', () => {
    const id = env.id('acme-swe-austin');
    env.ctx.services.userState.hide({ id, clusterKey: clusterOf('acme-swe-austin') });
    try {
      expect(ids(run({ q: 'software engineer' }))).not.toContain('acme-swe-austin');
      const shown = run({ q: 'software engineer', includeHidden: true });
      expect(item(shown, 'acme-swe-austin')!.userState.hidden).toBe(true);
    } finally {
      env.ctx.services.userState.unhide(clusterOf('acme-swe-austin'));
    }
  });

  it('includeApplied: false hides jobs already applied to; saved ones stay', () => {
    const insert = (cluster: string, status: string) =>
      env.db.run(
        `INSERT INTO applications (id, cluster_key, status, job_snapshot, status_changed_at, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?, ?)`,
        `app-${status}`, cluster, status, FIXTURE_NOW.toISOString(), FIXTURE_NOW.toISOString(), FIXTURE_NOW.toISOString(),
      );
    insert(clusterOf('acme-swe-berlin'), 'interviewing');
    insert(clusterOf('globex-swe-london'), 'saved');
    try {
      const r = run({ q: 'software engineer', includeApplied: false });
      expect(ids(r)).not.toContain('acme-swe-berlin');
      expect(ids(r)).toContain('globex-swe-london');
      expect(ids(run({ q: 'software engineer' }))).toContain('acme-swe-berlin');
    } finally {
      env.db.run('DELETE FROM applications');
    }
  });

  it('closed postings are excluded unless includeClosed, and then penalised', () => {
    const id = env.id('acme-qa-austin');
    env.store.setLiveness(id, { status: 'closed', checkedAt: FIXTURE_NOW.toISOString() });
    try {
      expect(ids(run({ q: 'qa analyst' }))).not.toContain('acme-qa-austin');
      const closed = item(run({ q: 'qa analyst', includeClosed: true }), 'acme-qa-austin')!;
      expect(closed.match.reasons).toContainEqual(expect.objectContaining({ key: 'closed', points: -20 }));
    } finally {
      env.store.setLiveness(id, { status: 'open', checkedAt: FIXTURE_NOW.toISOString() });
    }
  });

  it('postedWithinDays and the max posting age setting', () => {
    const recent = run({ q: '', location: 'Austin, TX', postedWithinDays: 3 });
    expect(ids(recent)).toContain('acme-swe-austin');
    expect(ids(recent)).not.toContain('acme-qa-austin');
    env.settings.maxPostingAgeDays = 3;
    try {
      expect(ids(run({ q: '', location: 'Austin, TX' }))).not.toContain('acme-qa-austin');
      expect(ids(run({ q: '', location: 'Austin, TX', postedWithinDays: 7 }))).toContain('acme-qa-austin');
    } finally {
      env.settings.maxPostingAgeDays = 0;
    }
  });

  it('companies match by normalised name; excluded companies disappear', () => {
    const only = run({ q: '', companies: ['acme robotics, inc.'] });
    expect(only.total).toBeGreaterThanOrEqual(8);
    expect(only.items.every((i) => i.job.company === 'Acme Robotics')).toBe(true);
    expect(run({ q: 'software engineer', excludeCompanies: ['ACME Robotics'] }).items.some((i) => i.job.company === 'Acme Robotics')).toBe(false);
  });

  it('work mode, source, seniority and employment type filters', () => {
    expect(run({ q: '', remote: ['remote'] }).items.every((i) => i.job.location.remote === 'remote')).toBe(true);
    expect(run({ q: '', sources: ['lever'] }).items.every((i) => i.job.source === 'lever')).toBe(true);
    const senior = run({ q: 'software engineer', seniority: ['senior'] });
    expect(senior.total).toBeGreaterThan(0);
    expect(senior.items.every((i) => i.job.seniority === 'senior')).toBe(true);
    expect(run({ q: '', employmentTypes: ['internship'] }).items.every((i) => i.job.employmentType === 'internship')).toBe(true);
  });
});

describe('de-duplication', () => {
  it('collapses a job listed by an aggregator into the employer ATS copy', () => {
    const r = run({ q: 'software engineer', location: 'Austin, TX', radiusKm: 50 });
    const swe = item(r, 'acme-swe-remote-us')!;
    expect(swe.job.source).toBe('greenhouse');
    expect(swe.duplicates).toEqual([expect.objectContaining({ jobId: env.id('remotive-acme-swe'), source: 'remotive' })]);
    expect(ids(r)).not.toContain('remotive-acme-swe');
  });

  it('count() equals total, also when only counting postings first seen after a date', () => {
    for (const q of [{ q: 'software engineer' }, { q: '', location: 'Germany' }, { q: 'engineer', remote: ['remote' as const] }, { q: '' }]) {
      expect(env.search.count(q), JSON.stringify(q)).toBe(env.search.search(q).total);
    }
    expect(env.search.count({ q: '' }, { firstSeenAfter: FIXTURE_NOW.toISOString() })).toBe(0);
    expect(env.search.count({ q: '' }, { firstSeenAfter: '2000-01-01T00:00:00.000Z' })).toBe(env.search.count({ q: '' }));
  });

  it("a job its employer's board has closed is closed, whatever aggregators still list", async () => {
    const small = await createSearchTestEnv({ fixtures: false });
    try {
      const q = { q: 'SWE', synonyms: false };
      expect(ids(small.search.search(q))).toEqual(['acme-swe-remote-us']);
      small.store.closePostings('greenhouse:acmerobotics', ['acme-swe-remote-us'], FIXTURE_NOW);
      expect(small.search.search(q).total).toBe(0);
      expect(small.search.count(q)).toBe(0);
      expect(small.search.search({ ...q, includeClosed: true }).total).toBe(1);
      const links = small.store.clusterLinks(small.store.getPosting(small.id('remotive-acme-swe'))!.clusterKey);
      expect(links.find((l) => l.source === 'greenhouse')?.closedAt).toBe(FIXTURE_NOW.toISOString());
      expect(links.find((l) => l.source === 'remotive')?.closedAt).toBeUndefined();
      // Closing only the aggregator's copy leaves the employer's open copy.
      small.db.run('UPDATE jobs SET closed_at = NULL');
      small.store.closePostings('remotive', ['remotive-acme-swe'], FIXTURE_NOW);
      expect(ids(small.search.search(q))).toEqual(['acme-swe-remote-us']);
    } finally {
      small.close();
    }
  });

  it('a removed feed leaves search at once, before its postings are deleted', async () => {
    const small = await createSearchTestEnv({ fixtures: false });
    try {
      const before = small.search.search({ q: '' });
      expect(before.facets.source.some((f) => f.value === 'remotive')).toBe(true);
      small.store.hideFeeds(['remotive']);
      const after = small.search.search({ q: '' });
      expect(after.facets.source.some((f) => f.value === 'remotive')).toBe(false);
      expect(small.search.count({ q: '' })).toBe(after.total);
      await small.store.purgePending();
      expect(small.search.search({ q: '' }).total).toBe(after.total);
    } finally {
      small.close();
    }
  });

  it('acronym titles count only written as one: "RN" is not the reference code in "RN 71344"', async () => {
    const small = await createSearchTestEnv({ fixtures: false });
    try {
      const def = getSource('remotive')!.def;
      const postings = [
        ['code', 'Konstrukteur Mechanik; RN 71344', 'Maschinenbau GmbH'],
        ['rn-icu', 'RN - ICU Night Shift', 'City Hospital'],
        ['np', 'Nurse Practitioner', 'City Hospital'],
        ['rn-word', 'Registered Nurse - Med Surg', 'County Clinic'],
      ].map(([externalId = '', title = '', company = '']) =>
        normalizePosting(
          { externalId, title, company, url: `https://jobs.example.com/${externalId}`, locations: ['Remote - US'], remote: 'remote', descriptionHtml: '<p>Join us.</p>' },
          { source: def, feedKey: 'remotive', now: FIXTURE_NOW },
        )!,
      );
      small.store.upsertPostings({ feedKey: 'remotive', source: 'remotive' }, postings, FIXTURE_NOW);
      const r = small.search.search({ q: 'registered nurse', limit: 50 });
      const found = ids(r);
      expect(found).not.toContain('code');
      expect(found).toEqual(expect.arrayContaining(['rn-icu', 'rn-word', 'np']));
      expect(found.indexOf('rn-icu')).toBeLessThan(found.indexOf('np'));
      expect(small.search.count({ q: 'registered nurse' })).toBe(r.total);
      expect(ids(small.search.search({ q: 'RN', synonyms: false }))).toEqual(['rn-icu']);
    } finally {
      small.close();
    }
  });

  it('a new copy of a job seen before does not make it new', async () => {
    const small = await createSearchTestEnv({ fixtures: false });
    try {
      const day = 86_400_000;
      const at = (days: number) => new Date(FIXTURE_NOW.getTime() - days * day).toISOString();
      small.db.run('UPDATE jobs SET first_seen_at = ?', at(3));
      small.db.run("UPDATE jobs SET first_seen_at = ? WHERE external_id = 'remotive-acme-swe'", at(0));
      const q = { q: 'SWE', synonyms: false };
      expect(small.search.count(q)).toBe(1);
      expect(small.search.count(q, { firstSeenAfter: at(1) })).toBe(0);
      small.db.run("UPDATE jobs SET first_seen_at = ? WHERE external_id = 'acme-swe-remote-us'", at(0));
      expect(small.search.count(q, { firstSeenAfter: at(1) })).toBe(1);
    } finally {
      small.close();
    }
  });
});

describe('facets', () => {
  it('each facet adds up to the total when it is not filtered', () => {
    const r = run({ q: '' });
    for (const facet of [r.facets.remote, r.facets.employmentType, r.facets.seniority, r.facets.source]) expect(sum(facet)).toBe(r.total);
    const within = r.facets.postedWithin.map((f) => f.count);
    expect(within).toEqual([...within].sort((a, b) => a - b));
    expect(within.at(-1)).toBeLessThanOrEqual(r.total);
    expect(r.facets.company.length).toBeLessThanOrEqual(15);
  });

  it('a filtered facet still shows what selecting another value would give', () => {
    const q: SearchQuery = { q: '', remote: ['remote'] };
    const r = run(q);
    expect(r.facets.remote.find((f) => f.value === 'remote')!.count).toBe(r.total);
    for (const value of ['hybrid', 'onsite'] as const) {
      expect(r.facets.remote.find((f) => f.value === value)?.count ?? 0, value).toBe(env.search.count({ ...q, remote: [value] }));
    }
    const company = r.facets.company[0]!;
    expect(env.search.count({ ...q, companies: [company.value] })).toBe(company.count);
  });
});

describe('broadening', () => {
  it('suggests changes for a zero-result search, and each really adds results', () => {
    const q: SearchQuery = { q: 'software engineer', location: 'Austin, TX', includeRemote: false, seniority: ['lead'] };
    const r = run(q);
    expect(r.total).toBe(0);
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.length).toBeLessThanOrEqual(6);
    for (const s of r.suggestions) {
      expect(s.extraResults, s.id).toBeGreaterThan(0);
      expect(env.search.count({ ...q, ...s.patch }), s.id).toBe(s.extraResults);
    }
    const gains = r.suggestions.map((s) => s.extraResults!);
    expect(gains).toEqual([...gains].sort((a, b) => b - a));
  });

  it('offers external links built only from the query and location', () => {
    env.profile.personal.fullName = 'Private Person';
    const r = run({ q: 'software engineer', location: 'Austin, TX' });
    expect(r.externalLinks.map((l) => l.id)).toEqual(expect.arrayContaining(['linkedin', 'indeed', 'google', 'usajobs']));
    expect(JSON.stringify(r.externalLinks)).not.toContain('Private');
  });
});

describe('ranking and explanations', () => {
  it('explains profile skill overlap, and ignores the profile when asked', () => {
    env.profile.preferences.skills = ['TypeScript', 'React', 'PostgreSQL'];
    try {
      const swe = item(run({ q: 'software engineer', location: 'Austin, TX' }), 'acme-swe-austin')!;
      expect(swe.match.skillsMatched).toEqual(expect.arrayContaining(['TypeScript', 'React', 'PostgreSQL']));
      expect(swe.match.skillsMissing).toContain('Amazon Web Services');
      expect(swe.match.reasons.find((x) => x.key === 'skills')!.label).toMatch(/^You have 3 of \d+ listed skills$/);
      const plain = item(run({ q: 'software engineer', location: 'Austin, TX', useProfile: false }), 'acme-swe-austin')!;
      expect(plain.match.skillsMatched).toEqual([]);
    } finally {
      env.profile.preferences.skills = [];
    }
  });

  it('scores are 0–100, relevance order follows them, and reasons are human', () => {
    const r = run({ q: 'software engineer' });
    const scores = r.items.map((i) => i.score);
    expect(scores.every((s) => s >= 0 && s <= 100)).toBe(true);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const swe = item(r, 'acme-swe-austin')!;
    expect(swe.match.reasons.map((x) => x.label)).toEqual(
      expect.arrayContaining(['Title matches “Software Engineer”', 'Posted 2 days ago', 'Salary listed: $90k–$130k/yr']),
    );
    expect(swe.match.reasons.reduce((n, x) => n + x.points, 0)).toBeCloseTo(swe.score, -1);
  });

  it('sorts by date and by salary', () => {
    const byDate = run({ q: '', sort: 'date' }).items.map((i) => i.job.postedAt ?? i.job.firstSeenAt);
    expect(byDate).toEqual([...byDate].sort().reverse());
    const bySalary = run({ q: '', location: 'Austin, TX', sort: 'salary', salaryCurrency: 'USD' }).items;
    const pay = (i: (typeof bySalary)[number]) => i.job.salary?.annualMax ?? i.job.salary?.annualMin;
    const tier = (i: (typeof bySalary)[number]) => (pay(i) === undefined ? 2 : i.job.salary?.currency === 'USD' ? 0 : 1);
    const tiers = bySalary.map(tier);
    expect(tiers).toEqual([...tiers].sort());
    const usd = bySalary.filter((i) => tier(i) === 0).map((i) => pay(i)!);
    expect(usd.length).toBeGreaterThan(1);
    expect(usd).toEqual([...usd].sort((a, b) => b - a));
  });

  it('pages without overlap', () => {
    const first = env.search.search({ q: '', limit: 10 });
    const second = env.search.search({ q: '', limit: 10, offset: 10 });
    expect(second.total).toBe(first.total);
    expect(ids(first).filter((x) => ids(second).includes(x))).toEqual([]);
  });
});

describe('job detail and suggestions', () => {
  it('returns the description, duplicates and user state; unknown ids are undefined', () => {
    const detail = env.search.jobDetail(env.id('acme-swe-remote-us'))!;
    expect(detail.descriptionHtml).toContain('Terraform');
    expect(detail.duplicates.map((d) => d.source)).toEqual(['remotive']);
    expect(detail.userState).toEqual({ hidden: false });
    expect(detail.score).toBeGreaterThan(0);
    const scored = env.search.jobDetail(env.id('acme-swe-austin'), { q: 'software engineer' })!;
    expect(scored.match.titleMatch).toBe('exact');
    expect(env.search.jobDetail('nope')).toBeUndefined();
  });

  it('suggests titles with live counts, companies, places and skills', () => {
    const titles = env.search.suggestTitles('software eng');
    expect(titles[0]).toMatchObject({ title: 'Software Engineer', roleId: 'software-engineer' });
    expect(titles[0]!.count).toBeGreaterThanOrEqual(5);
    expect(env.search.suggestCompanies('acme')).toEqual([{ name: 'Acme Robotics', count: 8 }]);
    expect(env.search.suggestCompanies('robot')[0]?.name).toBe('Acme Robotics');
    expect(env.search.suggestCompanies('%')).toEqual([]);
    expect(env.search.suggestLocations('austin', 3)[0]?.city).toBe('Austin');
    expect(env.search.suggestSkills('typescr', 3)[0]?.name).toBe('TypeScript');
  });
});
