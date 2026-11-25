import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { CircleCheck, CircleExclamationPoint, Info, X } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** How a screen-reader user can do the same thing without the toast; defaults to the label. */
  altText?: string;
}

export interface ToastOptions {
  description?: ReactNode;
  action?: ToastAction;
  /** Milliseconds before it hides itself. Defaults: 4s success/info, 7s error, 8s with an action. */
  duration?: number;
  /** Reusing an id replaces that toast instead of stacking a new one (e.g. repeated "Saved"). */
  id?: string;
}

export interface ToastApi {
  success: (title: ReactNode, options?: ToastOptions) => string;
  error: (title: ReactNode, options?: ToastOptions) => string;
  info: (title: ReactNode, options?: ToastOptions) => string;
  /** Hide one toast, or all when called without an id. */
  dismiss: (id?: string) => void;
}

interface ToastItem extends ToastOptions {
  id: string;
  tone: ToastTone;
  title: ReactNode;
  open: boolean;
}

const MAX_VISIBLE = 4;
/** Long enough for the exit animation to finish before the item is dropped. */
const REMOVE_DELAY_MS = 200;

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CircleCheck className="text-success" />,
  error: <CircleExclamationPoint className="text-danger" />,
  info: <Info className="text-info" />,
};

function defaultDuration(tone: ToastTone, options: ToastOptions): number {
  if (options.duration !== undefined) return options.duration;
  if (options.action) return 8000;
  return tone === 'error' ? 7000 : 4000;
}

/** Hosts toasts for useToast(). Mounted once in App. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const close = useCallback((id: string) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, open: false } : item)));
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id || item.open)), REMOVE_DELAY_MS);
  }, []);

  const api = useMemo<ToastApi>(() => {
    const show = (tone: ToastTone, title: ReactNode, options: ToastOptions = {}) => {
      counter.current += 1;
      const id = options.id ?? `toast-${counter.current}`;
      const item: ToastItem = { ...options, id, tone, title, open: true, duration: defaultDuration(tone, options) };
      setItems((current) => {
        const others = current.filter((existing) => existing.id !== id);
        const open = others.filter((existing) => existing.open);
        // Too many at once: the oldest go first.
        const overflow = new Set(open.slice(0, Math.max(0, open.length - (MAX_VISIBLE - 1))).map((existing) => existing.id));
        return [...others.map((existing) => (overflow.has(existing.id) ? { ...existing, open: false } : existing)), item];
      });
      return id;
    };
    return {
      success: (title, options) => show('success', title, options),
      error: (title, options) => show('error', title, options),
      info: (title, options) => show('info', title, options),
      dismiss: (id) => {
        if (id) close(id);
        else setItems((current) => current.map((item) => ({ ...item, open: false })));
      },
    };
  }, [close]);

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider swipeDirection="right" label="Notification">
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            open={item.open}
            onOpenChange={(open) => {
              if (!open) close(item.id);
            }}
            duration={item.duration}
            // Errors interrupt the screen reader; confirmations wait their turn.
            type={item.tone === 'error' ? 'foreground' : 'background'}
            className={cn(
              'pointer-events-auto relative flex w-full items-start gap-3 rounded-card border border-border bg-surface py-3 pr-2.5 pl-3.5 text-fg shadow-overlay',
              'data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out',
              'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=end]:animate-toast-out',
            )}
          >
            <span aria-hidden="true" className="mt-px flex shrink-0 [&_svg]:size-[1.125rem]">
              {ICONS[item.tone]}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
              <ToastPrimitive.Title className="text-base font-medium text-fg">{item.title}</ToastPrimitive.Title>
              {item.description ? <ToastPrimitive.Description className="text-sm text-muted">{item.description}</ToastPrimitive.Description> : null}
              {item.action ? (
                <ToastPrimitive.Action altText={item.action.altText ?? item.action.label} asChild>
                  <button
                    type="button"
                    onClick={item.action.onClick}
                    className="mt-1.5 w-fit rounded-md text-sm font-semibold text-primary underline-offset-[3px] hover:underline"
                  >
                    {item.action.label}
                  </button>
                </ToastPrimitive.Action>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label="Dismiss notification"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-fg"
            >
              <X aria-hidden="true" className="size-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport
          label="Notifications ({hotkey})"
          className="pointer-events-none fixed right-0 bottom-0 z-[60] flex w-full flex-col gap-2 p-4 outline-none sm:max-w-[400px] sm:p-5"
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/**
 * const toast = useToast();
 * toast.success('Saved to tracker', { action: { label: 'Open', onClick: () => navigate('/tracker/1') } });
 * toast.error('Could not sync', { description: errorMessage(err) });
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
