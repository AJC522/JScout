import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Bookmark, Search } from 'lucide-react';
import type { SavedSearch } from '../../../shared/types';
import { useServerEvent } from '../../app/events';
import { Page } from '../../components/layout/Page';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, useConfirm, useToast } from '../../components/ui';
import { pluralize } from '../../lib/format';
import { useDocumentTitle, useNow } from '../../lib/hooks';
import { qk } from '../../lib/query';
import { useDeleteSavedSearch, useMarkViewed, useSavedSearches, useUpdateSavedSearch } from './queries';
import { SavedSearchRow } from './SavedSearchRow';

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-busy="true" aria-label="Loading saved searches">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-40" />
        </li>
      ))}
    </ul>
  );
}

export function SavedSearchesPage() {
  useDocumentTitle('Saved searches');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const now = useNow(60_000);
  const saved = useSavedSearches();
  const update = useUpdateSavedSearch();
  const remove = useDeleteSavedSearch();
  const markViewed = useMarkViewed();

  // New postings change totals and "new" counts.
  useServerEvent((event) => {
    if (event.type === 'sync-finished') void queryClient.invalidateQueries({ queryKey: qk.savedSearches() });
  });

  const run = (search: SavedSearch) => {
    markViewed.mutate(search.id);
    void navigate(`/?saved=${encodeURIComponent(search.id)}`);
  };

  const onDelete = async (search: SavedSearch) => {
    const ok = await confirm({
      title: `Delete “${search.name}”?`,
      description: 'The search itself is removed; jobs in your tracker are not affected.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) remove.mutate(search.id, { onSuccess: () => toast.success('Saved search deleted') });
  };

  const newTotal = saved.data?.reduce((sum, s) => sum + s.newCount, 0) ?? 0;

  let content;
  if (saved.isPending) {
    content = <ListSkeleton />;
  } else if (saved.isError) {
    content = <ErrorState title="Could not load your saved searches" error={saved.error} onRetry={() => void saved.refetch()} retrying={saved.isFetching} />;
  } else if (saved.data.length === 0) {
    content = (
      <EmptyState
        bordered
        icon={<Bookmark />}
        title="No saved searches yet"
        description="Run a search, then choose Save search to keep it here. Each time you come back, JScout shows how many jobs are new since you last looked."
        action={
          <Button asChild variant="primary" leadingIcon={<Search />}>
            <Link to="/">Go to search</Link>
          </Button>
        }
      />
    );
  } else {
    content = (
      <ul className="flex flex-col gap-3">
        {saved.data.map((search) => (
          <SavedSearchRow
            key={search.id}
            search={search}
            now={now}
            onRun={() => run(search)}
            onRename={(name) => update.mutate({ id: search.id, name }, { onSuccess: () => toast.success('Renamed') })}
            onTogglePin={() => update.mutate({ id: search.id, pinned: !search.pinned })}
            onDelete={() => void onDelete(search)}
          />
        ))}
      </ul>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Saved searches"
        description={
          newTotal > 0
            ? `${pluralize(newTotal, 'new job')} across your searches since you last looked.`
            : 'Searches you run again, with new postings highlighted.'
        }
      />
      {content}
    </Page>
  );
}
