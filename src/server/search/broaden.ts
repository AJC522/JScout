/**
 * "Widen this search" suggestions: candidate patches, each counted with the fast count path,
 * kept only when they really add results, ordered by gain and then by how small the change is.
 */
import { RADIUS_OPTIONS_KM, SENIORITY_LABELS, SENIORITY_ORDER } from '../../shared/constants';
import type { BroadenKind, BroadenSuggestion, SearchQuery, Seniority } from '../../shared/types';
import { resolvePlace } from '../lib/location';
import { getRole, type RoleRef } from '../lib/titles';
import type { SearchPlan } from './plan';
import { formatQuery } from './query-parse';

export interface BroadenCandidate {
  id: string;
  kind: BroadenKind;
  label: string;
  description: string;
  patch: Partial<SearchQuery>;
  /** How big a change this is (smaller first among equal gains). */
  cost: number;
  /** Synonym/related-role suggestions: still offered when the search already has plenty of results. */
  cheap: boolean;
}

export const MAX_SUGGESTIONS = 6;
/** Below this many results every kind of widening is considered. */
export const FEW_RESULTS = 25;
const RELATED_SHOWN = 3;
const DATE_WINDOWS = [1, 3, 7, 14, 30, 90, 365] as const;

const list = (names: string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

function roleCandidates(query: SearchQuery, plan: SearchPlan): BroadenCandidate[] {
  const out: BroadenCandidate[] = [];
  const role = plan.understanding.role;
  if (!role) return out;
  if (query.synonyms === false && plan.understanding.titleOnly) {
    const examples = [role.title, ...role.aliases].slice(0, 2).map((t) => `“${t}”`).join(' or ');
    out.push({
      id: 'synonyms', kind: 'synonyms', label: 'Include similar titles', cost: 0, cheap: true, patch: { synonyms: true },
      description: `Also match titles that mean the same, such as ${examples}.`,
    });
  }
  const chosen = new Set(query.relatedRoles ?? []);
  const available = role.related.map(getRole).filter((r): r is RoleRef => r !== undefined && !chosen.has(r.id));
  for (const r of available.slice(0, RELATED_SHOWN)) {
    out.push({
      id: `related-role:${r.id}`, kind: 'related-role', label: `Add “${r.title}”`, cost: 1, cheap: true,
      patch: { relatedRoles: [...chosen, r.id] },
      description: `Also show ${r.title} roles, which are closely related to ${role.title}.`,
    });
  }
  if (available.length > 1) {
    out.push({
      // Not "cheap": its expression is the union of every related role's titles, the slowest count here.
      id: 'all-related-roles', kind: 'all-related-roles', label: 'Add all related roles', cost: 2, cheap: false,
      patch: { relatedRoles: [...chosen, ...available.map((r) => r.id)] },
      description: `Also show ${list(available.slice(0, 4).map((r) => r.title))}${available.length > 4 ? ' and more' : ''}.`,
    });
  }
  return out;
}

function locationCandidates(query: SearchQuery, plan: SearchPlan): BroadenCandidate[] {
  const out: BroadenCandidate[] = [];
  const place = plan.location.place;
  if (!query.location?.trim()) return out;
  if (place && place.kind !== 'anywhere') {
    if (!plan.opts.includeRemote) {
      out.push({
        id: 'include-remote', kind: 'include-remote', label: 'Include remote jobs', cost: 1, cheap: false, patch: { includeRemote: true },
        description: `Also show remote jobs that can be done from ${place.label}.`,
      });
    }
    if (place.kind === 'city') {
      const next = RADIUS_OPTIONS_KM.find((r) => r > plan.opts.radiusKm);
      if (next !== undefined) {
        out.push({
          id: `radius:${next}`, kind: 'radius', label: `Within ${next} km`, cost: 1, cheap: false, patch: { radiusKm: next },
          description: `Widen the search to ${next} km around ${place.label}.`,
        });
      }
    }
    const wider = widerArea(place);
    if (wider) {
      out.push({
        id: 'wider-area', kind: 'wider-area', label: `Anywhere in ${wider}`, cost: 3, cheap: false, patch: { location: wider },
        description: `Search all of ${wider} instead of ${place.label}.`,
      });
    }
  }
  out.push({
    id: 'drop-location', kind: 'drop-location', label: 'Any location', cost: 4, cheap: false, patch: { location: '' },
    description: 'Remove the location filter and search everywhere.',
  });
  return out;
}

/** City -> its state/province -> its country; state -> country. Only areas that resolve back to themselves. */
function widerArea(place: NonNullable<SearchPlan['location']['place']>): string | undefined {
  const country = place.countryName;
  if (place.kind === 'city' && place.admin1Name && country) {
    const text = `${place.admin1Name}, ${country}`;
    if (resolvePlace(text)?.kind === 'admin1') return text;
  }
  if ((place.kind === 'city' || place.kind === 'admin1') && country && resolvePlace(country)?.kind === 'country') return country;
  return undefined;
}

function filterCandidates(query: SearchQuery, plan: SearchPlan, maxPostingAgeDays: number): BroadenCandidate[] {
  const out: BroadenCandidate[] = [];
  if (plan.understanding.titleOnly && plan.understanding.match) {
    out.push({
      id: 'any-keyword-position', kind: 'any-keyword-position', label: 'Search keywords anywhere', cost: 2, cheap: false,
      patch: { titleOnly: false }, description: 'Match your keywords anywhere in the posting, not only in the job title.',
    });
  }
  const currentDays = query.postedWithinDays ?? (maxPostingAgeDays > 0 ? maxPostingAgeDays : undefined);
  const nextDays = currentDays === undefined ? undefined : DATE_WINDOWS.find((d) => d > currentDays);
  if (nextDays !== undefined) {
    out.push({
      id: `date:${nextDays}`, kind: 'date', label: `Posted within ${nextDays} days`, cost: 1, cheap: false, patch: { postedWithinDays: nextDays },
      description: `Include postings from the last ${nextDays} days.`,
    });
  }
  if (query.salaryMin !== undefined && query.salaryMin > 0) {
    if (query.includeNoSalary === false) {
      out.push({
        id: 'salary:no-salary', kind: 'salary', label: 'Include jobs without a salary', cost: 1, cheap: false, patch: { includeNoSalary: true },
        description: 'Also show postings that do not state a salary.',
      });
    }
    const lower = Math.floor((query.salaryMin * 0.8) / 1000) * 1000;
    if (lower > 0) {
      out.push({
        id: 'salary:lower', kind: 'salary', label: `Minimum ${lower.toLocaleString('en-US')}`, cost: 2, cheap: false, patch: { salaryMin: lower },
        description: `Lower the minimum salary by 20% to ${lower.toLocaleString('en-US')} ${plan.salaryCurrency}.`,
      });
    }
  }
  const levels = (query.seniority ?? []).filter((s): s is Seniority => s !== 'unknown');
  if (levels.length) {
    const adjacent = new Set<Seniority>();
    for (const s of levels) {
      const i = SENIORITY_ORDER.indexOf(s);
      for (const n of [SENIORITY_ORDER[i - 1], SENIORITY_ORDER[i + 1]]) if (n && !query.seniority?.includes(n)) adjacent.add(n);
    }
    if (adjacent.size) {
      const names = [...adjacent].map((s) => SENIORITY_LABELS[s]);
      out.push({
        id: 'seniority', kind: 'seniority', label: `Include ${list(names)}`, cost: 2, cheap: false,
        patch: { seniority: [...(query.seniority ?? []), ...adjacent] }, description: `Also show ${list(names)} roles.`,
      });
    }
  }
  if (query.employmentTypes?.length) {
    out.push({
      id: 'employment-type', kind: 'employment-type', label: 'Any employment type', cost: 3, cheap: false, patch: { employmentTypes: [] },
      description: 'Show full-time, part-time, contract and other types.',
    });
  }
  if (query.clearance?.length) {
    const selected = query.clearance;
    if (selected.includes('active')) {
      out.push({
        id: 'clearance', kind: 'clearance', label: 'Any clearance requirement', cost: 3, cheap: false, patch: { clearance: [] },
        description: 'Show jobs whatever they ask for in the way of a security clearance.',
      });
    } else {
      // Never widen into "must already hold one": someone who left it out has no clearance to bring.
      const wider = (['none', 'preferred', 'sponsored', 'required'] as const).filter((c) => !selected.includes(c));
      if (wider.length) {
        const unclearOnly = wider.length === 1 && wider[0] === 'required';
        out.push({
          id: 'clearance', kind: 'clearance', cost: 3, cheap: false, patch: { clearance: [...selected, ...wider] },
          label: unclearOnly ? 'Include “clearance required” jobs' : 'Any job you can get without a clearance of your own',
          description: unclearOnly
            ? 'Also show jobs that need a clearance but don’t say whether they sponsor it.'
            : 'Also show jobs that need no clearance, prefer one, or sponsor one.',
        });
      }
    }
  }
  if (query.remote?.length) {
    out.push({
      id: 'work-mode', kind: 'work-mode', label: 'Any work arrangement', cost: 3, cheap: false, patch: { remote: [] },
      description: 'Show remote, hybrid and on-site jobs.',
    });
  }
  const parsed = plan.understanding.parsed;
  if (parsed.excluded.length || query.excludeTerms?.length || query.excludeCompanies?.length) {
    const patch: Partial<SearchQuery> = { excludeTerms: [], excludeCompanies: [] };
    if (parsed.excluded.length) patch.q = formatQuery(parsed, { withExclusions: false });
    out.push({
      id: 'drop-exclusions', kind: 'drop-exclusions', label: 'Remove exclusions', cost: 3, cheap: false, patch,
      description: 'Stop excluding the words and companies you filtered out.',
    });
  }
  return out;
}

export function broadenCandidates(query: SearchQuery, plan: SearchPlan, maxPostingAgeDays: number): BroadenCandidate[] {
  return [...roleCandidates(query, plan), ...locationCandidates(query, plan), ...filterCandidates(query, plan, maxPostingAgeDays)];
}

/**
 * Count each candidate (all of them when results are few, only the cheap role ones otherwise),
 * keep those that add results and return the most useful.
 */
export function rankSuggestions(
  candidates: BroadenCandidate[],
  total: number,
  countPatched: (patch: Partial<SearchQuery>) => number,
): BroadenSuggestion[] {
  const considered = total < FEW_RESULTS ? candidates : candidates.filter((c) => c.cheap);
  return considered
    .map((c) => ({ c, extra: countPatched(c.patch) - total }))
    .filter(({ extra }) => extra > 0)
    .sort((a, b) => b.extra - a.extra || a.c.cost - b.c.cost)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ c, extra }) => ({ id: c.id, kind: c.kind, label: c.label, description: c.description, patch: c.patch, extraResults: extra }));
}
