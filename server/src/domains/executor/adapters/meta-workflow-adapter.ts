// server/src/domains/executor/adapters/meta-workflow-adapter.ts
import type { Database } from 'better-sqlite3';
import type {
  ExecutorInstance,
  IExecutor,
  ExecutorInput,
  ExecutorProgress,
  ExecutorStatus,
  GitCommit,
} from '@my-claudia/shared/features/executor';
import type { MetaWorkflowRunStatus } from '@my-claudia/shared/features/meta-workflow';
import { ExecutorInstanceRepository } from '../executor-instance-repository.js';
import type { MetaWorkflowService } from '../../meta-workflow/service.js';

/** Normalize MetaWorkflowRunStatus → ExecutorStatus. */
function mapStatus(s: MetaWorkflowRunStatus): ExecutorStatus {
  switch (s) {
    case 'requirement_draft':
    case 'requirement_review':
    case 'splitting':
      return 'pending';
    case 'executing':
    case 'reviewing':
      return 'executing';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/**
 * Meta-Workflow executor: wraps the existing MetaWorkflowService so that an
 * ExecutorInstance(type='meta-workflow') can drive a MetaWorkflowRun through
 * start/pause/cancel without touching the service's internals.
 *
 * G1 scope is intentionally narrow:
 *   - start    : no-op besides refreshing persisted status from the run
 *   - pause    : state-only at the abstract layer (no underlying transition yet)
 *   - resume   : state-only at the abstract layer
 *   - cancel   : delegates to MetaWorkflowService.cancelRun and persists state
 *   - getStatus: maps MetaWorkflowRunStatus → ExecutorStatus
 *   - getProgress: reports done/total phases from MetaWorkflowService.listPhases
 *   - getOutputCommits: returns []  (real commit history wiring in G3+)
 */
export class MetaWorkflowAdapter implements IExecutor {
  private repo: ExecutorInstanceRepository;

  constructor(
    private db: Database,
    private service: MetaWorkflowService,
    private instance: ExecutorInstance,
  ) {
    this.repo = new ExecutorInstanceRepository(db);
  }

  async start(_input: ExecutorInput): Promise<void> {
    // G1: starting a Meta-Workflow instance is a no-op — the underlying run
    // is assumed to already exist. G3 will move run creation into this adapter.
    this.refreshStatus();
  }

  async pause(): Promise<void> {
    // MetaWorkflowService doesn't expose pause yet — record at the abstract layer only.
    this.persistStatus('paused');
  }

  async resume(): Promise<void> {
    this.persistStatus('executing');
  }

  async cancel(): Promise<void> {
    if (!this.instance.underlyingId) {
      throw new Error('MetaWorkflowAdapter.cancel: instance has no underlyingId');
    }
    this.service.cancelRun(this.instance.underlyingId);
    this.persistStatus('cancelled', { completedAt: Date.now() });
  }

  getStatus(): ExecutorStatus {
    if (!this.instance.underlyingId) return this.instance.statusSummary;
    const run = this.service.getRun(this.instance.underlyingId);
    return run ? mapStatus(run.status) : this.instance.statusSummary;
  }

  getProgress(): ExecutorProgress {
    if (!this.instance.underlyingId) {
      return { fraction: -1, summary: `meta-workflow: ${this.instance.statusSummary}` };
    }
    const phases = this.service.listPhases(this.instance.underlyingId);
    const total = phases.length;
    const done = phases.filter((p) => p.status === 'done').length;
    return {
      fraction: total > 0 ? done / total : -1,
      summary: `${done}/${total} phases done`,
      metadata: { phaseCount: total, doneCount: done },
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
