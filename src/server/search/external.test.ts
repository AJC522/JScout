import { describe, expect, it } from 'vitest';
import { resolvePlace } from '../lib/location';
import { externalLinks } from './external';
import { parseQuery } from './query-parse';

const links = (q: string, location?: string) => externalLinks(parseQuery(q), location, location ? resolvePlace(location) : undefined);

describe('externalLinks', () => {
  it('runs the same search on the big job sites, plus the government job sites for US places', () => {
    const l = links('software engineer -senior', 'Austin, TX');
    expect(l.map((x) => x.id)).toEqual(['linkedin', 'indeed', 'google', 'glassdoor', 'wellfound', 'usajobs', 'governmentjobs', 'clearancejobs']);
    expect(l.find((x) => x.id === 'governmentjobs')!.url).toBe('https://www.governmentjobs.com/jobs?keyword=software+engineer&location=Austin%2C+TX');
    expect(l.find((x) => x.id === 'clearancejobs')!.url).toBe('https://www.clearancejobs.com/jobs?keywords=software+engineer&location=Austin%2C+TX');
    const linkedin = new URL(l[0]!.url);
    expect(linkedin.searchParams.get('keywords')).toBe('software engineer');
    expect(linkedin.searchParams.get('location')).toBe('Austin, TX');
    expect(l.find((x) => x.id === 'wellfound')!.url).toBe('https://wellfound.com/role/software-engineer');
  });

  it('uses local sites for Germany and the country Indeed site', () => {
    const l = links('Backend Entwickler, devops', 'Berlin');
    expect(l.map((x) => x.id)).toEqual(expect.arrayContaining(['arbeitnow', 'stepstone']));
    expect(l.find((x) => x.id === 'stepstone')!.url).toBe('https://www.stepstone.de/jobs/backend-entwickler/in-berlin');
    expect(new URL(l.find((x) => x.id === 'indeed')!.url).host).toBe('de.indeed.com');
    expect(new URL(l[0]!.url).searchParams.get('keywords')).toBe('Backend Entwickler OR devops');
  });

  it('offers the government job sites without a place only for public-sector searches', () => {
    expect(links('crime analyst').map((x) => x.id)).toEqual(expect.arrayContaining(['usajobs', 'governmentjobs', 'clearancejobs']));
    expect(links('IT Specialist INFOSEC').map((x) => x.id)).toContain('governmentjobs');
    expect(links('product designer').map((x) => x.id)).not.toContain('governmentjobs');
    expect(links('police officer', 'Berlin').map((x) => x.id)).not.toContain('usajobs');
  });

  it('builds nothing from an empty search, and ignores "anywhere"', () => {
    expect(links('')).toEqual([]);
    expect(new URL(links('nurse', 'Anywhere')[0]!.url).searchParams.has('location')).toBe(false);
  });
});
