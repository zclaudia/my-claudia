import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { WorktreePool } from '../worktree-pool.js';

function mockExecFileResolves(stdout = '', stderr = '') {
  mockExecFile.mockImplementation(
    (_binary: string, _args: string[], _opts: unknown, callback?: any) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      if (cb) cb(null, { stdout, stderr });
      return {};
    },
  );
}

function mockExecFileSequence(results: Array<{ stdout?: string; stderr?: string; error?: any }>) {
  let callIndex = 0;
  mockExecFile.mockImplementation(
    (_binary: string, _args: string[], _opts: unknown, callback?: any) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      const result = results[callIndex] ?? results[results.length - 1];
      callIndex++;
      if (result.error) {
        if (cb) cb(result.error, { stdout: '', stderr: '' });
      } else {
        if (cb) cb(null, { stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
      }
      return {};
    },
  );
}

describe('WorktreePool', () => {
  let pool: WorktreePool;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new WorktreePool('/projects/test-repo');
    mockExecFileResolves('');
  });

  describe('isInitialized()', () => {
    it('returns false before init', () => {
      expect(pool.isInitialized()).toBe(false);
    });

    it('returns true after init', async () => {
      // Mock worktree list as empty
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('list')) {
            cb(null, { stdout: 'worktree /projects/test-repo\n', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      await pool.init(2);
      expect(pool.isInitialized()).toBe(true);
    });
  });

  describe('init()', () => {
    it('creates N worktree slots', async () => {
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('list')) {
            cb(null, { stdout: 'worktree /projects/test-repo\n', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      await pool.init(3);

      // Should have called `git worktree add --detach` 3 times
      const addCalls = mockExecFile.mock.calls.filter(
        (call: any[]) => call[1] && call[1].includes('add'),
      );
      expect(addCalls).toHaveLength(3);
      expect(addCalls[0][1]).toEqual([
        'worktree',
        'add',
        '--detach',
        '/projects/test-repo/.worktrees/supervision/slot-0',
      ]);

      expect(pool.getStatus().total).toBe(3);
      expect(pool.getStatus().available).toBe(3);
    });

    it('is idempotent - second call is no-op', async () => {
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('list')) {
            cb(null, { stdout: '', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      await pool.init(2);
      const callsBefore = mockExecFile.mock.calls.length;

      await pool.init(2);
      const callsAfter = mockExecFile.mock.calls.length;

      expect(callsAfter).toBe(callsBefore); // No new calls
    });

    it('reuses existing worktrees', async () => {
      const existingPath = '/projects/test-repo/.worktrees/supervision/slot-0';
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('list')) {
            cb(null, {
              stdout: `worktree /projects/test-repo\n\nworktree ${existingPath}\n`,
              stderr: '',
            });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      await pool.init(2);

      // Only slot-1 should be created (slot-0 already exists)
      const addCalls = mockExecFile.mock.calls.filter(
        (call: any[]) => call[1] && call[1].includes('add'),
      );
      expect(addCalls).toHaveLength(1);
      // The args array should contain a path ending in 'slot-1'
      expect(addCalls[0][1]).toEqual(
        expect.arrayContaining([expect.stringContaining('slot-1')]),
      );
    });
  });

  describe('acquire()', () => {
    beforeEach(async () => {
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('list')) {
            cb(null, { stdout: '', stderr: '' });
          } else if (args.includes('symbolic-ref')) {
            cb(null, { stdout: 'origin/main', stderr: '' });
          } else if (args.includes('rev-parse')) {
            cb(null, { stdout: 'main', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );
      await pool.init(2);
    });

    it('returns worktree path and marks slot as in-use', async () => {
      const path = await pool.acquire('task-1', 1);

      expect(path).toBe('/projects/test-repo/.worktrees/supervision/slot-0');
      expect(pool.getStatus().available).toBe(1);
      expect(pool.getStatus().inUse).toHaveLength(1);
      expect(pool.getStatus().inUse[0].taskId).toBe('task-1');
    });

    it('throws when no slots available', async () => {
      await pool.acquire('task-1', 1);
      await pool.acquire('task-2', 1);

      await expect(pool.acquire('task-3', 1)).rejects.toThrow('No available worktree slots');
    });

    it('calls correct git sequence: checkout, reset, clean, branch create', async () => {
      const gitCalls: string[][] = [];
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          gitCalls.push(args);
          if (args.includes('symbolic-ref')) {
            cb(null, { stdout: 'origin/main', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      await pool.acquire('task-1', 1);

      // After pool.init calls, acquire should make these calls:
      // 1. symbolic-ref (getMainBranch)
      // 2. checkout main
      // 3. reset --hard origin/main
      // 4. clean -fd
      // 5. branch -D task/task-1/r1 (delete old branch)
      // 6. checkout -b task/task-1/r1
      const acquireCalls = gitCalls.filter(
        (args) =>
          args.includes('checkout') ||
          args.includes('reset') ||
          args.includes('clean') ||
          (args.includes('branch') && args.includes('-D')),
      );

      expect(acquireCalls.some((a) => a.includes('checkout') && a.includes('main'))).toBe(true);
      expect(acquireCalls.some((a) => a.includes('reset') && a.includes('--hard'))).toBe(true);
      expect(acquireCalls.some((a) => a.includes('clean') && a.includes('-fd'))).toBe(true);
      expect(
        acquireCalls.some((a) => a.includes('-b') && a.includes('task/task-1/r1')),
      ).toBe(true);
    });
  });

  describe('release()', () => {
    beforeEach(async () => {
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('symbolic-ref')) {
            cb(null, { stdout: 'origin/main', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );
      await pool.init(2);
    });

    it('marks slot as available', async () => {
      const path = await pool.acquire('task-1', 1);
      expect(pool.getStatus().available).toBe(1);

      pool.release(path);
      expect(pool.getStatus().available).toBe(2);
    });

    it('ignores non-existent paths silently', () => {
      pool.release('/nonexistent/path');
      expect(pool.getStatus().available).toBe(2);
    });
  });

  describe('mergeBack()', () => {
    beforeEach(async () => {
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('symbolic-ref')) {
            cb(null, { stdout: 'origin/main', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );
      await pool.init(2);
    });

    it('merges task branch back to main on success', async () => {
      const wtPath = await pool.acquire('task-1', 1);

      const gitCalls: string[][] = [];
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          gitCalls.push(args);
          if (args.includes('symbolic-ref')) {
            cb(null, { stdout: 'origin/main', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      const result = await pool.mergeBack('task-1', 1, wtPath);

      expect(result.success).toBe(true);
      // Should call: checkout main, merge --no-ff, checkout main (in wt), branch -d
      expect(gitCalls.some((a) => a.includes('merge') && a.includes('--no-ff'))).toBe(true);
      expect(
        gitCalls.some(
          (a) => a.includes('merge') && a.includes('task/task-1/r1'),
        ),
      ).toBe(true);
    });

    it('returns conflicts on merge failure', async () => {
      const wtPath = await pool.acquire('task-1', 1);

      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('merge') && args.includes('--no-ff')) {
            const err = new Error('merge conflict') as any;
            err.stdout = 'CONFLICT (content): merge conflict in src/file.ts\nAutomatic merge failed';
            err.stderr = '';
            cb(err, { stdout: '', stderr: '' });
          } else if (args.includes('symbolic-ref')) {
            cb(null, { stdout: 'origin/main', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      const result = await pool.mergeBack('task-1', 1, wtPath);

      expect(result.success).toBe(false);
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts!.length).toBeGreaterThan(0);
      expect(result.conflicts![0]).toContain('CONFLICT');
    });

    it('calls merge --abort on conflict', async () => {
      const wtPath = await pool.acquire('task-1', 1);
      const gitCalls: string[][] = [];

      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          gitCalls.push(args);
          if (args.includes('merge') && args.includes('--no-ff')) {
            const err = new Error('conflict') as any;
            err.stdout = 'CONFLICT (content): in file.ts';
            cb(err, { stdout: '', stderr: '' });
          } else if (args.includes('symbolic-ref')) {
            cb(null, { stdout: 'origin/main', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      await pool.mergeBack('task-1', 1, wtPath);

      expect(
        gitCalls.some((a) => a.includes('merge') && a.includes('--abort')),
      ).toBe(true);
    });

    it('serializes concurrent mergeBack calls via mutex', async () => {
      const wt0 = await pool.acquire('task-1', 1);
      const wt1 = await pool.acquire('task-2', 1);

      let concurrentMerges = 0;
      let maxConcurrentMerges = 0;

      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('merge') && args.includes('--no-ff')) {
            concurrentMerges++;
            maxConcurrentMerges = Math.max(maxConcurrentMerges, concurrentMerges);
            // Simulate async merge
            setTimeout(() => {
              concurrentMerges--;
              cb(null, { stdout: '', stderr: '' });
            }, 10);
          } else if (args.includes('symbolic-ref')) {
            cb(null, { stdout: 'origin/main', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      const [r1, r2] = await Promise.all([
        pool.mergeBack('task-1', 1, wt0),
        pool.mergeBack('task-2', 1, wt1),
      ]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      // With mutex, concurrent merge count should never exceed 1
      expect(maxConcurrentMerges).toBe(1);
    });
  });

  describe('destroy()', () => {
    it('removes all worktrees', async () => {
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          cb(null, { stdout: '', stderr: '' });
          return {};
        },
      );

      await pool.init(2);
      await pool.destroy();

      const removeCalls = mockExecFile.mock.calls.filter(
        (call: any[]) => call[1] && call[1].includes('remove'),
      );
      expect(removeCalls).toHaveLength(2);
      expect(pool.getStatus().total).toBe(0);
      expect(pool.isInitialized()).toBe(false);
    });

    it('continues cleanup on individual failure', async () => {
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('remove') && args.some((a) => a.includes('slot-0'))) {
            cb(new Error('remove failed'), { stdout: '', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      await pool.init(2);
      // Should not throw
      await pool.destroy();

      expect(pool.getStatus().total).toBe(0);
    });
  });

  describe('getStatus()', () => {
    it('returns correct counts through lifecycle', async () => {
      mockExecFile.mockImplementation(
        (_binary: string, args: string[], _opts: unknown, callback?: any) => {
          const cb = typeof _opts === 'function' ? _opts : callback;
          if (args.includes('symbolic-ref')) {
            cb(null, { stdout: 'origin/main', stderr: '' });
          } else {
            cb(null, { stdout: '', stderr: '' });
          }
          return {};
        },
      );

      await pool.init(3);
      expect(pool.getStatus()).toEqual({ total: 3, available: 3, inUse: [] });

      const path1 = await pool.acquire('t1', 1);
      expect(pool.getStatus().total).toBe(3);
      expect(pool.getStatus().available).toBe(2);
      expect(pool.getStatus().inUse).toHaveLength(1);

      await pool.acquire('t2', 1);
      expect(pool.getStatus().available).toBe(1);
      expect(pool.getStatus().inUse).toHaveLength(2);

      pool.release(path1);
      expect(pool.getStatus().available).toBe(2);
      expect(pool.getStatus().inUse).toHaveLength(1);
    });
  });
});
