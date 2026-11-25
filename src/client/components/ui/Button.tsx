import type { ComponentProps, ReactNode } from 'react';
import { Slot } from 'radix-ui';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium ' +
  'transition-[background-color,border-color,color,box-shadow] disabled:pointer-events-none disabled:opacity-50 ' +
  'aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:shrink-0';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active',
  secondary: 'border border-strong bg-surface text-fg hover:border-control hover:bg-surface-2 active:bg-surface-3',
  ghost: 'text-muted hover:bg-hover hover:text-fg active:bg-pressed',
  danger: 'bg-danger-solid text-on-danger hover:bg-danger-solid-hover',
  link: 'h-auto rounded-sm px-0 text-primary underline-offset-[3px] hover:underline',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-sm [&_svg]:size-3.5',
  md: 'h-8.5 px-3.5 text-base [&_svg]:size-4',
  lg: 'h-10 px-4.5 text-base [&_svg]:size-[1.125rem]',
};

/** Class names for a button look on something that is not a Button (e.g. a label wrapping a file input). */
export function buttonClasses({ variant = 'secondary', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  // VARIANTS come after SIZES so the link variant's h-auto/px-0 override the size box.
  return cn(BASE, SIZES[size], VARIANTS[variant], className);
}

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner in place of the leading icon and blocks clicks. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /**
   * Render the single child element (e.g. a router <Link> or <a>) with the button's look:
   * <Button asChild><Link to="/saved">Saved searches</Link></Button>
   */
  asChild?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  leadingIcon,
  trailingIcon,
  asChild = false,
  disabled,
  type,
  className,
  children,
  ...props
}: ButtonProps) {
  const leading = loading ? <Spinner size={size === 'sm' ? 'sm' : 'md'} label={null} /> : leadingIcon;
  const classes = buttonClasses({ variant, size, className });

  if (asChild) {
    return (
      <Slot.Root className={classes} aria-disabled={disabled || loading || undefined} aria-busy={loading || undefined} {...props}>
        {leading}
        <Slot.Slottable>{children}</Slot.Slottable>
        {trailingIcon}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {leading}
      {children}
      {trailingIcon}
    </button>
  );
}
