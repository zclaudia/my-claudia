import type { Database } from 'better-sqlite3';
import type {
  ExecutorInput,
  ExecutorStatus,
  IExecutor,
} from '@my-claudia/shared/features/executor';
import { ExecutorRegistry, ExecutorInstanceRepository } from '../executor/index.js';
import { EventDispatcher } from '../supervision/event-dispatcher.js';
import type { IssueDomainEvent } from './events.js';

export interface ExecutorServiceDeps {
  db: Database;
  registry: ExecutorRegistry;
  dispatcher: EventDispatcher<IssueDomainEvent>;
}

/**
 * Wraps {@link ExecutorRegistry} + {@link ExecutorInstanceRepository}. Every
 * mutation observes the pre/post `status_summary` and emits an
 * `executor.status_changed` event when it changes. The propagator (Task 3)
 * consumes these to recompute sub-issue status.
 */
export class ExecutorService {
  private repo: ExecutorInstanceRepository;

  constructor(private deps: ExecutorServiceDeps) {
    this.repo = new ExecutorInstanceRepository(deps.db);
  }

  async start(executorInstanceId: string, input: ExecutorInput = {}): Promise<void> {
    await this.withStatusEvent(executorInstanceId, (executor) => executor.start(input));
  }

  async pause(executorInstanceId: string): Promise<void> {
    await this.withStatusEvent(executorInstanceId, (executor) => executor.pause());
  }

  async resume(executorInstanceId: string): Promise<void> {
    await this.withStatusEvent(executorInstanceId, (executor) => executor.resume());
  }

  async cancel(executorInstanceId: string): Promise<void> {
    await this.withStatusEvent(executorInstanceId, (executor) => executor.cancel());
  }

  /** For Manual executor: caller pushes completion via this method. */
  async markCompleted(executorInstanceId: string): Promise<void> {
    await this.withStatusEvent(executorInstanceId, async (executor) => {
      const manual = executor as IExecutor & { markCompleted?: () => Promise<void> };
      if (typeof manual.markCompleted !== 'function') {
        throw new Error(`Executor does not support markCompleted (type mismatch)`);
      }
      await manual.markCompleted();
    });
  }

  /** Re-read status from underlying without invoking an action; emit if changed. */
  async refresh(executorInstanceId: string): Promise<void> {
    await this.withStatusEvent(executorInstanceId, async () => undefined);
  }

  /** Read-through helper used by propagator + UI. */
  getStatus(executorInstanceId: string): ExecutorStatus | null {
    const inst = this.repo.findById(executorInstanceId);
    return inst ? inst.statusSummary : null;
  }

  private async withStatusEvent(
    executorInstanceId: string,
    op: (executor: IExecutor) => Promise<void> | void,
  ): Promise<void> {
    const before = this.repo.findById(executorInstanceId);
    if (!before) throw new Error(`ExecutorInstance not found: ${executorInstanceId}`);

    const executor = this.deps.registry.resolve(before);
    await op(executor);

    const after = this.repo.findById(executorInstanceId);
    if (!after) return; // could happen if cancelled+deleted; shouldn't, but defensive
    if (after.statusSummary !== before.statusSummary) {
      this.deps.dispatcher.dispatch({
        type: 'executor.status_changed',
        executorInstanceId: after.id,
        specChangeId: after.specChangeId,
        projectId: after.projectId,
        prev: before.statusSummary,
        next: after.statusSummary,
        at: Date.now(),
      });
    }
  }
}
