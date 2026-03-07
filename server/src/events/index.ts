/**
 * Plugin Event System - Event emission and subscription for plugins.
 *
 * This system enables plugins to subscribe to application lifecycle events
 * and emit custom events. It follows a pub/sub pattern with proper cleanup.
 *
 * Usage:
 *   // Subscribe to an event
 *   const unsubscribe = pluginEvents.on('run.started', (data) => {
 *     console.log('Run started:', data);
 *   });
 *
 *   // Emit an event
 *   await pluginEvents.emit('run.completed', { sessionId, result });
 *
 *   // Unsubscribe
 *   unsubscribe();
 */

// ============================================
// Types
// ============================================

export type PluginEvent =
  // Lifecycle events
  | 'plugin.loaded'
  | 'plugin.activated'
  | 'plugin.deactivated'
  | 'plugin.error'
  // App events
  | 'app.ready'
  | 'app.quit'
  // Run events
  | 'run.started'
  | 'run.message'
  | 'run.toolCall'
  | 'run.toolResult'
  | 'run.completed'
  | 'run.error'
  // Session events
  | 'session.created'
  | 'session.message'
  | 'session.deleted'
  | 'session.archived'
  | 'session.restored'
  // Project events
  | 'project.opened'
  | 'project.closed'
  // Permission events
  | 'permission.request'
  | 'permission.approved'
  | 'permission.denied'
  // File events
  | 'file.beforeSave'
  | 'file.saved'
  | 'file.opened'
  // Provider events
  | 'provider.changed'
  // Custom events (plugins can emit any string, namespace: 'pluginId.eventName')
  | string;

export interface EventData {
  [key: string]: unknown;
}

export interface EventListener {
  (data: EventData, pluginId?: string): void | Promise<void>;
}

export interface Subscription {
  event: PluginEvent;
  listener: EventListener;
  pluginId?: string;
}

// ============================================
// Plugin Event Emitter
// ============================================

class PluginEventEmitter {
  private listeners = new Map<PluginEvent, Set<Subscription>>();
  private onceListeners = new Map<PluginEvent, Set<Subscription>>();

  /**
   * Subscribe to an event.
   * @param event - The event name to subscribe to
   * @param listener - The callback function
   * @param pluginId - Optional plugin ID for tracking
   * @returns Unsubscribe function
   */
  on(event: PluginEvent, listener: EventListener, pluginId?: string): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const subscription: Subscription = { event, listener, pluginId };
    this.listeners.get(event)!.add(subscription);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(subscription);
    };
  }

  /**
   * Subscribe to an event for a single occurrence.
   * @param event - The event name to subscribe to
   * @param listener - The callback function
   * @param pluginId - Optional plugin ID for tracking
   */
  once(event: PluginEvent, listener: EventListener, pluginId?: string): void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }

    const subscription: Subscription = { event, listener, pluginId };
    this.onceListeners.get(event)!.add(subscription);
  }

  /**
   * Unsubscribe from an event.
   * @param event - The event name
   * @param listener - The callback function to remove
   */
  off(event: PluginEvent, listener: EventListener): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const sub of listeners) {
        if (sub.listener === listener) {
          listeners.delete(sub);
          break;
        }
      }
    }

    const onceListeners = this.onceListeners.get(event);
    if (onceListeners) {
      for (const sub of onceListeners) {
        if (sub.listener === listener) {
          onceListeners.delete(sub);
          break;
        }
      }
    }
  }

  /**
   * Emit an event to all subscribers.
   * @param event - The event name
   * @param data - The event data
   * @param sourcePluginId - Optional ID of the plugin that emitted the event
   */
  async emit(event: PluginEvent, data: EventData = {}, sourcePluginId?: string): Promise<void> {
    // Get regular listeners
    const listeners = this.listeners.get(event);
    const promises: Promise<void>[] = [];

    if (listeners) {
      for (const sub of listeners) {
        try {
          const result = sub.listener(data, sourcePluginId);
          if (result instanceof Promise) {
            // Wrap promise to catch errors gracefully
            promises.push(
              result.catch((error) => {
                console.error(
                  `[PluginEvents] Error in async listener for "${event}":`,
                  error instanceof Error ? error.message : String(error)
                );
              })
            );
          }
        } catch (error) {
          console.error(
            `[PluginEvents] Error in listener for "${event}":`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    // Get once listeners
    const onceListeners = this.onceListeners.get(event);
    if (onceListeners) {
      const toRemove = Array.from(onceListeners);
      onceListeners.clear();

      for (const sub of toRemove) {
        try {
          const result = sub.listener(data, sourcePluginId);
          if (result instanceof Promise) {
            // Wrap promise to catch errors gracefully
            promises.push(
              result.catch((error) => {
                console.error(
                  `[PluginEvents] Error in async once listener for "${event}":`,
                  error instanceof Error ? error.message : String(error)
                );
              })
            );
          }
        } catch (error) {
          console.error(
            `[PluginEvents] Error in once listener for "${event}":`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    // Wait for all async listeners to complete
    await Promise.all(promises);
  }

  /**
   * Emit an event synchronously (does not wait for async listeners).
   * @param event - The event name
   * @param data - The event data
   * @param sourcePluginId - Optional ID of the plugin that emitted the event
   */
  emitSync(event: PluginEvent, data: EventData = {}, sourcePluginId?: string): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const sub of listeners) {
        try {
          sub.listener(data, sourcePluginId);
        } catch (error) {
          console.error(
            `[PluginEvents] Error in listener for "${event}":`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    const onceListeners = this.onceListeners.get(event);
    if (onceListeners) {
      const toRemove = Array.from(onceListeners);
      onceListeners.clear();

      for (const sub of toRemove) {
        try {
          sub.listener(data, sourcePluginId);
        } catch (error) {
          console.error(
            `[PluginEvents] Error in once listener for "${event}":`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }
  }

  /**
   * Remove all listeners for a specific plugin.
   * Called when a plugin is deactivated or uninstalled.
   * @param pluginId - The plugin ID
   */
  clearByPlugin(pluginId: string): number {
    let count = 0;

    for (const [, subscriptions] of this.listeners) {
      for (const sub of Array.from(subscriptions)) {
        if (sub.pluginId === pluginId) {
          subscriptions.delete(sub);
          count++;
        }
      }
    }

    for (const [, subscriptions] of this.onceListeners) {
      for (const sub of Array.from(subscriptions)) {
        if (sub.pluginId === pluginId) {
          subscriptions.delete(sub);
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Get the number of listeners for a specific event.
   */
  listenerCount(event: PluginEvent): number {
    const regular = this.listeners.get(event)?.size || 0;
    const once = this.onceListeners.get(event)?.size || 0;
    return regular + once;
  }

  /**
   * Get the total number of all listeners.
   */
  get totalListeners(): number {
    let count = 0;
    for (const [, subs] of this.listeners) {
      count += subs.size;
    }
    for (const [, subs] of this.onceListeners) {
      count += subs.size;
    }
    return count;
  }

  /**
   * Clear all listeners (mainly for testing).
   */
  clear(): void {
    this.listeners.clear();
    this.onceListeners.clear();
  }
}

// ============================================
// Singleton Export
// ============================================

export const pluginEvents = new PluginEventEmitter();
