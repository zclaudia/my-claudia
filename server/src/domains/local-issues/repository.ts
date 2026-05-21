import { BaseRepository } from '../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  LocalIssue,
  LocalIssueStatus,
  LocalIssueType,
} from '@my-claudia/shared/features/local-issue';
import { v4 as uuidv4 } from 'uuid';

/**
 * Create payload. `type` and `isAnonymous` default in the repo if omitted
 * (mirrors the SQLite schema defaults: type='implement', is_anonymous=0).
 */
export type LocalIssueCreate = Omit<
  LocalIssue,
  'id' | 'createdAt' | 'updatedAt' | 'type' | 'isAnonymous'
> & {
  type?: LocalIssueType;
  isAnonymous?: boolean;
};

export type LocalIssueUpdate = Partial<
  Omit<LocalIssue, 'id' | 'projectId' | 'createdAt'>
>;

export class LocalIssueRepository extends BaseRepository<LocalIssue, LocalIssueCreate, LocalIssueUpdate> {
  constructor(db: Database) {
    super(db, 'local_issues');
  }

  mapRow(raw: unknown): LocalIssue {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      description: (row.description as string) || undefined,
      status: row.status as LocalIssueStatus,
      priority: row.priority as LocalIssue['priority'],
      labels: row.labels ? JSON.parse(row.labels as string) : [],
      // G1 additions — columns added by migration 070_openspec_foundation.
      type: (row.type as LocalIssueType) ?? 'implement',
      parentIssueId: (row.parent_issue_id as string) || undefined,
      specChangeId: (row.spec_change_id as string) || undefined,
      isAnonymous: row.is_anonymous === 1,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      closedAt: (row.closed_at as number) || undefined,
    };
  }

  createQuery(data: LocalIssueCreate): { sql: string; params: unknown[] } {
    const id = uuidv4();
    const now = Date.now();
    return {
      sql: `INSERT INTO local_issues (
        id, project_id, title, description, status, priority, labels,
        type, parent_issue_id, spec_change_id, is_anonymous,
        created_at, updated_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.projectId,
        data.title,
        data.description ?? null,
        data.status ?? 'open',
        data.priority ?? 'medium',
        JSON.stringify(data.labels ?? []),
        data.type ?? 'implement',
        data.parentIssueId ?? null,
        data.specChangeId ?? null,
        data.isAnonymous ? 1 : 0,
        now,
        now,
        data.closedAt ?? null,
      ],
    };
  }

  updateQuery(id: string, data: LocalIssueUpdate): { sql: string; params: unknown[] } {
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.priority !== undefined) { sets.push('priority = ?'); params.push(data.priority); }
    if (data.labels !== undefined) { sets.push('labels = ?'); params.push(JSON.stringify(data.labels)); }
    if (data.closedAt !== undefined) { sets.push('closed_at = ?'); params.push(data.closedAt); }
    // G1 additions
    if (data.type !== undefined) { sets.push('type = ?'); params.push(data.type); }
    if (data.parentIssueId !== undefined) { sets.push('parent_issue_id = ?'); params.push(data.parentIssueId); }
    if (data.specChangeId !== undefined) { sets.push('spec_change_id = ?'); params.push(data.specChangeId); }
    if (data.isAnonymous !== undefined) { sets.push('is_anonymous = ?'); params.push(data.isAnonymous ? 1 : 0); }

    params.push(id);
    return {
      sql: `UPDATE local_issues SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByProjectId(projectId: string): LocalIssue[] {
    const rows = this.db
      .prepare('SELECT * FROM local_issues WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId);
    return rows.map((r) => this.mapRow(r));
  }

  findByStatus(projectId: string, status: LocalIssueStatus): LocalIssue[] {
    const rows = this.db
      .prepare('SELECT * FROM local_issues WHERE project_id = ? AND status = ? ORDER BY created_at DESC')
      .all(projectId, status);
    return rows.map((r) => this.mapRow(r));
  }
}
