import { EVENTS_PATH } from '../../shared/api';
import type { ServerEvent } from '../../shared/types';

export type ServerEventHandler = (event: ServerEvent) => void;

/**
 * Subscribe to the server's event stream (sync progress, index changes).
 * EventSource reconnects on its own; returns an unsubscribe function.
 */
export function subscribeToEvents(handler: ServerEventHandler): () => void {
  const source = new EventSource(EVENTS_PATH);
  source.onmessage = (message) => {
    try {
      handler(JSON.parse(message.data as string) as ServerEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => source.close();
}
