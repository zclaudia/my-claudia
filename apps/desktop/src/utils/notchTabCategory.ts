import type { Toast } from '../stores/toastStore';
import type { NotificationItem } from '@my-claudia/shared';

export type NotchTab = 'sessions' | 'approvals' | 'system';

export const NOTCH_TABS: readonly NotchTab[] = ['sessions', 'approvals', 'system'] as const;

export const NOTCH_TAB_LABELS: Record<NotchTab, string> = {
  sessions: 'Sessions',
  approvals: 'Approvals',
  system: 'System',
};

export function classifyToast(toast: Toast): NotchTab {
  if (toast.icon === 'permission') return 'approvals';
  if (toast.icon === 'task') return 'sessions';
  if (toast.icon === 'system') return 'system';
  // error icon without session context → system; with session → sessions
  if (toast.icon === 'error') return toast.sessionId ? 'sessions' : 'system';
  // No icon: info/error toasts without sessionId → system
  if (!toast.sessionId) return 'system';
  return 'sessions';
}

export function classifyFeedItem(item: NotificationItem): NotchTab {
  if (item.source === 'delegation' || item.delegationContext) return 'approvals';
  return 'sessions';
}
