import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { ModalOverlay } from './Dialog';

const SIZES = {
  sm: 'sm:max-w-[400px]',
  md: 'sm:max-w-[520px]',
  lg: 'sm:max-w-[680px]',
  xl: 'sm:max-w-[880px]',
} as const;

export interface DrawerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Controls in the header next to the × (e.g. "Open in new tab", a menu). */
  headerActions?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  /** Which edge it slides from. Right for detail panels; left is used by the mobile navigation. */
  side?: 'right' | 'left';
  /** Hide the title row's text visually (it is still announced), for drawers that render their own heading. */
  hideTitle?: boolean;
  children?: ReactNode;
  /** Classes for the scrolling body. */
  bodyClassName?: string;
  className?: string;
}

/**
 * Side sheet for detail panels (a job, an application) that keeps the list behind it in context.
 * Full width on phones. Same focus and dismissal behaviour as Dialog.
 */
export function Drawer({ open, onOpenChange, trigger, title, description, headerActions, footer, size = 'md', side = 'right', hideTitle = false, children, bodyClassName, className }: DrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <ModalOverlay />
        <DialogPrimitive.Content
          data-modal-layer=""
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-y-0 z-50 flex w-full flex-col bg-surface shadow-dialog outline-none',
            side === 'right'
              ? 'right-0 border-l border-border data-[state=closed]:animate-sheet-out-right data-[state=open]:animate-sheet-in-right'
              : 'left-0 border-r border-border data-[state=closed]:animate-sheet-out-left data-[state=open]:animate-sheet-in-left',
            SIZES[size],
            className,
          )}
        >
          <div className={cn('flex items-start gap-3 border-b border-border px-5 py-4', hideTitle && 'border-b-0 pb-0')}>
            <div className={cn('flex min-w-0 flex-1 flex-col gap-0.5', hideTitle && 'sr-only')}>
              <DialogPrimitive.Title className="truncate text-lg font-semibold text-fg">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="text-sm text-muted">{description}</DialogPrimitive.Description> : null}
            </div>
            <div className={cn('-mt-1 -mr-2 flex shrink-0 items-center gap-1', hideTitle && 'ml-auto')}>
              {headerActions}
              <DialogPrimitive.Close
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-control text-subtle transition-colors hover:bg-hover hover:text-fg"
              >
                <X aria-hidden="true" className="size-[1.125rem]" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>{children}</div>
          {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
