import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertDialog } from 'radix-ui';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { useRestoreFocus } from './Dialog';

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  /** Default "Confirm". Name the action: "Delete application", "Reset index". */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** "danger" for destructive or irreversible actions. */
  tone?: 'default' | 'danger';
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** Shows a spinner on the confirm button and keeps the dialog open (for async confirms). */
  loading?: boolean;
}

/**
 * A yes/no question before a consequential action. Uses Radix AlertDialog: it can't be
 * dismissed by clicking outside, and focus starts on Cancel so Enter never destroys data by accident.
 */
export function ConfirmDialog({ open, onOpenChange, onConfirm, loading = false, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default' }: ConfirmDialogProps) {
  const restoreFocus = useRestoreFocus(open);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <AlertDialog.Content
            data-modal-layer=""
            onCloseAutoFocus={restoreFocus}
            {...(description ? {} : { 'aria-describedby': undefined })}
            className={cn(
              'pointer-events-auto w-full max-w-[420px] rounded-card border border-border bg-surface p-5 shadow-dialog outline-none',
              'data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in',
            )}
          >
            <AlertDialog.Title className="text-lg font-semibold text-fg">{title}</AlertDialog.Title>
            {description ? <AlertDialog.Description className="mt-1.5 text-base text-muted">{description}</AlertDialog.Description> : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button disabled={loading}>{cancelLabel}</Button>
              </AlertDialog.Cancel>
              <Button
                variant={tone === 'danger' ? 'danger' : 'primary'}
                loading={loading}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Hosts the dialog behind useConfirm(). Mounted once in App. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback<ConfirmFn>((next) => {
    // A second request while one is open answers the first with "no" rather than leaving it hanging.
    resolver.current?.(false);
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options ? (
        <ConfirmDialog
          {...options}
          open={open}
          onOpenChange={(next) => {
            if (!next) settle(false);
          }}
          onConfirm={() => settle(true)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

/**
 * Promise-based confirmation:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete this application?', tone: 'danger', confirmLabel: 'Delete' })) …
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return confirm;
}
