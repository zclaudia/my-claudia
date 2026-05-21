import type { ExecutorStatus } from '@my-claudia/shared/features/executor';
import type { LocalIssueStatus } from '@my-claudia/shared/features/local-issue';
import type { SpecChangeStatus } from '@my-claudia/shared/features/spec-change';

export interface ExecutorStatusChangedEvent {
  type: 'executor.status_changed';
  executorInstanceId: string;
  specChangeId: string;
  projectId: string;
  prev: ExecutorStatus;
  next: ExecutorStatus;
  at: number;
}

export interface SubIssueStatusChangedEvent {
  type: 'sub_issue.status_changed';
  subIssueId: string;
  projectId: string;
  prev: LocalIssueStatus;
  next: LocalIssueStatus;
  at: number;
}

export interface SpecChangeStatusChangedEvent {
  type: 'spec_change.status_changed';
  specChangeId: string;
  prev: SpecChangeStatus;
  next: SpecChangeStatus;
  at: number;
}

export type IssueDomainEvent =
  | ExecutorStatusChangedEvent
  | SubIssueStatusChangedEvent
  | SpecChangeStatusChangedEvent;
