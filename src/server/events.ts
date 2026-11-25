import type { ServerEvent } from '../shared/types';

export type EventListener = (event: ServerEvent) => void;

/** In-process pub/sub that feeds the /api/events stream. */
export class EventBus {
  private readonly listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: ServerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a broken subscriber must not affect the others */
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
