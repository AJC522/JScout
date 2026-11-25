/**
 * The search page: search bar, interpretation and broaden chips, filters, the virtualised result
 * list and (on wide screens) the job detail beside it. The URL holds the whole state.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, BookmarkPlus, Keyboard, MousePointerClick, SlidersHorizontal } from 'lucide-react';
import type { JobDetail, SearchQuery, SearchResultItem, SearchSort } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { Page } from '../../components/layout/Page';
import { Badge, Button, Drawer, ErrorState, IconButton, Kbd, PageHeader, Select, Spinner, useToast } from '../../components/ui';
import { useBootstrap } from '../../app/bootstrap';
import { useServerEvent, useSyncState } from '../../app/events';
import { cn } from '../../lib/cn';
import { pluralize } from '../../lib/format';
import { useDocumentTitle, useHotkey, useMediaQuery } from '../../lib/hooks';
import { qk } from '../../lib/query';
import { useMarkViewed as useMarkSavedSearchViewed } from '../saved/queries';
import { FiltersPanel } from './FiltersPanel';
import { IndexStatus } from './IndexStatus';
import { BroadenChips, InterpretationBar } from './InterpretationBar';
import { JobDetailView } from './JobDetailView';
import { flattenPages, useSearchResults } from './queries';
import { ResultsList, ResultsSkeleton, type ResultsListHandle } from './ResultsList';
import { SaveSearchDialog } from './SaveSearchDialog';
import { SearchBar } from './SearchBar';
import { cursorReducer } from './selection';
import { ShortcutSheet } from './ShortcutSheet';
import { StartPanel } from './StartPanel';
import { countActiveFilters, isBlankQuery } from './url-state';
import { useJobActions, type JobRef } from './use-job-actions';
import { useSearchUrl } from './use-search-url';
import { useStableCallback } from './use-stable-callback';
import { useVisitBoundary } from './use-visit-boundary';
import { WiderSearch } from './WiderSearch';

/** Below this many results the broaden suggestions become part of the main content. */
const FEW_RESULTS = 10;
const SPLIT_QUERY = '(min-width: 1200px)';
const INLINE_FILTERS_QUERY = '(min-width: 1360px)';
const SORT_OPTIONS: Array<{ value: SearchSort; label: string }> = [
  { value: 'relevance', label: 'Best match' },
  { value: 'date', label: 'Newest' },
  { value: 'salary', label: 'Highest salary' },
];

/** Resolves ?from=profile and ?saved=<id> into a real query in the URL (replacing the entry). */
function useEntryRedirect(from: string | undefined, savedId: string | undefined, setQuery: (q: SearchQuery, o: { replace: boolean }) => void) {
  const toast = useToast();
  const markViewed = useMarkSavedSearchViewed();
  const profile = useQuery({
    queryKey: qk.searchFromProfile(),
    queryFn: ({ signal }) => api('GET /api/search/from-profile', { signal }),
    enabled: from === 'profile',
  });
  const saved = useQuery({
    queryKey: qk.savedSearches(),
    queryFn: ({ signal }) => api('GET /api/saved-searches', { signal }),
    enabled: Boolean(savedId),
  });
  const { mutate: markViewedMutate } = markViewed;

  useEffect(() => {
    if (from !== 'profile') return;
    if (profile.data) setQuery(profile.data, { replace: true });
    else if (profile.isError) {
      toast.error('Could not build a search from your profile', { description: errorMessage(profile.error) });
      setQuery({ q: '' }, { replace: true });
    }
  }, [from, profile.data, profile.isError, profile.error, setQuery, toast]);

  useEffect(() => {
    if (!savedId) return;
    if (saved.data) {
      const match = saved.data.find((s) => s.id === savedId);
      if (match) {
        markViewedMutate(match.id);
        setQuery(match.query, { replace: true });
      } else {
        toast.error('That saved search no longer exists');
        setQuery({ q: '' }, { replace: true });
      }
    } else if (saved.isError) {
      toast.error('Could not open the saved search', { description: errorMessage(saved.error) });
      setQuery({ q: '' }, { replace: true });
    }
  }, [savedId, saved.data, saved.isError, saved.error, markViewedMutate, setQuery, toast]);
}

export function SearchPage() {
  const { query, signature, selectedId, from, savedId, setQuery, selectJob } = useSearchUrl();
  useDocumentTitle(query.q ? `${query.q} jobs` : 'Search');
  useEntryRedirect(from, savedId, setQuery);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const { index, syncing } = useSyncState();
  const split = useMediaQuery(SPLIT_QUERY);
  const filtersInline = useMediaQuery(INLINE_FILTERS_QUERY);
  const whatRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<ResultsListHandle>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [cursorId, setCursorId] = useState<string | null>(selectedId ?? null);
  const [freshJobs, setFreshJobs] = useState(false);

  const blank = isBlankQuery(query);
  const resolving = Boolean(from || savedId);
  const enabled = !blank && !resolving;
  const results = useSearchResults(query, enabled);
  const response = enabled ? results.data?.pages[0] : undefined;
  const updating = results.isPlaceholderData || (results.isFetching && !results.isFetchingNextPage && !results.isPending);

  const items = useMemo(() => {
    const all = flattenPages(results.data);
    return query.includeHidden ? all : all.filter((item) => !item.userState.hidden);
  }, [results.data, query.includeHidden]);
  const ids = useMemo(() => items.map((item) => item.job.id), [items]);
  // Recorded as soon as the query is known, so the badges are there with the first results.
  const newSince = useVisitBoundary(signature, enabled);

  // A new search starts without a cursor or a pending "new jobs" notice.
  const [lastSignature, setLastSignature] = useState(signature);
  if (lastSignature !== signature) {
    setLastSignature(signature);
    setCursorId(null);
    setFreshJobs(false);
  }
  // The cursor follows a selection made elsewhere (a click, back/forward).
  const [lastSelected, setLastSelected] = useState(selectedId);
  if (lastSelected !== selectedId) {
    setLastSelected(selectedId);
    if (selectedId) setCursorId(selectedId);
  }
  // Keep the cursor near its place when the job under it disappears (hidden, or gone after a refresh).
  const [lastIds, setLastIds] = useState(ids);
  if (lastIds !== ids) {
    setLastIds(ids);
    const next = cursorReducer({ id: cursorId }, { type: 'sync', ids, previousIds: lastIds }).id;
    if (next !== cursorId) setCursorId(next);
  }

  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);

  // Never reshuffle what the user is reading: offer a refresh instead. With nothing on screen
  // yet (the first sync), just fetch again.
  const total = response?.total ?? 0;
  const { refetch } = results;
  useServerEvent((event) => {
    if (!enabled || !response) return;
    if (event.type === 'index-changed' || (event.type === 'sync-finished' && event.added > 0)) {
      if (total === 0) void refetch();
      else setFreshJobs(true);
    }
  });
  const refresh = () => {
    setFreshJobs(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    void refetch();
  };

  const actions = useJobActions();
  const findItem = (id: string | null | undefined): SearchResultItem | undefined => (id ? items.find((item) => item.job.id === id) : undefined);
  const selectedItem = findItem(selectedId);

  const onChange = useCallback(
    (next: SearchQuery, label?: string) => {
      setQuery(next);
      // One notice at a time: each widening replaces the last one's undo.
      if (label) toast.info(label, { id: 'search-widened', action: { label: 'Undo', onClick: () => navigate(-1) } });
    },
    [setQuery, toast, navigate],
  );

  const select = useStableCallback((id: string) => {
    setCursorId(id);
    selectJob(id, { push: !split });
  });
  const save = useStableCallback((item: JobRef) => actions.save(item));
  // Hiding the open job moves on to the next one, the way an inbox does.
  const hide = useStableCallback((item: JobRef) => {
    if (!item.userState.hidden && !query.includeHidden && item.job.id === selectedId) {
      const at = ids.indexOf(item.job.id);
      const next = at >= 0 ? (ids[at + 1] ?? ids[at - 1]) : undefined;
      if (split && next) {
        setCursorId(next);
        selectJob(next);
      } else selectJob(undefined);
    }
    actions.hide(item);
  });
  const loadMore = useStableCallback(() => void results.fetchNextPage());
  const pageActions = useMemo(() => ({ ...actions, hide }), [actions, hide]);

  // --- keyboard -------------------------------------------------------------------------
  const active = !blank && items.length > 0;
  const move = (delta: 1 | -1) => {
    // The cursor, not the URL, is the origin: it is already updated when keys repeat quickly.
    const next = cursorReducer({ id: cursorId }, { type: 'move', delta, ids }).id;
    if (!next) return;
    setCursorId(next);
    listRef.current?.scrollToJob(next);
    if (split) selectJob(next);
  };
  // Shortcuts act on the open job (which may have left the list, e.g. once hidden), else on the cursor.
  const target = (): JobRef | undefined =>
    selectedId ? (findItem(selectedId) ?? queryClient.getQueryData<JobDetail>(qk.job(selectedId))) : findItem(cursorId);
  useHotkey('/', () => whatRef.current?.focus());
  useHotkey('?', () => setShortcutsOpen(true));
  useHotkey(['j', 'arrowdown'], () => move(1), { enabled: active });
  useHotkey(['k', 'arrowup'], () => move(-1), { enabled: active });
  useHotkey(
    ['enter', 'o'],
    (event) => {
      // Enter on a focused button or link belongs to that control.
      if (event.key === 'Enter' && (event.target as HTMLElement).closest('a, button, [role="button"], [role="menuitem"]')) return;
      const id = cursorId ?? selectedId;
      if (!id) return;
      event.preventDefault();
      if (split && id === selectedId) navigate(`/jobs/${encodeURIComponent(id)}`);
      else select(id);
    },
    { enabled: active, preventDefault: false },
  );
  useHotkey('s', () => {
    const item = target();
    if (item) save(item);
  }, { enabled: active });
  useHotkey('h', () => {
    const item = target();
    if (item) hide(item);
  }, { enabled: active });
  useHotkey('a', () => {
    const item = target();
    if (item) actions.apply(item);
  }, { enabled: active });
  useHotkey('escape', () => selectJob(undefined), { enabled: Boolean(selectedId) && split });

  // --- rendering ------------------------------------------------------------------------
  const filterCount = countActiveFilters(query);
  const showDetailColumn = split && !blank;
  const showFiltersColumn = filtersInline && !blank;
  const indexLine = index
    ? `${index.openJobs > 0 ? `${pluralize(index.openJobs, 'open job')} at ${pluralize(index.companies, 'company', 'companies')} from ${pluralize(index.sources, 'source')}` : 'No jobs downloaded yet'}${syncing ? ' · updating…' : ''}`
    : undefined;

  const filtersPanel = <FiltersPanel query={query} facets={response?.facets} onChange={(next) => setQuery(next)} />;

  return (
    <Page width="wide">
      <PageHeader
        title="Search"
        description={indexLine}
        actions={
          <>
            <IconButton label="Keyboard shortcuts" tooltip="Keyboard shortcuts (?)" icon={<Keyboard />} onClick={() => setShortcutsOpen(true)} className="max-sm:hidden" />
            <Button leadingIcon={<BookmarkPlus />} onClick={() => setSaveOpen(true)} disabled={blank}>
              Save search
            </Button>
          </>
        }
      />

      <SearchBar query={query} resolvedPlace={response?.interpretation.place} onSearch={(next) => setQuery(next)} whatRef={whatRef} />

      {blank && !resolving ? (
        <div className="mt-6">
          {index && index.openJobs === 0 ? (
            <div className="mx-auto mb-6 max-w-3xl">
              <IndexStatus index={index} />
            </div>
          ) : null}
          <StartPanel onboarded={bootstrap.data?.profile.onboarded ?? false} onRun={(next) => setQuery(next)} />
        </div>
      ) : (
        <>
          <div className={cn('mt-3 space-y-2 transition-opacity', updating && 'opacity-60')}>
            <InterpretationBar query={query} response={response} onChange={onChange} />
            {response && response.total >= FEW_RESULTS ? <BroadenChips query={query} suggestions={response.suggestions} onChange={onChange} /> : null}
          </div>

          <div
            className={cn(
              'mt-4 grid items-start gap-5',
              showFiltersColumn && showDetailColumn && 'grid-cols-[13.5rem_minmax(0,1fr)_minmax(0,1.2fr)]',
              !showFiltersColumn && showDetailColumn && 'grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]',
            )}
          >
            {showFiltersColumn ? (
              <aside aria-label="Filters" className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto pr-1 pb-4">
                {filtersPanel}
              </aside>
            ) : null}

            <section aria-label="Results" className="min-w-0">
              <div className="mb-2.5 flex items-center gap-2">
                {!filtersInline ? (
                  <Button size="sm" leadingIcon={<SlidersHorizontal />} onClick={() => setFiltersOpen(true)}>
                    Filters
                    {filterCount > 0 ? (
                      <Badge tone="primary" variant="solid" size="sm">
                        {filterCount}
                      </Badge>
                    ) : null}
                  </Button>
                ) : null}
                <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-subtle">
                  {updating ? <Spinner size="sm" label="Updating results" /> : response ? `in ${response.tookMs} ms` : null}
                </span>
                <Select
                  aria-label="Sort by"
                  size="sm"
                  options={SORT_OPTIONS}
                  value={query.sort ?? 'relevance'}
                  onChange={(e) => setQuery({ ...query, sort: e.target.value as SearchSort })}
                  wrapperClassName="w-36"
                />
              </div>

              {freshJobs ? (
                <div className="sticky top-3 z-20 mb-2 flex justify-center max-sm:top-16">
                  <Button size="sm" variant="primary" leadingIcon={<ArrowUp />} onClick={refresh} className="rounded-full shadow-overlay">
                    New jobs available — refresh
                  </Button>
                </div>
              ) : null}

              <ResultsArea
                loading={resolving || (results.isPending && enabled)}
                error={results.isError && !results.data ? results.error : null}
                retrying={results.isFetching}
                onRetry={() => void refetch()}
                emptyIndex={index !== undefined && index.openJobs === 0}
                syncing={syncing}
                indexNode={index ? <IndexStatus index={index} /> : null}
              >
                {response ? (
                  <div className={cn('space-y-3 transition-opacity', updating && 'opacity-60')}>
                    {response.total === 0 && syncing ? (
                      <p className="flex items-center gap-2 text-sm text-muted">
                        <Spinner size="sm" label={null} /> Still fetching jobs. Matches will show up here as they arrive.
                      </p>
                    ) : null}
                    {/* With only a few matches, ways to widen the search come first. */}
                    {response.total < FEW_RESULTS ? (
                      <WiderSearch query={query} total={response.total} suggestions={response.suggestions} externalLinks={response.externalLinks} onChange={onChange} />
                    ) : null}
                    {items.length > 0 ? (
                      <ResultsList
                        ref={listRef}
                        items={items}
                        total={response.total}
                        newSince={newSince}
                        selectedId={selectedId}
                        cursorId={cursorId}
                        savingId={actions.savingId}
                        hasMore={Boolean(results.hasNextPage) && !results.isFetchNextPageError}
                        loadingMore={results.isFetchingNextPage}
                        onLoadMore={loadMore}
                        onSelect={select}
                        onSave={save}
                        onHide={hide}
                      />
                    ) : null}
                    {results.isFetchNextPageError ? (
                      <ErrorState compact title="Could not load more jobs" error={results.error} onRetry={loadMore} retrying={results.isFetchingNextPage} />
                    ) : null}
                  </div>
                ) : null}
              </ResultsArea>
            </section>

            {showDetailColumn ? (
              <aside
                ref={detailRef}
                aria-label="Job details"
                className="sticky top-4 h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-card border border-border bg-surface p-5"
              >
                {selectedId ? (
                  <JobDetailView key={selectedId} jobId={selectedId} placeholder={selectedItem} actions={pageActions} variant="panel" onClose={() => selectJob(undefined)} />
                ) : (
                  <DetailHint hasResults={items.length > 0} />
                )}
              </aside>
            ) : null}
          </div>
        </>
      )}

      {!split ? (
        <Drawer
          open={Boolean(selectedId)}
          onOpenChange={(open) => {
            if (!open) selectJob(undefined);
          }}
          size="lg"
          title={selectedItem?.job.title ?? 'Job details'}
          description={selectedItem ? [selectedItem.job.company, selectedItem.job.locationText].filter(Boolean).join(' · ') : undefined}
        >
          {selectedId ? <JobDetailView key={selectedId} jobId={selectedId} placeholder={selectedItem} actions={pageActions} variant="embedded" /> : null}
        </Drawer>
      ) : null}

      {!filtersInline ? (
        <Drawer
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          size="sm"
          title="Filters"
          hideTitle
          footer={
            <Button variant="primary" onClick={() => setFiltersOpen(false)} className="w-full">
              {response ? `Show ${pluralize(response.total, 'job')}` : 'Done'}
            </Button>
          }
        >
          {filtersPanel}
        </Drawer>
      ) : null}

      <SaveSearchDialog open={saveOpen} onOpenChange={setSaveOpen} query={query} />
      <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </Page>
  );
}

function ResultsArea({
  loading,
  error,
  retrying,
  onRetry,
  emptyIndex,
  syncing,
  indexNode,
  children,
}: {
  loading: boolean;
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
  emptyIndex: boolean;
  syncing: boolean;
  indexNode: ReactNode;
  children: ReactNode;
}) {
  if (emptyIndex) return <>{indexNode}</>;
  if (loading) return <ResultsSkeleton />;
  if (error) return <ErrorState title="Search did not work" error={error} onRetry={onRetry} retrying={retrying} />;
  if (syncing && !children) return <>{indexNode}</>;
  return <>{children}</>;
}

function DetailHint({ hasResults }: { hasResults: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <MousePointerClick className="size-8 text-subtle" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-fg">{hasResults ? 'Pick a job to see the details here' : 'Job details show up here'}</p>
      <p className="mt-1 text-sm text-muted">
        Move with <Kbd combo="j" /> and <Kbd combo="k" />, save with <Kbd combo="s" />, hide with <Kbd combo="h" />.
      </p>
    </div>
  );
}
