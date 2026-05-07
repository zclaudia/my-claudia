// Workflow, Scheduled Task, System Task, and Local PR protocol messages

import type { Workflow, WorkflowRun, WorkflowStepRun } from '../../features/workflows.js';
import type { SystemTaskInfo } from '../../features/system-tasks.js';
import type { LocalPR } from '../../features/local-pr.js';
import type { LocalIssue } from '../../features/local-issue.js';
import type { Attachment, AttachmentOwnerKind } from '../../features/attachment.js';

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

export interface WorkflowTriggerSourcesChangedMessage {
  type: 'workflow_trigger_sources_changed';
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

// Local Issue update (Server → Client)
export interface LocalIssueUpdateMessage {
  type: 'local_issue_update';
  projectId: string;
  issue: LocalIssue;
}

// Local Issue deleted (Server → Client)
export interface LocalIssueDeletedMessage {
  type: 'local_issue_deleted';
  projectId: string;
  issueId: string;
}

// Attachment added to an owner (Server → Client)
export interface AttachmentAddedMessage {
  type: 'attachment_added';
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  attachment: Attachment;
}

// Attachment removed from an owner (Server → Client)
export interface AttachmentRemovedMessage {
  type: 'attachment_removed';
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  attachmentId: string;
}
