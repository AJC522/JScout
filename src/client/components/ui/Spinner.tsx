import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

const SIZES = { xs: 'size-3', sm: 'size-3.5', md: 'size-4', lg: 'size-6', xl: 'size-8' } as const;

export interface SpinnerProps extends Omit<ComponentProps<'span'>, 'children'> {
  size?: keyof typeof SIZES;
  /** Announced to screen readers. Pass null when the surrounding text already says what is loading. */
  label?: string | null;
}

/** Indeterminate loading indicator. Inherits the text colour. */
export function Spinner({ size = 'md', label = 'Loading', className, ...props }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      {...props}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn('animate-spin', SIZES[size])}>
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
        <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
