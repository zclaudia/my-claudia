// Notification Feed Types — proactive agent task results

export type NotificationStatus = 'running' | 'completed' | 'failed';
export type NotificationSource = 'trigger' | 'scheduled' | 'manual' | 'delegation';

export interface DelegationContext {
  originalRequestId: string;
  toolName: string;
  detail: string;
  decision: 'approve' | 'deny';
  reasoning: string;
  confidence: number;
}

export interface NotificationItem {
  id: string;
  triggerId?: string;
  taskId?: string;
  sessionId?: string;
  projectId?: string;
  ownerBackendId: string;
  source: NotificationSource;
  title: string;
  summary?: string;
  status: NotificationStatus;
  error?: string;
  delegationContext?: DelegationContext;
  createdAt: number;
  completedAt?: number;
  readAt?: number;
}
