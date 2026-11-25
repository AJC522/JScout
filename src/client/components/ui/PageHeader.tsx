import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned page actions (primary action last). They wrap under the title on narrow screens. */
  actions?: ReactNode;
  /** A "back to…" link above the title, for detail pages. */
  back?: { to: string; label: string };
  /** Small inline element after the title, e.g. a status Badge. */
  titleAddon?: ReactNode;
  /** Content under the title row, e.g. Tabs or a filter bar. */
  children?: ReactNode;
  className?: string;
}

/** Title row at the top of every page. Renders the page's single <h1>. */
export function PageHeader({ title, description, actions, back, titleAddon, children, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 pb-6', className)}>
      {back ? (
        <Link
          to={back.to}
          className="-ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1 text-sm font-medium text-muted transition-colors hover:text-fg"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-[-0.01em] text-balance text-fg">{title}</h1>
            {titleAddon}
          </div>
          {description ? <div className="max-w-prose text-base text-muted text-pretty">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
