import type { ExecutorStatus } from '../../features/executor.js';
import type { LocalIssueStatus } from '../../features/local-issue.js';
import type { SpecChangeStatus } from '../../features/spec-change.js';

/**
 * Pushed when an ExecutorInstance.statusSummary changes. Subscribers
 * (typically desktop store) should refresh the underlying executor record
 * and any affected sub-issue/spec_change derived state.
 */
export interface OpenSpecExecutorStatusChangedMessage {
  type: 'openspec_executor_status_changed';
  projectId: string;
  executorInstanceId: string;
  specChangeId: string;
  prev: ExecutorStatus;
  next: ExecutorStatus;
  at: number;
}

export interface OpenSpecSubIssueStatusChangedMessage {
  type: 'openspec_sub_issue_status_changed';
  projectId: string;
  subIssueId: string;
  prev: LocalIssueStatus;
  next: LocalIssueStatus;
  at: number;
}

export interface OpenSpecSpecChangeStatusChangedMessage {
  type: 'openspec_spec_change_status_changed';
  projectId: string;
  specChangeId: string;
  prev: SpecChangeStatus;
  next: SpecChangeStatus;
  at: number;
}

/**
 * Streamed during a project bootstrap scan. The `payload.kind` discriminates
 * the event type (e.g. `scan_started`, `analysis_progress`, `scan_completed`)
 * and may carry additional event-specific fields.
 */
export interface BootstrapEventMessage {
  type: 'bootstrap_event';
  scanId: string;
  projectId: string;
  payload: {
    kind: string;
    [k: string]: unknown;
  };
}
