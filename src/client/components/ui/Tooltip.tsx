import type { ReactNode } from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';

/** Mounted once in App; shares the open delay so moving between triggers feels instant. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={250}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element; it receives the trigger props. */
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Shortcut hint rendered after the text, e.g. <Kbd combo="mod+k" />. */
  shortcut?: ReactNode;
  /** Render the trigger without a tooltip (e.g. when the label is already visible). */
  disabled?: boolean;
  delayDuration?: number;
  className?: string;
}

/**
 * Short supplementary label shown on hover and keyboard focus. Never put essential
 * information only in a tooltip: touch screens cannot show it.
 */
export function Tooltip({ content, children, side = 'top', align = 'center', shortcut, disabled, delayDuration, className }: TooltipProps) {
  if (disabled || content === null || content === undefined || content === '') return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-50 flex max-w-xs items-center gap-2 rounded-md bg-tooltip px-2 py-1 text-xs font-medium text-on-tooltip shadow-overlay',
            'data-[state=delayed-open]:animate-fade-in data-[state=instant-open]:animate-fade-in data-[state=closed]:animate-fade-out',
            className,
          )}
        >
          {content}
          {shortcut ? <span className="opacity-75">{shortcut}</span> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
