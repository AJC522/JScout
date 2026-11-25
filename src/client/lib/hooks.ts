/** Small, dependency-free React hooks used across the app. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isApplePlatform, isPlainKey, matchesHotkey, parseHotkey } from './hotkey';

/** The latest value of something, readable from callbacks without re-subscribing effects. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** `value`, but only after it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// --- localStorage ----------------------------------------------------------

const storageListeners = new Map<string, Set<() => void>>();
/** Used when localStorage is unavailable (private mode, quota) so the hook still works for the session. */
const memoryFallback = new Map<string, string>();

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function writeStorage(key: string, raw: string | null): void {
  try {
    if (raw === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, raw);
  } catch {
    if (raw === null) memoryFallback.delete(key);
    else memoryFallback.set(key, raw);
  }
  for (const listener of storageListeners.get(key) ?? []) listener();
}

function subscribeStorage(key: string, listener: () => void): () => void {
  const listeners = storageListeners.get(key) ?? new Set();
  storageListeners.set(key, listeners);
  listeners.add(listener);
  // "storage" fires for changes made by other tabs only; same-tab writes notify through the set above.
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function parseStored<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * State persisted as JSON in localStorage and kept in sync across components and tabs.
 * Returns [value, setValue, remove]. For per-device UI preferences only: anything the
 * user would miss after clearing the browser belongs in the profile/settings API.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [value: T, setValue: (next: T | ((previous: T) => T)) => void, remove: () => void] {
  const initial = useLatest(initialValue);
  const subscribe = useCallback((listener: () => void) => subscribeStorage(key, listener), [key]);
  const raw = useSyncExternalStore(
    subscribe,
    () => readStorage(key),
    () => null,
  );
  // Parsed from the raw string so the value keeps its identity until the stored text changes
  // (`initial` is a ref, deliberately not a dependency).
  const value = useMemo(() => parseStored(raw, initial.current), [raw, initial]);

  const setValue = useCallback(
    (next: T | ((previous: T) => T)) => {
      const previous = parseStored(readStorage(key), initial.current);
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
      writeStorage(key, JSON.stringify(resolved));
    },
    [key, initial],
  );
  const remove = useCallback(() => writeStorage(key, null), [key]);
  return [value, setValue, remove];
}

// --- media queries ---------------------------------------------------------

/** Whether a CSS media query currently matches, e.g. useMediaQuery('(max-width: 639.98px)'). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// --- hotkeys ---------------------------------------------------------------

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches('input, textarea, select, [role="combobox"], [role="textbox"]');
}

export interface HotkeyOptions {
  /** Default true. */
  enabled?: boolean;
  /** Fire even while the user is typing in a field. Shortcuts with Ctrl/⌘/Alt always do. */
  allowInInput?: boolean;
  /** Fire even while a dialog or drawer is open. Default false. */
  allowInModal?: boolean;
  /** Default true. */
  preventDefault?: boolean;
}

/**
 * Global keyboard shortcut. `combo` uses "+"-joined parts: "mod+k" (⌘K / Ctrl+K), "/",
 * "shift+enter", "escape". Pass several combos to bind alternatives.
 */
export function useHotkey(
  combo: string | readonly string[],
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {},
): void {
  const { enabled = true, allowInInput = false, allowInModal = false, preventDefault = true } = options;
  const latestHandler = useLatest(handler);
  const combos = typeof combo === 'string' ? combo : combo.join('\n');

  useEffect(() => {
    if (!enabled) return;
    const hotkeys = combos.split('\n').map(parseHotkey);
    const apple = isApplePlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const hotkey = hotkeys.find((candidate) => matchesHotkey(event, candidate, apple));
      if (!hotkey) return;
      if (!allowInInput && isPlainKey(hotkey) && isEditable(event.target)) return;
      // Dialog, Drawer and ConfirmDialog mark their content; page shortcuts must not act on what is behind them.
      if (!allowInModal && document.querySelector('[data-modal-layer]')) return;
      if (preventDefault) event.preventDefault();
      latestHandler.current(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [combos, enabled, allowInInput, allowInModal, preventDefault, latestHandler]);
}

// --- clipboard -------------------------------------------------------------

/** Clipboard write with a fallback for browsers/contexts where the async API is unavailable. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** `copy(text)` resolves to whether it worked; `copied` stays true for `resetMs` afterwards. */
export function useCopyToClipboard(resetMs = 1600): { copied: boolean; copy: (text: string) => Promise<boolean> } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      const ok = await writeClipboard(text);
      window.clearTimeout(timer.current);
      setCopied(ok);
      if (ok) timer.current = window.setTimeout(() => setCopied(false), resetMs);
      return ok;
    },
    [resetMs],
  );
  return { copied, copy };
}

// --- misc ------------------------------------------------------------------

/** Sets the browser tab title to "<title> · JScout" while the calling page is mounted. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · JScout`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** A timestamp that re-renders the caller every `intervalMs`, for relative times ("5m ago") that must not go stale. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
