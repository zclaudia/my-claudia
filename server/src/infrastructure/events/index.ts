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

const patternRegexCache = new Map<string, RegExp>();

function matchesEventPattern(event: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern === event) return true;
  let regex = patternRegexCache.get(pattern);
  if (!regex) {
    // * matches a single segment (no dots), ** matches any number of segments
    // Use placeholders to avoid escaping conflicts
    let src = pattern.replace(/\*\*/g, '\0MULTI\0');
    src = src.replace(/\*/g, '\0SINGLE\0');
    src = src.replace(/\./g, '\\.');
    src = src.replace(/\0MULTI\0/g, '.*');
    src = src.replace(/\0SINGLE\0/g, '[^.]*');
    regex = new RegExp(`^${src}$`);
    patternRegexCache.set(pattern, regex);
  }
  return regex.test(event);
}

// ============================================
// Plugin Event Emitter
// ============================================

class PluginEventEmitter {
  private listeners = new Map<PluginEvent, Set<Subscription>>();
  private onceListeners = new Map<PluginEvent, Set<Subscription>>();
  private patternListeners = new Map<string, Set<Subscription>>();
  private oncePatternListeners = new Map<string, Set<Subscription>>();

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

  onPattern(pattern: string, listener: EventListener, pluginId?: string): () => void {
    if (!this.patternListeners.has(pattern)) {
      this.patternListeners.set(pattern, new Set());
    }

    const subscription: Subscription = { event: pattern, listener, pluginId };
    this.patternListeners.get(pattern)!.add(subscription);

    return () => {
      this.patternListeners.get(pattern)?.delete(subscription);
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

  oncePattern(pattern: string, listener: EventListener, pluginId?: string): void {
    if (!this.oncePatternListeners.has(pattern)) {
      this.oncePatternListeners.set(pattern, new Set());
    }

    const subscription: Subscription = { event: pattern, listener, pluginId };
    this.oncePatternListeners.get(pattern)!.add(subscription);
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

  offPattern(pattern: string, listener: EventListener): void {
    const listeners = this.patternListeners.get(pattern);
    if (listeners) {
      for (const sub of listeners) {
        if (sub.listener === listener) {
          listeners.delete(sub);
          break;
        }
      }
    }

    const onceListeners = this.oncePatternListeners.get(pattern);
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
  /**
   * Check if any listener is subscribed to the given event (exact or pattern match).
   */
  hasListeners(event: PluginEvent): boolean {
    const exact = this.listeners.get(event);
    if (exact && exact.size > 0) return true;
    for (const [pattern, subs] of this.patternListeners) {
      if (subs.size > 0 && matchesEventPattern(event, pattern)) return true;
    }
    return false;
  }

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

    for (const [pattern, subscriptions] of this.patternListeners) {
      if (!matchesEventPattern(event, pattern)) continue;
      for (const sub of subscriptions) {
        try {
          const result = sub.listener(data, sourcePluginId);
          if (result instanceof Promise) {
            promises.push(
              result.catch((error) => {
                console.error(
                  `[PluginEvents] Error in async pattern listener for "${event}" (${pattern}):`,
                  error instanceof Error ? error.message : String(error)
                );
              })
            );
          }
        } catch (error) {
          console.error(
            `[PluginEvents] Error in pattern listener for "${event}" (${pattern}):`,
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

    for (const [pattern, subscriptions] of this.oncePatternListeners) {
      if (!matchesEventPattern(event, pattern)) continue;
      const toRemove = Array.from(subscriptions);
      subscriptions.clear();

      for (const sub of toRemove) {
        try {
          const result = sub.listener(data, sourcePluginId);
          if (result instanceof Promise) {
            promises.push(
              result.catch((error) => {
                console.error(
                  `[PluginEvents] Error in async once pattern listener for "${event}" (${pattern}):`,
                  error instanceof Error ? error.message : String(error)
                );
              })
            );
          }
        } catch (error) {
          console.error(
            `[PluginEvents] Error in once pattern listener for "${event}" (${pattern}):`,
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

    for (const [pattern, subscriptions] of this.patternListeners) {
      if (!matchesEventPattern(event, pattern)) continue;
      for (const sub of subscriptions) {
        try {
          sub.listener(data, sourcePluginId);
        } catch (error) {
          console.error(
            `[PluginEvents] Error in pattern listener for "${event}" (${pattern}):`,
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

    for (const [pattern, subscriptions] of this.oncePatternListeners) {
      if (!matchesEventPattern(event, pattern)) continue;
      const toRemove = Array.from(subscriptions);
      subscriptions.clear();

      for (const sub of toRemove) {
        try {
          sub.listener(data, sourcePluginId);
        } catch (error) {
          console.error(
            `[PluginEvents] Error in once pattern listener for "${event}" (${pattern}):`,
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

    for (const [, subscriptions] of this.patternListeners) {
      for (const sub of Array.from(subscriptions)) {
        if (sub.pluginId === pluginId) {
          subscriptions.delete(sub);
          count++;
        }
      }
    }

    for (const [, subscriptions] of this.oncePatternListeners) {
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
    for (const [, subs] of this.patternListeners) {
      count += subs.size;
    }
    for (const [, subs] of this.oncePatternListeners) {
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
    this.patternListeners.clear();
    this.oncePatternListeners.clear();
  }
}

// ============================================
// Singleton Export
// ============================================

export const pluginEvents = new PluginEventEmitter();
