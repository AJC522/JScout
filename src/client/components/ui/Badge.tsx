import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type Tone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const SOFT: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted',
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

const SOLID: Record<Tone, string> = {
  neutral: 'bg-fg text-canvas',
  primary: 'bg-primary text-on-primary',
  accent: 'bg-accent text-on-accent',
  success: 'bg-success text-surface',
  warning: 'bg-warning text-surface',
  danger: 'bg-danger-solid text-on-danger',
  info: 'bg-info text-surface',
};

const OUTLINE: Record<Tone, string> = {
  neutral: 'border-strong text-muted',
  primary: 'border-primary/40 text-primary',
  accent: 'border-accent/60 text-accent',
  success: 'border-success/40 text-success',
  warning: 'border-warning/40 text-warning',
  danger: 'border-danger/40 text-danger',
  info: 'border-info/40 text-info',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-subtle',
  primary: 'bg-primary-fg',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: Tone;
  variant?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  /** A small status dot before the text (e.g. sync state). */
  dot?: boolean;
}

/** Short status or count label. Not interactive; use Chip for something clickable. */
export function Badge({ tone = 'neutral', variant = 'soft', size = 'md', icon, dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap tabular-nums [&_svg]:shrink-0',
        size === 'sm' ? 'h-4.5 px-1.5 text-[0.6875rem] leading-none [&_svg]:size-3' : 'h-5.5 px-2 text-xs [&_svg]:size-3.5',
        variant === 'soft' && SOFT[tone],
        variant === 'solid' && SOLID[tone],
        variant === 'outline' && cn('border', OUTLINE[tone]),
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden="true" className={cn('size-1.5 rounded-full', variant === 'solid' ? 'bg-current' : DOT[tone])} /> : null}
      {icon}
      {children !== undefined && children !== null ? <span className="truncate">{children}</span> : null}
    </span>
  );
}
