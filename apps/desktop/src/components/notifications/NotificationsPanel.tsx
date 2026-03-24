import { useEffect, useCallback } from 'react';
import { useNotificationFeedStore } from '../../stores/notificationFeedStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { NotificationItem } from './NotificationItem';

export function NotificationsPanel() {
  const { items, hasMore, loading, unreadCount, hydrated, setLoading, clearRead, removeItem } = useNotificationFeedStore();
  const { sendMessage } = useConnection();

  useEffect(() => {
    if (hydrated) return;
    setLoading(true);
    sendMessage({ type: 'get_notifications', limit: 50 });
  }, [hydrated, sendMessage, setLoading]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    const oldest = items[items.length - 1];
    if (oldest) {
      setLoading(true);
      sendMessage({ type: 'get_notifications', limit: 50, before: oldest.createdAt });
    }
  }, [hasMore, loading, items, sendMessage, setLoading]);

  const markAllRead = useCallback(() => {
    const unreadIds = items.filter((i) => !i.readAt).map((i) => i.id);
    if (unreadIds.length > 0) {
      sendMessage({ type: 'mark_notifications_read', itemIds: unreadIds });
      useNotificationFeedStore.getState().markRead(unreadIds);
    }
  }, [items, sendMessage]);

  const handleClearRead = useCallback(() => {
    sendMessage({ type: 'clear_read_notifications' });
    clearRead();
  }, [clearRead, sendMessage]);

  const handleDismiss = useCallback((id: string) => {
    sendMessage({ type: 'dismiss_notifications', itemIds: [id] });
    removeItem(id);
  }, [removeItem, sendMessage]);

  const hasReadItems = items.some((i) => i.readAt);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Notifications</span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary text-primary-foreground rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasReadItems && (
            <button
              onClick={handleClearRead}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear read
            </button>
          )}
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Feed list */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && !loading && (
          <div className="p-8 text-center text-muted-foreground text-sm">
            <p>No notifications yet.</p>
            <p className="text-xs mt-1">Task results, scheduled events, and plugin notifications appear here.</p>
          </div>
        )}

        <div className="divide-y divide-border/50">
          {items.map((item) => (
            <NotificationItem key={item.id} item={item} onDismiss={handleDismiss} />
          ))}
        </div>

        {hasMore && (
          <div className="p-3 text-center">
            <button
              onClick={loadMore}
              disabled={loading}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {loading ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
