import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { createGitWorktree, listGitWorktrees } from '../../utils/git-worktrees.js';

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

export class ProjectWorktreeService {
  constructor(private readonly db: Database.Database) {}

  listWorktrees(projectId: string) {
    const rootPath = this.getProjectRootPath(projectId);
    if (!rootPath) return [];
    return listGitWorktrees(rootPath);
  }

  createWorktree(
    projectId: string,
    input: { branch?: string; path?: string },
  ) {
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
