/** Copy-paste panel for filling in application forms: every profile detail one click away. */
import { Link } from 'react-router';
import { Check, ClipboardCopy, Copy, UserRound } from 'lucide-react';
import type { QuickFillField } from '../../../shared/types';
import { Button, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useCopyToClipboard } from '../../lib/hooks';
import { useProfileCompleteness, useQuickFill } from './queries';
import { groupQuickFill } from './text';

function QuickFillRow({ field }: { field: QuickFillField }) {
  const { copied, copy } = useCopyToClipboard();
  const empty = !field.value.trim();
  if (empty) {
    return (
      <li className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="text-sm text-muted">{field.label}</span>
        <Link to="/profile" className="text-sm font-medium text-primary hover:underline">
          Add
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => void copy(field.value)}
        className="group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
        aria-label={`Copy ${field.label}: ${field.value}`}
      >
        <span className="w-28 shrink-0 text-xs text-muted sm:w-32">{field.label}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-fg">{field.value}</span>
        <span
          aria-live="polite"
          className={cn(
            'flex shrink-0 items-center gap-1 text-xs font-medium',
            copied ? 'text-success' : 'text-subtle group-hover:text-muted group-focus-visible:text-muted',
          )}
        >
          {copied ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
          {copied ? 'Copied' : <span className="sr-only sm:not-sr-only">Copy</span>}
        </span>
      </button>
    </li>
  );
}

function MissingDetails() {
  const completeness = useProfileCompleteness();
  const missing = (completeness.data?.missing ?? []).filter((m) => m.section === 'personal' || m.section === 'work');
  if (missing.length === 0) return null;
  const names = missing.slice(0, 3).map((m) => m.label.toLowerCase());
  return (
    <p className="text-sm text-muted">
      Missing: {names.join(', ')}
      {missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.{' '}
      <Link to="/profile" className="font-medium text-primary hover:underline">
        Complete your profile
      </Link>
    </p>
  );
}

export function QuickFillPanel() {
  const quickFill = useQuickFill();

  if (quickFill.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading your details">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (quickFill.isError) {
    return <ErrorState compact title="Could not load your details" error={quickFill.error} onRetry={() => void quickFill.refetch()} retrying={quickFill.isFetching} />;
  }

  const groups = groupQuickFill(quickFill.data);
  if (groups.length === 0) {
    return (
      <EmptyState
        compact
        icon={<UserRound />}
        title="Nothing to copy yet"
        description="Add your contact details, links and work history to your profile, and they will show up here ready to paste into forms."
        action={
          <Button asChild size="sm" variant="primary">
            <Link to="/profile">Go to profile</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex gap-2 text-sm text-muted">
        <ClipboardCopy aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>Filling in an application form? Click any detail to copy it, then paste it into the form.</span>
      </p>
      {groups.map((g) => (
        <section key={g.group} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{g.label}</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-control border border-border bg-surface">
            {g.fields.map((f) => (
              <QuickFillRow key={f.key} field={f} />
            ))}
          </ul>
        </section>
      ))}
      <MissingDetails />
    </div>
  );
}
