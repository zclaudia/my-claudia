import type {
  SupervisionTask,
  SupervisionLogEvent,
} from '@my-claudia/shared';
import type { ProjectRepository } from '../../repositories/project.js';
import type { SessionRepository } from '../../repositories/session.js';
import { WorktreePool } from './worktree-pool.js';

export interface WorktreeManagerDeps {
  projectRepo: ProjectRepository;
  sessionRepo: SessionRepository;
  log: (projectId: string, event: SupervisionLogEvent, detail?: Record<string, unknown>, taskId?: string) => void;
}

export class WorktreeManager {
  private worktreePools = new Map<string, WorktreePool>();
  private poolInitPromises = new Map<string, Promise<void>>();
  private deps: WorktreeManagerDeps;

  constructor(deps: WorktreeManagerDeps) {
    this.deps = deps;
  }

  getWorktreePool(projectId: string): WorktreePool {
    if (!this.worktreePools.has(projectId)) {
      const project = this.deps.projectRepo.findById(projectId);
      if (!project?.rootPath) {
        throw new Error(`Project ${projectId} has no rootPath for worktree pool`);
      }
      const pool = new WorktreePool(project.rootPath);
      this.worktreePools.set(projectId, pool);
    }
    return this.worktreePools.get(projectId)!;
  }

  async ensurePoolInitialized(projectId: string): Promise<void> {
    const pool = this.getWorktreePool(projectId);
    if (pool.isInitialized()) {
      return;
    }

    const existingInit = this.poolInitPromises.get(projectId);
    if (existingInit) {
      await existingInit;
      return;
    }

    const initPromise = (async () => {
      const project = this.deps.projectRepo.findById(projectId);
      const maxConcurrent = project?.agent?.config?.maxConcurrentTasks ?? 2;
      await pool.init(maxConcurrent);
    })();

    this.poolInitPromises.set(projectId, initPromise);

    try {
      await initPromise;
    } finally {
      this.poolInitPromises.delete(projectId);
    }
  }

  async cleanupPool(projectId: string): Promise<void> {
    this.poolInitPromises.delete(projectId);
    const pool = this.worktreePools.get(projectId);
    if (pool) {
      await pool.destroy();
      this.worktreePools.delete(projectId);
    }
  }

  destroyAllPools(): void {
    this.poolInitPromises.clear();
    for (const [, pool] of this.worktreePools) {
      pool.destroy().catch(() => {});
    }
    this.worktreePools.clear();
  }

  releaseTaskWorktree(task: SupervisionTask): void {
    const session = task.sessionId ? this.deps.sessionRepo.findById(task.sessionId) : undefined;
    const project = this.deps.projectRepo.findById(task.projectId);
    if (
      session?.workingDirectory &&
      project?.rootPath &&
      session.workingDirectory !== project.rootPath
    ) {
      const pool = this.worktreePools.get(task.projectId);
      pool?.release(session.workingDirectory);
      this.deps.log(task.projectId, 'worktree_released', {
        taskId: task.id, worktreePath: session.workingDirectory,
      }, task.id);
    }
  }

  hasWorktreePool(projectId: string): boolean {
    return this.worktreePools.has(projectId);
  }

  getWorktreePoolIfExists(projectId: string): WorktreePool | undefined {
    return this.worktreePools.get(projectId);
  }

  /**
   * Get the internal pools map — used for releasing worktrees directly
   * when the pool reference is needed without creating a new pool.
   */
  getPoolsMap(): Map<string, WorktreePool> {
    return this.worktreePools;
  }
}
