import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  /** A lucide icon element, e.g. <Inbox />. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or links; the first is usually the primary next step. */
  action?: ReactNode;
  /** Less vertical space, for empty panels inside cards and drawers. */
  compact?: boolean;
  /** Draw a dashed outline (for empty drop zones and lists inside a page). */
  bordered?: boolean;
  className?: string;
}

/** What to show when there is nothing yet, with a clear next step. */
export function EmptyState({ icon, title, description, action, compact = false, bordered = false, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16',
        bordered && 'rounded-card border border-dashed border-strong',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-card bg-primary-soft text-primary',
            compact ? 'size-9 [&_svg]:size-[1.125rem]' : 'mb-1 size-12 [&_svg]:size-6',
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-md flex-col gap-1">
        <h2 className={cn('font-semibold text-fg', compact ? 'text-base' : 'text-lg')}>{title}</h2>
        {description ? <div className="text-base text-muted text-pretty">{description}</div> : null}
      </div>
      {action ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
