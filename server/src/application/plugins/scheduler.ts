/**
 * Plugin Scheduler Service
 *
 * Manages periodic tasks registered by plugins.
 */

import { systemTaskRegistry } from '../services/system-task-registry.js';

interface ScheduledEntry {
  pluginId: string;
  taskId: string;
  name: string;
  intervalMs: number;
  handler: () => Promise<void> | void;
  timerId: ReturnType<typeof setInterval> | null;
  systemId: string;
}

export class PluginSchedulerService {
  private tasks = new Map<string, ScheduledEntry>();

  register(
    pluginId: string,
    taskId: string,
    name: string,
    intervalMs: number,
    handler: () => Promise<void> | void,
    immediate = true,
  ): () => void {
    const systemId = `plugin:${pluginId}/${taskId}`;

    if (this.tasks.has(systemId)) {
      this.unregister(systemId);
    }

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

    entry.timerId = setInterval(() => {
      void this.executeTask(entry);
    }, intervalMs);

    this.tasks.set(systemId, entry);

    if (immediate) {
      void this.executeTask(entry);
    }

    return () => this.unregister(systemId);
  }

  unregister(idOrSystemId: string): void {
    const entry = this.tasks.get(idOrSystemId);
    if (!entry) {
      return;
    }

    if (entry.timerId !== null) {
      clearInterval(entry.timerId);
      entry.timerId = null;
    }
    this.tasks.delete(idOrSystemId);
    systemTaskRegistry.unregister(entry.systemId);
  }

  async trigger(systemId: string): Promise<void> {
    const entry = this.tasks.get(systemId);
    if (!entry) {
      throw new Error(`Scheduler task not found: ${systemId}`);
    }
    await this.executeTask(entry);
  }

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

  getAll(): Array<{ systemId: string; pluginId: string; taskId: string; name: string; intervalMs: number }> {
    return Array.from(this.tasks.values()).map((entry) => ({
      systemId: entry.systemId,
      pluginId: entry.pluginId,
      taskId: entry.taskId,
      name: entry.name,
      intervalMs: entry.intervalMs,
    }));
  }

  getByPlugin(pluginId: string): string[] {
    return Array.from(this.tasks.values())
      .filter((entry) => entry.pluginId === pluginId)
      .map((entry) => entry.systemId);
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
