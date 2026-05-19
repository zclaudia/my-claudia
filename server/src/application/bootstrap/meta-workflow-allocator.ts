/**
 * WorktreeAllocator adapter that wraps SupervisorService's worktree pool.
 *
 * Phase E2a: persistent per-run worktree — all phases in the same run share
 * one slot. This is required so phase B can read commits produced by phase A
 * (they execute in the same worktree filesystem).
 *
 * Phase D MVP: requires the project's supervision worktree pool to have been
 * initialized (i.e., supervision has been run for the project at least once).
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
  // Phase E2a: persistent per-run worktree cache.
  //
  // We cache the in-flight acquire Promise (not just the resolved path) so
  // that two concurrent acquires for the same runId share the underlying
  // pool.acquire() call instead of grabbing two slots.
  const pathByRun = new Map<string, Promise<string>>();

  return {
    async acquire({ runId, attempt }) {
      const existing = pathByRun.get(runId);
      if (existing) return existing;

      const pool = supervisorService.getWorktreePoolIfExists(projectId);
      if (!pool) {
        throw new Error(
          `WorktreeAllocator: project "${projectId}" has no initialized worktree pool. ` +
          `Run supervision for this project first (or ensure it is started before executing meta-workflow phases).`,
        );
      }

      // Phase E2a: taskId is per-run, not per-phase, so the pool can recycle
      // the slot when the run completes.
      const acquirePromise = pool.acquire(`meta-${runId}`, attempt);
      pathByRun.set(runId, acquirePromise);
      try {
        return await acquirePromise;
      } catch (e) {
        // Allow retry on next acquire by clearing the failed in-flight entry.
        pathByRun.delete(runId);
        throw e;
      }
    },
    async release(_path) {
      // Phase E2a: release is a no-op per phase. Run-level release lands in
      // Phase E2b/F when phase teardown is wired (currently the pool slot
      // recycles naturally when the supervisor task completes).
    },
  };
}
