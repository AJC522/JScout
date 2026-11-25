import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** A titled block of the gallery with an anchor for the in-page index. */
export function KitSection({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 border-t border-border pt-8 pb-10 first:border-t-0 first:pt-0">
      <div className="mb-5 flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-xl font-semibold text-fg">
          {title}
        </h2>
        {description ? <p className="max-w-prose text-base text-muted">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

/** One labelled example row inside a section. */
export function Demo({ label, children, className, stack = false }: { label: string; children: ReactNode; className?: string; stack?: boolean }) {
  return (
    <div className="grid gap-2 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-6">
      <div className="pt-1.5 text-sm font-medium text-subtle">{label}</div>
      <div className={cn(stack ? 'flex flex-col gap-3' : 'flex flex-wrap items-center gap-3', className)}>{children}</div>
    </div>
  );
}
