// Local PR Types

export type LocalPRStatus =
  | 'open'
  | 'reviewing'
  | 'review_failed'
  | 'approved'
  | 'merging'
  | 'merged'
  | 'conflict'
  | 'closed';

export type ExecutionState = 'idle' | 'queued' | 'running' | 'failed';
export type PendingAction = 'none' | 'review' | 'merge' | 'resolve_conflict';

export interface LocalPR {
  id: string;
  projectId: string;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  title: string;
  description?: string;
  status: LocalPRStatus;
  commits?: string[];
  diffSummary?: string;
  reviewSessionId?: string;
  conflictSessionId?: string;
  reviewNotes?: string;
  statusMessage?: string;
  autoTriggered: boolean;
  autoReview: boolean;
  createdAt: number;
  updatedAt: number;
  mergedAt?: number;
  mergeCommitSha?: string;
  executionState: ExecutionState;
  pendingAction: PendingAction;
  executionError?: string;
}
