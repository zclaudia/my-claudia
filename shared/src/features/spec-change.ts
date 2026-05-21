// shared/src/features/spec-change.ts

export type SpecChangeStatus =
  | 'drafting'
  | 'proposing'
  | 'designing'
  | 'tasks_ready'
  | 'archived'
  | 'cancelled';

export interface SpecChange {
  id: string;
  projectId: string;
  /** The sub-issue this SpecChange belongs to (always 1:1). */
  subIssueId: string;
  /** kebab-case folder name under openspec/changes/. */
  slug: string;
  title: string;
  status: SpecChangeStatus;
  proposalPath: string;
  designPath: string;
  tasksPath: string;
  /** File paths of delta specs (one per touched capability). */
  deltaSpecPaths: string[];
  /** B3: true means delta has been frozen at sub-issue close, awaiting merge. */
  deltaPendingMerge: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface SpecChangeCreate {
  projectId: string;
  subIssueId: string;
  slug: string;
  title: string;
}

export interface SpecChangeUpdate {
  status?: SpecChangeStatus;
  title?: string;
  deltaSpecPaths?: string[];
  deltaPendingMerge?: boolean;
  archivedAt?: number;
}
