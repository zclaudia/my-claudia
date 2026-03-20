/**
 * Plugin Scheduler Service
 *
 * Manages periodic tasks registered by plugins. Instead of plugins running
 * their own setInterval, they register tasks here and the scheduler drives
 * execution centrally. This gives us:
 *  - Unified monitoring via SystemTaskRegistry
 *  - Automatic cleanup on plugin deactivate
 *  - Immediate first-run support
 *  - Global throttle / backoff potential
 */

import { systemTaskRegistry } from '../services/system-task-registry.js';

interface ScheduledEntry {
  pluginId: string;
  taskId: string;
  name: string;
  intervalMs: number;
  handler: () => Promise<void> | void;
  timerId: ReturnType<typeof setInterval> | null;
  /** Fully-qualified ID used in SystemTaskRegistry: plugin:<pluginId>/<taskId> */
  systemId: string;
}

export class PluginSchedulerService {
  private tasks = new Map<string, ScheduledEntry>();

  /**
   * Register a periodic task for a plugin.
   * @returns dispose function to unregister
   */
  register(
    pluginId: string,
    taskId: string,
    name: string,
    intervalMs: number,
    handler: () => Promise<void> | void,
    immediate = true,
  ): () => void {
    const systemId = `plugin:${pluginId}/${taskId}`;

    // Prevent duplicate registration
    if (this.tasks.has(systemId)) {
      this.unregister(systemId);
    }

    // Register in SystemTaskRegistry for monitoring
    systemTaskRegistry.register({
      id: systemId,
      name: `[${pluginId}] ${name}`,
      description: `Plugin periodic task: ${name}`,
      category: 'plugin',
      intervalMs,
    });

    const entry: ScheduledEntry = {
      pluginId,
      taskId,
      name,
      intervalMs,
      handler,
      timerId: null,
      systemId,
    };

    // Start interval
    entry.timerId = setInterval(() => {
      this.executeTask(entry);
    }, intervalMs);

    this.tasks.set(systemId, entry);

    // Immediate first run
    if (immediate) {
      this.executeTask(entry);
    }

    return () => this.unregister(systemId);
  }

  /**
   * Unregister a task by its system ID or by plugin-scoped taskId.
   */
  unregister(idOrSystemId: string): void {
    const entry = this.tasks.get(idOrSystemId);
    if (!entry) return;

    if (entry.timerId !== null) {
      clearInterval(entry.timerId);
      entry.timerId = null;
    }
    this.tasks.delete(idOrSystemId);
    systemTaskRegistry.unregister(entry.systemId);
  }

  /**
   * Trigger a task immediately (outside its regular schedule).
   */
  async trigger(systemId: string): Promise<void> {
    const entry = this.tasks.get(systemId);
    if (!entry) {
      throw new Error(`Scheduler task not found: ${systemId}`);
    }
    await this.executeTask(entry);
  }

  /**
   * Remove all tasks belonging to a plugin. Called on deactivate.
   */
  clearByPlugin(pluginId: string): void {
    for (const [systemId, entry] of this.tasks) {
      if (entry.pluginId === pluginId) {
        if (entry.timerId !== null) {
          clearInterval(entry.timerId);
        }
        this.tasks.delete(systemId);
        systemTaskRegistry.unregister(entry.systemId);
      }
    }
  }

  /**
   * Get all registered tasks (for diagnostics).
   */
  getAll(): Array<{ systemId: string; pluginId: string; taskId: string; name: string; intervalMs: number }> {
    return Array.from(this.tasks.values()).map(e => ({
      systemId: e.systemId,
      pluginId: e.pluginId,
      taskId: e.taskId,
      name: e.name,
      intervalMs: e.intervalMs,
    }));
  }

  /**
   * Get tasks for a specific plugin.
   */
  getByPlugin(pluginId: string): string[] {
    return Array.from(this.tasks.values())
      .filter(e => e.pluginId === pluginId)
      .map(e => e.systemId);
  }

  private async executeTask(entry: ScheduledEntry): Promise<void> {
    systemTaskRegistry.markRunStart(entry.systemId);
    const start = Date.now();
    try {
      await entry.handler();
      systemTaskRegistry.markRunComplete(entry.systemId, Date.now() - start);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      systemTaskRegistry.markRunComplete(entry.systemId, Date.now() - start, errorMsg);
      console.error(`[PluginScheduler] Task ${entry.systemId} failed:`, errorMsg);
    }
  }
}

export const pluginScheduler = new PluginSchedulerService();
