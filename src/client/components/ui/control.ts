/** Shared look of text-entry controls (Input, Textarea, Select, TagInput, Combobox) so they line up in forms. */
import { cn } from '../../lib/cn';

export type ControlSize = 'sm' | 'md' | 'lg';

export const CONTROL_HEIGHT: Record<ControlSize, string> = {
  sm: 'h-7 text-sm',
  md: 'h-8.5 text-base',
  lg: 'h-10 text-base',
};

export const CONTROL_PADDING_X: Record<ControlSize, string> = {
  sm: 'px-2',
  md: 'px-2.5',
  lg: 'px-3',
};

/**
 * The bordered box. Focus is drawn on the box (focus-within) rather than on the inner
 * <input>, so icons and buttons inside the box sit within one 2px ring.
 */
export function controlFrame({ invalid = false, disabled = false, className }: { invalid?: boolean; disabled?: boolean; className?: string } = {}): string {
  return cn(
    'rounded-control border bg-surface text-fg transition-[border-color,box-shadow]',
    invalid
      ? 'border-danger focus-within:ring-1 focus-within:ring-danger'
      : 'border-control/70 hover:border-control focus-within:border-focus focus-within:ring-1 focus-within:ring-focus focus-within:hover:border-focus',
    disabled && 'cursor-not-allowed bg-surface-2 opacity-60 hover:border-control/70',
    className,
  );
}

/** The bare inner element: no border or outline of its own (the frame draws them). */
export const BARE_INPUT =
  'min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-subtle focus-visible:outline-none disabled:cursor-not-allowed';
