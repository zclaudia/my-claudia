// shared/src/features/executor.ts

export type ExecutorType = 'classic' | 'meta-workflow' | 'manual' | 'superpowers';

export type ExecutorStatus =
  | 'pending'
  | 'executing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExecutorInstance {
  id: string;
  projectId: string;
  specChangeId: string;
  type: ExecutorType;
  /** FK into the type-specific table (project_changes / meta_workflow_runs / etc).
   *  null for type='manual'. */
  underlyingId?: string;
  statusSummary: ExecutorStatus;
  progressJson?: string;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutorInstanceCreate {
  projectId: string;
  specChangeId: string;
  type: ExecutorType;
  underlyingId?: string;
}

export interface ExecutorInstanceUpdate {
  statusSummary?: ExecutorStatus;
  progressJson?: string;
  startedAt?: number;
  completedAt?: number;
}

/** Generic input passed to IExecutor.start(). Adapters cast to their concrete shape. */
export interface ExecutorInput {
  /** Adapter-specific configuration. */
  config?: unknown;
}

export interface ExecutorProgress {
  /** 0–1 normalized progress (best-effort; -1 if unknown). */
  fraction: number;
  /** Human-readable summary line. */
  summary: string;
  /** Adapter-specific extra info. */
  metadata?: Record<string, unknown>;
}

export interface GitCommit {
  sha: string;
  message: string;
  authoredAt: number;
}

/**
 * Port that every executor implementation must satisfy. Adapters implement
 * this in the server domain; the Issue layer talks to executors only via
 * this interface.
 */
export interface IExecutor {
  start(input: ExecutorInput): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  getStatus(): ExecutorStatus;
  getProgress(): ExecutorProgress;
  getOutputCommits(): GitCommit[];
}
