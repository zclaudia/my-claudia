import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import type { GitWorktree, GitWorktreeStatus } from '@my-claudia/shared/core/project';
import { createGitWorktree, listGitWorktrees } from '../../utils/git-worktrees.js';
import {
  getGitStatus,
  getCurrentBranch,
  getMainBranch,
  getAheadBehind,
  removeWorktree as gitRemoveWorktree,
} from '../../utils/git-operations.js';

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectRootPathMissingError extends Error {
  constructor(projectId: string) {
    super(`Project has no root path: ${projectId}`);
    this.name = 'ProjectRootPathMissingError';
  }
}

export class WorktreeNotFoundError extends Error {
  constructor(worktreePath: string) {
    super(`Worktree not registered: ${worktreePath}`);
    this.name = 'WorktreeNotFoundError';
  }
}

export class SupervisorManagedWorktreeError extends Error {
  constructor(worktreePath: string) {
    super(`Worktree is managed by Supervisor and cannot be deleted manually: ${worktreePath}`);
    this.name = 'SupervisorManagedWorktreeError';
  }
}

export class MainWorktreeError extends Error {
  constructor(worktreePath: string) {
    super(`Cannot remove the main worktree: ${worktreePath}`);
    this.name = 'MainWorktreeError';
  }
}

const SUPERVISOR_POOL_SEGMENT = `${path.sep}.worktrees${path.sep}supervision${path.sep}`;

function isSupervisorManagedPath(p: string): boolean {
  const normalized = path.normalize(p);
  return normalized.includes(SUPERVISOR_POOL_SEGMENT);
}

export class ProjectWorktreeService {
  constructor(private readonly db: Database.Database) {}

  listWorktrees(projectId: string): GitWorktree[] {
    const rootPath = this.getProjectRootPath(projectId);
    if (!rootPath) return [];
    return listGitWorktrees(rootPath).map((wt) => ({
      ...wt,
      managedBy: isSupervisorManagedPath(wt.path) ? ('supervisor' as const) : undefined,
    }));
  }

  createWorktree(
    projectId: string,
    input: { branch?: string; path?: string },
  ): GitWorktree {
    const rootPath = this.getProjectRootPath(projectId);
    if (!rootPath) {
      throw new ProjectRootPathMissingError(projectId);
    }

    const branch = this.resolveBranchName(input.branch);
    const worktreePath = this.resolveWorktreePath(rootPath, branch, input.path);

    if (!input.path?.trim()) {
      this.ensureWorktreesGitignore(rootPath);
    }

    return createGitWorktree(rootPath, worktreePath, branch);
  }

  /**
   * Remove a worktree by absolute path.
   * Refuses if the worktree is supervisor-managed, the main worktree, or not registered on this project.
   */
  async removeWorktree(projectId: string, worktreePath: string): Promise<void> {
    const rootPath = this.requireProjectRootPath(projectId);
    const target = path.normalize(worktreePath);

    if (isSupervisorManagedPath(target)) {
      throw new SupervisorManagedWorktreeError(target);
    }

    const worktrees = listGitWorktrees(rootPath);
    const match = worktrees.find((wt) => path.normalize(wt.path) === target);
    if (!match) {
      throw new WorktreeNotFoundError(target);
    }
    if (match.isMain) {
      throw new MainWorktreeError(target);
    }

    const branchName = match.branch && !match.branch.startsWith('detached@')
      ? match.branch
      : undefined;
    await gitRemoveWorktree(rootPath, target, branchName);
  }

  /**
   * Returns the working-tree status of a registered worktree.
   */
  async getWorktreeStatus(projectId: string, worktreePath: string): Promise<GitWorktreeStatus> {
    const rootPath = this.requireProjectRootPath(projectId);
    const target = path.normalize(worktreePath);

    const worktrees = listGitWorktrees(rootPath);
    const match = worktrees.find((wt) => path.normalize(wt.path) === target);
    if (!match) {
      throw new WorktreeNotFoundError(target);
    }

    const status = await getGitStatus(target);
    const currentBranch = await getCurrentBranch(target).catch(() => match.branch);

    let ahead = 0;
    let behind = 0;
    // Skip ahead/behind for detached HEAD — no symbolic branch to compare.
    if (currentBranch && !currentBranch.startsWith('detached@') && currentBranch !== 'HEAD') {
      try {
        const baseBranch = await getMainBranch(target);
        if (baseBranch && baseBranch !== currentBranch) {
          const counts = await getAheadBehind(target, currentBranch, baseBranch);
          ahead = counts.ahead;
          behind = counts.behind;
        }
      } catch {
        // ahead/behind is best-effort
      }
    }

    return {
      clean: !status.hasChanges,
      staged: status.staged,
      unstaged: status.unstaged,
      untracked: status.untracked,
      currentBranch,
      ahead,
      behind,
    };
  }

  /**
   * Validates that worktreePath is registered on the project and returns the main repo path.
   * Throws if the path is unknown or supervisor-managed (when checkManaged is true).
   */
  resolveWorktreeForGitOp(projectId: string, worktreePath: string): { rootPath: string; worktreePath: string } {
    const rootPath = this.requireProjectRootPath(projectId);
    const target = path.normalize(worktreePath);
    const worktrees = listGitWorktrees(rootPath);
    const match = worktrees.find((wt) => path.normalize(wt.path) === target);
    if (!match) {
      throw new WorktreeNotFoundError(target);
    }
    return { rootPath, worktreePath: target };
  }

  /** Returns root_path or null (for list), throws ProjectNotFoundError if project missing */
  private getProjectRootPath(projectId: string): string | null {
    const project = this.db
      .prepare('SELECT root_path FROM projects WHERE id = ?')
      .get(projectId) as { root_path: string | null } | undefined;

    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }

    return project.root_path;
  }

  private requireProjectRootPath(projectId: string): string {
    const rootPath = this.getProjectRootPath(projectId);
    if (!rootPath) {
      throw new ProjectRootPathMissingError(projectId);
    }
    return rootPath;
  }

  private resolveBranchName(rawBranch?: string): string {
    return rawBranch?.trim()
      || `wt-${new Date()
        .toISOString()
        .slice(0, 16)
        .replace(/[-T:]/g, '')
        .replace(/(\d{8})(\d{4})/, '$1-$2')}`;
  }

  private resolveWorktreePath(rootPath: string, branch: string, rawPath?: string): string {
    return rawPath?.trim()
      || path.join(rootPath, '.worktrees', branch.replace(/\//g, '-'));
  }

  private ensureWorktreesGitignore(repoPath: string): void {
    const gitignorePath = path.join(repoPath, '.gitignore');
    const entry = '.worktrees/';

    try {
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        if (!content.split('\n').some((line) => line.trim() === entry)) {
          fs.appendFileSync(gitignorePath, `\n${entry}\n`);
        }
        return;
      }

      fs.writeFileSync(gitignorePath, `${entry}\n`);
    } catch {
      // Best effort only.
    }
  }
}
