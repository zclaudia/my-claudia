import type { Toast } from '../stores/toastStore';
import {
  classifyNotificationItemTab,
  type NotificationInboxTab,
  type NotificationItem,
} from '@my-claudia/shared';

export type NotchTab = NotificationInboxTab | `plugin:${string}`;

export const NOTCH_TABS: readonly NotchTab[] = ['sessions', 'claudia', 'approvals', 'system'] as const;

export const NOTCH_TAB_LABELS: Record<NotchTab, string> = {
  sessions: 'Sessions',
  claudia: 'Claudia',
  approvals: 'Approvals',
  system: 'System',
};

export function classifyToast(toast: Toast): NotchTab {
  // Plugin tab routing takes priority
  if (toast.pluginTab) return `plugin:${toast.pluginTab}`;
  // Claudia-initiated toasts go to the Claudia tab (except permission requests)
  if (toast.initiator === 'claudia' && toast.icon !== 'permission') return 'claudia';
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
  return classifyNotificationItemTab(item);
}
