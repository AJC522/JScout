import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface SectionProps {
  title: string;
  /** Short text after the title, e.g. "3 of 5 done". */
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled card on the application page. */
export function Section({ title, meta, actions, children, className }: SectionProps) {
  return (
    <section className={cn('rounded-card border border-border bg-surface', className)} aria-label={title}>
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {meta ? <span className="truncate text-xs text-muted">{meta}</span> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
