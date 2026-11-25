/** Plain-English descriptions of what a search actually ran, for the interpretation bar. Pure. */
import type { BroadenSuggestion, ExpandedTitle, SearchInterpretation, SearchQuery } from '../../../shared/types';
import { pluralize } from '../../lib/format';

/** "Software Engineer + 6 similar titles", "“react” and “rust”", or "Any job". */
export function describeTitles(interpretation: SearchInterpretation, query: SearchQuery): string {
  const fromQuery = interpretation.titles.filter((t) => t.via === 'query');
  const extra = interpretation.titles.length - fromQuery.length;
  const head = interpretation.role?.title ?? fromQuery[0]?.title;
  if (head) {
    const others = fromQuery.length > 1 ? ` or ${pluralize(fromQuery.length - 1, 'other title')}` : '';
    return extra > 0 ? `${head}${others} + ${pluralize(extra, 'similar title')}` : `${head}${others}`;
  }
  const terms = interpretation.terms.map((t) => `“${t}”`);
  if (terms.length > 0) return terms.length > 3 ? `${terms.slice(0, 3).join(', ')} +${terms.length - 3} more` : terms.join(' and ');
  return query.q.trim() ? query.q.trim() : 'Any job';
}

/** "Austin, TX within 50 km + remote", "Remote only", or "Anywhere". */
export function describePlace(interpretation: SearchInterpretation, query: SearchQuery): string {
  const remote = query.remote ?? [];
  const remoteAllowed = remote.length === 0 || remote.includes('remote');
  if (!query.location) return remote.length === 1 && remote[0] === 'remote' ? 'Remote only' : 'Anywhere';
  const place = interpretation.place;
  const name = place && !interpretation.placeUnresolved ? place.label : query.location;
  const radius = place?.kind === 'city' && query.radiusKm ? ` within ${query.radiusKm} km` : '';
  const plusRemote = query.includeRemote !== false && remoteAllowed ? ' + remote' : '';
  return `${name}${radius}${plusRemote}`;
}

export function summaryParts(total: number, interpretation: SearchInterpretation, query: SearchQuery): string[] {
  const parts = [pluralize(total, 'job'), describeTitles(interpretation, query), describePlace(interpretation, query)];
  if (interpretation.excluded.length > 0) parts.push(`without ${interpretation.excluded.map((t) => `“${t}”`).join(', ')}`);
  return parts;
}

export interface RelatedRoleChip {
  roleId: string;
  label: string;
  /** Already part of the search. */
  selected: boolean;
  /** Extra results it would add (for suggestions only). */
  extra?: number;
  /** The query change that toggles it. */
  patch: Partial<SearchQuery>;
}

/**
 * Related roles the user can switch on or off one at a time: the ones already searched (from
 * the interpretation) followed by the engine's suggestions, de-duplicated by role.
 */
export function relatedRoleChips(titles: readonly ExpandedTitle[], suggestions: readonly BroadenSuggestion[], query: SearchQuery): RelatedRoleChip[] {
  const chosen = query.relatedRoles ?? [];
  const chips: RelatedRoleChip[] = [];
  const seen = new Set<string>();
  for (const title of titles) {
    if (title.via !== 'related' || !title.roleId || seen.has(title.roleId)) continue;
    seen.add(title.roleId);
    const roleId = title.roleId;
    chips.push({ roleId, label: title.title, selected: true, patch: { relatedRoles: chosen.filter((r) => r !== roleId) } });
  }
  // Chosen roles the engine did not echo back still need a way to be switched off.
  for (const roleId of chosen) {
    if (seen.has(roleId)) continue;
    seen.add(roleId);
    chips.push({ roleId, label: roleLabel(roleId), selected: true, patch: { relatedRoles: chosen.filter((r) => r !== roleId) } });
  }
  for (const suggestion of suggestions) {
    if (suggestion.kind !== 'related-role') continue;
    const added = (suggestion.patch.relatedRoles ?? []).filter((r) => !chosen.includes(r));
    const roleId = added[0];
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    chips.push({ roleId, label: suggestion.label, selected: false, extra: suggestion.extraResults, patch: suggestion.patch });
  }
  return chips;
}

/** "site-reliability-engineer" -> "Site reliability engineer", for roles with no title to show. */
export function roleLabel(roleId: string): string {
  const words = roleId.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Broaden chips shown on their own row: everything except related roles (those live in the interpretation bar). */
export function broadenChips(suggestions: readonly BroadenSuggestion[]): BroadenSuggestion[] {
  return suggestions
    .filter((s) => s.kind !== 'related-role' && s.kind !== 'external')
    .toSorted((a, b) => (b.extraResults ?? -1) - (a.extraResults ?? -1));
}

/** "+1,234 jobs" for a suggestion's gain; empty when the engine could not tell. */
export function gainLabel(extra: number | undefined): string {
  if (extra === undefined || extra <= 0) return '';
  return `+${pluralize(extra, 'job')}`;
}
