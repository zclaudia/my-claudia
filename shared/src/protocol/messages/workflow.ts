// Workflow, Scheduled Task, System Task, and Local PR protocol messages

import type { Workflow, WorkflowRun, WorkflowStepRun } from '../../features/workflows.js';
import type { ScheduledTask } from '../../features/scheduled-tasks.js';
import type { SystemTaskInfo } from '../../features/system-tasks.js';
import type { LocalPR } from '../../features/local-pr.js';

// Workflow messages (Server → Client)
export interface WorkflowRunUpdateMessage {
  type: 'workflow_run_update';
  projectId: string;
  run: WorkflowRun;
  stepRuns: WorkflowStepRun[];
}

export interface WorkflowUpdateMessage {
  type: 'workflow_update';
  projectId: string;
  workflow: Workflow;
}

export interface WorkflowDeletedMessage {
  type: 'workflow_deleted';
  projectId: string;
  workflowId: string;
}

export interface WorkflowStepTypesChangedMessage {
  type: 'workflow_step_types_changed';
}

// Scheduled task updates (Server → Client)
export interface ScheduledTaskUpdateMessage {
  type: 'scheduled_task_update';
  projectId?: string;
  task: ScheduledTask;
}

export interface ScheduledTaskDeletedMessage {
  type: 'scheduled_task_deleted';
  projectId?: string;
  taskId: string;
}

// System task updates (Server → Client)
export interface SystemTaskUpdateMessage {
  type: 'system_task_update';
  task: SystemTaskInfo;
}

// Local PR update (Server → Client) — sent on PR status changes
export interface LocalPRUpdateMessage {
  type: 'local_pr_update';
  projectId: string;
  pr: LocalPR;
}

// Local PR deleted (Server → Client) — sent when a finished PR is cleaned up
export interface LocalPRDeletedMessage {
  type: 'local_pr_deleted';
  projectId: string;
  prId: string;
}
