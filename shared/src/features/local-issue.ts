// Local Issue Types

export type LocalIssueStatus = 'open' | 'in_progress' | 'closed';

export type LocalIssuePriority = 'low' | 'medium' | 'high' | 'critical';

export interface LocalIssue {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: LocalIssueStatus;
  priority: LocalIssuePriority;
  labels: string[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

/**
 * A comment attached to a LocalIssue. No `author` field for v1 — the app is
 * single-user local-first; if Claude-generated comments need to be
 * distinguished later, add an `authorKind` column as a non-breaking change.
 */
export interface LocalIssueComment {
  id: string;
  issueId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}
