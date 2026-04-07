import type { SupervisionTask, TaskStatus } from '@my-claudia/shared/features/supervision';
import type { SupervisionTaskRepository } from '../../infrastructure/repositories/supervision-task.js';
import type { SupervisionTaskEvent } from './task-events.js';
import {
  assertTaskStatus,
  assertTaskStatusIn,
  assertTaskTransition,
  getLiteFailureTransition,
} from './status-machine.js';
import {
  resolveCreatedTaskStatus,
  getReviewRejectionOutcome,
} from './model.js';
import type { TrustLevel } from '@my-claudia/shared/features/supervision';

// ── Create input ────────────────────────────────────────────────────

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description: string;
  source?: 'user' | 'agent_discovered';
  priority?: number;
  dependencies?: string[];
  dependencyMode?: 'all' | 'any';
  relevantDocIds?: string[];
  taskSpecificContext?: string;
  scope?: string[];
  acceptanceCriteria?: string[];
  maxRetries?: number;
  scheduleCron?: string;
  scheduleEnabled?: boolean;
  scheduleNextRun?: number;
  retryDelayMs?: number;
}

// ── Aggregate root ──────────────────────────────────────────────────

export class TaskAggregate {
  private events: SupervisionTaskEvent[] = [];

  constructor(
    private task: SupervisionTask,
    private taskRepo: SupervisionTaskRepository,
  ) {}

  // ── Queries ─────────────────────────────────────────────────────

  get snapshot(): Readonly<SupervisionTask> {
    return this.task;
  }

  get id(): string {
    return this.task.id;
  }

  get projectId(): string {
    return this.task.projectId;
  }

  // ── Event collection ────────────────────────────────────────────

  releaseEvents(): SupervisionTaskEvent[] {
    const released = this.events;
    this.events = [];
    return released;
  }

  // ── Static factory ──────────────────────────────────────────────

  static create(
    input: CreateTaskInput,
    trustLevel: TrustLevel,
    taskRepo: SupervisionTaskRepository,
  ): TaskAggregate {
    const source = input.source ?? 'user';
    const status = resolveCreatedTaskStatus(source, trustLevel);

    const task = taskRepo.create({
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      source,
      status,
      priority: input.priority,
      dependencies: input.dependencies,
      dependencyMode: input.dependencyMode,
      relevantDocIds: input.relevantDocIds,
      taskSpecificContext: input.taskSpecificContext,
      scope: input.scope,
      acceptanceCriteria: input.acceptanceCriteria,
      maxRetries: input.maxRetries,
      scheduleCron: input.scheduleCron,
      scheduleEnabled: input.scheduleEnabled,
      scheduleNextRun: input.scheduleNextRun,
      retryDelayMs: input.retryDelayMs,
    });

    const agg = new TaskAggregate(task, taskRepo);
    agg.emit({
      type: 'task_created',
      taskId: task.id,
      projectId: task.projectId,
      timestamp: Date.now(),
      task,
      source,
    });
    return agg;
  }

  // ── Commands ────────────────────────────────────────────────────

  approve(): void {
    assertTaskStatus(this.task.status, 'proposed', 'approve');
    assertTaskTransition('proposed', 'pending');
    this.taskRepo.updateStatus(this.task.id, 'pending');
    this.refresh();
    this.emit({
      type: 'task_approved',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      fromStatus: 'proposed',
    });
  }

  reject(): void {
    assertTaskStatus(this.task.status, 'proposed', 'reject');
    assertTaskTransition('proposed', 'cancelled');
    this.taskRepo.updateStatus(this.task.id, 'cancelled');
    this.refresh();
    this.emit({
      type: 'task_rejected',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      fromStatus: 'proposed',
    });
  }

  openSession(sessionId: string): void {
    assertTaskTransition(this.task.status, 'planning');
    this.taskRepo.updateStatus(this.task.id, 'planning', { sessionId });
    this.refresh();
    this.emit({
      type: 'task_session_opened',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      sessionId,
    });
  }

  update(data: Partial<Pick<SupervisionTask,
    'title' | 'description' | 'priority' | 'dependencies' | 'dependencyMode' |
    'acceptanceCriteria' | 'relevantDocIds' | 'scope' | 'taskSpecificContext'
  >>): void {
    const fields = Object.keys(data).filter(
      (k) => data[k as keyof typeof data] !== undefined,
    );
    if (fields.length === 0) return;

    this.taskRepo.update(this.task.id, data);
    this.refresh();
    this.emit({
      type: 'task_updated',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      fields,
    });
  }

  submitPlan(sessionId: string, planPath?: string): void {
    assertTaskStatus(this.task.status, 'planning', 'submit plan for');
    assertTaskTransition('planning', 'queued');
    this.taskRepo.updateStatus(this.task.id, 'queued');
    this.refresh();
    this.emit({
      type: 'task_plan_submitted',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      sessionId,
      planPath,
    });
  }

  retry(): void {
    assertTaskStatusIn(this.task.status, ['failed', 'cancelled', 'completed', 'blocked'], 'retry');
    const fromStatus = this.task.status;
    assertTaskTransition(fromStatus, 'pending');
    this.taskRepo.updateStatus(this.task.id, 'pending', { attempt: 1 });
    this.refresh();
    this.emit({
      type: 'task_retried',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      fromStatus,
    });
  }

  runNow(): void {
    assertTaskStatusIn(this.task.status, ['completed', 'failed', 'cancelled'], 'run-now');
    const fromStatus = this.task.status;
    assertTaskTransition(fromStatus, 'pending');
    this.taskRepo.updateStatus(this.task.id, 'pending', { attempt: 1 });
    this.refresh();
    this.emit({
      type: 'task_run_now',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      fromStatus,
    });
  }

  cancel(): void {
    const fromStatus = this.task.status;
    assertTaskTransition(fromStatus, 'cancelled');
    this.taskRepo.updateStatus(this.task.id, 'cancelled');
    this.refresh();
    this.emit({
      type: 'task_cancelled',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      fromStatus,
    });
  }

  markStarted(sessionId: string, workingDirectory: string, baseCommit?: string): void {
    const fromStatus = this.task.status;
    assertTaskTransition(fromStatus, 'running');
    this.taskRepo.updateStatus(this.task.id, 'running', { sessionId, baseCommit });
    this.refresh();
    this.emit({
      type: 'task_started',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      sessionId,
      workingDirectory,
      baseCommit,
      fromStatus,
    });
  }

  markLiteStarted(sessionId: string): void {
    const fromStatus = this.task.status;
    assertTaskTransition(fromStatus, 'running');
    this.taskRepo.updateStatus(this.task.id, 'running', { sessionId });
    this.refresh();
    this.emit({
      type: 'lite_task_started',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      sessionId,
      fromStatus,
    });
  }

  markStartFailed(error: string): void {
    const fromStatus = this.task.status;
    assertTaskTransition(fromStatus, 'failed');
    this.taskRepo.updateStatus(this.task.id, 'failed', {
      result: { summary: `Task failed to start: ${error}`, filesChanged: [] },
    });
    this.refresh();
    this.emit({
      type: 'task_start_failed',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      fromStatus,
      error,
    });
  }

  transitionToReviewing(): void {
    assertTaskTransition(this.task.status, 'reviewing');
    this.taskRepo.updateStatus(this.task.id, 'reviewing');
    this.refresh();
    this.emit({
      type: 'task_run_completed',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
    });
  }

  markRunFailed(error: string): void {
    assertTaskTransition(this.task.status, 'failed');
    this.taskRepo.updateStatus(this.task.id, 'failed', {
      result: { summary: `Run failed: ${error}`, filesChanged: [] },
    });
    this.refresh();
    this.emit({
      type: 'task_run_failed',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      error,
    });
  }

  markLiteCompleted(): void {
    assertTaskTransition(this.task.status, 'completed');
    this.taskRepo.updateStatus(this.task.id, 'completed', {
      result: { summary: 'Task completed', filesChanged: [] },
    });
    this.refresh();
    this.emit({
      type: 'lite_task_completed',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
    });
  }

  markLiteFailed(error: string): void {
    const { nextStatus, nextAttempt } = getLiteFailureTransition(
      this.task.attempt,
      this.task.maxRetries,
    );

    if (nextStatus === 'failed') {
      assertTaskTransition(this.task.status, 'failed');
      this.taskRepo.updateStatus(this.task.id, 'failed', {
        result: {
          summary: `Failed after ${this.task.maxRetries} retries: ${error}`,
          filesChanged: [],
        },
        attempt: nextAttempt,
      });
    } else {
      assertTaskTransition(this.task.status, 'pending');
      this.taskRepo.updateStatus(this.task.id, 'pending', { attempt: nextAttempt });
    }

    this.refresh();
    this.emit({
      type: 'lite_task_failed',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      nextStatus,
      nextAttempt,
      error,
    });
  }

  markIntegrated(): void {
    assertTaskTransition(this.task.status, 'integrated');
    this.taskRepo.updateStatus(this.task.id, 'integrated');
    this.refresh();
    this.emit({
      type: 'task_result_approved',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
    });
  }

  markMergeConflict(conflicts: string[]): void {
    assertTaskTransition(this.task.status, 'merge_conflict');
    this.taskRepo.updateStatus(this.task.id, 'merge_conflict', {
      result: {
        ...(this.task.result ?? { summary: '', filesChanged: [] }),
        reviewNotes: `Merge conflicts: ${conflicts.join(', ')}`,
      },
    });
    this.refresh();
    this.emit({
      type: 'task_merge_conflict',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      conflicts,
    });
  }

  rejectResult(reviewNotes: string): void {
    assertTaskStatus(this.task.status, 'reviewing', 'reject result for');
    const { nextStatus, nextAttempt } = getReviewRejectionOutcome(
      this.task.attempt,
      this.task.maxRetries,
    );

    if (nextStatus === 'failed') {
      assertTaskTransition('reviewing', 'failed');
      this.taskRepo.updateStatus(this.task.id, 'failed', {
        result: { ...(this.task.result ?? { summary: '', filesChanged: [] }), reviewNotes },
        attempt: nextAttempt,
      });
    } else {
      assertTaskTransition('reviewing', 'queued');
      this.taskRepo.updateStatus(this.task.id, 'queued', {
        result: { ...(this.task.result ?? { summary: '', filesChanged: [] }), reviewNotes },
        attempt: nextAttempt,
      });
    }

    this.refresh();
    this.emit({
      type: 'task_result_rejected',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
      nextStatus,
      nextAttempt,
      reviewNotes,
    });
  }

  markConflictResolved(): void {
    assertTaskStatus(this.task.status, 'merge_conflict', 'resolve conflict for');
    assertTaskTransition('merge_conflict', 'integrated');
    this.taskRepo.updateStatus(this.task.id, 'integrated');
    this.refresh();
    this.emit({
      type: 'conflict_resolved',
      taskId: this.task.id,
      projectId: this.task.projectId,
      timestamp: Date.now(),
    });
  }

  // ── Internal helpers ────────────────────────────────────────────

  private refresh(): void {
    const updated = this.taskRepo.findById(this.task.id);
    if (updated) {
      this.task = updated;
    }
  }

  private emit(event: SupervisionTaskEvent): void {
    this.events.push(event);
  }
}
