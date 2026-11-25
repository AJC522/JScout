/** Headline numbers for the tracker. "Follow-ups due" doubles as a filter toggle. */
import type { ReactNode } from 'react';
import { BellRing } from 'lucide-react';
import { ACTIVE_STATUSES } from '../../../shared/constants';
import type { ApplicationStats } from '../../../shared/types';
import { Skeleton } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatNumber, formatPercent } from '../../lib/format';

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-card border border-border bg-surface px-3.5 py-2.5">
      <p className="truncate text-xs text-muted">{label}</p>
      <p className="text-lg leading-tight font-semibold text-fg tabular-nums" title={hint}>
        {value}
      </p>
    </div>
  );
}

export interface TrackerStatsProps {
  stats: ApplicationStats | undefined;
  dueFilter: boolean;
  onToggleDue: () => void;
}

export function TrackerStats({ stats, dueFilter, onToggleDue }: TrackerStatsProps) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true" aria-label="Loading tracker numbers">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[3.75rem] rounded-card" />
        ))}
      </div>
    );
  }
  const active = ACTIVE_STATUSES.reduce((sum, s) => sum + stats.byStatus[s], 0);
  const due = stats.followUpsDue;
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      <Stat label="Active" value={formatNumber(active)} />
      <Stat label="Applied, last 7 days" value={formatNumber(stats.appliedLast7Days)} />
      <Stat label="Applied, last 30 days" value={formatNumber(stats.appliedLast30Days)} />
      <Stat
        label="Response rate"
        value={formatPercent(stats.responseRate)}
        hint="Share of applications that reached screening or further"
      />
      <div className="col-span-2 sm:col-span-1">
        <button
          type="button"
          onClick={onToggleDue}
          aria-pressed={dueFilter}
          disabled={due === 0 && !dueFilter}
          className={cn(
            'flex w-full min-w-0 flex-col gap-0.5 rounded-card border px-3.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
            due > 0 ? 'border-warning/40 bg-warning-soft hover:border-warning' : 'border-border bg-surface',
            dueFilter && 'ring-2 ring-warning',
            due === 0 && !dueFilter && 'cursor-default',
          )}
        >
          <span className={cn('flex items-center gap-1.5 truncate text-xs', due > 0 ? 'text-warning' : 'text-muted')}>
            {due > 0 ? <BellRing aria-hidden="true" className="size-3.5" /> : null}
            Follow-ups due
          </span>
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-lg leading-tight font-semibold text-fg tabular-nums">{formatNumber(due)}</span>
            {due > 0 || dueFilter ? <span className="text-xs text-muted">{dueFilter ? 'Show all' : 'Show them'}</span> : null}
          </span>
        </button>
      </div>
    </div>
  );
}
