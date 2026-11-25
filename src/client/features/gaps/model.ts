/** Pure helpers for the Skill gaps page: labels, the analysed scope in the URL, rows and profile edits. */
import type { ProfilePatch } from '../../../shared/api';
import type { GapItem, GapRecommendation, GapRequest, GapScope, LevelFit, Profile, SearchQuery } from '../../../shared/types';
import { paramsToQuery, queryToParams } from '../search/url-state';

/** Display names of the skills dictionary's categories. */
export const CATEGORY_LABELS: Record<string, string> = {
  'business-tool': 'Business tools',
  'certification-license': 'Certifications and licences',
  'cloud-devops': 'Cloud and DevOps',
  'data-ml': 'Data and machine learning',
  database: 'Databases',
  'design-creative': 'Design',
  'education-training': 'Education and training',
  'engineering-manufacturing': 'Engineering and manufacturing',
  'finance-accounting': 'Finance and accounting',
  'framework-library': 'Frameworks and libraries',
  'healthcare-clinical': 'Healthcare',
  'hospitality-retail': 'Hospitality and retail',
  'hr-recruiting': 'HR and recruiting',
  language: 'Languages',
  'legal-compliance': 'Legal and compliance',
  marketing: 'Marketing',
  'operations-supply-chain': 'Operations and supply chain',
  'product-project': 'Product and project management',
  'programming-language': 'Programming languages',
  'sales-customer': 'Sales and customer service',
  'science-research': 'Science and research',
  security: 'Security',
  'skilled-trades': 'Skilled trades',
  'soft-skill': 'Soft skills',
  'writing-communication': 'Writing and communication',
};

export function categoryLabel(category: string | undefined): string | undefined {
  return category ? CATEGORY_LABELS[category] : undefined;
}

export const SCOPE_PARAM = 'scope';
const SCOPES: readonly GapScope[] = ['profile', 'applications', 'search'];

/** The page's URL for a scope; the search scope carries the search in the same parameters as the Search page. */
export function gapsUrl(scope: GapScope, query?: SearchQuery): string {
  const params = scope === 'search' && query ? queryToParams(query) : new URLSearchParams();
  if (scope !== 'profile') params.set(SCOPE_PARAM, scope);
  const text = params.toString();
  return text ? `/gaps?${text}` : '/gaps';
}

/** What the URL asks to analyse. A search without any search text or filter falls back to the profile. */
export function requestFromParams(params: URLSearchParams): { request: GapRequest; search?: SearchQuery } {
  const raw = params.get(SCOPE_PARAM);
  const scope = SCOPES.includes(raw as GapScope) ? (raw as GapScope) : 'profile';
  if (scope !== 'search') return { request: { scope } };
  const rest = new URLSearchParams(params);
  rest.delete(SCOPE_PARAM);
  if ([...rest.keys()].length === 0) return { request: { scope: 'profile' } };
  const query = paramsToQuery(rest);
  return { request: { scope, query }, search: query };
}

/** A Search page link listing the jobs that ask for a skill. */
export function skillSearchUrl(name: string): string {
  return `/search?${queryToParams({ q: name }).toString()}`;
}

export interface LevelRow {
  key: 'above' | 'at' | 'below';
  label: string;
  count: number;
  /** Share of the jobs that state a level, 0–100. */
  share: number;
}

/** Above, at and below your level, as shares of the jobs that state one. Empty when nothing compares. */
export function levelRows(level: LevelFit): LevelRow[] {
  const known = level.above + level.at + level.below;
  if (known === 0) return [];
  const share = (n: number) => Math.round((n * 100) / known);
  return [
    { key: 'above', label: 'Above your level', count: level.above, share: share(level.above) },
    { key: 'at', label: 'At your level', count: level.at, share: share(level.at) },
    { key: 'below', label: 'Below your level', count: level.below, share: share(level.below) },
  ];
}

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Whether the profile already lists the skill or certification (by name, ignoring case and accents). */
export function profileHas(profile: Profile | undefined, item: Pick<GapItem, 'name' | 'kind'>): boolean {
  if (!profile) return false;
  const list = item.kind === 'certification' ? profile.preferences.certifications : profile.preferences.skills;
  const key = fold(item.name);
  return list.some((s) => fold(s) === key);
}

/** The profile edit that adds a skill to the skills list, or a certification to the certifications. */
export function addToProfilePatch(profile: Profile, item: Pick<GapItem, 'name' | 'kind'>): ProfilePatch {
  const { skills, certifications } = profile.preferences;
  if (profileHas(profile, item)) return {};
  return item.kind === 'certification'
    ? { preferences: { certifications: [...certifications, item.name] } }
    : { preferences: { skills: [...skills, item.name] } };
}

export interface RecommendationLink {
  to: string;
  label: string;
}

/** Where a recommendation is acted on, when that is another page. */
export function recommendationLink(rec: GapRecommendation): RecommendationLink | undefined {
  switch (rec.kind) {
    case 'add-resume':
      return { to: '/profile#resume', label: 'Add your résumé' };
    case 'add-skills':
    case 'add-targets':
      return { to: '/profile#preferences', label: 'Edit your profile' };
    case 'add-experience':
    case 'level-above':
      return { to: '/profile#work', label: 'Edit your experience' };
    case 'resume-skills':
      return { to: '/resume', label: 'Open Résumé review' };
    default:
      return undefined;
  }
}

/** "+6", rounded to whole points; at least +1 for any rise. */
export function formatGain(gain: number): string {
  return gain > 0 ? `+${Math.max(1, Math.round(gain))}` : '±0';
}
