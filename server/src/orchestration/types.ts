/**
 * TaskOrchestrator types — unified task orchestration layer.
 *
 * Phase 2: TaskOrchestrator only owns kind='agent' tasks.
 * Supervision / Workflow / ScheduledTask keep their own tickers.
 * External tasks are mirrored via syncExternalTask() for visibility.
 */

export type TaskKind = 'agent' | 'supervision' | 'workflow' | 'scheduled';
export type TaskStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export interface OrchestratorTask {
  id: string;
  parentTaskId: string | null;
  rootTaskId: string | null;
  projectId: string | null;
  sessionId: string | null;
  kind: TaskKind;
  contextTemplate: string;
  status: TaskStatus;
  task: string;
  externalId: string | null;
  scheduleType?: string;
  scheduleConfig?: string;
  dependsOn?: string[];
  providerId?: string;
  retryCount: number;
  maxRetries: number;
  resultSummary?: string;
  errorSummary?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

export interface SpawnTaskConfig {
  task: string;
  projectId?: string;
  providerId?: string;
  contextTemplate?: string;
  tools?: string[];
  worktree?: boolean;
  checkpoint?: boolean;
  maxTurns?: number;
  schedule?: {
    type: 'cron' | 'interval' | 'once';
    cron?: string;
    intervalMinutes?: number;
    onceAt?: number;
  };
  dependsOn?: string[];
}

export interface TaskResult {
  taskId: string;
  status: 'completed' | 'failed';
  summary?: string;
  artifact?: string;
  error?: string;
}

export interface ExternalTaskSync {
  externalId: string;
  kind: Exclude<TaskKind, 'agent'>;
  projectId: string | null;
  sessionId?: string | null;
  parentTaskId?: string | null;
  rootTaskId?: string | null;
  status: TaskStatus;
  task: string;
  resultSummary?: string;
  errorSummary?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskOrchestrator {
  // Core operations (agent tasks)
  spawnTask(parentId: string | null, config: SpawnTaskConfig): Promise<string>;
  steerTask(taskId: string, instruction: string): Promise<void>;
  killTask(taskId: string): Promise<void>;
  getTaskResult(taskId: string): Promise<TaskResult>;
  waitForTask(taskId: string, timeoutMs?: number): Promise<TaskResult>;
  listTasks(parentId?: string): OrchestratorTask[];

  // External task mirroring (supervision/workflow/scheduled)
  syncExternalTask(task: ExternalTaskSync): Promise<void>;

  // Scheduling (agent tasks only)
  tick(): Promise<void>;

  // Lifecycle
  start(intervalMs?: number): void;
  stop(): void;
}
