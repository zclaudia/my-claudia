// Notification Feed protocol messages

// Client → Server messages

export interface GetNotificationsMessage {
  type: 'get_notifications';
  limit?: number;
  before?: number;
  unreadOnly?: boolean;
}

export interface MarkNotificationsReadMessage {
  type: 'mark_notifications_read';
  itemIds: string[];
}

export interface DismissNotificationsMessage {
  type: 'dismiss_notifications';
  itemIds: string[];
}

export interface ClearReadNotificationsMessage {
  type: 'clear_read_notifications';
}

// Server → Client messages

export interface NotificationUpdateMessage {
  type: 'notification_update';
  item: import('../../features/notification-feed.js').NotificationItem;
}

export interface NotificationListMessage {
  type: 'notification_list';
  items: import('../../features/notification-feed.js').NotificationItem[];
  hasMore: boolean;
  unreadCount: number;
  append?: boolean;
}

export interface NotificationReadMessage {
  type: 'notification_read';
  itemIds: string[];
  readAt: number;
  unreadCount: number;
}
