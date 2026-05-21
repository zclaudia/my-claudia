// server/src/domains/executor/adapters/classic-adapter.ts
import type { Database } from 'better-sqlite3';
import type {
  ExecutorInstance,
  IExecutor,
  ExecutorInput,
  ExecutorProgress,
  ExecutorStatus,
  GitCommit,
} from '@my-claudia/shared/features/executor';
import type { ChangeStatus } from '@my-claudia/shared/features/supervision';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';
import type { ChangeLifecycle } from '../../supervision/change-lifecycle.js';

/** Normalize ChangeStatus → ExecutorStatus. */
function mapStatus(s: ChangeStatus): ExecutorStatus {
  switch (s) {
    case 'draft':
    case 'designing':
    case 'awaiting_design_review':
    case 'planning':
    case 'awaiting_execution_review':
      return 'pending';
    case 'executing':
    case 'accepting':
    case 'syncing':
      return 'executing';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/**
 * Classic executor: wraps the existing ChangeLifecycle so that an
 * ExecutorInstance(type='classic') can drive a ProjectChange through
 * start/pause/cancel without touching the lifecycle's internals.
 *
 * G1 scope is intentionally narrow:
 *   - start    : no-op besides refreshing persisted status from the change
 *   - pause    : state-only at the abstract layer (no underlying transition yet)
 *   - resume   : state-only at the abstract layer
 *   - cancel   : persists cancelled state (real ChangeLifecycle.cancel wiring lands in G3)
 *   - getStatus: maps ChangeStatus → ExecutorStatus
 *   - getOutputCommits: returns []  (real commit history wiring in G3+)
 */
export class ClassicAdapter implements IExecutor {
  private repo: ExecutorInstanceRepository;

  constructor(
    private db: Database,
    private lifecycle: ChangeLifecycle,
    private instance: ExecutorInstance,
  ) {
    this.repo = new ExecutorInstanceRepository(db);
  }

  async start(_input: ExecutorInput): Promise<void> {
    // G1: starting a Classic instance is a no-op — the underlying ProjectChange
    // is assumed to already exist (created elsewhere, e.g. via existing flow).
    // G3 will move ProjectChange creation into this adapter.
    this.refreshStatus();
  }

  async pause(): Promise<void> {
    // ChangeLifecycle doesn't expose pause yet — record at the abstract layer only.
    this.persistStatus('paused');
  }

  async resume(): Promise<void> {
    this.persistStatus('executing');
  }

  async cancel(): Promise<void> {
    if (!this.instance.underlyingId) {
      throw new Error('ClassicAdapter.cancel: instance has no underlyingId');
    }
    // ChangeLifecycle.cancel API TBD — for G1 we just normalize state.
    // G3 will wire real cancellation through ChangeLifecycle.
    this.persistStatus('cancelled', { completedAt: Date.now() });
  }

  getStatus(): ExecutorStatus {
    if (!this.instance.underlyingId) return this.instance.statusSummary;
    const change = this.lifecycle.getChange(this.instance.underlyingId);
    return change ? mapStatus(change.status) : this.instance.statusSummary;
  }

  getProgress(): ExecutorProgress {
    const status = this.getStatus();
    return {
      fraction: status === 'completed' ? 1 : -1,
      summary: `classic: ${status}`,
    };
  }

  getOutputCommits(): GitCommit[] {
    // G1 placeholder — real commit history wiring in G3+.
    return [];
  }

  /** Re-read status from underlying and persist to ExecutorInstance. */
  refreshStatus(): void {
    const status = this.getStatus();
    if (status !== this.instance.statusSummary) {
      this.persistStatus(status);
    }
  }

  private persistStatus(
    s: ExecutorStatus,
    extra?: { startedAt?: number; completedAt?: number },
  ): void {
    this.repo.update(this.instance.id, {
      statusSummary: s,
      startedAt: extra?.startedAt,
      completedAt: extra?.completedAt,
    });
    this.instance = { ...this.instance, statusSummary: s };
  }
}
