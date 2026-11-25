import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

const VARIANTS = {
  ghost: 'text-muted hover:bg-hover hover:text-fg active:bg-pressed data-[state=open]:bg-hover data-[state=open]:text-fg',
  secondary: 'border border-strong bg-surface text-fg hover:border-control hover:bg-surface-2 data-[state=open]:bg-surface-2',
  primary: 'bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active',
  danger: 'text-danger hover:bg-danger-soft',
} as const;

const SIZES = {
  xs: 'size-6 rounded-md [&_svg]:size-3.5',
  sm: 'size-7 rounded-control [&_svg]:size-4',
  md: 'size-8.5 rounded-control [&_svg]:size-[1.125rem]',
  lg: 'size-10 rounded-control [&_svg]:size-5',
} as const;

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  /** Accessible name; also shown as the tooltip. Required because the button has no visible text. */
  label: string;
  icon: ReactNode;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  loading?: boolean;
  /** false hides the tooltip (the label is still announced). A node replaces the label as tooltip text. */
  tooltip?: ReactNode | false;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** Small dot in the corner, e.g. "has unread items". */
  indicator?: boolean;
}

/** Square icon-only button with an aria-label and a matching tooltip. */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  loading = false,
  tooltip,
  tooltipSide,
  indicator = false,
  disabled,
  type,
  className,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type ?? 'button'}
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size={size === 'xs' ? 'xs' : 'sm'} label={null} /> : icon}
      {indicator ? (
        <span aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-full bg-accent ring-2 ring-surface" />
      ) : null}
    </button>
  );
  if (tooltip === false) return button;
  return (
    <Tooltip content={tooltip ?? label} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}
