// Notification Feed Types — proactive agent task results

export type NotificationStatus = 'running' | 'completed' | 'failed';
export type NotificationSource = 'trigger' | 'scheduled' | 'manual' | 'delegation';
export type NotificationInboxTab = 'sessions' | 'claudia' | 'approvals' | 'system';

export interface NotificationUnreadCountsByTab {
  sessions: number;
  claudia: number;
  approvals: number;
  system: number;
}

export const EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB: NotificationUnreadCountsByTab = {
  sessions: 0,
  claudia: 0,
  approvals: 0,
  system: 0,
};

export interface DelegationContext {
  originalRequestId: string;
  toolName: string;
  detail: string;
  decision: 'approve' | 'deny';
  reasoning: string;
  confidence: number;
  payloadDisposition?: 'safe_to_send' | 'send_with_redaction' | 'do_not_send';
  redactionCount?: number;
  reviewedFileCount?: number;
}

export type NotificationInitiator = 'system' | 'claudia';

export interface NotificationItem {
  id: string;
  triggerId?: string;
  taskId?: string;
  sessionId?: string;
  projectId?: string;
  ownerBackendId: string;
  source: NotificationSource;
  initiator?: NotificationInitiator;
  title: string;
  summary?: string;
  status: NotificationStatus;
  error?: string;
  delegationContext?: DelegationContext;
  createdAt: number;
  completedAt?: number;
  readAt?: number;
}

export function classifyNotificationItemTab(
  item: Pick<NotificationItem, 'initiator' | 'delegationContext' | 'source'>,
): NotificationInboxTab {
  if (item.initiator === 'claudia' && !item.delegationContext) return 'claudia';
  if (item.source === 'delegation' || item.delegationContext) return 'approvals';
  return 'sessions';
}
