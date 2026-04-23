/**
 * NotchPanel bridge — wires the main window and the independent `notch`
 * Tauri window together over Tauri events.
 *
 * Main → notch:
 *   - 'notch:state'       — debounced snapshot of toasts + feed + projects + attention
 *   - 'notch:close'       — explicit request to collapse (e.g. session selected)
 *
 * Notch → main:
 *   - 'notch:open-session'     — { sessionId, backendId? }
 *   - 'notch:mark-read'        — { ids: string[] }
 *   - 'notch:dismiss-item'     — { id: string }
 *   - 'notch:mark-all-read'    — {}
 *   - 'notch:clear-read'       — {}
 *
 * The payload types are defined below. Both sides share this file.
 */

import type { NotificationItem } from '@my-claudia/shared';
import type { Toast } from '../stores/toastStore';
import type { NotchTab } from '../utils/notchTabCategory';
import type { NotificationUnreadCountsByTab } from '@my-claudia/shared';

export interface NotchProjectSlim {
  id: string;
  name: string;
}

export interface NotchStateSnapshot {
  toasts: Toast[];
  items: NotificationItem[];
  unreadCount: number;
  unreadCountsByTab: NotificationUnreadCountsByTab;
  projects: NotchProjectSlim[];
  lastPreviewTitle: string | null;
  hasPendingAttention: boolean;
  activeTab: NotchTab;
}

export const NOTCH_EVENT = {
  /** main → notch */
  state: 'notch:state',
  collapse: 'notch:collapse',
  toggle: 'notch:toggle',
  /** notch → main */
  openSession: 'notch:open-session',
  markRead: 'notch:mark-read',
  dismissItem: 'notch:dismiss-item',
  markAllRead: 'notch:mark-all-read',
  clearRead: 'notch:clear-read',
  setTab: 'notch:set-tab',
} as const;

export interface NotchOpenSessionPayload {
  sessionId: string;
  backendId?: string;
}

export interface NotchMarkReadPayload {
  ids: string[];
}

export interface NotchDismissItemPayload {
  id: string;
}

export interface NotchSetTabPayload {
  tab: NotchTab;
}
