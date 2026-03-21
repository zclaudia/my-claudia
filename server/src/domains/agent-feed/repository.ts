import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { AgentFeedItem, FeedItemStatus, FeedItemSource } from '@my-claudia/shared';

interface FeedRow {
  id: string;
  trigger_id: string | null;
  task_id: string | null;
  session_id: string | null;
  project_id: string | null;
  source: string;
  title: string;
  summary: string | null;
  status: string;
  error: string | null;
  delegation_context: string | null;
  created_at: number;
  completed_at: number | null;
  read_at: number | null;
}

function rowToItem(row: FeedRow): AgentFeedItem {
  return {
    id: row.id,
    triggerId: row.trigger_id ?? undefined,
    taskId: row.task_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    projectId: row.project_id ?? undefined,
    source: row.source as FeedItemSource,
    title: row.title,
    summary: row.summary ?? undefined,
    status: row.status as FeedItemStatus,
    error: row.error ?? undefined,
    delegationContext: row.delegation_context ? JSON.parse(row.delegation_context) : undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    readAt: row.read_at ?? undefined,
  };
}

export class AgentFeedRepository {
  constructor(private db: Database.Database) {}

  create(item: Omit<AgentFeedItem, 'id' | 'createdAt'>): AgentFeedItem {
    const id = uuidv4();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO agent_feed (id, trigger_id, task_id, session_id, project_id, source, title, summary, status, error, delegation_context, created_at, completed_at, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      item.triggerId ?? null,
      item.taskId ?? null,
      item.sessionId ?? null,
      item.projectId ?? null,
      item.source,
      item.title,
      item.summary ?? null,
      item.status,
      item.error ?? null,
      item.delegationContext ? JSON.stringify(item.delegationContext) : null,
      now,
      item.completedAt ?? null,
      item.readAt ?? null,
    );
    return { ...item, id, createdAt: now };
  }

  updateStatus(id: string, status: FeedItemStatus, extra?: { summary?: string; error?: string; completedAt?: number }): void {
    this.db.prepare(`
      UPDATE agent_feed SET status = ?, summary = COALESCE(?, summary), error = COALESCE(?, error), completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `).run(status, extra?.summary ?? null, extra?.error ?? null, extra?.completedAt ?? null, id);
  }

  list(options?: { limit?: number; before?: number; unreadOnly?: boolean }): AgentFeedItem[] {
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
      `SELECT * FROM agent_feed ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params, limit) as FeedRow[];

    return rows.map(rowToItem);
  }

  markRead(ids: string[]): number | undefined {
    if (ids.length === 0) return undefined;
    const now = Date.now();
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE agent_feed SET read_at = ? WHERE id IN (${placeholders}) AND read_at IS NULL`
    ).run(now, ...ids);
    return now;
  }

  unreadCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM agent_feed WHERE read_at IS NULL').get() as { count: number };
    return row.count;
  }

  findById(id: string): AgentFeedItem | undefined {
    const row = this.db.prepare('SELECT * FROM agent_feed WHERE id = ?').get(id) as FeedRow | undefined;
    return row ? rowToItem(row) : undefined;
  }

  findByTaskId(taskId: string): AgentFeedItem | undefined {
    const row = this.db.prepare('SELECT * FROM agent_feed WHERE task_id = ?').get(taskId) as FeedRow | undefined;
    return row ? rowToItem(row) : undefined;
  }
}
