/** One company board: name, ATS, industry, open jobs, sync status, follow switch and (for user-added boards) remove. */
import { memo } from 'react';
import { CircleAlert, CircleCheck, Trash2 } from 'lucide-react';
import type { CompanyBoard } from '../../../shared/types';
import { Badge, IconButton, Spinner, Switch, Tooltip } from '../../components/ui';
import { formatNumber, formatRelativeTime } from '../../lib/format';
import { cn } from '../../lib/cn';
import { industryLabel } from '../onboarding/industries';
import { ATS_LABELS } from './model';

/** Column template shared with the header row in CompaniesPage. */
export const ROW_GRID = 'sm:grid sm:grid-cols-[minmax(0,2fr)_6.5rem_minmax(0,1.2fr)_5rem_minmax(0,1.4fr)_3.25rem_2.25rem] sm:items-center sm:gap-4';

function SyncCell({ company, now }: { company: CompanyBoard; now: number }) {
  const { sync } = company;
  if (sync.status === 'running' || sync.status === 'queued') {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted">
        <Spinner size="sm" label={null} />
        {sync.status === 'running' ? 'Syncing…' : 'Queued'}
      </span>
    );
  }
  if (sync.status === 'error') {
    return (
      <Tooltip content={sync.error ?? 'The last sync failed.'}>
        <span tabIndex={0} className="inline-flex min-w-0 items-center gap-1.5 rounded-sm text-danger focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{sync.error ?? 'Sync failed'}</span>
        </span>
      </Tooltip>
    );
  }
  if (sync.lastSuccessAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted">
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
        Synced {formatRelativeTime(sync.lastSuccessAt, now)}
      </span>
    );
  }
  return <span className="text-subtle">{company.enabled ? 'Not synced yet' : 'Not followed'}</span>;
}

export interface CompanyRowProps {
  company: CompanyBoard;
  now: number;
  onToggle: (company: CompanyBoard, enabled: boolean) => void;
  onRemove: (company: CompanyBoard) => void;
}

export const CompanyRow = memo(function CompanyRow({ company, now, onToggle, onRemove }: CompanyRowProps) {
  return (
    <li className={cn('px-4 py-3 text-sm', ROW_GRID, !company.enabled && 'bg-surface-2/40')}>
      <div className="flex items-start justify-between gap-3 sm:block sm:min-w-0">
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className={cn('truncate font-medium', company.enabled ? 'text-fg' : 'text-muted')}>{company.name}</span>
            {company.origin === 'user' ? (
              <Badge size="sm" tone="primary">
                Added by you
              </Badge>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-xs text-subtle sm:hidden">
            {ATS_LABELS[company.ats]}
            {company.industry ? ` · ${industryLabel(company.industry)}` : ''} · {formatNumber(company.jobCount)} open jobs
          </p>
        </div>
        <Switch
          className="sm:hidden"
          aria-label={`Follow ${company.name}`}
          checked={company.enabled}
          onCheckedChange={(on) => onToggle(company, on)}
        />
      </div>
      <span className="hidden truncate text-muted sm:block">{ATS_LABELS[company.ats]}</span>
      <span className="hidden truncate text-muted sm:block">{company.industry ? industryLabel(company.industry) : '—'}</span>
      <span className="hidden text-right text-fg tabular-nums sm:block">{formatNumber(company.jobCount)}</span>
      <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-xs sm:mt-0 sm:text-sm">
        <SyncCell company={company} now={now} />
        {company.origin === 'user' ? (
          <IconButton className="sm:hidden" size="sm" variant="danger" label={`Remove ${company.name}`} icon={<Trash2 />} onClick={() => onRemove(company)} />
        ) : null}
      </div>
      <div className="hidden sm:flex sm:justify-center">
        <Switch aria-label={`Follow ${company.name}`} checked={company.enabled} onCheckedChange={(on) => onToggle(company, on)} />
      </div>
      <div className="hidden sm:flex sm:h-7 sm:justify-end">
        {company.origin === 'user' ? <IconButton size="sm" variant="danger" label={`Remove ${company.name}`} icon={<Trash2 />} onClick={() => onRemove(company)} /> : null}
      </div>
    </li>
  );
});
