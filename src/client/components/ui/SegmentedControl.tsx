import type { ReactNode } from 'react';
import { ToggleGroup } from 'radix-ui';
import { cn } from '../../lib/cn';
import { Tooltip } from './Tooltip';

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  /** Hide the label and show only the icon (the label becomes the tooltip and accessible name). */
  iconOnly?: boolean;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string = string> {
  options: ReadonlyArray<SegmentedOption<V>>;
  value: V;
  onValueChange: (value: V) => void;
  /** Names the group for screen readers. */
  'aria-label': string;
  size?: 'sm' | 'md';
  /** Stretch to the container width with equal segments. */
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

/** A compact single-choice switcher (view modes, sort order, theme). Always has exactly one value selected. */
export function SegmentedControl<V extends string = string>({ options, value, onValueChange, size = 'md', fullWidth = false, disabled, className, ...props }: SegmentedControlProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix allows deselecting the pressed item; a segmented control always keeps one.
      onValueChange={(next) => {
        if (next) onValueChange(next as V);
      }}
      disabled={disabled}
      aria-label={props['aria-label']}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-control border border-border bg-surface-2 p-0.5',
        fullWidth && 'flex w-full',
        size === 'sm' ? 'h-7' : 'h-8.5',
        className,
      )}
    >
      {options.map((option) => {
        const label = typeof option.label === 'string' ? option.label : undefined;
        const item = (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            aria-label={option.iconOnly ? label : undefined}
            className={cn(
              'inline-flex h-full items-center justify-center gap-1.5 rounded-[0.375rem] font-medium whitespace-nowrap text-muted transition-colors',
              'hover:text-fg disabled:cursor-not-allowed disabled:opacity-50',
              // Styled from aria-checked, not data-state: a Tooltip around an item overrides data-state with its own.
              'aria-checked:bg-surface aria-checked:text-fg aria-checked:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--border-strong)]',
              size === 'sm' ? 'px-2 text-sm [&_svg]:size-3.5' : 'px-2.5 text-base [&_svg]:size-4',
              option.iconOnly && (size === 'sm' ? 'w-7 px-0' : 'w-8 px-0'),
              fullWidth && 'flex-1',
            )}
          >
            {option.icon}
            {option.iconOnly ? null : option.label}
          </ToggleGroup.Item>
        );
        return option.iconOnly ? (
          <Tooltip key={option.value} content={option.label}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </ToggleGroup.Root>
  );
}
