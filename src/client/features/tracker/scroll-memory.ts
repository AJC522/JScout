/**
 * Remembers where the board was scrolled when the user opened an application, so coming back
 * (by the back link, the browser's back button or the sidebar) lands in the same place.
 */
const KEY = 'jscout.tracker.scroll';
/** Older positions are stale: the user has moved on. */
const MAX_AGE_MS = 30 * 60_000;

interface Saved {
  x: number;
  y: number;
  at: number;
}

export function saveTrackerScroll(x: number, y: number): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ x, y, at: Date.now() } satisfies Saved));
  } catch {
    // Storage can be unavailable (private mode, quota); losing the position is harmless.
  }
}

/** The saved position, removed so it is restored only once. */
export function takeTrackerScroll(): { x: number; y: number } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Saved>;
    if (typeof saved.x !== 'number' || typeof saved.y !== 'number' || typeof saved.at !== 'number') return null;
    return Date.now() - saved.at > MAX_AGE_MS ? null : { x: saved.x, y: saved.y };
  } catch {
    return null;
  }
}
