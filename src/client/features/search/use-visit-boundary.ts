/** Remembers visits to each search in localStorage and returns the "new since" boundary for the current one. */
import { useEffect, useState } from 'react';
import type { IsoDate } from '../../../shared/types';
import { parseVisitLog, recordVisit, SEEN_STORAGE_KEY } from './seen';

function readLog() {
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    return parseVisitLog(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

function writeLog(log: object): void {
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Storage full or blocked: "new" badges are a nicety, the search still works.
  }
}

/** Boundary for `signature`, recorded once per activation (re-running the same search within a visit keeps it). */
export function useVisitBoundary(signature: string, enabled: boolean): IsoDate | undefined {
  const [state, setState] = useState<{ signature: string; since: IsoDate | undefined } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const { log, since } = recordVisit(readLog(), signature, new Date());
    writeLog(log);
    setState({ signature, since });
  }, [signature, enabled]);

  return state?.signature === signature ? state.since : undefined;
}
