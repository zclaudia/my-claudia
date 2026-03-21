import type Database from 'better-sqlite3';
import type { AgentFeedItem, FeedItemStatus, AgentFeedUpdateMessage, ServerMessage } from '@my-claudia/shared';
import { AgentFeedRepository } from './repository.js';

export interface AgentFeedServiceDeps {
  db: Database.Database;
  broadcastFn: (message: ServerMessage) => void;
  notifyFn?: (event: string, data: Record<string, unknown>) => void;
}

export class AgentFeedService {
  private repo: AgentFeedRepository;
  private broadcastFn: (message: ServerMessage) => void;
  private notifyFn?: (event: string, data: Record<string, unknown>) => void;

  constructor(deps: AgentFeedServiceDeps) {
    this.repo = new AgentFeedRepository(deps.db);
    this.broadcastFn = deps.broadcastFn;
    this.notifyFn = deps.notifyFn;
  }

  /** Post a new feed item — persists to DB, broadcasts to clients, optionally sends push notification */
  postItem(item: Omit<AgentFeedItem, 'id' | 'createdAt'>): AgentFeedItem {
    const created = this.repo.create(item);

    // Broadcast to all connected WS clients
    this.broadcastFn({
      type: 'agent_feed_update',
      item: created,
    } as AgentFeedUpdateMessage);

    // Push notification for completed items
    if (created.status === 'completed' || created.status === 'failed') {
      this.notifyFn?.('agent_feed', {
        title: created.title,
        summary: created.summary || created.error || '',
        status: created.status,
      });
    }

    return created;
  }

  /** Update an existing feed item's status */
  updateItemStatus(id: string, status: FeedItemStatus, extra?: { summary?: string; error?: string }): void {
    this.repo.updateStatus(id, status, {
      ...extra,
      completedAt: status === 'completed' || status === 'failed' ? Date.now() : undefined,
    });

    const updated = this.repo.findById(id);
    if (updated) {
      this.broadcastFn({
        type: 'agent_feed_update',
        item: updated,
      } as AgentFeedUpdateMessage);

      if (status === 'completed' || status === 'failed') {
        this.notifyFn?.('agent_feed', {
          title: updated.title,
          summary: updated.summary || updated.error || '',
          status: updated.status,
        });
      }
    }
  }

  /** List feed items with pagination */
  listItems(options?: { limit?: number; before?: number; unreadOnly?: boolean }): {
    items: AgentFeedItem[];
    hasMore: boolean;
    unreadCount: number;
  } {
    const limit = options?.limit ?? 50;
    const items = this.repo.list({ ...options, limit: limit + 1 });
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    return {
      items,
      hasMore,
      unreadCount: this.repo.unreadCount(),
    };
  }

  /** Mark items as read */
  markRead(ids: string[]): void {
    this.repo.markRead(ids);
  }

  /** Get unread count */
  getUnreadCount(): number {
    return this.repo.unreadCount();
  }

  /** Find feed item by task ID (for updating on task completion) */
  findByTaskId(taskId: string): AgentFeedItem | undefined {
    return this.repo.findByTaskId(taskId);
  }
}
