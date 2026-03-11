import type { SystemTaskInfo, SystemTaskCategory } from '@my-claudia/shared';

export interface SystemTaskRegistration {
  id: string;
  name: string;
  description: string;
  category: SystemTaskCategory;
  intervalMs: number;
}

export class SystemTaskRegistry {
  private tasks = new Map<string, SystemTaskInfo>();

  register(info: SystemTaskRegistration): void {
    this.tasks.set(info.id, {
      ...info,
      status: 'idle',
      runCount: 0,
    });
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
