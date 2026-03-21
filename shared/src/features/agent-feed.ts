// Agent Feed Types — proactive agent task results

export type FeedItemStatus = 'running' | 'completed' | 'failed';
export type FeedItemSource = 'trigger' | 'scheduled' | 'manual' | 'delegation';

export interface DelegationContext {
  originalRequestId: string;
  toolName: string;
  detail: string;
  decision: 'approve' | 'deny';
  reasoning: string;
  confidence: number;
}

export interface AgentFeedItem {
  id: string;
  triggerId?: string;
  taskId?: string;
  sessionId?: string;
  projectId?: string;
  source: FeedItemSource;
  title: string;
  summary?: string;
  status: FeedItemStatus;
  error?: string;
  delegationContext?: DelegationContext;
  createdAt: number;
  completedAt?: number;
  readAt?: number;
}
