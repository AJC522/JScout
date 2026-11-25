import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

const SIZES = {
  sm: 'max-w-[400px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[680px]',
  xl: 'max-w-[880px]',
} as const;

export type DialogSize = keyof typeof SIZES;

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional element that opens the dialog (rendered asChild), for uncontrolled use. */
  trigger?: ReactNode;
  title: ReactNode;
  /** One sentence under the title; also announced as the dialog's description. */
  description?: ReactNode;
  /** Buttons, right-aligned; wrap the cancel button in <DialogClose asChild>. */
  footer?: ReactNode;
  size?: DialogSize;
  children?: ReactNode;
  /** Hide the × button (e.g. while a save is in flight). */
  hideClose?: boolean;
  /** Block closing by Escape or clicking outside (for dialogs with unsaved input). */
  dismissible?: boolean;
  /** Call event.preventDefault() to stop focus moving to the first focusable element (then focus one yourself). */
  onOpenAutoFocus?: (event: Event) => void;
  className?: string;
}

export const DialogClose = DialogPrimitive.Close;
export const DialogTrigger = DialogPrimitive.Trigger;

/** Shared overlay so Dialog, Drawer and ConfirmDialog dim the page the same way. */
export function ModalOverlay() {
  return <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />;
}

/**
 * Modal dialog: focus is trapped inside, Escape and the × close it, focus returns to
 * the trigger afterwards. The body scrolls; header and footer stay put.
 */
export function Dialog({ open, onOpenChange, trigger, title, description, footer, size = 'md', children, hideClose = false, dismissible = true, onOpenAutoFocus, className }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <ModalOverlay />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <DialogPrimitive.Content
            data-modal-layer=""
            onOpenAutoFocus={onOpenAutoFocus}
            onEscapeKeyDown={dismissible ? undefined : (event) => event.preventDefault()}
            onPointerDownOutside={dismissible ? undefined : (event) => event.preventDefault()}
            // Radix warns when a dialog has no description unless aria-describedby is explicitly unset.
            {...(description ? {} : { 'aria-describedby': undefined })}
            className={cn(
              'pointer-events-auto flex max-h-[min(92dvh,56rem)] w-full flex-col overflow-hidden rounded-t-card border border-border bg-surface shadow-dialog outline-none sm:rounded-card',
              'data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in',
              SIZES[size],
              className,
            )}
          >
            <div className="flex items-start gap-3 px-5 pt-5 pb-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <DialogPrimitive.Title className="text-lg font-semibold text-fg">{title}</DialogPrimitive.Title>
                {description ? <DialogPrimitive.Description className="text-base text-muted">{description}</DialogPrimitive.Description> : null}
              </div>
              {hideClose ? null : (
                <DialogPrimitive.Close
                  aria-label="Close"
                  className="-mt-1 -mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-control text-subtle transition-colors hover:bg-hover hover:text-fg"
                >
                  <X aria-hidden="true" className="size-[1.125rem]" />
                </DialogPrimitive.Close>
              )}
            </div>
            {children !== undefined && children !== null ? <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5">{children}</div> : null}
            {footer ? (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2/60 px-5 py-3">{footer}</div>
            ) : null}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
