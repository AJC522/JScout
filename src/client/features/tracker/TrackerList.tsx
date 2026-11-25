/** Dense, sortable table of applications with inline status changes. */
import { useMemo } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { Application, ApplicationStatus } from '../../../shared/types';
import { Badge, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatDate, formatRelativeTime } from '../../lib/format';
import { useLocalStorage } from '../../lib/hooks';
import { ClosedBadge, FollowUpBadge } from './ApplicationCard';
import { followUpState, groupByStatus, sortOrderAt } from './board';
import { DEFAULT_LIST_SORT, nextSort, sortApplications, type ListSort, type SortKey } from './list-sort';
import { useMoveApplication } from './queries';
import { PRIORITY_LABELS, PRIORITY_TONES, STATUS_OPTIONS } from './status';

interface Column {
  key: SortKey;
  label: string;
  className?: string;
}

const COLUMNS: Column[] = [
  { key: 'title', label: 'Job' },
  { key: 'company', label: 'Company', className: 'hidden md:table-cell' },
  { key: 'status', label: 'Status' },
  { key: 'appliedAt', label: 'Applied', className: 'hidden lg:table-cell' },
  { key: 'followUpAt', label: 'Follow-up', className: 'hidden sm:table-cell' },
  { key: 'priority', label: 'Priority', className: 'hidden lg:table-cell' },
  { key: 'updatedAt', label: 'Updated', className: 'hidden md:table-cell' },
];

function SortHeader({ column, sort, onSort }: { column: Column; sort: ListSort; onSort: (key: SortKey) => void }) {
  const active = sort.key === column.key;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted', column.className)}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={cn('-mx-1 inline-flex items-center gap-1 rounded-md px-1 hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none', active && 'text-fg')}
      >
        {column.label}
        <Icon aria-hidden="true" className={cn('size-3', !active && 'opacity-50')} />
      </button>
    </th>
  );
}

export interface TrackerListProps {
  apps: Application[];
  now: number;
  onOpen: (app: Application) => void;
}

export function TrackerList({ apps, now, onOpen }: TrackerListProps) {
  const [sort, setSort] = useLocalStorage<ListSort>('jscout.tracker.list-sort', DEFAULT_LIST_SORT);
  const rows = useMemo(() => sortApplications(apps, sort), [apps, sort]);
  const columns = useMemo(() => groupByStatus(apps), [apps]);
  const move = useMoveApplication();

  const changeStatus = (app: Application, status: ApplicationStatus) => {
    if (status === app.status) return;
    // New status goes to the top of its column, as it does on the board.
    move.mutate({ id: app.id, status, sortOrder: sortOrderAt(columns[status], 0) ?? 0 });
  };

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[20rem] border-collapse text-sm">
        <thead className="border-b border-border bg-surface-2">
          <tr>
            {COLUMNS.map((c) => (
              <SortHeader key={c.key} column={c} sort={sort} onSort={(key) => setSort(nextSort(sort, key))} />
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((app) => (
            <tr key={app.id} className="transition-colors hover:bg-hover">
              <td className="max-w-[18rem] px-3 py-2">
                <Link
                  to={`/tracker/${app.id}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    onOpen(app);
                  }}
                  className="line-clamp-1 font-medium text-fg hover:text-primary hover:underline"
                >
                  {app.job.title}
                </Link>
                <p className="truncate text-xs text-muted md:hidden">{app.job.company}</p>
                {app.jobClosed ? (
                  <div className="mt-1">
                    <ClosedBadge />
                  </div>
                ) : null}
              </td>
              <td className="hidden max-w-[12rem] truncate px-3 py-2 text-fg md:table-cell">{app.job.company}</td>
              <td className="px-3 py-1.5">
                <Select
                  size="sm"
                  aria-label={`Status of ${app.job.title}`}
                  value={app.status}
                  options={STATUS_OPTIONS}
                  onChange={(e) => changeStatus(app, e.target.value as ApplicationStatus)}
                  wrapperClassName="w-32"
                />
              </td>
              <td className="hidden px-3 py-2 whitespace-nowrap text-muted tabular-nums lg:table-cell">{formatDate(app.appliedAt, 'short') || '–'}</td>
              <td className="hidden px-3 py-2 whitespace-nowrap sm:table-cell">
                {followUpState(app, now) ? <FollowUpBadge app={app} now={now} /> : <span className="text-muted">–</span>}
              </td>
              <td className="hidden px-3 py-2 lg:table-cell">
                {app.priority > 0 ? (
                  <Badge size="sm" variant="outline" tone={PRIORITY_TONES[app.priority]}>
                    {PRIORITY_LABELS[app.priority]}
                  </Badge>
                ) : (
                  <span className="text-muted">–</span>
                )}
              </td>
              <td className="hidden px-3 py-2 whitespace-nowrap text-muted tabular-nums md:table-cell">{formatRelativeTime(app.updatedAt, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
