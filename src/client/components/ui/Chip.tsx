import type { ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface ChipProps {
  children: ReactNode;
  /** Makes the chip a toggle button (aria-pressed). */
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  /** Adds a remove (×) button. */
  onRemove?: () => void;
  /** Accessible name of the remove button; defaults to "Remove <text>". */
  removeLabel?: string;
  icon?: ReactNode;
  /** Trailing count, e.g. facet totals. */
  count?: ReactNode;
  size?: 'sm' | 'md';
  /** Visual emphasis for chips that were added automatically (e.g. broadened synonyms). */
  tone?: 'neutral' | 'primary' | 'accent';
  disabled?: boolean;
  className?: string;
  title?: string;
}

const TONES = {
  neutral: 'border-border bg-surface text-fg',
  primary: 'border-primary/30 bg-primary-soft text-primary',
  accent: 'border-accent/50 bg-accent-soft text-accent',
} as const;

/**
 * Pill for filters, keywords and tags. Selectable chips are toggle buttons;
 * removable chips are a label plus a separate remove button, so both stay keyboard reachable.
 */
export function Chip({ children, selected, onSelectedChange, onRemove, removeLabel, icon, count, size = 'md', tone = 'neutral', disabled = false, className, title }: ChipProps) {
  const selectable = onSelectedChange !== undefined;
  const textLabel = typeof children === 'string' ? children : 'item';
  const body = (
    <>
      {selectable && selected ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : icon}
      <span className="truncate">{children}</span>
      {count !== undefined ? <span className={cn('tabular-nums', selected ? 'opacity-80' : 'text-subtle')}>{count}</span> : null}
    </>
  );
  const shape = cn(
    'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border font-medium transition-colors [&_svg]:shrink-0',
    size === 'sm' ? 'h-6 px-2 text-xs [&_svg]:size-3' : 'h-7 px-2.5 text-sm [&_svg]:size-3.5',
    disabled && 'pointer-events-none opacity-50',
  );

  if (selectable) {
    return (
      <button
        type="button"
        aria-pressed={selected ?? false}
        disabled={disabled}
        title={title}
        onClick={() => onSelectedChange(!selected)}
        className={cn(
          shape,
          selected ? 'border-primary bg-primary text-on-primary hover:bg-primary-hover' : 'border-border bg-surface text-fg hover:border-strong hover:bg-surface-2',
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <span title={title} className={cn(shape, TONES[tone], onRemove && (size === 'sm' ? 'pr-0.5' : 'pr-1'), className)}>
      {body}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={removeLabel ?? `Remove ${textLabel}`}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full text-current opacity-60 transition hover:bg-hover hover:opacity-100',
            size === 'sm' ? 'size-4.5' : 'size-5',
          )}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
