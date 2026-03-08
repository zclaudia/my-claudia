import type { Database } from 'better-sqlite3';
import type { WorktreeConfig } from '@my-claudia/shared';

export class WorktreeConfigRepository {
  constructor(private db: Database) {}

  private mapRow(row: any): WorktreeConfig {
    return {
      projectId: row.project_id,
      worktreePath: row.worktree_path,
      autoCreatePR: row.auto_create_pr === 1,
      autoReview: row.auto_review === 1,
    };
  }

  findByProjectId(projectId: string): WorktreeConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM worktree_configs WHERE project_id = ?')
      .all(projectId);
    return rows.map((r) => this.mapRow(r));
  }

  findOne(projectId: string, worktreePath: string): WorktreeConfig | null {
    const row = this.db
      .prepare('SELECT * FROM worktree_configs WHERE project_id = ? AND worktree_path = ?')
      .get(projectId, worktreePath);
    return row ? this.mapRow(row) : null;
  }

  upsert(config: WorktreeConfig): WorktreeConfig {
    this.db
      .prepare(
        `INSERT INTO worktree_configs (project_id, worktree_path, auto_create_pr, auto_review)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id, worktree_path)
         DO UPDATE SET auto_create_pr = excluded.auto_create_pr, auto_review = excluded.auto_review`,
      )
      .run(
        config.projectId,
        config.worktreePath,
        config.autoCreatePR ? 1 : 0,
        config.autoReview ? 1 : 0,
      );
    return this.findOne(config.projectId, config.worktreePath)!;
  }

  delete(projectId: string, worktreePath: string): void {
    this.db
      .prepare('DELETE FROM worktree_configs WHERE project_id = ? AND worktree_path = ?')
      .run(projectId, worktreePath);
  }
}
