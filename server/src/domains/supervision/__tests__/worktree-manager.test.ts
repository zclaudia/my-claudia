import { describe, it, expect, vi } from 'vitest';
import { WorktreeManager } from '../worktree-manager.js';

describe('WorktreeManager', () => {
  it('deduplicates concurrent pool initialization', async () => {
    let releaseInit!: () => void;
    const initPromise = new Promise<void>((resolve) => {
      releaseInit = resolve;
    });

    const mockPool = {
      isInitialized: vi.fn().mockReturnValue(false),
      init: vi.fn().mockReturnValue(initPromise),
      destroy: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };

    const manager = new WorktreeManager({
      projectRepo: {
        findById: vi.fn().mockReturnValue({
          id: 'p1',
          rootPath: '/tmp/project',
          agent: { config: { maxConcurrentTasks: 3 } },
        }),
      } as any,
      sessionRepo: {} as any,
      log: vi.fn(),
    });

    (manager as any).worktreePools.set('p1', mockPool);

    const first = manager.ensurePoolInitialized('p1');
    const second = manager.ensurePoolInitialized('p1');

    releaseInit();
    await Promise.all([first, second]);

    expect(mockPool.init).toHaveBeenCalledTimes(1);
  });
});
