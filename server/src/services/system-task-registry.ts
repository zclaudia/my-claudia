import type { SystemTaskInfo, SystemTaskCategory } from '@my-claudia/shared';

export interface SystemTaskRegistration {
  id: string;
  name: string;
  description: string;
  category: SystemTaskCategory;
  intervalMs: number;
}

/** Port interface consumed by domain modules that need to report system task health. */
export interface SystemTaskRegistryPort {
  register(info: { id: string; name: string; description: string; category: string; intervalMs: number }): void;
  markRunStart(id: string): void;
  markRunComplete(id: string, durationMs: number, error?: string): void;
}

export class SystemTaskRegistry implements SystemTaskRegistryPort {
  private tasks = new Map<string, SystemTaskInfo>();

  register(info: SystemTaskRegistration): void {
    this.tasks.set(info.id, {
      ...info,
      status: 'idle',
      runCount: 0,
    });
  }

  unregister(id: string): boolean {
    return this.tasks.delete(id);
  }

  markRunStart(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'running';
      task.lastRunAt = Date.now();
    }
  }

  markRunComplete(id: string, durationMs: number, error?: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = error ? 'error' : 'idle';
      task.lastRunDurationMs = durationMs;
      task.lastError = error;
      task.runCount++;
    }
  }

  getAll(): SystemTaskInfo[] {
    return Array.from(this.tasks.values());
  }

  getById(id: string): SystemTaskInfo | undefined {
    return this.tasks.get(id);
  }
}

export const systemTaskRegistry = new SystemTaskRegistry();
