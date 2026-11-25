import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface CardProps extends ComponentProps<'div'> {
  /** Hover feedback for cards that are clickable as a whole (put the link/button inside). */
  interactive?: boolean;
  /** Highlight state, e.g. the selected result in a list. */
  selected?: boolean;
  /** Pad a simple card. Leave off when composing CardHeader/CardBody/CardFooter, which bring their own. */
  padded?: boolean;
}

/** Bordered panel on the surface colour. Compose with CardHeader, CardBody and CardFooter. */
export function Card({ interactive = false, selected = false, padded = false, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-card border border-border bg-surface',
        padded && 'p-4',
        interactive && 'transition-colors hover:border-strong',
        selected && 'border-primary ring-1 ring-primary',
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Right-aligned controls (buttons, menus). */
  actions?: ReactNode;
}

export function CardHeader({ actions, className, children, ...props }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-4 pt-4 pb-3', className)} {...props}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
      {actions ? <div className="-mt-1 -mr-1 flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 className={cn('text-base font-semibold text-fg', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted', className)} {...props} />;
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-4 pb-4 first:pt-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 rounded-b-card border-t border-border bg-surface-2/60 px-4 py-3', className)}
      {...props}
    />
  );
}
