import { cn } from '../../lib/cn';
import type { Tone } from './Badge';

const FILL: Record<Tone, string> = {
  neutral: 'bg-subtle',
  primary: 'bg-primary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger-solid',
  info: 'bg-info',
};

export interface ProgressBarProps {
  /** 0–100. Omit (or pass null) for an indeterminate bar. */
  value?: number | null;
  /** Accessible name, e.g. "Profile completeness". */
  label: string;
  tone?: Tone;
  size?: 'sm' | 'md';
  /** Show the label and percentage above the bar. */
  showValue?: boolean;
  className?: string;
}

export function ProgressBar({ value, label, tone = 'primary', size = 'md', showValue = false, className }: ProgressBarProps) {
  const indeterminate = value === undefined || value === null || !Number.isFinite(value);
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {showValue ? (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted">{label}</span>
          {indeterminate ? null : <span className="font-medium text-fg tabular-nums">{Math.round(clamped)}%</span>}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : 100}
        aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
        className={cn('relative w-full overflow-hidden rounded-full bg-surface-3', size === 'sm' ? 'h-1' : 'h-1.5')}
      >
        <div
          className={cn(
            'h-full rounded-full',
            FILL[tone],
            indeterminate ? 'w-2/5 animate-indeterminate' : 'transition-[width] duration-300 ease-out',
          )}
          style={indeterminate ? undefined : { width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
