import { useMutation } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import { useBootstrap } from '../../app/bootstrap';
import { useSyncState } from '../../app/events';
import { cn } from '../../lib/cn';
import { formatRelativeTime, pluralize } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Skeleton } from '../ui/Skeleton';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';

/** POST /api/sync with user feedback. Progress itself arrives through server events. */
function useSyncNow() {
  const toast = useToast();
  return useMutation({
    mutationFn: () => api('POST /api/sync', { body: {} }),
    onSuccess: ({ queued }) => {
      if (queued === 0) toast.info('Everything is already up to date', { id: 'sync' });
    },
    onError: (error) => toast.error('Could not start a sync', { description: errorMessage(error), id: 'sync' }),
  });
}

/** One-line description of the index for tooltips and screen readers. */
function useStatusText(): { primary: string; secondary: string; syncing: boolean; loading: boolean; failed: boolean } {
  const bootstrap = useBootstrap();
  const { syncing, pendingFeeds, index } = useSyncState();
  const now = useNow();
  if (!index) return { primary: '', secondary: '', syncing: false, loading: bootstrap.isPending, failed: bootstrap.isError };
  const primary = pluralize(index.openJobs, 'open job');
  const secondary = syncing
    ? pendingFeeds > 0
      ? `Syncing… (${pendingFeeds} left)`
      : 'Syncing…'
    : index.lastSyncAt
      ? `Synced ${formatRelativeTime(index.lastSyncAt, now)}`
      : 'Not synced yet';
  return { primary, secondary, syncing, loading: false, failed: false };
}

/** Sidebar footer block: "12,430 open jobs · synced 5m ago" and a Sync now button. */
export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const status = useStatusText();
  const sync = useSyncNow();
  const busy = status.syncing || sync.isPending;

  if (compact) {
    const label = status.loading ? 'Loading index status' : status.failed ? 'Index status unavailable' : `${status.primary} · ${status.secondary}`;
    return (
      <IconButton
        label={busy ? label : `Sync now (${label})`}
        tooltipSide="right"
        icon={busy ? <Spinner size="sm" label={null} className="text-primary" /> : <RefreshCw />}
        onClick={() => sync.mutate()}
        disabled={status.failed || busy}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-h-9 flex-col justify-center gap-0.5 px-1" aria-live="polite">
        {status.loading ? (
          <>
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20" />
          </>
        ) : status.failed ? (
          <span className="text-sm text-subtle">Index status unavailable</span>
        ) : (
          <>
            <span className="text-sm font-medium text-fg tabular-nums">{status.primary}</span>
            <span className={cn('flex items-center gap-1.5 text-xs tabular-nums', status.syncing ? 'text-primary' : 'text-subtle')}>
              {status.syncing ? <Spinner size="xs" label={null} /> : null}
              {status.secondary}
            </span>
          </>
        )}
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        leadingIcon={busy ? <Spinner size="sm" label={null} /> : <RefreshCw />}
        disabled={status.failed || busy}
        onClick={() => sync.mutate()}
      >
        {status.syncing ? 'Syncing…' : 'Sync now'}
      </Button>
    </div>
  );
}
