import { useEffect, useCallback } from 'react';
import { useAgentFeedStore } from '../../stores/agentFeedStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { FeedItem } from './FeedItem';

export function AgentFeedPanel() {
  const { items, hasMore, loading, unreadCount, setLoading } = useAgentFeedStore();
  const { sendMessage } = useConnection();

  // Load feed on mount
  useEffect(() => {
    setLoading(true);
    sendMessage({ type: 'get_agent_feed', limit: 50 });
  }, [sendMessage, setLoading]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    const oldest = items[items.length - 1];
    if (oldest) {
      setLoading(true);
      sendMessage({ type: 'get_agent_feed', limit: 50, before: oldest.createdAt });
    }
  }, [hasMore, loading, items, sendMessage, setLoading]);

  const markAllRead = useCallback(() => {
    const unreadIds = items.filter((i) => !i.readAt).map((i) => i.id);
    if (unreadIds.length > 0) {
      sendMessage({ type: 'mark_feed_read', itemIds: unreadIds });
      useAgentFeedStore.getState().markRead(unreadIds);
    }
  }, [items, sendMessage]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Agent Feed</span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-primary text-primary-foreground rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Feed list */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && !loading && (
          <div className="p-8 text-center text-muted-foreground text-sm">
            <p>No agent activity yet.</p>
            <p className="text-xs mt-1">Scheduled tasks and triggered events will appear here.</p>
          </div>
        )}

        <div className="divide-y divide-border">
          {items.map((item) => (
            <FeedItem key={item.id} item={item} />
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
