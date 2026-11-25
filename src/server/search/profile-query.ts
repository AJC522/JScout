/** Queries derived from elsewhere: the saved profile, and upstream "search"-mode sources. */
import type { Profile, SearchQuery } from '../../shared/types';
import { resolvePlace } from '../lib/location';
import { expandTitle } from '../lib/titles';
import type { UpstreamQuery } from '../sources/types';
import { LOCATION_SEPARATOR, locationPieces } from './location-filter';
import { alternativeText, parseQuery } from './query-parse';
import { understandQuery } from './understand';

/** Target titles used for a profile query (more makes the search vague). */
const PROFILE_TITLES = 3;
const UPSTREAM_SYNONYMS = 2;
const UPSTREAM_KEYWORDS = 6;
const UPSTREAM_LIMIT = 60;

export function queryFromPreferences(profile: Profile): SearchQuery {
  const p = profile.preferences;
  // Commas separate alternatives in q, so a comma inside one title would split it.
  const titles = p.targetTitles.map((t) => t.replace(/[,|"]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, PROFILE_TITLES);
  const query: SearchQuery = { q: titles.join(', ') };
  // Every saved place, so jobs in any of the user's cities come up (not only the first one's).
  const locations = p.locations.map((l) => l.replaceAll(LOCATION_SEPARATOR, ' ').trim()).filter(Boolean);
  if (locations.length) {
    query.location = locations.join(`${LOCATION_SEPARATOR} `);
    query.radiusKm = p.radiusKm;
  }
  if (p.remote.length) query.remote = [...p.remote];
  if (p.salaryMin !== null && p.salaryMin > 0) {
    query.salaryMin = p.salaryMin;
    query.salaryCurrency = p.salaryCurrency;
  }
  if (p.employmentTypes.length) query.employmentTypes = [...p.employmentTypes];
  if (p.seniority.length) query.seniority = [...p.seniority];
  if (p.excludeCompanies.length) query.excludeCompanies = [...p.excludeCompanies];
  if (p.excludeTerms.length) query.excludeTerms = [...p.excludeTerms];
  return query;
}

export function upstreamQuery(query: SearchQuery): UpstreamQuery {
  const parsed = parseQuery(query.q ?? '');
  const keywords = parsed.alternatives.map(alternativeText);
  if (query.synonyms !== false && understandQuery(query).titleOnly) {
    for (const alt of keywords.slice()) keywords.push(...expandTitle(alt).synonyms.slice(0, UPSTREAM_SYNONYMS));
  }
  const out: UpstreamQuery = { keywords: [...new Set(keywords)].slice(0, UPSTREAM_KEYWORDS), limit: UPSTREAM_LIMIT };
  // Upstream sources take one place.
  const text = locationPieces(query.location)[0];
  if (text) {
    out.locationText = text;
    const place = resolvePlace(text);
    if (place && place.kind !== 'anywhere' && place.kind !== 'region') {
      if (place.city) out.city = place.city;
      if (place.admin1) out.admin1 = place.admin1;
      if (place.country) out.country = place.country;
    }
  }
  if (query.remote?.length === 1 && query.remote[0] === 'remote') out.remoteOnly = true;
  if (query.postedWithinDays !== undefined) out.postedWithinDays = query.postedWithinDays;
  if (query.salaryMin !== undefined && query.salaryMin > 0) {
    out.salaryMin = query.salaryMin;
    if (query.salaryCurrency) out.salaryCurrency = query.salaryCurrency;
  }
  return out;
}
