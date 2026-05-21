import { BaseRepository } from '../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  SpecChange,
  SpecChangeCreate,
  SpecChangeUpdate,
  SpecChangeStatus,
} from '@my-claudia/shared/features/spec-change';
import { v4 as uuidv4 } from 'uuid';

interface Row {
  id: string;
  project_id: string;
  sub_issue_id: string;
  slug: string;
  title: string;
  status: string;
  proposal_path: string;
  design_path: string;
  tasks_path: string;
  delta_spec_paths: string;
  delta_pending_merge: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export class SpecChangeRepository extends BaseRepository<
  SpecChange,
  SpecChangeCreate,
  SpecChangeUpdate
> {
  constructor(db: Database) {
    super(db, 'spec_changes');
  }

  mapRow(raw: unknown): SpecChange {
    const r = raw as Row;
    return {
      id: r.id,
      projectId: r.project_id,
      subIssueId: r.sub_issue_id,
      slug: r.slug,
      title: r.title,
      status: r.status as SpecChangeStatus,
      proposalPath: r.proposal_path,
      designPath: r.design_path,
      tasksPath: r.tasks_path,
      deltaSpecPaths: JSON.parse(r.delta_spec_paths) as string[],
      deltaPendingMerge: r.delta_pending_merge === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      archivedAt: r.archived_at ?? undefined,
    };
  }

  createQuery(data: SpecChangeCreate): { sql: string; params: unknown[] } {
    const id = uuidv4();
    const now = Date.now();
    const base = `openspec/changes/${data.slug}`;
    return {
      sql: `INSERT INTO spec_changes
              (id, project_id, sub_issue_id, slug, title, status,
               proposal_path, design_path, tasks_path,
               delta_spec_paths, delta_pending_merge, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.projectId,
        data.subIssueId,
        data.slug,
        data.title,
        'drafting',
        `${base}/proposal.md`,
        `${base}/design.md`,
        `${base}/tasks.md`,
        '[]',
        0,
        now,
        now,
      ],
    };
  }

  updateQuery(id: string, data: SpecChangeUpdate): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.status !== undefined) {
      sets.push('status = ?');
      params.push(data.status);
    }
    if (data.title !== undefined) {
      sets.push('title = ?');
      params.push(data.title);
    }
    if (data.deltaSpecPaths !== undefined) {
      sets.push('delta_spec_paths = ?');
      params.push(JSON.stringify(data.deltaSpecPaths));
    }
    if (data.deltaPendingMerge !== undefined) {
      sets.push('delta_pending_merge = ?');
      params.push(data.deltaPendingMerge ? 1 : 0);
    }
    if (data.archivedAt !== undefined) {
      sets.push('archived_at = ?');
      params.push(data.archivedAt);
    }
    // Always bump updated_at so callers can rely on it monotonically advancing
    // even when the update payload is otherwise empty.
    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    return {
      sql: `UPDATE spec_changes SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findBySubIssue(subIssueId: string): SpecChange | null {
    const row = this.db
      .prepare(`SELECT * FROM spec_changes WHERE sub_issue_id = ?`)
      .get(subIssueId);
    return row ? this.mapRow(row) : null;
  }

  findBySlug(projectId: string, slug: string): SpecChange | null {
    const row = this.db
      .prepare(`SELECT * FROM spec_changes WHERE project_id = ? AND slug = ?`)
      .get(projectId, slug);
    return row ? this.mapRow(row) : null;
  }

  listByProject(projectId: string): SpecChange[] {
    const rows = this.db
      .prepare(`SELECT * FROM spec_changes WHERE project_id = ? ORDER BY created_at DESC`)
      .all(projectId);
    return rows.map((r) => this.mapRow(r));
  }
}
