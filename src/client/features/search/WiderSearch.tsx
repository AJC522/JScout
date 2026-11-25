/**
 * What the results area shows when a search finds little or nothing: the broaden suggestions as
 * the main content, links to run the same search elsewhere, and (with filters on) a way out.
 */
import { ArrowUpRight, SearchX, Sparkles } from 'lucide-react';
import type { BroadenSuggestion, ExternalSearchLink, SearchQuery } from '../../../shared/types';
import { Button } from '../../components/ui';
import { broadenChips, gainLabel, isUseful } from './summary';
import { applyPatch, clearFilters, countActiveFilters } from './url-state';

export interface WiderSearchProps {
  query: SearchQuery;
  total: number;
  suggestions: readonly BroadenSuggestion[];
  externalLinks: readonly ExternalSearchLink[];
  onChange: (next: SearchQuery, label?: string) => void;
}

export function WiderSearch({ query, total, suggestions, externalLinks, onChange }: WiderSearchProps) {
  // Related roles are offered here too: with few results they are the most useful widening.
  const options = [...suggestions.filter((s) => s.kind === 'related-role' && isUseful(s)), ...broadenChips(suggestions)]
    .toSorted((a, b) => (b.extraResults ?? -1) - (a.extraResults ?? -1))
    .slice(0, 8);
  const filters = countActiveFilters(query);

  return (
    <section aria-labelledby="wider-title" className="rounded-card border border-border bg-surface p-4 sm:p-5">
      {total === 0 ? (
        <div className="mb-4 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
            <SearchX className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="wider-title" className="text-base font-semibold text-fg">
              No jobs match all of that yet
            </h2>
            <p className="mt-0.5 text-sm text-muted">Try one of these, or run the same search on another site.</p>
          </div>
        </div>
      ) : (
        <h2 id="wider-title" className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          Only a few matches. Widen the search?
        </h2>
      )}

      {options.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {options.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onChange(applyPatch(query, s.patch), s.label)}
                className="flex h-full w-full items-start gap-3 rounded-control border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{s.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{s.description}</span>
                </span>
                {gainLabel(s.extraResults) ? <span className="shrink-0 text-sm font-semibold text-primary tabular-nums">{gainLabel(s.extraResults)}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {filters > 0 ? (
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => onChange(clearFilters(query), 'Cleared filters')}>
          Clear all filters
        </Button>
      ) : null}

      {externalLinks.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs text-subtle">Run this search on</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {externalLinks.map((link) => (
              <li key={link.id}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1 rounded-control border border-border px-2.5 text-sm text-fg transition-colors hover:border-strong hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                >
                  {link.name}
                  <ArrowUpRight className="size-3.5 text-subtle" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
