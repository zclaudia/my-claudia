import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

export function writePermissionLog(
  db: Database.Database,
  sessionId: string,
  tool: string,
  detail: string,
  decision: 'allow' | 'deny',
  remembered: boolean,
): void {
  try {
    db.prepare(
      `INSERT INTO permission_logs (id, session_id, tool, detail, decision, remembered, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), sessionId, tool, detail, decision, remembered ? 1 : 0, Date.now());
  } catch (err) {
    console.error('[PermissionLog] Failed to write permission log:', err);
  }
}
