import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import {
  EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB,
  classifyNotificationItemTab,
  type NotificationItem,
  type NotificationStatus,
  type NotificationSource,
  type NotificationInitiator,
  type NotificationUnreadCountsByTab,
} from '@my-claudia/shared/features/notification-feed';

interface FeedRow {
  id: string;
  trigger_id: string | null;
  task_id: string | null;
  session_id: string | null;
  project_id: string | null;
  source: string;
  initiator: string | null;
  title: string;
  summary: string | null;
  status: string;
  error: string | null;
  delegation_context: string | null;
  created_at: number;
  completed_at: number | null;
  read_at: number | null;
}

const LOCAL_NOTIFICATION_BACKEND_ID = 'local-standalone';

function rowToItem(row: FeedRow): NotificationItem {
  return {
    id: row.id,
    triggerId: row.trigger_id ?? undefined,
    taskId: row.task_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    projectId: row.project_id ?? undefined,
    ownerBackendId: LOCAL_NOTIFICATION_BACKEND_ID,
    source: row.source as NotificationSource,
    initiator: (row.initiator as NotificationInitiator) ?? undefined,
    title: row.title,
    summary: row.summary ?? undefined,
    status: row.status as NotificationStatus,
    error: row.error ?? undefined,
    delegationContext: row.delegation_context ? JSON.parse(row.delegation_context) : undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    readAt: row.read_at ?? undefined,
  };
}

export class NotificationRepository {
  constructor(private db: Database.Database) {}

  create(item: Omit<NotificationItem, 'id' | 'createdAt'>): NotificationItem {
    const id = uuidv4();
    const now = Date.now();
    const normalizedItem: Omit<NotificationItem, 'id' | 'createdAt'> = {
      ...item,
      ownerBackendId: item.ownerBackendId || LOCAL_NOTIFICATION_BACKEND_ID,
    };
    this.db.prepare(`
      INSERT INTO notifications (id, trigger_id, task_id, session_id, project_id, source, initiator, title, summary, status, error, delegation_context, created_at, completed_at, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      normalizedItem.triggerId ?? null,
      normalizedItem.taskId ?? null,
      normalizedItem.sessionId ?? null,
      normalizedItem.projectId ?? null,
      normalizedItem.source,
      normalizedItem.initiator ?? null,
      normalizedItem.title,
      normalizedItem.summary ?? null,
      normalizedItem.status,
      normalizedItem.error ?? null,
      normalizedItem.delegationContext ? JSON.stringify(normalizedItem.delegationContext) : null,
      now,
      normalizedItem.completedAt ?? null,
      normalizedItem.readAt ?? null,
    );
    return { ...normalizedItem, id, createdAt: now };
  }

  updateStatus(id: string, status: NotificationStatus, extra?: { summary?: string; error?: string; completedAt?: number }): void {
    this.db.prepare(`
      UPDATE notifications SET status = ?, summary = COALESCE(?, summary), error = COALESCE(?, error), completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `).run(status, extra?.summary ?? null, extra?.error ?? null, extra?.completedAt ?? null, id);
  }

  list(options?: { limit?: number; before?: number; unreadOnly?: boolean }): NotificationItem[] {
    const limit = options?.limit ?? 50;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.before) {
      conditions.push('created_at < ?');
      params.push(options.before);
    }
    if (options?.unreadOnly) {
      conditions.push('read_at IS NULL');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params, limit) as FeedRow[];

    return rows.map(rowToItem);
  }

  markRead(ids: string[]): number | undefined {
    if (ids.length === 0) return undefined;
    const now = Date.now();
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE notifications SET read_at = ? WHERE id IN (${placeholders}) AND read_at IS NULL`
    ).run(now, ...ids);
    return now;
  }

  markAllRead(): number {
    const now = Date.now();
    this.db.prepare(
      'UPDATE notifications SET read_at = ? WHERE read_at IS NULL'
    ).run(now);
    return now;
  }

  deleteByIds(ids: string[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const result = this.db.prepare(
      `DELETE FROM notifications WHERE id IN (${placeholders})`
    ).run(...ids);
    return result.changes;
  }

  deleteRead(): number {
    const result = this.db.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL').run();
    return result.changes;
  }

  unreadCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read_at IS NULL').get() as { count: number };
    return row.count;
  }

  unreadCountsByTab(): NotificationUnreadCountsByTab {
    const rows = this.db.prepare(
      'SELECT source, initiator, delegation_context FROM notifications WHERE read_at IS NULL'
    ).all() as Array<Pick<FeedRow, 'source' | 'initiator' | 'delegation_context'>>;

    const counts: NotificationUnreadCountsByTab = { ...EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB };
    for (const row of rows) {
      const tab = classifyNotificationItemTab({
        source: row.source as NotificationSource,
        initiator: (row.initiator as NotificationInitiator) ?? undefined,
        delegationContext: row.delegation_context ? JSON.parse(row.delegation_context) : undefined,
        pluginTab: undefined,
      });
      // Only count built-in tabs; plugin tab counts are computed client-side
      if (tab in counts) counts[tab as keyof NotificationUnreadCountsByTab] += 1;
    }

    return counts;
  }

  findById(id: string): NotificationItem | undefined {
    const row = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as FeedRow | undefined;
    return row ? rowToItem(row) : undefined;
  }

  findByTaskId(taskId: string): NotificationItem | undefined {
    const row = this.db.prepare('SELECT * FROM notifications WHERE task_id = ?').get(taskId) as FeedRow | undefined;
    return row ? rowToItem(row) : undefined;
  }
}
