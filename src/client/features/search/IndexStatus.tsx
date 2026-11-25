/** The results area while the local index is empty: first-sync progress, or a way to start one. */
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { DatabaseZap, RefreshCw } from 'lucide-react';
import type { IndexSummary } from '../../../shared/types';
import { api, errorMessage } from '../../api/client';
import { Button, EmptyState, ProgressBar, useToast } from '../../components/ui';
import { formatNumber, pluralize } from '../../lib/format';

export function IndexStatus({ index }: { index: IndexSummary }) {
  const toast = useToast();
  const sync = useMutation({
    mutationFn: () => api('POST /api/sync', { body: {} }),
    onSuccess: (res) => toast.success('Fetching jobs', { description: `${pluralize(res.queued, 'feed')} queued. Results appear as they arrive.` }),
    onError: (error) => toast.error('Could not start fetching jobs', { description: errorMessage(error) }),
  });

  if (index.syncing || sync.isPending || sync.isSuccess) {
    return (
      <section className="rounded-card border border-border bg-surface p-6 text-center sm:p-8" aria-live="polite">
        <RefreshCw className="mx-auto size-7 animate-spin text-primary [animation-duration:2s]" aria-hidden="true" />
        <h2 className="mt-3 text-base font-semibold text-fg">
          Fetching jobs from {pluralize(Math.max(index.sources, 1), 'source')}…
          {index.openJobs > 0 ? ` ${formatNumber(index.openJobs)} so far` : ''}
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          The first fetch takes a minute or two. Results show up here as soon as there are some to search.
        </p>
        <ProgressBar className="mx-auto mt-4 max-w-sm" label="Fetching jobs" size="sm" />
        {index.pendingFeeds > 0 ? <p className="mt-2 text-xs text-subtle">{pluralize(index.pendingFeeds, 'feed')} still to go</p> : null}
      </section>
    );
  }

  return (
    <EmptyState
      bordered
      icon={<DatabaseZap />}
      title="Your job index is empty"
      description="JScout searches its own copy of job boards and company career pages, so it is fast and private. Fetch jobs to get started."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => sync.mutate()} loading={sync.isPending}>
            Fetch jobs now
          </Button>
          <Button asChild variant="secondary">
            <Link to="/settings">Choose sources</Link>
          </Button>
        </div>
      }
    />
  );
}
