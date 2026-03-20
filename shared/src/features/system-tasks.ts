// System Task Types

export type SystemTaskCategory = 'scheduling' | 'sync' | 'maintenance' | 'supervision' | 'plugin';

export interface SystemTaskInfo {
  id: string;
  name: string;
  description: string;
  category: SystemTaskCategory;
  intervalMs: number;
  status: 'running' | 'idle' | 'error';
  lastRunAt?: number;
  lastRunDurationMs?: number;
  lastError?: string;
  runCount: number;
}
