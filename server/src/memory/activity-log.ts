/**
 * Layer 1: Activity Log — append-only journal of agent actions.
 * Records session-level summaries on run completion.
 */

import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';

export interface ActivityLogEntry {
  id: string;
  projectId: string | null;
  sessionId: string | null;
  type: string;
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export function recordActivity(
  db: Database.Database,
  entry: Omit<ActivityLogEntry, 'id' | 'createdAt'>,
): void {
  db.prepare(`
    INSERT INTO agent_activity_log (id, project_id, session_id, type, summary, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    entry.projectId,
    entry.sessionId,
    entry.type,
    entry.summary,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
    Date.now(),
  );
}

export function getRecentActivity(
  db: Database.Database,
  projectId: string | null,
  limit = 50,
): ActivityLogEntry[] {
  const query = projectId
    ? `SELECT * FROM agent_activity_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM agent_activity_log ORDER BY created_at DESC LIMIT ?`;
  const params = projectId ? [projectId, limit] : [limit];
  const rows = db.prepare(query).all(...params) as Array<{
    id: string;
    project_id: string | null;
    session_id: string | null;
    type: string;
    summary: string;
    metadata: string | null;
    created_at: number;
  }>;
  return rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    sessionId: r.session_id,
    type: r.type,
    summary: r.summary,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    createdAt: r.created_at,
  }));
}
