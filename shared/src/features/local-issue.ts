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
