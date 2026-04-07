import type { SupervisionTask, TaskStatus } from '@my-claudia/shared/features/supervision';

// ── Base ────────────────────────────────────────────────────────────

interface TaskEventBase {
  taskId: string;
  projectId: string;
  timestamp: number;
}

// ── Individual event types ──────────────────────────────────────────

export interface TaskCreatedEvent extends TaskEventBase {
  type: 'task_created';
  task: SupervisionTask;
  source: 'user' | 'agent_discovered';
}

export interface TaskApprovedEvent extends TaskEventBase {
  type: 'task_approved';
  fromStatus: 'proposed';
}

export interface TaskRejectedEvent extends TaskEventBase {
  type: 'task_rejected';
  fromStatus: 'proposed';
}

export interface TaskUpdatedEvent extends TaskEventBase {
  type: 'task_updated';
  fields: string[];
}

export interface TaskSessionOpenedEvent extends TaskEventBase {
  type: 'task_session_opened';
  sessionId: string;
}

export interface TaskPlanSubmittedEvent extends TaskEventBase {
  type: 'task_plan_submitted';
  sessionId: string;
  planPath?: string;
}

export interface TaskRetriedEvent extends TaskEventBase {
  type: 'task_retried';
  fromStatus: TaskStatus;
}

export interface TaskRunNowEvent extends TaskEventBase {
  type: 'task_run_now';
  fromStatus: TaskStatus;
}

export interface TaskCancelledEvent extends TaskEventBase {
  type: 'task_cancelled';
  fromStatus: TaskStatus;
}

export interface TaskStartedEvent extends TaskEventBase {
  type: 'task_started';
  sessionId: string;
  workingDirectory: string;
  baseCommit?: string;
  fromStatus: TaskStatus;
}

export interface LiteTaskStartedEvent extends TaskEventBase {
  type: 'lite_task_started';
  sessionId: string;
  fromStatus: TaskStatus;
}

export interface TaskStartFailedEvent extends TaskEventBase {
  type: 'task_start_failed';
  fromStatus: TaskStatus;
  error: string;
}

export interface TaskRunCompletedEvent extends TaskEventBase {
  type: 'task_run_completed';
}

export interface TaskRunFailedEvent extends TaskEventBase {
  type: 'task_run_failed';
  error: string;
}

export interface LiteTaskCompletedEvent extends TaskEventBase {
  type: 'lite_task_completed';
}

export interface LiteTaskFailedEvent extends TaskEventBase {
  type: 'lite_task_failed';
  nextStatus: 'pending' | 'failed';
  nextAttempt: number;
  error: string;
}

export interface TaskResultApprovedEvent extends TaskEventBase {
  type: 'task_result_approved';
}

export interface TaskMergeConflictEvent extends TaskEventBase {
  type: 'task_merge_conflict';
  conflicts: string[];
}

export interface TaskResultRejectedEvent extends TaskEventBase {
  type: 'task_result_rejected';
  nextStatus: 'queued' | 'failed';
  nextAttempt: number;
  reviewNotes: string;
}

export interface ConflictResolvedEvent extends TaskEventBase {
  type: 'conflict_resolved';
}

// ── Discriminated union ─────────────────────────────────────────────

export type SupervisionTaskEvent =
  | TaskCreatedEvent
  | TaskApprovedEvent
  | TaskRejectedEvent
  | TaskUpdatedEvent
  | TaskSessionOpenedEvent
  | TaskPlanSubmittedEvent
  | TaskRetriedEvent
  | TaskRunNowEvent
  | TaskCancelledEvent
  | TaskStartedEvent
  | LiteTaskStartedEvent
  | TaskStartFailedEvent
  | TaskRunCompletedEvent
  | TaskRunFailedEvent
  | LiteTaskCompletedEvent
  | LiteTaskFailedEvent
  | TaskResultApprovedEvent
  | TaskMergeConflictEvent
  | TaskResultRejectedEvent
  | ConflictResolvedEvent;
