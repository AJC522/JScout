/** How the search was understood, with switches to widen it: similar titles, related roles and broaden chips. */
import { Info, ListTree, Plus, Sparkles } from 'lucide-react';
import type { BroadenSuggestion, SearchQuery, SearchResponse } from '../../../shared/types';
import { Chip, Popover, PopoverContent, PopoverTrigger, Skeleton, Switch } from '../../components/ui';
import { pluralize } from '../../lib/format';
import { broadenChips, gainLabel, relatedRoleChips, summaryParts } from './summary';
import { applyPatch } from './url-state';

export interface InterpretationBarProps {
  query: SearchQuery;
  response: SearchResponse | undefined;
  onChange: (next: SearchQuery, label?: string) => void;
}

export function InterpretationBar({ query, response, onChange }: InterpretationBarProps) {
  if (!response) {
    return (
      <div className="flex h-7 items-center" aria-hidden="true">
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
    );
  }
  const { interpretation, total, suggestions } = response;
  const parts = summaryParts(total, interpretation, query);
  const synonymsOn = query.synonyms !== false;
  const related = relatedRoleChips(interpretation.titles, suggestions, query);
  const titles = interpretation.titles;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 text-sm text-muted" aria-live="polite">
          {parts.map((part, i) => (
            <span key={i}>
              {i > 0 ? <span className="px-1.5 text-subtle">·</span> : null}
              <span className={i === 0 ? 'font-semibold text-fg' : undefined}>{part}</span>
            </span>
          ))}
        </p>
        {interpretation.role || query.synonyms === false ? (
          <div className="flex items-center gap-1">
            <Switch size="sm" label="Similar titles" checked={synonymsOn} onCheckedChange={(on) => onChange(applyPatch(query, { synonyms: on }))} />
            {titles.length > 0 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-hover">
                    <ListTree className="size-3.5" aria-hidden="true" />
                    {pluralize(titles.length, 'title')}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72">
                  <p className="text-sm font-medium text-fg">Titles searched</p>
                  <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
                    {titles.map((t) => (
                      <li key={`${t.via}:${t.title}`} className="flex items-center justify-between gap-2">
                        <span className="truncate text-fg">{t.title}</span>
                        <span className="shrink-0 text-xs text-subtle">{t.via === 'query' ? 'you typed' : t.via === 'synonym' ? 'same role' : 'related'}</span>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
        ) : null}
      </div>

      {interpretation.placeUnresolved ? (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          Couldn't find “{query.location}” on the map, so jobs mentioning it are shown instead.
        </p>
      ) : null}

      {related.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Related roles">
          <span className="mr-0.5 text-xs text-subtle">Related roles</span>
          {related.map((chip) => (
            <Chip
              key={chip.roleId}
              size="sm"
              tone="primary"
              selected={chip.selected}
              count={!chip.selected && chip.extra ? `+${chip.extra}` : undefined}
              onSelectedChange={() => onChange(applyPatch(query, chip.patch), chip.selected ? undefined : `Added ${chip.label}`)}
            >
              {chip.label}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One-click ways to widen the search, labelled with what they add. */
export function BroadenChips({ query, suggestions, onChange }: { query: SearchQuery; suggestions: readonly BroadenSuggestion[]; onChange: InterpretationBarProps['onChange'] }) {
  const chips = broadenChips(suggestions);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Widen your search">
      <span className="mr-0.5 inline-flex items-center gap-1 text-xs text-subtle">
        <Sparkles className="size-3.5" aria-hidden="true" />
        Widen
      </span>
      {chips.map((s) => (
        <button
          key={s.id}
          type="button"
          title={s.description}
          onClick={() => onChange(applyPatch(query, s.patch), s.label)}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-strong bg-surface px-2.5 text-xs text-fg transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <Plus className="size-3.5 text-subtle" aria-hidden="true" />
          {s.label}
          {gainLabel(s.extraResults) ? <span className="font-semibold text-primary tabular-nums">{gainLabel(s.extraResults)}</span> : null}
        </button>
      ))}
    </div>
  );
}
