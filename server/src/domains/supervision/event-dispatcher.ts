export type EventHandler<E> = (event: E) => void;

export class EventDispatcher<E extends { type: string }> {
  private handlers = new Map<string, EventHandler<E>[]>();
  private wildcardHandlers: EventHandler<E>[] = [];

  on(eventType: string, handler: EventHandler<E>): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  onAny(handler: EventHandler<E>): void {
    this.wildcardHandlers.push(handler);
  }

  off(eventType: string, handler: EventHandler<E>): void {
    const list = this.handlers.get(eventType);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx === -1) return;
    list.splice(idx, 1);
    if (list.length === 0) this.handlers.delete(eventType);
  }

  offAny(handler: EventHandler<E>): void {
    const idx = this.wildcardHandlers.indexOf(handler);
    if (idx === -1) return;
    this.wildcardHandlers.splice(idx, 1);
  }

  dispatch(event: E): void {
    const specific = this.handlers.get(event.type);
    if (specific) {
      for (const h of specific) {
        try { h(event); } catch (err) {
          console.error(`[EventDispatcher] Handler error for ${event.type}:`, err);
        }
      }
    }
    for (const h of this.wildcardHandlers) {
      try { h(event); } catch (err) {
        console.error(`[EventDispatcher] Wildcard handler error for ${event.type}:`, err);
      }
    }
  }

  dispatchAll(events: E[]): void {
    for (const event of events) {
      this.dispatch(event);
    }
  }
}
