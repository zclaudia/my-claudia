/**
 * WorktreeAllocator adapter that wraps SupervisorService's worktree pool.
 *
 * Phase D MVP: requires the project's supervision worktree pool to have been
 * initialized (i.e., supervision has been run for the project at least once).
 * Phase E will add proper pool lifecycle management.
 */
import type { SupervisorService } from '../../domains/supervision/index.js';
import type { WorktreeAllocator } from '../../domains/meta-workflow/service.js';

// TODO(Phase E): Revisit once meta-workflow has per-run projectId context
// wired through the full call stack. For now each service instance is bound
// to a single defaultProjectId resolved at bootstrap time.

export function createWorktreeAllocatorFromSupervisor(
  supervisorService: SupervisorService,
  projectId: string,
): WorktreeAllocator {
  return {
    async acquire({ runId, phaseId, attempt }) {
      const pool = supervisorService.getWorktreePoolIfExists(projectId);
      if (!pool) {
        throw new Error(
          `WorktreeAllocator: project "${projectId}" has no initialized worktree pool. ` +
          `Run supervision for this project first (or ensure it is started before executing meta-workflow phases).`,
        );
      }
      return pool.acquire(`meta-${runId}-${phaseId}`, attempt);
    },
    async release(path) {
      const pool = supervisorService.getWorktreePoolIfExists(projectId);
      if (pool) {
        pool.release(path);
      }
      // If pool was cleaned up (project deleted), silently ignore.
    },
  };
}
