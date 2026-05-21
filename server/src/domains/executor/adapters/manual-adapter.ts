// server/src/domains/executor/adapters/manual-adapter.ts
import type { Database } from 'better-sqlite3';
import type {
  ExecutorInstance,
  IExecutor,
  ExecutorInput,
  ExecutorProgress,
  ExecutorStatus,
  GitCommit,
} from '@my-claudia/shared/features/executor';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';

/**
 * Manual executor: no underlying service. The user marks transitions by hand
 * via API/UI calls. This adapter just persists the status changes to
 * executor_instances and exposes them.
 */
export class ManualAdapter implements IExecutor {
  private repo: ExecutorInstanceRepository;
  private currentStatus: ExecutorStatus;

  constructor(db: Database, private instance: ExecutorInstance) {
    this.repo = new ExecutorInstanceRepository(db);
    this.currentStatus = instance.statusSummary;
  }

  async start(_input: ExecutorInput): Promise<void> {
    this.transitionTo('executing', { startedAt: Date.now() });
  }

  async pause(): Promise<void> {
    this.transitionTo('paused');
  }

  async resume(): Promise<void> {
    this.transitionTo('executing');
  }

  async cancel(): Promise<void> {
    this.transitionTo('cancelled', { completedAt: Date.now() });
  }

  /** Manual-specific public API: user-driven completion. */
  async markCompleted(): Promise<void> {
    this.transitionTo('completed', { completedAt: Date.now() });
  }

  /** Manual-specific public API: user-driven failure. */
  async markFailed(): Promise<void> {
    this.transitionTo('failed', { completedAt: Date.now() });
  }

  getStatus(): ExecutorStatus {
    return this.currentStatus;
  }

  getProgress(): ExecutorProgress {
    return {
      fraction: this.currentStatus === 'completed' ? 1 : -1,
      summary: `manual: ${this.currentStatus}`,
    };
  }

  getOutputCommits(): GitCommit[] {
    return [];
  }

  private transitionTo(
    next: ExecutorStatus,
    extra?: { startedAt?: number; completedAt?: number },
  ): void {
    this.repo.update(this.instance.id, {
      statusSummary: next,
      startedAt: extra?.startedAt,
      completedAt: extra?.completedAt,
    });
    this.currentStatus = next;
  }
}
