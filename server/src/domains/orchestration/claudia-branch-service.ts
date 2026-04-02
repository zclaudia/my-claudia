/**
 * Claudia Branch Service — manages branch allocation for Claudia Chat.
 *
 * Core rules:
 * 1. No active task on current branch → reuse current branch (session reuse)
 * 2. Active task exists on current branch → fork new branch
 * 3. Continue from task → prefer that task's branch
 * 4. Resume → always reuse original branch
 * 5. Explicit new conversation → force fork
 */

import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';

export type BranchAction = 'reused' | 'forked' | 'created';

const ACTIVE_STATUSES = ['running', 'queued', 'waiting'] as const;

/** Port interface — conversation domain depends on this, not on the concrete class. */
export interface BranchAllocatorPort {
  allocateBranch(opts: { hostProjectId: string; activeBranchId?: string | null; forceNew?: boolean; title: string; sessionId: string }): BranchAllocation;
  allocateForContinue(opts: { taskBranchId: string | null; hostProjectId: string; title: string; sessionId: string }): BranchAllocation;
  setActiveBranchId(hostProjectId: string, branchId: string | null): void;
  attachSession(branchId: string, sessionId: string): void;
  updateBranchTask(branchId: string, taskId: string, sessionId?: string): void;
}

export interface BranchAllocation {
  branchId: string;
  sessionId: string;
  action: BranchAction;
  contextReset?: boolean;
}

export interface ClaudiaBranch {
  id: string;
  hostProjectId: string;
  activeSessionId: string | null;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  lastTaskId: string | null;
}

export interface ClaudiaProjectActiveBranch {
  projectId: string;
  branchId: string;
}

export class ClaudiaBranchService {
  constructor(private db: Database.Database) {}

  private sessionExists(sessionId: string | null | undefined): boolean {
    if (!sessionId) return false;
    const row = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId) as { 1: number } | undefined;
    return Boolean(row);
  }

  /**
   * Find a branch by ID.
   */
  findById(branchId: string): ClaudiaBranch | null {
    const row = this.db.prepare(
      'SELECT * FROM claudia_branches WHERE id = ?'
    ).get(branchId) as BranchRow | undefined;
    return row ? rowToBranch(row) : null;
  }

  /**
   * Check if a branch has any active (running/queued/waiting) tasks.
   */
  branchHasActiveTask(branchId: string): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM orchestrator_tasks
       WHERE branch_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})
       LIMIT 1`
    ).get(branchId, ...ACTIVE_STATUSES) as { 1: number } | undefined;
    return !!row;
  }

  /**
   * Create a new branch. Session is attached later once a real session row exists.
   */
  createBranch(opts: {
    hostProjectId: string;
    title: string;
  }): ClaudiaBranch {
    const id = uuidv4();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO claudia_branches (id, host_project_id, active_session_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, opts.hostProjectId, null, opts.title, now, now);
    return {
      id,
      hostProjectId: opts.hostProjectId,
      activeSessionId: null,
      title: opts.title,
      createdAt: now,
      updatedAt: now,
      lastTaskId: null,
    };
  }

  /**
   * Update branch metadata after a task is bound to it.
   */
  updateBranchTask(branchId: string, taskId: string, sessionId?: string): void {
    const now = Date.now();
    if (sessionId) {
      this.db.prepare(
        'UPDATE claudia_branches SET last_task_id = ?, active_session_id = ?, updated_at = ? WHERE id = ?'
      ).run(taskId, sessionId, now, branchId);
    } else {
      this.db.prepare(
        'UPDATE claudia_branches SET last_task_id = ?, updated_at = ? WHERE id = ?'
      ).run(taskId, now, branchId);
    }
  }

  /**
   * Attach a real session to a branch after the session row exists.
   */
  attachSession(branchId: string, sessionId: string): void {
    this.db.prepare(
      'UPDATE claudia_branches SET active_session_id = ?, updated_at = ? WHERE id = ?'
    ).run(sessionId, Date.now(), branchId);
  }

  getActiveBranchId(hostProjectId: string): string | null {
    const row = this.db.prepare(
      'SELECT active_branch_id FROM claudia_project_state WHERE host_project_id = ?'
    ).get(hostProjectId) as { active_branch_id: string | null } | undefined;
    return row?.active_branch_id ?? null;
  }

  listActiveBranches(): ClaudiaProjectActiveBranch[] {
    const rows = this.db.prepare(
      'SELECT host_project_id, active_branch_id FROM claudia_project_state WHERE active_branch_id IS NOT NULL'
    ).all() as Array<{ host_project_id: string; active_branch_id: string }>;
    return rows.map((row) => ({
      projectId: row.host_project_id,
      branchId: row.active_branch_id,
    }));
  }

  setActiveBranchId(hostProjectId: string, branchId: string | null): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO claudia_project_state (host_project_id, active_branch_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(host_project_id) DO UPDATE SET
        active_branch_id = excluded.active_branch_id,
        updated_at = excluded.updated_at
    `).run(hostProjectId, branchId, now);
  }

  /**
   * Allocate a branch for a new Claudia message.
   *
   * Algorithm (from design doc):
   * 1. If resume → reuse original branch (handled by caller)
   * 2. If continue from task → prefer task's branch (handled by caller)
   * 3. If forceNew → fork new branch
   * 4. If activeBranchId provided and no active task → reuse
   * 5. If activeBranchId provided but has active task → fork
   * 6. No active branch → create new branch
   */
  allocateBranch(opts: {
    hostProjectId: string;
    activeBranchId?: string | null;
    forceNew?: boolean;
    title: string;
    sessionId: string;
  }): BranchAllocation {
    // Force new conversation
    if (opts.forceNew) {
      const branch = this.createBranch({
        hostProjectId: opts.hostProjectId,
        title: opts.title,
      });
      return { branchId: branch.id, sessionId: opts.sessionId, action: 'created' };
    }

    // Try to reuse active branch
    if (opts.activeBranchId) {
      const branch = this.findById(opts.activeBranchId);
      if (branch && branch.hostProjectId === opts.hostProjectId) {
        if (!this.branchHasActiveTask(branch.id)) {
          if (this.sessionExists(branch.activeSessionId)) {
            return { branchId: branch.id, sessionId: branch.activeSessionId!, action: 'reused' };
          }
          return { branchId: branch.id, sessionId: opts.sessionId, action: 'created', contextReset: true };
        }
        // Branch busy — fork new branch
        const newBranch = this.createBranch({
          hostProjectId: opts.hostProjectId,
          title: opts.title,
        });
        return { branchId: newBranch.id, sessionId: opts.sessionId, action: 'forked' };
      }
    }

    // No active branch — create new
    const branch = this.createBranch({
      hostProjectId: opts.hostProjectId,
      title: opts.title,
    });
    return { branchId: branch.id, sessionId: opts.sessionId, action: 'created' };
  }

  /**
   * Allocate branch for a "Continue from task" action.
   * Prefer the task's original branch; fork if that branch is busy.
   */
  allocateForContinue(opts: {
    taskBranchId: string | null;
    hostProjectId: string;
    title: string;
    sessionId: string;
  }): BranchAllocation {
    if (opts.taskBranchId) {
      const branch = this.findById(opts.taskBranchId);
      if (branch && !this.branchHasActiveTask(branch.id)) {
        if (this.sessionExists(branch.activeSessionId)) {
          return { branchId: branch.id, sessionId: branch.activeSessionId!, action: 'reused' };
        }
        return { branchId: branch.id, sessionId: opts.sessionId, action: 'created', contextReset: true };
      }
      if (branch) {
        // Branch busy — fork with context reset warning
        const newBranch = this.createBranch({
          hostProjectId: opts.hostProjectId,
          title: opts.title,
        });
        return { branchId: newBranch.id, sessionId: opts.sessionId, action: 'forked', contextReset: true };
      }
    }
    // No branch info — create new
    const newBranch = this.createBranch({
      hostProjectId: opts.hostProjectId,
      title: opts.title,
    });
    return { branchId: newBranch.id, sessionId: opts.sessionId, action: 'created' };
  }
}

// Internal row type
interface BranchRow {
  id: string;
  host_project_id: string;
  active_session_id: string | null;
  title: string | null;
  created_at: number;
  updated_at: number;
  last_task_id: string | null;
}

function rowToBranch(row: BranchRow): ClaudiaBranch {
  return {
    id: row.id,
    hostProjectId: row.host_project_id,
    activeSessionId: row.active_session_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTaskId: row.last_task_id,
  };
}
