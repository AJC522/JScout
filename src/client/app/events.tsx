import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Bootstrap, IndexSummary, ServerEvent } from '../../shared/types';
import { subscribeToEvents, type ServerEventHandler } from '../api/events';
import { qk } from '../lib/query';
import { useBootstrap } from './bootstrap';

type Subscribe = (handler: ServerEventHandler) => () => void;

const EventsContext = createContext<Subscribe | null>(null);

function patchIndex(queryClient: QueryClient, patch: (index: IndexSummary) => IndexSummary): void {
  queryClient.setQueryData<Bootstrap>(qk.bootstrap(), (old) => (old ? { ...old, index: patch(old.index) } : old));
}

/** Keeps the bootstrap query's index summary in step with the server's event stream. */
export function applyServerEvent(queryClient: QueryClient, event: ServerEvent): void {
  switch (event.type) {
    case 'hello':
    case 'index-changed':
      patchIndex(queryClient, () => event.index);
      return;
    case 'sync-started':
      patchIndex(queryClient, (index) => ({ ...index, syncing: true, pendingFeeds: event.feeds }));
      return;
    case 'feed-finished':
      patchIndex(queryClient, (index) => ({ ...index, pendingFeeds: event.pendingFeeds }));
      return;
    case 'sync-finished':
      patchIndex(queryClient, () => event.index);
      // New postings can change the saved-search "new results" badge, which only bootstrap knows.
      void queryClient.invalidateQueries({ queryKey: qk.bootstrap() });
      return;
  }
}

/**
 * Opens the app's single connection to GET /api/events. Pages listen with useServerEvent()
 * instead of opening their own EventSource.
 */
export function EventsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<ServerEventHandler>());

  useEffect(
    () =>
      subscribeToEvents((event) => {
        applyServerEvent(queryClient, event);
        for (const listener of listeners.current) listener(event);
      }),
    [queryClient],
  );

  const [subscribe] = useState<Subscribe>(() => (handler) => {
    listeners.current.add(handler);
    return () => {
      listeners.current.delete(handler);
    };
  });

  return <EventsContext.Provider value={subscribe}>{children}</EventsContext.Provider>;
}

/**
 * Run `handler` for every server event while the calling component is mounted, e.g. to
 * refresh results when a sync finishes:
 *   useServerEvent((e) => { if (e.type === 'sync-finished') void refetch(); });
 */
export function useServerEvent(handler: ServerEventHandler): void {
  const subscribe = useContext(EventsContext);
  if (!subscribe) throw new Error('useServerEvent must be used inside <EventsProvider>');
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}

export interface SyncState {
  syncing: boolean;
  /** Feeds still queued or running. */
  pendingFeeds: number;
  /** Undefined until bootstrap has loaded. */
  index: IndexSummary | undefined;
}

/** Live sync progress and index totals, for status lines and "syncing…" indicators. */
export function useSyncState(): SyncState {
  const index = useBootstrap().data?.index;
  return { syncing: index?.syncing ?? false, pendingFeeds: index?.pendingFeeds ?? 0, index };
}
