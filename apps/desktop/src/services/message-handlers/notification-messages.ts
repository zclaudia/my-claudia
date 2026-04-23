/**
 * Notification feed message handlers.
 */
import type { ServerMessage } from '@my-claudia/shared';
import { useNotchPanelStore } from '../../stores/notchPanelStore';
import { resolveCanonicalBackendId, resolveLocalBackendId } from '../../utils/controlPlane';
import { parseBackendId } from '../../stores/gatewayStore';

function resolveOwnerBackendId(backendId: string | null, serverId: string): string {
  const rawBackendId = backendId || parseBackendId(serverId) || serverId;
  return resolveCanonicalBackendId(rawBackendId, resolveLocalBackendId() ?? rawBackendId) ?? rawBackendId;
}

export function handleNotificationMessage(
  msg: ServerMessage,
  serverId: string,
  backendId: string | null,
): boolean {
  switch (msg.type) {
    case 'notification_update': {
      const { item } = msg as import('@my-claudia/shared').NotificationUpdateMessage;
      const ownerBackendId = resolveOwnerBackendId(backendId, serverId);
      import('../../stores/notificationFeedStore').then(m => m.useNotificationFeedStore.getState().upsertItem({
        ...item,
        ownerBackendId: item.ownerBackendId ?? ownerBackendId,
      }));
      if (item.status === 'completed' || item.status === 'failed') {
        const notchTab = item.initiator === 'claudia' ? 'claudia' as const : 'sessions' as const;
        import('../../stores/toastStore').then(m => {
          m.useToastStore.getState().add({
            title: item.title,
            message: item.status === 'completed' ? (item.summary?.slice(0, 100) || 'Task completed') : (item.error?.slice(0, 100) || 'Task failed'),
            type: item.status === 'completed' ? 'success' : 'error',
            projectId: item.projectId,
            sessionId: item.sessionId,
            serverId,
            icon: item.status === 'completed' ? 'task' : 'error',
            initiator: item.initiator,
          });
        });
        useNotchPanelStore.getState().open({ auto: true, previewTitle: item.title, tab: notchTab });
      }
      return true;
    }

    case 'notification_list': {
      const feedMsg = msg as import('@my-claudia/shared').NotificationListMessage;
      const ownerBackendId = resolveOwnerBackendId(backendId, serverId);
      import('../../stores/notificationFeedStore').then(m => {
        m.useNotificationFeedStore.getState().setFeedList(
          feedMsg.items.map((item) => ({
            ...item,
            ownerBackendId: item.ownerBackendId ?? ownerBackendId,
          })),
          feedMsg.hasMore,
          feedMsg.unreadCount,
          feedMsg.unreadCountsByTab,
          feedMsg.append,
        );
        m.useNotificationFeedStore.getState().setLoading(false);
      });
      return true;
    }

    case 'notification_read': {
      const readMsg = msg as import('@my-claudia/shared').NotificationReadMessage;
      import('../../stores/notificationFeedStore').then(m => {
        if (readMsg.itemIds.length === 0) {
          m.useNotificationFeedStore.getState().markAllRead(readMsg.readAt);
          return;
        }
        m.useNotificationFeedStore.getState().markRead(
          readMsg.itemIds,
          readMsg.unreadCount,
          readMsg.unreadCountsByTab,
          readMsg.readAt,
        );
      });
      return true;
    }

    default:
      return false;
  }
}
