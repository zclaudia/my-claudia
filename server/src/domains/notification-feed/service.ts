import type Database from 'better-sqlite3';
import type { NotificationItem, NotificationStatus } from '@my-claudia/shared/features/notification-feed';
import type { NotificationReadMessage, NotificationUpdateMessage } from '@my-claudia/shared/protocol/messages';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import { NotificationRepository } from './repository.js';

export interface NotificationServiceDeps {
  db: Database.Database;
  broadcastFn: (message: ServerMessage) => void;
  notifyFn?: (item: NotificationItem) => void | Promise<void>;
}

export class NotificationService {
  private repo: NotificationRepository;
  private broadcastFn: (message: ServerMessage) => void;
  private notifyFn?: (item: NotificationItem) => void | Promise<void>;

  constructor(deps: NotificationServiceDeps) {
    this.repo = new NotificationRepository(deps.db);
    this.broadcastFn = deps.broadcastFn;
    this.notifyFn = deps.notifyFn;
  }

  /** Post a new feed item — persists to DB, broadcasts to clients, optionally sends push notification */
  postItem(item: Omit<NotificationItem, 'id' | 'createdAt' | 'ownerBackendId'> & { ownerBackendId?: string }): NotificationItem {
    const created = this.repo.create({
      ...item,
      ownerBackendId: item.ownerBackendId ?? 'local-standalone',
    });

    // Broadcast to all connected WS clients
    this.broadcastFn({
      type: 'notification_update',
      item: created,
    } as NotificationUpdateMessage);

    // Push notification for completed items
    if (created.status === 'completed' || created.status === 'failed') {
      this.notifyFn?.(created)?.catch(err =>
        console.error('[NotificationService] notifyFn error:', err),
      );
    }

    return created;
  }

  /** Update an existing feed item's status */
  updateItemStatus(id: string, status: NotificationStatus, extra?: { summary?: string; error?: string }): void {
    this.repo.updateStatus(id, status, {
      ...extra,
      completedAt: status === 'completed' || status === 'failed' ? Date.now() : undefined,
    });

    const updated = this.repo.findById(id);
    if (updated) {
      this.broadcastFn({
        type: 'notification_update',
        item: updated,
      } as NotificationUpdateMessage);

      if (status === 'completed' || status === 'failed') {
        this.notifyFn?.(updated)?.catch(err =>
          console.error('[NotificationService] notifyFn error:', err),
        );
      }
    }
  }

  /** List feed items with pagination */
  listItems(options?: { limit?: number; before?: number; unreadOnly?: boolean }): {
    items: NotificationItem[];
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
  markRead(ids: string[]): number {
    if (ids.length === 0) {
      return this.repo.unreadCount();
    }
    const readAt = this.repo.markRead(ids);
    const unreadCount = this.repo.unreadCount();
    this.broadcastFn({
      type: 'notification_read',
      itemIds: ids,
      readAt: readAt ?? Date.now(),
      unreadCount,
    } as NotificationReadMessage);
    return unreadCount;
  }

  markAllRead(): number {
    const readAt = this.repo.markAllRead();
    const unreadCount = this.repo.unreadCount();
    this.broadcastFn({
      type: 'notification_read',
      itemIds: [],
      readAt,
      unreadCount,
    } as NotificationReadMessage);
    return unreadCount;
  }

  dismissItems(ids: string[]): number {
    return this.repo.deleteByIds(ids);
  }

  clearRead(): number {
    return this.repo.deleteRead();
  }

  /** Get unread count */
  getUnreadCount(): number {
    return this.repo.unreadCount();
  }

  /** Find feed item by task ID (for updating on task completion) */
  findByTaskId(taskId: string): NotificationItem | undefined {
    return this.repo.findByTaskId(taskId);
  }
}
