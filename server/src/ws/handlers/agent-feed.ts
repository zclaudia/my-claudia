import type {
  GetAgentFeedMessage,
  MarkFeedReadMessage,
  DismissFeedItemsMessage,
  AgentFeedListMessage,
} from '@my-claudia/shared';
import type { AgentFeedService } from '../../domains/agent-feed/service.js';
import type { ConnectedClient } from '../types.js';
import { sendMessage } from '../broadcast.js';

export function handleGetAgentFeed(
  client: ConnectedClient,
  message: GetAgentFeedMessage,
  agentFeedService: AgentFeedService,
): void {
  const result = agentFeedService.listItems({
    limit: message.limit,
    before: message.before,
    unreadOnly: message.unreadOnly,
  });
  sendMessage(client.ws, {
    type: 'agent_feed_list',
    items: result.items,
    hasMore: result.hasMore,
    unreadCount: result.unreadCount,
    append: typeof message.before === 'number',
  } as AgentFeedListMessage);
}

export function handleMarkFeedRead(
  message: MarkFeedReadMessage,
  agentFeedService: AgentFeedService,
): void {
  if (Array.isArray(message.itemIds)) {
    agentFeedService.markRead(message.itemIds);
  }
}

export function handleDismissFeedItems(
  message: DismissFeedItemsMessage,
  agentFeedService: AgentFeedService,
): void {
  if (Array.isArray(message.itemIds)) {
    agentFeedService.dismissItems(message.itemIds);
  }
}

export function handleClearReadFeedItems(agentFeedService: AgentFeedService): void {
  agentFeedService.clearRead();
}
