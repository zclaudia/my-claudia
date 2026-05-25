import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { ProjectChange, ChangeStatus } from '@my-claudia/shared/features/supervision';

function slugify(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'change';
}

export class ProjectChangeRepository {
  constructor(private db: Database) {}

  private hasTable(): boolean {
    const row = this.db
      .prepare("SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'project_changes'")
      .get() as { ok?: number } | undefined;
    return Boolean(row?.ok);
  }

  private mapRow(row: any): ProjectChange {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      slug: row.slug,
      status: row.status as ChangeStatus,
      summary: row.summary,
      motivation: row.motivation || undefined,
      nonGoals: row.non_goals ? JSON.parse(row.non_goals) : [],
      scope: row.scope ? JSON.parse(row.scope) : [],
      acceptanceCriteria: row.acceptance_criteria ? JSON.parse(row.acceptance_criteria) : [],
      baselineVersion: row.baseline_version || undefined,
      active: row.active === 1,
      designApprovedAt: row.design_approved_at || undefined,
      executionApprovedAt: row.execution_approved_at || undefined,
      syncApprovedAt: row.sync_approved_at || undefined,
      worktreeId: row.worktree_id || undefined,
      localPrId: row.local_pr_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
    };
  }

  findById(id: string): ProjectChange | undefined {
    if (!this.hasTable()) return undefined;
    const row = this.db.prepare('SELECT * FROM project_changes WHERE id = ?').get(id);
    return row ? this.mapRow(row) : undefined;
  }

  findByProjectId(projectId: string): ProjectChange[] {
    if (!this.hasTable()) return [];
    const rows = this.db
      .prepare('SELECT * FROM project_changes WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId);
    return rows.map((row) => this.mapRow(row));
  }

  findActiveByProjectId(projectId: string): ProjectChange | undefined {
    if (!this.hasTable()) return undefined;
    const row = this.db
      .prepare('SELECT * FROM project_changes WHERE project_id = ? AND active = 1 LIMIT 1')
      .get(projectId);
    return row ? this.mapRow(row) : undefined;
  }

  findBySlug(projectId: string, slug: string): ProjectChange | undefined {
    if (!this.hasTable()) return undefined;
    const row = this.db
      .prepare('SELECT * FROM project_changes WHERE project_id = ? AND slug = ? LIMIT 1')
      .get(projectId, slug);
    return row ? this.mapRow(row) : undefined;
  }

  create(data: {
    projectId: string;
    title: string;
    summary: string;
    motivation?: string;
    nonGoals?: string[];
    scope?: string[];
    acceptanceCriteria?: string[];
    active?: boolean;
  }): ProjectChange {
    if (!this.hasTable()) {
      throw new Error('project_changes table is not available');
    }
    const existing = this.findActiveByProjectId(data.projectId);
    if (data.active !== false && existing) {
      throw new Error(`Project ${data.projectId} already has an active change`);
    }

    const id = uuidv4();
    const now = Date.now();
    const slugBase = slugify(data.title);
    let slug = slugBase;
    let suffix = 2;
    while (this.db.prepare('SELECT 1 FROM project_changes WHERE project_id = ? AND slug = ?').get(data.projectId, slug)) {
      slug = `${slugBase}-${suffix++}`;
    }

    this.db.prepare(`
      INSERT INTO project_changes (
        id, project_id, slug, title, summary, motivation, non_goals, scope,
        acceptance_criteria, status, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.projectId,
      slug,
      data.title,
      data.summary,
      data.motivation ?? null,
      JSON.stringify(data.nonGoals ?? []),
      JSON.stringify(data.scope ?? []),
      JSON.stringify(data.acceptanceCriteria ?? []),
      'draft',
      data.active === false ? 0 : 1,
      now,
      now,
    );

    return this.findById(id)!;
  }

  updateFields(
    id: string,
    data: Partial<{
      title: string;
      summary: string;
      motivation: string | null;
      nonGoals: string[];
      scope: string[];
      acceptanceCriteria: string[];
      active: boolean;
      status: ChangeStatus;
      designApprovedAt: number | null;
      executionApprovedAt: number | null;
      syncApprovedAt: number | null;
      completedAt: number | null;
    }>,
  ): ProjectChange {
    if (!this.hasTable()) {
      throw new Error('project_changes table is not available');
    }
    const updates: string[] = [];
    const params: unknown[] = [];
    if (data.title !== undefined) { updates.push('title = ?'); params.push(data.title); }
    if (data.summary !== undefined) { updates.push('summary = ?'); params.push(data.summary); }
    if (data.motivation !== undefined) { updates.push('motivation = ?'); params.push(data.motivation); }
    if (data.nonGoals !== undefined) { updates.push('non_goals = ?'); params.push(JSON.stringify(data.nonGoals)); }
    if (data.scope !== undefined) { updates.push('scope = ?'); params.push(JSON.stringify(data.scope)); }
    if (data.acceptanceCriteria !== undefined) { updates.push('acceptance_criteria = ?'); params.push(JSON.stringify(data.acceptanceCriteria)); }
    if (data.active !== undefined) { updates.push('active = ?'); params.push(data.active ? 1 : 0); }
    if (data.status !== undefined) { updates.push('status = ?'); params.push(data.status); }
    if (data.designApprovedAt !== undefined) { updates.push('design_approved_at = ?'); params.push(data.designApprovedAt); }
    if (data.executionApprovedAt !== undefined) { updates.push('execution_approved_at = ?'); params.push(data.executionApprovedAt); }
    if (data.syncApprovedAt !== undefined) { updates.push('sync_approved_at = ?'); params.push(data.syncApprovedAt); }
    if (data.completedAt !== undefined) { updates.push('completed_at = ?'); params.push(data.completedAt); }
    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    this.db.prepare(`UPDATE project_changes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Change not found: ${id}`);
    }
    return updated;
  }

  updateStatus(id: string, status: ChangeStatus): ProjectChange {
    const now = Date.now();
    this.db.prepare(`
      UPDATE project_changes
      SET status = ?, updated_at = ?, completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END
      WHERE id = ?
    `).run(status, now, status, now, id);

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Change not found: ${id}`);
    }
    return updated;
  }
}
