import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Kanban, List, Plus, Search, SearchX, SquareKanban } from 'lucide-react';
import { ACTIVE_STATUSES, STATUS_LABELS } from '../../../shared/constants';
import type { Application, ApplicationStatus } from '../../../shared/types';
import { Page } from '../../components/layout/Page';
import { Button, Chip, EmptyState, ErrorState, Input, PageHeader, SegmentedControl, Select, Skeleton } from '../../components/ui';
import { useDebouncedValue, useDocumentTitle, useHotkey, useLocalStorage, useNow } from '../../lib/hooks';
import { AddApplicationDialog } from './AddApplicationDialog';
import { useOpenApplication } from './ApplicationCard';
import { isFollowUpDue } from './board';
import { useApplicationList, useApplicationStats } from './queries';
import { saveTrackerScroll, takeTrackerScroll } from './scroll-memory';
import { isStatus, STATUS_OPTIONS } from './status';
import { TrackerBoard } from './TrackerBoard';
import { TrackerList } from './TrackerList';
import { TrackerStats } from './TrackerStats';

type View = 'board' | 'list';

const VIEW_OPTIONS = [
  { value: 'board' as const, label: 'Board', icon: <Kanban /> },
  { value: 'list' as const, label: 'List', icon: <List /> },
];

const STATUS_FILTER_OPTIONS = [{ value: '', label: 'All statuses' }, ...STATUS_OPTIONS];

function BoardSkeleton() {
  return (
    <div className="flex gap-2.5 overflow-hidden" aria-busy="true" aria-label="Loading applications">
      {ACTIVE_STATUSES.map((s, i) => (
        <div key={s} className="flex w-[17rem] shrink-0 flex-col gap-2 sm:w-[15rem] xl:w-auto xl:min-w-[11.5rem] xl:flex-1">
          <Skeleton className="mx-1 mb-1 h-5 w-24" />
          <div className="flex min-h-32 flex-col gap-2 rounded-card bg-surface-2 p-2">
            {Array.from({ length: Math.max(1, 3 - i) }, (_, j) => (
              <Skeleton key={j} className="h-24 rounded-card" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 rounded-card border border-border bg-surface p-3" aria-busy="true" aria-label="Loading applications">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  );
}

export function TrackerPage() {
  useDocumentTitle('Tracker');
  const [params, setParams] = useSearchParams();
  const [view, setView] = useLocalStorage<View>('jscout.tracker.view', 'board');
  const [addOpen, setAddOpen] = useState(false);
  const [text, setText] = useState(() => params.get('q') ?? '');
  const q = useDebouncedValue(text, 250);
  const statusParam = params.get('status');
  const status: ApplicationStatus | undefined = isStatus(statusParam) ? statusParam : undefined;
  const due = params.get('due') === '1';
  const now = useNow(60_000);
  const boardScroll = useRef<HTMLDivElement>(null);
  const openApplication = useOpenApplication();

  const list = useApplicationList(q);
  const stats = useApplicationStats();
  useHotkey('n', () => setAddOpen(true));

  const setParam = (key: string, value: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  // Keep the text filter in the URL so "Back to tracker" returns to the same view.
  // Only the debounced text drives this effect; setParam reads the current params itself.
  useEffect(() => {
    if ((params.get('q') ?? '') !== q.trim()) setParam('q', q.trim() || null);
  }, [q]);

  const apps = list.data;
  const visible = useMemo(() => {
    if (!apps) return [];
    return apps.filter((a) => (!status || a.status === status) && (!due || isFollowUpDue(a, now)));
  }, [apps, status, due, now]);

  // Put the board back where it was when the user opened an application.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !apps) return;
    restored.current = true;
    const saved = takeTrackerScroll();
    if (!saved) return;
    requestAnimationFrame(() => {
      boardScroll.current?.scrollTo({ left: saved.x });
      window.scrollTo({ top: saved.y });
    });
  }, [apps]);

  const open = (app: Application) => {
    saveTrackerScroll(boardScroll.current?.scrollLeft ?? 0, window.scrollY);
    openApplication(app.id);
  };

  const filtered = Boolean(q.trim() || status || due);
  const clearFilters = () => {
    setText('');
    setParams(new URLSearchParams(), { replace: true });
  };

  let content;
  if (list.isPending) {
    content = view === 'board' ? <BoardSkeleton /> : <ListSkeleton />;
  } else if (list.isError) {
    content = <ErrorState title="Could not load your applications" error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />;
  } else if (list.data.length === 0 && !q.trim()) {
    content = (
      <EmptyState
        bordered
        icon={<SquareKanban />}
        title="Your tracker is empty"
        description="Save jobs from search to track them here, from saved to offer. Found a job somewhere else? Add it by hand."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="primary" leadingIcon={<Search />}>
              <Link to="/">Search jobs</Link>
            </Button>
            <Button leadingIcon={<Plus />} onClick={() => setAddOpen(true)}>
              Add application
            </Button>
          </div>
        }
      />
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        bordered
        compact
        icon={<SearchX />}
        title="No applications match"
        description={due ? 'No follow-ups are due. Nice work.' : 'Try other words or another status.'}
        action={<Button onClick={clearFilters}>Clear filters</Button>}
      />
    );
  } else if (view === 'board') {
    content = <TrackerBoard apps={visible} now={now} onOpen={open} scrollRef={boardScroll} onlyStatus={status} />;
  } else {
    content = <TrackerList apps={visible} now={now} onOpen={open} />;
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Tracker"
        description="Every application, from saved to offer, with follow-ups."
        actions={
          <Button variant="primary" leadingIcon={<Plus />} onClick={() => setAddOpen(true)}>
            Add application
          </Button>
        }
      >
        <TrackerStats stats={stats.data} dueFilter={due} onToggleDue={() => setParam('due', due ? null : '1')} />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Filter applications"
          placeholder="Filter by title, company or notes"
          leadingIcon={<Search />}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onClear={() => setText('')}
          size="sm"
          wrapperClassName="w-full sm:w-72"
        />
        <Select
          aria-label="Status"
          size="sm"
          value={status ?? ''}
          onChange={(e) => setParam('status', e.target.value || null)}
          options={STATUS_FILTER_OPTIONS}
          wrapperClassName="w-40"
        />
        {due ? (
          <Chip size="sm" tone="primary" onRemove={() => setParam('due', null)} removeLabel="Show all applications">
            Follow-ups due
          </Chip>
        ) : null}
        {status ? <span className="text-xs text-muted">Showing {STATUS_LABELS[status].toLowerCase()} only</span> : null}
        <SegmentedControl aria-label="View" size="sm" options={VIEW_OPTIONS} value={view} onValueChange={setView} className="ml-auto" />
      </div>

      {content}

      <AddApplicationDialog open={addOpen} onOpenChange={setAddOpen} onCreated={(created) => openApplication(created.id)} />
    </Page>
  );
}
