/**
 * Layer 2: Memory Store — persistent key-value knowledge store.
 * Project-scoped (project_id set) or global (project_id = NULL).
 */

import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';

export interface MemoryEntry {
  id: string;
  projectId: string | null;
  namespace: string;
  key: string;
  value: string;
  authorScope: string;
  createdAt: number;
  updatedAt: number;
}

export class MemoryStore {
  constructor(private db: Database.Database) {}

  get(projectId: string | null, namespace: string, key: string): string | undefined {
    const row = this.db.prepare(
      `SELECT value FROM agent_memory WHERE project_id IS ? AND namespace = ? AND key = ?`
    ).get(projectId, namespace, key) as { value: string } | undefined;
    return row?.value;
  }

  set(projectId: string | null, namespace: string, key: string, value: string, authorScope = 'project'): void {
    const now = Date.now();
    const existing = this.db.prepare(
      `SELECT id FROM agent_memory WHERE project_id IS ? AND namespace = ? AND key = ?`
    ).get(projectId, namespace, key) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(
        `UPDATE agent_memory SET value = ?, author_scope = ?, updated_at = ? WHERE id = ?`
      ).run(value, authorScope, now, existing.id);
    } else {
      this.db.prepare(
        `INSERT INTO agent_memory (id, project_id, namespace, key, value, author_scope, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), projectId, namespace, key, value, authorScope, now, now);
    }
  }

  delete(projectId: string | null, namespace: string, key: string): boolean {
    const result = this.db.prepare(
      `DELETE FROM agent_memory WHERE project_id IS ? AND namespace = ? AND key = ?`
    ).run(projectId, namespace, key);
    return result.changes > 0;
  }

  list(projectId: string | null, namespace?: string): MemoryEntry[] {
    const query = namespace
      ? `SELECT * FROM agent_memory WHERE project_id IS ? AND namespace = ? ORDER BY updated_at DESC`
      : `SELECT * FROM agent_memory WHERE project_id IS ? ORDER BY updated_at DESC`;
    const params = namespace ? [projectId, namespace] : [projectId];
    return this.parseRows(this.db.prepare(query).all(...params));
  }

  /** Get project + global memories for Context Engine injection */
  getProjectAndGlobalMemories(projectId: string): MemoryEntry[] {
    const rows = this.db.prepare(
      `SELECT * FROM agent_memory WHERE project_id = ? OR project_id IS NULL ORDER BY updated_at DESC`
    ).all(projectId);
    return this.parseRows(rows);
  }

  private parseRows(rows: unknown[]): MemoryEntry[] {
    return (rows as Array<{
      id: string;
      project_id: string | null;
      namespace: string;
      key: string;
      value: string;
      author_scope: string;
      created_at: number;
      updated_at: number;
    }>).map(r => ({
      id: r.id,
      projectId: r.project_id,
      namespace: r.namespace,
      key: r.key,
      value: r.value,
      authorScope: r.author_scope,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }
}
