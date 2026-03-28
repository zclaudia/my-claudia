import type {
  GetNotificationsMessage,
  MarkNotificationsReadMessage,
  DismissNotificationsMessage,
  NotificationListMessage,
} from '@my-claudia/shared';
import type { NotificationFeedService } from '../../../../domains/notification-feed/service.js';
import type { ConnectedClient } from '../types.js';
import { sendMessage } from '../broadcast.js';

export function handleGetNotifications(
  client: ConnectedClient,
  message: GetNotificationsMessage,
  notificationService: NotificationFeedService,
): void {
  const result = notificationService.listItems({
    limit: message.limit,
    before: message.before,
    unreadOnly: message.unreadOnly,
  });
  sendMessage(client.ws, {
    type: 'notification_list',
    items: result.items,
    hasMore: result.hasMore,
    unreadCount: result.unreadCount,
    append: typeof message.before === 'number',
  } as NotificationListMessage);
}

export function handleMarkNotificationsRead(
  message: MarkNotificationsReadMessage,
  notificationService: NotificationFeedService,
): void {
  if (Array.isArray(message.itemIds)) {
    notificationService.markRead(message.itemIds);
  }
}

export function handleDismissNotifications(
  message: DismissNotificationsMessage,
  notificationService: NotificationFeedService,
): void {
  if (Array.isArray(message.itemIds)) {
    notificationService.dismissItems(message.itemIds);
  }
}

export function handleClearReadNotifications(notificationService: NotificationFeedService): void {
  notificationService.clearRead();
}
