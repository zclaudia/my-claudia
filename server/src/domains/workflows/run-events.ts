import type { WorkflowRun, WorkflowRunStatus, WorkflowStepRunStatus } from '@my-claudia/shared/features/workflows';

// ── Base ─────────────────────────────────────────────────────────────

interface WorkflowEventBase {
  runId: string;
  projectId?: string;
  timestamp: number;
}

// ── Run events ───────────────────────────────────────────────────────

export interface RunStartedEvent extends WorkflowEventBase {
  type: 'run_started';
  workflowId: string;
  triggerSource: 'manual' | 'schedule' | 'event';
}

export interface RunCompletedEvent extends WorkflowEventBase {
  type: 'run_completed';
}

export interface RunFailedEvent extends WorkflowEventBase {
  type: 'run_failed';
  error: string;
}

export interface RunCancelledEvent extends WorkflowEventBase {
  type: 'run_cancelled';
  fromStatus: WorkflowRunStatus;
}

// ── Step events ──────────────────────────────────────────────────────

export interface StepStartedEvent extends WorkflowEventBase {
  type: 'step_started';
  stepId: string;
  stepRunId: string;
  attempt: number;
}

export interface StepCompletedEvent extends WorkflowEventBase {
  type: 'step_completed';
  stepId: string;
  stepRunId: string;
  output?: Record<string, unknown>;
}

export interface StepFailedEvent extends WorkflowEventBase {
  type: 'step_failed';
  stepId: string;
  stepRunId: string;
  error?: string;
}

export interface StepSkippedEvent extends WorkflowEventBase {
  type: 'step_skipped';
  stepId: string;
  stepRunId: string;
  fromStatus: WorkflowStepRunStatus;
}

export interface StepWaitingForApprovalEvent extends WorkflowEventBase {
  type: 'step_waiting_for_approval';
  stepId: string;
  stepRunId: string;
}

export interface StepApprovedEvent extends WorkflowEventBase {
  type: 'step_approved';
  stepId: string;
  stepRunId: string;
}

export interface StepRejectedEvent extends WorkflowEventBase {
  type: 'step_rejected';
  stepId: string;
  stepRunId: string;
}

// ── Discriminated union ──────────────────────────────────────────────

export type WorkflowRunEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | StepSkippedEvent
  | StepWaitingForApprovalEvent
  | StepApprovedEvent
  | StepRejectedEvent;
