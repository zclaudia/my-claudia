// server/src/domains/epics/repository.ts
//
// Persistence for the `epics` table (C5 extraction). Epics are thematic
// containers for LocalIssues; lifecycle is just open/closed/cancelled.

import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Epic, EpicStatus } from '@my-claudia/shared/features/epic';

export interface EpicCreate {
  projectId: string;
  title: string;
  description?: string;
  status?: EpicStatus;
  labels?: string[];
}

export interface EpicUpdate {
  title?: string;
  description?: string;
  status?: EpicStatus;
  labels?: string[];
  closedAt?: number;
}

export class EpicRepository {
  constructor(private db: Database) {}

  private mapRow(raw: unknown): Epic {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      description: (row.description as string) || undefined,
      status: row.status as EpicStatus,
      labels: row.labels ? JSON.parse(row.labels as string) : [],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      closedAt: (row.closed_at as number) || undefined,
    };
  }

  create(data: EpicCreate): Epic {
    const id = uuidv4();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO epics (
        id, project_id, title, description, status, labels,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.projectId,
      data.title,
      data.description ?? null,
      data.status ?? 'open',
      JSON.stringify(data.labels ?? []),
      now,
      now,
    );
    return this.findById(id)!;
  }

  update(id: string, data: EpicUpdate): Epic {
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [Date.now()];
    if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.labels !== undefined) { sets.push('labels = ?'); params.push(JSON.stringify(data.labels)); }
    if (data.closedAt !== undefined) { sets.push('closed_at = ?'); params.push(data.closedAt); }
    params.push(id);
    this.db.prepare(`UPDATE epics SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    const next = this.findById(id);
    if (!next) throw new Error(`Epic not found: ${id}`);
    return next;
  }

  findById(id: string): Epic | null {
    const row = this.db.prepare('SELECT * FROM epics WHERE id = ?').get(id);
    return row ? this.mapRow(row) : null;
  }

  findByProjectId(projectId: string): Epic[] {
    const rows = this.db
      .prepare('SELECT * FROM epics WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId);
    return rows.map((r) => this.mapRow(r));
  }

  delete(id: string): boolean {
    const res = this.db.prepare('DELETE FROM epics WHERE id = ?').run(id);
    return res.changes > 0;
  }
}
