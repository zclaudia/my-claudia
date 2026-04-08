/**
 * WorkflowRunAggregate — aggregate root for a single workflow run.
 *
 * Guards status transitions, writes to repos, and collects domain events
 * following the same pattern as supervision/TaskAggregate.
 */

import type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepRun,
  WorkflowStepRunStatus,
  WorkflowDefinition,
  WorkflowRunTriggerSource,
} from '@my-claudia/shared/features/workflows';
import type { WorkflowRunRepository } from './workflow-run-repository.js';
import type { WorkflowStepRunRepository } from './workflow-step-run-repository.js';
import type { WorkflowRunEvent } from './run-events.js';
import { assertRunTransition, assertStepTransition } from './status-machine.js';

// ── Aggregate root ───────────────────────────────────────────────────

export class WorkflowRunAggregate {
  private events: WorkflowRunEvent[] = [];

  constructor(
    private run: WorkflowRun,
    private runRepo: WorkflowRunRepository,
    private stepRunRepo: WorkflowStepRunRepository,
  ) {}

  // ── Queries ──────────────────────────────────────────────────────

  get snapshot(): Readonly<WorkflowRun> {
    return this.run;
  }

  get id(): string {
    return this.run.id;
  }

  get projectId(): string | undefined {
    return this.run.projectId;
  }

  get status(): WorkflowRunStatus {
    return this.run.status;
  }

  // ── Event collection ─────────────────────────────────────────────

  releaseEvents(): WorkflowRunEvent[] {
    const released = this.events;
    this.events = [];
    return released;
  }

  // ── Static factory ───────────────────────────────────────────────

  static start(
    definition: WorkflowDefinition,
    workflowId: string,
    projectId: string | undefined,
    triggerSource: WorkflowRunTriggerSource,
    runRepo: WorkflowRunRepository,
    stepRunRepo: WorkflowStepRunRepository,
    triggerDetail?: string,
  ): WorkflowRunAggregate {
    const run = runRepo.create({
      workflowId,
      projectId,
      status: 'running',
      triggerSource,
      triggerDetail,
      startedAt: Date.now(),
    });

    for (const node of definition.nodes) {
      stepRunRepo.create({
        runId: run.id,
        stepId: node.id,
        stepType: node.type,
        status: 'pending',
        attempt: 1,
      });
    }

    const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);
    agg.emit({
      type: 'run_started',
      runId: run.id,
      projectId,
      timestamp: Date.now(),
      workflowId,
      triggerSource,
    });
    return agg;
  }

  // ── Run-level commands ───────────────────────────────────────────

  completeRun(): void {
    assertRunTransition(this.run.status, 'completed');
    this.runRepo.update(this.run.id, {
      status: 'completed',
      completedAt: Date.now(),
      currentStepId: undefined,
    });
    this.refresh();
    this.emit({
      type: 'run_completed',
      runId: this.run.id,
      projectId: this.run.projectId,
      timestamp: Date.now(),
    });
  }

  failRun(error: string): void {
    assertRunTransition(this.run.status, 'failed');
    this.runRepo.update(this.run.id, {
      status: 'failed',
      error,
      completedAt: Date.now(),
      currentStepId: undefined,
    });
    this.refresh();
    this.emit({
      type: 'run_failed',
      runId: this.run.id,
      projectId: this.run.projectId,
      timestamp: Date.now(),
      error,
    });
  }

  cancelRun(): void {
    const fromStatus = this.run.status;
    assertRunTransition(fromStatus, 'cancelled');
    this.runRepo.update(this.run.id, {
      status: 'cancelled',
      completedAt: Date.now(),
    });
    this.refresh();
    this.emit({
      type: 'run_cancelled',
      runId: this.run.id,
      projectId: this.run.projectId,
      timestamp: Date.now(),
      fromStatus,
    });
  }

  /** Update which step is currently executing (no event, tracking only) */
  setCurrentStep(stepId: string): void {
    this.runRepo.update(this.run.id, { currentStepId: stepId });
    this.run = { ...this.run, currentStepId: stepId };
  }

  // ── Step-level commands ──────────────────────────────────────────

  startStep(stepId: string, attempt: number = 1): void {
    const stepRun = this.requireStepRun(stepId);
    assertStepTransition(stepRun.status, 'running');
    this.stepRunRepo.update(stepRun.id, {
      status: 'running',
      startedAt: Date.now(),
      attempt,
    });
    this.emit({
      type: 'step_started',
      runId: this.run.id,
      projectId: this.run.projectId,
      timestamp: Date.now(),
      stepId,
      stepRunId: stepRun.id,
      attempt,
    });
  }

  completeStep(stepId: string, output?: Record<string, unknown>): void {
    const stepRun = this.requireStepRun(stepId);
    assertStepTransition(stepRun.status, 'completed');
    this.stepRunRepo.update(stepRun.id, {
      status: 'completed',
      output,
      completedAt: Date.now(),
    });
    this.emit({
      type: 'step_completed',
      runId: this.run.id,
      projectId: this.run.projectId,
      timestamp: Date.now(),
      stepId,
      stepRunId: stepRun.id,
      output,
    });
  }

  failStep(stepId: string, error?: string): void {
    const stepRun = this.requireStepRun(stepId);
    assertStepTransition(stepRun.status, 'failed');
    this.stepRunRepo.update(stepRun.id, {
      status: 'failed',
      error,
      completedAt: Date.now(),
    });
    this.emit({
      type: 'step_failed',
      runId: this.run.id,
      projectId: this.run.projectId,
      timestamp: Date.now(),
      stepId,
      stepRunId: stepRun.id,
      error,
    });
  }

  skipStep(stepId: string): void {
    const stepRun = this.requireStepRun(stepId);
    const fromStatus = stepRun.status;
    assertStepTransition(fromStatus, 'skipped');
    this.stepRunRepo.update(stepRun.id, {
      status: 'skipped',
      completedAt: Date.now(),
    });
    this.emit({
      type: 'step_skipped',
      runId: this.run.id,
      projectId: this.run.projectId,
      timestamp: Date.now(),
      stepId,
      stepRunId: stepRun.id,
      fromStatus,
    });
  }

  markStepWaiting(stepId: string): void {
    const stepRun = this.requireStepRun(stepId);
    assertStepTransition(stepRun.status, 'waiting');
    this.stepRunRepo.update(stepRun.id, {
      status: 'waiting',
    });
    this.emit({
      type: 'step_waiting_for_approval',
      runId: this.run.id,
      projectId: this.run.projectId,
      timestamp: Date.now(),
      stepId,
      stepRunId: stepRun.id,
    });
  }

  markStepResumed(stepId: string): void {
    const stepRun = this.requireStepRun(stepId);
    assertStepTransition(stepRun.status, 'running');
    this.stepRunRepo.update(stepRun.id, {
      status: 'running',
    });
    this.emit({
      type: 'step_approved',
      runId: this.run.id,
      projectId: this.run.projectId,
      timestamp: Date.now(),
      stepId,
      stepRunId: stepRun.id,
    });
  }

  // ── Convenience: update step input/sessionId (no status change) ──

  setStepInput(stepId: string, input: Record<string, unknown>): void {
    const stepRun = this.requireStepRun(stepId);
    this.stepRunRepo.update(stepRun.id, { input });
  }

  setStepSessionId(stepId: string, sessionId: string): void {
    const stepRun = this.requireStepRun(stepId);
    this.stepRunRepo.update(stepRun.id, { sessionId });
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private requireStepRun(stepId: string): WorkflowStepRun {
    const stepRun = this.stepRunRepo.findByRunAndStep(this.run.id, stepId);
    if (!stepRun) {
      throw new Error(`Step run not found for run=${this.run.id} step=${stepId}`);
    }
    return stepRun;
  }

  private refresh(): void {
    const updated = this.runRepo.findById(this.run.id);
    if (updated) {
      this.run = updated;
    }
  }

  private emit(event: WorkflowRunEvent): void {
    this.events.push(event);
  }
}
