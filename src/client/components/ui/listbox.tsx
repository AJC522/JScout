/*
 * Internals shared by Combobox and TagInput: debounced async option loading and the
 * floating listbox anchored under a text box. The text box keeps DOM focus the whole
 * time; the highlighted option is conveyed with aria-activedescendant.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';
import { useDebouncedValue } from '../../lib/hooks';
import { POPOVER_PANEL } from './Popover';
import { Spinner } from './Spinner';

export type OptionLoader<T> = (query: string, signal: AbortSignal) => Promise<readonly T[]>;

const CACHE_LIMIT = 50;

/**
 * Options for `query` from `loader`, debounced, with stale responses discarded and
 * recent answers cached so backspacing is instant.
 */
export function useAsyncOptions<T>(
  loader: OptionLoader<T> | undefined,
  query: string,
  { enabled, debounceMs, minChars }: { enabled: boolean; debounceMs: number; minChars: number },
): { options: readonly T[]; loading: boolean; failed: boolean } {
  const debounced = useDebouncedValue(query.trim(), debounceMs);
  // Callers usually pass an inline function; keeping it in a ref stops each render from refetching.
  const loaderRef = useRef(loader);
  useLayoutEffect(() => {
    loaderRef.current = loader;
  });
  const cache = useRef(new Map<string, readonly T[]>());
  const [state, setState] = useState<{ query: string; options: readonly T[]; loading: boolean; failed: boolean }>({
    query: '',
    options: [],
    loading: false,
    failed: false,
  });

  useEffect(() => {
    const load = loaderRef.current;
    if (!enabled || !load || debounced.length < minChars) {
      setState({ query: debounced, options: [], loading: false, failed: false });
      return;
    }
    const cached = cache.current.get(debounced);
    if (cached) {
      setState({ query: debounced, options: cached, loading: false, failed: false });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, failed: false }));
    load(debounced, controller.signal).then(
      (options) => {
        if (controller.signal.aborted) return;
        cache.current.set(debounced, options);
        if (cache.current.size > CACHE_LIMIT) {
          const oldest = cache.current.keys().next().value;
          if (oldest !== undefined) cache.current.delete(oldest);
        }
        setState({ query: debounced, options, loading: false, failed: false });
      },
      () => {
        // Suggestions are a convenience: on failure the box keeps working as plain text entry.
        if (!controller.signal.aborted) setState({ query: debounced, options: [], loading: false, failed: true });
      },
    );
    return () => controller.abort();
  }, [debounced, enabled, minChars]);

  // While the debounce is pending, the previous options stay visible instead of flashing empty.
  const pending = query.trim() !== debounced;
  return { options: state.options, loading: state.loading || (pending && query.trim().length >= minChars && Boolean(loader)), failed: state.failed };
}

export function optionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/** Next highlighted index for ArrowDown (+1) / ArrowUp (-1), wrapping; -1 means none. */
export function moveActiveIndex(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

export interface OptionListProps<T> {
  listId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bordered text box; the list is positioned under it and matches its width. */
  anchor: ReactNode;
  options: readonly T[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (option: T) => void;
  getKey: (option: T) => string;
  renderOption: (option: T, active: boolean) => ReactNode;
  loading: boolean;
  /** Shown when nothing matched; omit to hide the list instead. */
  emptyMessage?: ReactNode;
  label?: string;
  /** Id of a visible label (the surrounding Field's), used when `label` is not given. */
  labelledBy?: string;
}

export function OptionList<T>({ listId, open, onOpenChange, anchor, options, activeIndex, onActiveIndexChange, onSelect, getKey, renderOption, loading, emptyMessage, label, labelledBy }: OptionListProps<T>) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const showEmpty = !loading && options.length === 0 && emptyMessage !== undefined;
  const visible = open && (options.length > 0 || loading || showEmpty);

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(listId, activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listId]);

  return (
    <PopoverPrimitive.Root open={visible} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor asChild>
        <div ref={anchorRef} className="min-w-0">
          {anchor}
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          // Focus stays in the text box: the list is navigated with the arrow keys from there.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchorRef.current?.contains(event.target)) event.preventDefault();
          }}
          className={cn(
            POPOVER_PANEL,
            'w-[var(--radix-popover-trigger-width)] min-w-56 overflow-hidden rounded-control p-0',
          )}
        >
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            aria-labelledby={label ? undefined : labelledBy}
            // mousedown anywhere in the list (an option, the scrollbar) would blur the text box and close it.
            onMouseDown={(event) => event.preventDefault()}
            className="max-h-[min(20rem,var(--radix-popover-content-available-height))] overflow-y-auto p-1"
          >
            {options.map((option, index) => {
              const active = index === activeIndex;
              return (
                <li
                  key={getKey(option)}
                  id={optionId(listId, index)}
                  role="option"
                  aria-selected={active}
                  onMouseMove={() => {
                    if (!active) onActiveIndexChange(index);
                  }}
                  onClick={() => onSelect(option)}
                  className={cn(
                    'flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-base text-fg select-none',
                    active && 'bg-hover',
                  )}
                >
                  {renderOption(option, active)}
                </li>
              );
            })}
            {loading && options.length === 0 ? (
              <li role="presentation" className="flex h-8 items-center gap-2 px-2 text-sm text-muted">
                <Spinner size="sm" label={null} /> Searching…
              </li>
            ) : null}
            {showEmpty ? (
              <li role="presentation" className="flex min-h-8 items-center px-2 text-sm text-muted">
                {emptyMessage}
              </li>
            ) : null}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Wraps the first case-insensitive occurrence of `query` in <mark> (bold, no background). */
export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}
