/**
 * Deep links that run the same search on major job sites JScout does not index.
 * Built ONLY from the query's positive terms and the location text the user typed:
 * nothing from the profile ever leaves the machine through these links.
 */
import type { ExternalSearchLink, Place } from '../../shared/types';
import { normalizeText } from '../lib/text';
import { alternativeText, type ParsedQuery } from './query-parse';

/** Indeed runs a site per country; others redirect to their .com search. */
const INDEED_HOSTS: Record<string, string> = {
  GB: 'uk.indeed.com', DE: 'de.indeed.com', CA: 'ca.indeed.com', AU: 'au.indeed.com', IN: 'in.indeed.com',
  FR: 'fr.indeed.com', NL: 'nl.indeed.com', IE: 'ie.indeed.com', ES: 'es.indeed.com', IT: 'it.indeed.com',
  AT: 'at.indeed.com', CH: 'ch.indeed.com', SG: 'sg.indeed.com', NZ: 'nz.indeed.com', BE: 'be.indeed.com',
};

const slug = (s: string): string => normalizeText(s).replace(/[+#]/g, '').trim().replace(/\s+/g, '-');

function url(base: string, params: Record<string, string | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

export function externalLinks(parsed: ParsedQuery, locationText: string | undefined, place: Place | undefined): ExternalSearchLink[] {
  const alternatives = parsed.alternatives.map(alternativeText);
  const keywords = alternatives.join(' OR ');
  const first = alternatives[0] ?? '';
  const where = place?.kind === 'anywhere' ? '' : (locationText?.trim() ?? '');
  if (!keywords && !where) return [];
  const country = place?.kind === 'anywhere' ? undefined : place?.country;
  const links: ExternalSearchLink[] = [
    { id: 'linkedin', name: 'LinkedIn Jobs', url: url('https://www.linkedin.com/jobs/search/', { keywords, location: where }) },
    { id: 'indeed', name: 'Indeed', url: url(`https://${INDEED_HOSTS[country ?? ''] ?? 'www.indeed.com'}/jobs`, { q: keywords, l: where }) },
    { id: 'google', name: 'Google Jobs', url: url('https://www.google.com/search', { q: [keywords, 'jobs', where && `in ${where}`].filter(Boolean).join(' '), ibp: 'htl;jobs' }) },
    { id: 'glassdoor', name: 'Glassdoor', url: url('https://www.glassdoor.com/Job/jobs.htm', { 'sc.keyword': keywords, locKeyword: where }) },
  ];
  if (first) links.push({ id: 'wellfound', name: 'Wellfound', url: `https://wellfound.com/role/${encodeURIComponent(slug(first))}` });
  if (country === 'US') links.push({ id: 'usajobs', name: 'USAJOBS', url: url('https://www.usajobs.gov/Search/Results', { k: keywords, l: where }) });
  if (country === 'DE') {
    links.push({ id: 'arbeitnow', name: 'Arbeitnow', url: url('https://www.arbeitnow.com/', { search: keywords }) });
    const city = place?.kind === 'city' ? place.city : undefined;
    const path = [first ? slug(first) : '', city ? `in-${slug(city)}` : ''].filter(Boolean).map(encodeURIComponent).join('/');
    links.push({ id: 'stepstone', name: 'StepStone', url: `https://www.stepstone.de/jobs/${path}` });
  }
  return links;
}
