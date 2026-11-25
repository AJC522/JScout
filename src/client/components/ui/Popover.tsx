import type { ComponentProps } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';

/*
 * Non-modal floating panel for small forms and filters:
 *   <Popover>
 *     <PopoverTrigger asChild><Button>Salary</Button></PopoverTrigger>
 *     <PopoverContent>…</PopoverContent>
 *   </Popover>
 */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const POPOVER_PANEL =
  'z-50 rounded-card border border-border bg-surface text-fg shadow-overlay outline-none ' +
  'origin-[var(--radix-popover-content-transform-origin)] data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in';

export function PopoverContent({ className, sideOffset = 6, collisionPadding = 8, align = 'start', ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        align={align}
        className={cn(POPOVER_PANEL, 'w-72 max-w-[calc(100vw-1rem)] p-4', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
