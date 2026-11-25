/** The "what" and "where" boxes, radius, work arrangement and the Search button. */
import { useRef, useState, type FormEvent, type Ref } from 'react';
import { CircleHelp, Globe, Laptop, MapPin, Search } from 'lucide-react';
import { RADIUS_OPTIONS_KM, REMOTE_LABELS } from '../../../shared/constants';
import type { Place, RemoteMode, SearchQuery, TitleSuggestion } from '../../../shared/types';
import { api } from '../../api/client';
import { Button, Chip, Combobox, HighlightMatch, IconButton, Popover, PopoverContent, PopoverTrigger, Select } from '../../components/ui';
import { formatCompactNumber } from '../../lib/format';
import { applyPatch } from './url-state';

const ARRANGEMENTS: RemoteMode[] = ['remote', 'hybrid', 'onsite'];
const SUGGEST_LIMIT = 8;
const RADIUS_OPTIONS = RADIUS_OPTIONS_KM.map((km) => ({ value: String(km), label: km === 0 ? 'City only' : `Within ${km} km` }));

type WhereOption = { kind: 'remote' } | { kind: 'anywhere' } | { kind: 'place'; place: Place };

const REMOTE_OPTION: WhereOption = { kind: 'remote' };
const ANYWHERE_OPTION: WhereOption = { kind: 'anywhere' };

function whereLabel(option: WhereOption): string {
  if (option.kind === 'remote') return 'Remote';
  if (option.kind === 'anywhere') return 'Anywhere';
  return option.place.label;
}

const loadTitles = (q: string, signal: AbortSignal) => api('GET /api/suggest/titles', { query: { q, limit: SUGGEST_LIMIT }, signal });

async function loadPlaces(q: string, signal: AbortSignal): Promise<WhereOption[]> {
  const text = q.trim().toLowerCase();
  const fixed = [REMOTE_OPTION, ANYWHERE_OPTION].filter((o) => whereLabel(o).toLowerCase().startsWith(text));
  if (!text) return fixed;
  const places = await api('GET /api/suggest/locations', { query: { q, limit: SUGGEST_LIMIT }, signal });
  return [...fixed, ...places.filter((p) => p.kind !== 'anywhere').map((place): WhereOption => ({ kind: 'place', place }))];
}

/** Turns the "where" text into query fields: "Remote" and "Anywhere" are not places. */
function wherePatch(text: string, query: SearchQuery): Partial<SearchQuery> {
  const where = text.trim();
  const lower = where.toLowerCase();
  if (lower === 'remote' || lower === 'remote only') return { location: undefined, remote: ['remote'] };
  if (['anywhere', 'worldwide', 'everywhere'].includes(lower)) return { location: undefined };
  return { location: where || undefined, remote: query.remote };
}

export interface SearchBarProps {
  query: SearchQuery;
  /** How the server understood the current location (to offer a radius around a city). */
  resolvedPlace?: Place;
  onSearch: (next: SearchQuery) => void;
  whatRef?: Ref<HTMLInputElement>;
}

export function SearchBar({ query, resolvedPlace, onSearch, whatRef }: SearchBarProps) {
  const [what, setWhat] = useState(query.q);
  const [where, setWhere] = useState(query.location ?? '');
  const [radius, setRadius] = useState(query.radiusKm ?? 0);
  /** The place picked from the list, so a radius can be offered before searching. */
  const [picked, setPicked] = useState<Place | null>(null);
  const whereRef = useRef<HTMLInputElement>(null);

  // Follow the URL (back/forward, a broaden chip) without fighting the user's typing in between.
  const [synced, setSynced] = useState({ q: query.q, location: query.location, radiusKm: query.radiusKm });
  if (synced.q !== query.q || synced.location !== query.location || synced.radiusKm !== query.radiusKm) {
    setSynced({ q: query.q, location: query.location, radiusKm: query.radiusKm });
    setWhat(query.q);
    setWhere(query.location ?? '');
    setRadius(query.radiusKm ?? 0);
  }

  const cityPlace =
    picked?.kind === 'city' && picked.label === where
      ? picked
      : resolvedPlace?.kind === 'city' && where.trim() !== '' && where === query.location
        ? resolvedPlace
        : null;

  const submit = (overrides: { what?: string; where?: string; remote?: RemoteMode[]; radius?: number } = {}) => {
    const q = (overrides.what ?? what).trim();
    const location = wherePatch(overrides.where ?? where, { ...query, remote: overrides.remote ?? query.remote });
    const titleChanged = q !== query.q;
    onSearch(
      applyPatch(query, {
        q,
        ...location,
        radiusKm: overrides.radius ?? (cityPlace ? radius : undefined),
        // Related roles and the title-only switch belong to the old title.
        ...(titleChanged ? { relatedRoles: undefined, titleOnly: undefined } : {}),
      }),
    );
  };

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const toggleArrangement = (mode: RemoteMode, on: boolean) => {
    const current = query.remote ?? [];
    submit({ remote: on ? [...current, mode] : current.filter((m) => m !== mode) });
  };

  return (
    <form role="search" onSubmit={onFormSubmit} className="rounded-card border border-border bg-surface p-3 shadow-xs sm:p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-[1.4]">
          <Combobox<TitleSuggestion>
            ref={whatRef}
            aria-label="What: job title or keywords"
            value={what}
            onValueChange={setWhat}
            loadOptions={loadTitles}
            getOptionLabel={(s) => s.title}
            getOptionKey={(s) => `${s.roleId ?? ''}:${s.title}`}
            renderOption={(s, { query: typed }) => (
              <span className="flex w-full items-center gap-3">
                <span className="min-w-0 flex-1 truncate">
                  <HighlightMatch text={s.title} query={typed} />{' '}
                  {s.family ? <span className="ml-2 text-xs text-subtle">{s.family}</span> : null}
                </span>{' '}
                {s.count > 0 ? <span className="shrink-0 text-xs text-muted tabular-nums">{formatCompactNumber(s.count)} open</span> : null}
              </span>
            )}
            onSelect={(s) => submit({ what: s.title })}
            placeholder="Job title or keywords"
            leadingIcon={<Search />}
            size="lg"
            className="pr-9"
          />
          <SyntaxHelp />
        </div>
        <div className="min-w-0 flex-1">
          <Combobox<WhereOption>
            ref={whereRef}
            aria-label="Where: city, region or country"
            value={where}
            onValueChange={(text) => {
              setWhere(text);
              if (picked && text !== picked.label) setPicked(null);
            }}
            loadOptions={loadPlaces}
            minChars={0}
            getOptionLabel={whereLabel}
            getOptionKey={(o) => (o.kind === 'place' ? `${o.place.kind}:${o.place.label}` : o.kind)}
            renderOption={(o, { query: typed }) => (
              <span className="flex w-full items-center gap-2">
                {o.kind === 'place' ? <MapPin className="size-4 shrink-0 text-subtle" /> : o.kind === 'remote' ? <Laptop className="size-4 shrink-0 text-subtle" /> : <Globe className="size-4 shrink-0 text-subtle" />}
                <span className="min-w-0 flex-1 truncate">
                  <HighlightMatch text={whereLabel(o)} query={typed} />
                </span>
                {o.kind === 'place' && o.place.kind !== 'city' ? <span className="shrink-0 text-xs text-subtle">{PLACE_KIND_LABEL[o.place.kind]}</span> : null}
              </span>
            )}
            onSelect={(o) => {
              if (o.kind === 'place') setPicked(o.place);
              // A city keeps the user's radius choice open; anything else searches straight away.
              if (o.kind !== 'place' || o.place.kind !== 'city') submit({ where: whereLabel(o) });
            }}
            placeholder="Anywhere"
            leadingIcon={<MapPin />}
            size="lg"
          />
        </div>
        {cityPlace ? (
          <Select
            aria-label="Distance from the city"
            size="lg"
            options={RADIUS_OPTIONS}
            value={String(RADIUS_OPTIONS_KM.includes(radius as (typeof RADIUS_OPTIONS_KM)[number]) ? radius : 0)}
            onChange={(e) => {
              const km = Number(e.target.value);
              setRadius(km);
              // Around the place already searched, a new distance applies at once.
              if (where === query.location) submit({ radius: km });
            }}
            wrapperClassName="md:w-40"
          />
        ) : null}
        <Button type="submit" variant="primary" size="lg" leadingIcon={<Search />} className="md:px-5">
          Search
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Work arrangement">
        {ARRANGEMENTS.map((mode) => (
          <Chip key={mode} size="sm" selected={query.remote?.includes(mode) ?? false} onSelectedChange={(on) => toggleArrangement(mode, on)}>
            {REMOTE_LABELS[mode]}
          </Chip>
        ))}
      </div>
    </form>
  );
}

const PLACE_KIND_LABEL: Record<Place['kind'], string> = {
  city: 'City',
  admin1: 'State or region',
  country: 'Country',
  region: 'Hiring region',
  anywhere: 'Anywhere',
  unknown: '',
};

const SYNTAX_EXAMPLES: Array<[string, string]> = [
  ['product designer, ux designer', 'Commas: any of these titles'],
  ['"data engineer"', 'Quotes: this exact phrase'],
  ['python OR golang', 'OR: either word'],
  ['engineer -manager', 'Minus: leave out jobs with this word'],
];

function SyntaxHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Search tips" icon={<CircleHelp />} size="sm" className="absolute top-1/2 right-1.5 -translate-y-1/2" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-medium text-fg">Search tips</p>
        <dl className="mt-2 space-y-2 text-sm">
          {SYNTAX_EXAMPLES.map(([example, meaning]) => (
            <div key={example}>
              <dt>
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">{example}</code>
              </dt>
              <dd className="mt-0.5 text-muted">{meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-subtle">Similar titles are included automatically. You can switch that off under the search box.</p>
      </PopoverContent>
    </Popover>
  );
}
