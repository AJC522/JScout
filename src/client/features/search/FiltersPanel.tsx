/** Filter controls. Every change produces a new query; counts come from the (disjunctive) facets. */
import { useState, type ReactNode } from 'react';
import { EMPLOYMENT_LABELS, EMPLOYMENT_TYPES, POSTED_WITHIN_OPTIONS, REMOTE_LABELS, REMOTE_MODES, SENIORITY_LABELS, SENIORITY_ORDER } from '../../../shared/constants';
import type { FacetCount, SearchFacets, SearchQuery } from '../../../shared/types';
import { api } from '../../api/client';
import { Button, Checkbox, Input, Select, Switch, TagInput } from '../../components/ui';
import { formatNumber } from '../../lib/format';
import { applyPatch, clearFilters, countActiveFilters } from './url-state';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'INR', 'SEK', 'NOK', 'DKK', 'PLN', 'NZD', 'SGD', 'JPY', 'BRL'];
const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c, label: c }));

const loadCompanies = async (q: string, signal: AbortSignal) =>
  (await api('GET /api/suggest/companies', { query: { q, limit: 8 }, signal })).map((c) => c.name);

interface Option {
  value: string;
  label: string;
}

function countOf(facet: readonly FacetCount[] | undefined, value: string): number | undefined {
  if (!facet) return undefined;
  return facet.find((f) => f.value === value)?.count ?? 0;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-border pt-3.5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-2 w-full text-xs font-semibold tracking-wide text-subtle uppercase">{title}</legend>
      <div className="clear-left">{children}</div>
    </fieldset>
  );
}

/**
 * Checkbox list with counts. Options with no matches are tucked away (unless selected) so the
 * list stays short; facets are disjunctive, so a group's counts do not collapse when one is picked.
 */
function CheckList({ options, selected, facet, onChange }: { options: Option[]; selected: readonly string[]; facet?: readonly FacetCount[]; onChange: (next: string[]) => void }) {
  const [showAll, setShowAll] = useState(false);
  const visible = options.filter((o) => showAll || !facet || selected.includes(o.value) || (countOf(facet, o.value) ?? 0) > 0);
  const hiddenCount = options.length - visible.length;
  return (
    <ul className="space-y-0.5">
      {visible.map((option) => {
        const checked = selected.includes(option.value);
        const count = countOf(facet, option.value);
        return (
          <li key={option.value}>
            <label className="flex cursor-pointer items-center gap-2 rounded-control px-1 py-1 text-sm text-fg hover:bg-hover">
              <Checkbox
                checked={checked}
                onCheckedChange={(on) => onChange(on === true ? [...selected, option.value] : selected.filter((v) => v !== option.value))}
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {count !== undefined ? <span className="text-xs text-subtle tabular-nums">{formatNumber(count)}</span> : null}
            </label>
          </li>
        );
      })}
      {hiddenCount > 0 || showAll ? (
        <li>
          <button type="button" onClick={() => setShowAll((v) => !v)} className="px-1 py-1 text-xs font-medium text-primary hover:underline">
            {showAll ? 'Show fewer' : `Show ${hiddenCount} more`}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function SalaryFilter({ query, onChange }: { query: SearchQuery; onChange: (next: SearchQuery) => void }) {
  const [text, setText] = useState(query.salaryMin ? String(query.salaryMin) : '');
  const [synced, setSynced] = useState(query.salaryMin);
  if (synced !== query.salaryMin) {
    setSynced(query.salaryMin);
    setText(query.salaryMin ? String(query.salaryMin) : '');
  }
  const commit = () => {
    const value = Number(text.replace(/[^\d.]/g, ''));
    const next = Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
    if (next !== query.salaryMin) onChange(applyPatch(query, { salaryMin: next, salaryCurrency: query.salaryCurrency ?? 'USD' }));
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          aria-label="Minimum yearly salary"
          inputMode="numeric"
          placeholder="Minimum per year"
          size="sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          wrapperClassName="min-w-0 flex-1"
        />
        <Select
          aria-label="Currency"
          size="sm"
          options={CURRENCY_OPTIONS}
          value={query.salaryCurrency ?? 'USD'}
          onChange={(e) => onChange(applyPatch(query, { salaryCurrency: e.target.value }))}
          disabled={!query.salaryMin}
          wrapperClassName="w-22"
        />
      </div>
      {query.salaryMin ? (
        <Checkbox
          label="Include jobs without a salary"
          checked={query.includeNoSalary !== false}
          onCheckedChange={(on) => onChange(applyPatch(query, { includeNoSalary: on === true }))}
          className="text-sm"
        />
      ) : null}
    </div>
  );
}

export interface FiltersPanelProps {
  query: SearchQuery;
  facets?: SearchFacets;
  onChange: (next: SearchQuery) => void;
}

export function FiltersPanel({ query, facets, onChange }: FiltersPanelProps) {
  const set = (patch: Partial<SearchQuery>) => onChange(applyPatch(query, patch));
  const active = countActiveFilters(query);

  const postedOptions = [
    { value: '', label: 'Any time' },
    ...POSTED_WITHIN_OPTIONS.map((o) => {
      const count = countOf(facets?.postedWithin, String(o.days));
      return { value: String(o.days), label: count === undefined ? o.label : `${o.label} (${formatNumber(count)})` };
    }),
  ];
  const sourceOptions: Option[] = [
    ...(facets?.source ?? []).map((f) => ({ value: f.value, label: f.label })),
    // Selected sources with no matches still need a box to untick.
    ...(query.sources ?? []).filter((s) => !facets?.source.some((f) => f.value === s)).map((s) => ({ value: s, label: s })),
  ];

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">Filters{active > 0 ? <span className="ml-1.5 text-muted">({active})</span> : null}</h2>
        <Button size="sm" variant="link" onClick={() => onChange(clearFilters(query))} disabled={active === 0}>
          Clear all
        </Button>
      </div>

      <Group title="Work arrangement">
        <CheckList
          options={REMOTE_MODES.map((m) => ({ value: m, label: REMOTE_LABELS[m] }))}
          selected={query.remote ?? []}
          facet={facets?.remote}
          onChange={(remote) => set({ remote: remote as SearchQuery['remote'] })}
        />
      </Group>

      <Group title="Posted">
        <Select
          aria-label="Posted within"
          size="sm"
          options={postedOptions}
          value={query.postedWithinDays ? String(query.postedWithinDays) : ''}
          onChange={(e) => set({ postedWithinDays: e.target.value ? Number(e.target.value) : undefined })}
        />
      </Group>

      <Group title="Salary">
        <SalaryFilter query={query} onChange={onChange} />
      </Group>

      <Group title="Job type">
        <CheckList
          options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_LABELS[t] }))}
          selected={query.employmentTypes ?? []}
          facet={facets?.employmentType}
          onChange={(employmentTypes) => set({ employmentTypes: employmentTypes as SearchQuery['employmentTypes'] })}
        />
      </Group>

      <Group title="Seniority">
        <CheckList
          options={[...SENIORITY_ORDER, 'unknown' as const].map((s) => ({ value: s, label: SENIORITY_LABELS[s] }))}
          selected={query.seniority ?? []}
          facet={facets?.seniority}
          onChange={(seniority) => set({ seniority: seniority as SearchQuery['seniority'] })}
        />
      </Group>

      {sourceOptions.length > 0 ? (
        <Group title="Sources">
          <CheckList options={sourceOptions} selected={query.sources ?? []} facet={facets?.source} onChange={(sources) => set({ sources })} />
        </Group>
      ) : null}

      <Group title="Companies">
        <div className="space-y-2">
          <TagInput aria-label="Only these companies" placeholder="Only these companies…" value={query.companies ?? []} onChange={(companies) => set({ companies })} loadSuggestions={loadCompanies} />
          <TagInput aria-label="Never show these companies" placeholder="Never show…" value={query.excludeCompanies ?? []} onChange={(excludeCompanies) => set({ excludeCompanies })} loadSuggestions={loadCompanies} />
        </div>
      </Group>

      <Group title="Leave out words">
        <TagInput aria-label="Leave out jobs mentioning" placeholder="e.g. clearance, sales" value={query.excludeTerms ?? []} onChange={(excludeTerms) => set({ excludeTerms })} />
      </Group>

      <Group title="Also show">
        <div className="space-y-2.5">
          <Switch size="sm" label="Jobs I've hidden" checked={query.includeHidden === true} onCheckedChange={(on) => set({ includeHidden: on })} />
          <Switch size="sm" label="Closed jobs" checked={query.includeClosed === true} onCheckedChange={(on) => set({ includeClosed: on })} />
          <Switch size="sm" label="Jobs I've applied to" checked={query.includeApplied !== false} onCheckedChange={(on) => set({ includeApplied: on })} />
        </div>
      </Group>
    </div>
  );
}
