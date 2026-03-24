// Agent Feed protocol messages

// Client → Server messages

export interface GetAgentFeedMessage {
  type: 'get_agent_feed';
  limit?: number;
  before?: number;
  unreadOnly?: boolean;
}

export interface MarkFeedReadMessage {
  type: 'mark_feed_read';
  itemIds: string[];
}

export interface DismissFeedItemsMessage {
  type: 'dismiss_feed_items';
  itemIds: string[];
}

export interface ClearReadFeedItemsMessage {
  type: 'clear_read_feed_items';
}

// Server → Client messages

export interface AgentFeedUpdateMessage {
  type: 'agent_feed_update';
  item: import('../../features/agent-feed.js').AgentFeedItem;
}

export interface AgentFeedListMessage {
  type: 'agent_feed_list';
  items: import('../../features/agent-feed.js').AgentFeedItem[];
  hasMore: boolean;
  unreadCount: number;
  append?: boolean;
}

export interface AgentFeedReadMessage {
  type: 'agent_feed_read';
  itemIds: string[];
  readAt: number;
  unreadCount: number;
}
