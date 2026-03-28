import { BaseRepository } from '../../repositories/base.js';
import type { Database } from 'better-sqlite3';
import type { LocalPR, LocalPRStatus, ExecutionState, PendingAction } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

type LocalPRCreate = Omit<LocalPR, 'id' | 'createdAt' | 'updatedAt'>;
type LocalPRUpdate = Partial<Omit<LocalPR, 'id' | 'createdAt'>>;

export class LocalPRRepository extends BaseRepository<LocalPR, LocalPRCreate, LocalPRUpdate> {
  constructor(db: Database) {
    super(db, 'local_prs');
  }

  mapRow(raw: unknown): LocalPR {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      worktreePath: row.worktree_path as string,
      branchName: row.branch_name as string,
      baseBranch: row.base_branch as string,
      title: row.title as string,
      description: (row.description as string) || undefined,
      status: row.status as LocalPRStatus,
      commits: row.commits ? JSON.parse(row.commits as string) : undefined,
      diffSummary: (row.diff_summary as string) || undefined,
      reviewSessionId: (row.review_session_id as string) || undefined,
      conflictSessionId: (row.conflict_session_id as string) || undefined,
      reviewNotes: (row.review_notes as string) || undefined,
      statusMessage: (row.status_message as string) || undefined,
      autoTriggered: row.auto_triggered === 1,
      autoReview: row.auto_review === 1,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      mergedAt: (row.merged_at as number) || undefined,
      mergeCommitSha: (row.merged_commit_sha as string) || undefined,
      executionState: ((row.execution_state as string) || 'idle') as ExecutionState,
      pendingAction: ((row.pending_action as string) || 'none') as PendingAction,
      executionError: (row.execution_error as string) || undefined,
    };
  }

  createQuery(data: LocalPRCreate): { sql: string; params: unknown[] } {
    const id = uuidv4();
    const now = Date.now();
    return {
      sql: `INSERT INTO local_prs (
        id, project_id, worktree_path, branch_name, base_branch,
        title, description, status, commits, diff_summary,
        review_session_id, conflict_session_id, review_notes, status_message,
        auto_triggered, auto_review, created_at, updated_at, merged_at, merged_commit_sha,
        execution_state, pending_action, execution_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.projectId,
        data.worktreePath,
        data.branchName,
        data.baseBranch,
        data.title,
        data.description ?? null,
        data.status ?? 'open',
        data.commits ? JSON.stringify(data.commits) : null,
        data.diffSummary ?? null,
        data.reviewSessionId ?? null,
        data.conflictSessionId ?? null,
        data.reviewNotes ?? null,
        data.statusMessage ?? null,
        data.autoTriggered ? 1 : 0,
        data.autoReview ? 1 : 0,
        now,
        now,
        data.mergedAt ?? null,
        data.mergeCommitSha ?? null,
        data.executionState ?? 'idle',
        data.pendingAction ?? 'none',
        data.executionError ?? null,
      ],
    };
  }

  updateQuery(id: string, data: LocalPRUpdate): { sql: string; params: unknown[] } {
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.commits !== undefined) { sets.push('commits = ?'); params.push(JSON.stringify(data.commits)); }
    if (data.diffSummary !== undefined) { sets.push('diff_summary = ?'); params.push(data.diffSummary); }
    if (data.reviewSessionId !== undefined) { sets.push('review_session_id = ?'); params.push(data.reviewSessionId); }
    if (data.conflictSessionId !== undefined) { sets.push('conflict_session_id = ?'); params.push(data.conflictSessionId); }
    if (data.reviewNotes !== undefined) { sets.push('review_notes = ?'); params.push(data.reviewNotes); }
    if (data.statusMessage !== undefined) { sets.push('status_message = ?'); params.push(data.statusMessage); }
    if (data.autoReview !== undefined) { sets.push('auto_review = ?'); params.push(data.autoReview ? 1 : 0); }
    if (data.mergedAt !== undefined) { sets.push('merged_at = ?'); params.push(data.mergedAt); }
    if (data.mergeCommitSha !== undefined) { sets.push('merged_commit_sha = ?'); params.push(data.mergeCommitSha); }
    if (data.executionState !== undefined) { sets.push('execution_state = ?'); params.push(data.executionState); }
    if (data.pendingAction !== undefined) { sets.push('pending_action = ?'); params.push(data.pendingAction); }
    if (data.executionError !== undefined) { sets.push('execution_error = ?'); params.push(data.executionError); }

    params.push(id);
    return {
      sql: `UPDATE local_prs SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByProjectId(projectId: string): LocalPR[] {
    const rows = this.db
      .prepare('SELECT * FROM local_prs WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId);
    return rows.map((r) => this.mapRow(r));
  }

  findByStatus(status: LocalPRStatus): LocalPR[] {
    const rows = this.db
      .prepare('SELECT * FROM local_prs WHERE status = ? ORDER BY created_at ASC')
      .all(status);
    return rows.map((r) => this.mapRow(r));
  }

  /** PRs ready to start reviewing (open + no active review session). */
  findPendingReview(): LocalPR[] {
    const rows = this.db
      .prepare(`SELECT * FROM local_prs WHERE status = 'open' ORDER BY created_at ASC`)
      .all();
    return rows.map((r) => this.mapRow(r));
  }

  /** PRs with auto_review enabled, ready for automatic review pickup. */
  findPendingAutoReview(): LocalPR[] {
    const rows = this.db
      .prepare(`SELECT * FROM local_prs WHERE status = 'open' AND auto_review = 1 ORDER BY created_at ASC`)
      .all();
    return rows.map((r) => this.mapRow(r));
  }

  /** PRs approved and ready to merge. */
  findPendingMerge(): LocalPR[] {
    const rows = this.db
      .prepare(`SELECT * FROM local_prs WHERE status = 'approved' ORDER BY created_at ASC`)
      .all();
    return rows.map((r) => this.mapRow(r));
  }

  /** PRs currently in-progress (reviewing or merging). */
  findInProgress(): LocalPR[] {
    const rows = this.db
      .prepare(`SELECT * FROM local_prs WHERE status IN ('reviewing', 'merging') ORDER BY updated_at ASC`)
      .all();
    return rows.map((r) => this.mapRow(r));
  }

  /** Check if an open/reviewing/approved PR already exists for a worktree path. */
  findActiveByWorktree(worktreePath: string): LocalPR | null {
    const row = this.db
      .prepare(
        `SELECT * FROM local_prs WHERE worktree_path = ? AND status NOT IN ('merged','closed','review_failed') LIMIT 1`,
      )
      .get(worktreePath);
    return row ? this.mapRow(row) : null;
  }

  /** Find PRs by execution state. */
  findByExecutionState(state: ExecutionState): LocalPR[] {
    const rows = this.db
      .prepare('SELECT * FROM local_prs WHERE execution_state = ? ORDER BY updated_at ASC')
      .all(state);
    return rows.map((r) => this.mapRow(r));
  }

  /** Find PRs that are queued and ready to run. */
  findQueued(): LocalPR[] {
    return this.findByExecutionState('queued');
  }

  /** Find PRs that failed and are retryable. */
  findFailed(): LocalPR[] {
    return this.findByExecutionState('failed');
  }
}
