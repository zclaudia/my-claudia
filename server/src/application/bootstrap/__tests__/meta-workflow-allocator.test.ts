import { describe, it, expect, vi } from 'vitest';
import { createWorktreeAllocatorFromSupervisor } from '../meta-workflow-allocator.js';

describe('meta-workflow-allocator persistent per-run worktree', () => {
  it('returns the same path for two acquires with the same runId', async () => {
    const acquireMock = vi.fn().mockResolvedValue('/tmp/worktree-slot-1');
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: acquireMock,
        ensurePoolInitialized: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');

    const p1 = await allocator.acquire({ runId: 'run-A', phaseId: 'p1', attempt: 1 });
    const p2 = await allocator.acquire({ runId: 'run-A', phaseId: 'p2', attempt: 1 });
    expect(p1).toBe('/tmp/worktree-slot-1');
    expect(p2).toBe('/tmp/worktree-slot-1');
    expect(acquireMock).toHaveBeenCalledOnce();
  });

  it('returns different paths for different runIds', async () => {
    let counter = 0;
    const acquireMock = vi.fn().mockImplementation(async () => `/tmp/slot-${++counter}`);
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: acquireMock,
        ensurePoolInitialized: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');

    const a = await allocator.acquire({ runId: 'run-A', phaseId: 'p1', attempt: 1 });
    const b = await allocator.acquire({ runId: 'run-B', phaseId: 'p1', attempt: 1 });
    expect(a).not.toBe(b);
    expect(acquireMock).toHaveBeenCalledTimes(2);
  });

  it('release is a no-op (Phase E2a does not release per-phase)', async () => {
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: vi.fn().mockResolvedValue('/tmp/slot'),
        ensurePoolInitialized: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');
    await allocator.acquire({ runId: 'run-A', phaseId: 'p1', attempt: 1 });
    await expect(allocator.release('/tmp/slot')).resolves.toBeUndefined();
  });

  it('releaseRun returns the cached path to the pool and clears the entry', async () => {
    const releaseMock = vi.fn();
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: vi.fn().mockResolvedValue('/tmp/slot-x'),
        release: releaseMock,
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');
    await allocator.acquire({ runId: 'run-A', phaseId: 'p1', attempt: 1 });
    await allocator.releaseRun('run-A');
    expect(releaseMock).toHaveBeenCalledWith('/tmp/slot-x');

    // Subsequent acquire for same runId triggers a fresh underlying acquire.
    await allocator.acquire({ runId: 'run-A', phaseId: 'p2', attempt: 1 });
    const pool = supervisorService.getWorktreePoolIfExists.mock.results.at(-1)!.value as { acquire: ReturnType<typeof vi.fn> };
    expect(pool.acquire).toHaveBeenCalledTimes(2);
  });

  it('releaseRun is a no-op for an unknown runId', async () => {
    const releaseMock = vi.fn();
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: vi.fn().mockResolvedValue('/tmp/slot'),
        release: releaseMock,
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');
    await expect(allocator.releaseRun('never-acquired')).resolves.toBeUndefined();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('releaseRun awaits an in-flight acquire before releasing', async () => {
    let resolveAcquire: (p: string) => void;
    const acquirePromise = new Promise<string>((res) => { resolveAcquire = res; });
    const releaseMock = vi.fn();
    const supervisorService = {
      getWorktreePoolIfExists: vi.fn().mockReturnValue({
        acquire: vi.fn().mockReturnValue(acquirePromise),
        release: releaseMock,
      }),
    };
    const allocator = createWorktreeAllocatorFromSupervisor(supervisorService as never, 'proj-1');
    const acquired = allocator.acquire({ runId: 'run-A', phaseId: 'p1', attempt: 1 });
    const released = allocator.releaseRun('run-A');
    resolveAcquire!('/tmp/slot-y');
    await acquired;
    await released;
    expect(releaseMock).toHaveBeenCalledWith('/tmp/slot-y');
  });
});
