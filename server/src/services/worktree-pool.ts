import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdir } from 'fs/promises';
import path from 'path';
import { Mutex } from 'async-mutex';
import type { MergeResult } from '@my-claudia/shared';

const execFileAsync = promisify(execFileCb);

async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

export interface WorktreeSlot {
  path: string;
  inUse: boolean;
  taskId?: string;
}

export class WorktreePool {
  private slots: WorktreeSlot[] = [];
  private mergeLock = new Mutex();
  private mainPath: string;
  private worktreeDir: string;
  private initialized = false;

  constructor(mainPath: string) {
    this.mainPath = mainPath;
    this.worktreeDir = path.join(mainPath, '.worktrees', 'supervision');
  }

  async init(size: number): Promise<void> {
    if (this.initialized) return;

    await mkdir(this.worktreeDir, { recursive: true });

    // Discover existing worktrees
    const { stdout } = await git(['worktree', 'list', '--porcelain'], this.mainPath);
    const existingPaths = new Set(
      stdout
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .map((l) => l.replace('worktree ', '').trim()),
    );

    for (let i = 0; i < size; i++) {
      const wtPath = path.join(this.worktreeDir, `slot-${i}`);

      if (!existingPaths.has(wtPath)) {
        await git(['worktree', 'add', '--detach', wtPath], this.mainPath);
      }

      this.slots.push({ path: wtPath, inUse: false });
    }

    this.initialized = true;
  }

  async acquire(taskId: string, attempt: number): Promise<string> {
    const slot = this.slots.find((s) => !s.inUse);
    if (!slot) {
      throw new Error('No available worktree slots');
    }

    slot.inUse = true;
    slot.taskId = taskId;

    const mainBranch = await this.getMainBranch();

    // Reset to latest main
    await git(['checkout', mainBranch], slot.path);
    await git(['reset', '--hard', `origin/${mainBranch}`], slot.path).catch(() =>
      git(['reset', '--hard', mainBranch], slot.path),
    );
    await git(['clean', '-fd'], slot.path);

    // Create task branch (delete first if exists from previous attempt)
    const branch = `task/${taskId}/r${attempt}`;
    await git(['branch', '-D', branch], this.mainPath).catch(() => {});
    await git(['checkout', '-b', branch], slot.path);

    return slot.path;
  }

  release(wtPath: string): void {
    const slot = this.slots.find((s) => s.path === wtPath);
    if (slot) {
      slot.inUse = false;
      slot.taskId = undefined;
    }
  }

  async mergeBack(
    taskId: string,
    attempt: number,
    wtPath: string,
  ): Promise<MergeResult> {
    return this.mergeLock.runExclusive(async () => {
      const branch = `task/${taskId}/r${attempt}`;
      const mainBranch = await this.getMainBranch();

      try {
        await git(['checkout', mainBranch], this.mainPath);
        await git(
          [
            'merge',
            '--no-ff',
            branch,
            '-m',
            `Merge task ${taskId} (attempt ${attempt})`,
          ],
          this.mainPath,
        );
      } catch (err: unknown) {
        // Merge conflict — abort and report
        await git(['merge', '--abort'], this.mainPath).catch(() => {});
        const execErr = err as { stderr?: string; stdout?: string };
        const conflictOutput = execErr.stderr || execErr.stdout || '';
        const conflicts = conflictOutput
          .split('\n')
          .filter((l: string) => l.includes('CONFLICT'))
          .map((l: string) => l.trim());
        return { success: false, conflicts };
      }

      // Checkout main in worktree so the task branch can be deleted
      await git(['checkout', mainBranch], wtPath);
      await git(['branch', '-d', branch], this.mainPath).catch(() => {});

      return { success: true };
    });
  }

  async destroy(): Promise<void> {
    for (const slot of this.slots) {
      try {
        await git(['worktree', 'remove', '--force', slot.path], this.mainPath);
      } catch {
        // Best-effort cleanup
      }
    }
    this.slots = [];
    this.initialized = false;
  }

  getStatus(): { total: number; available: number; inUse: WorktreeSlot[] } {
    return {
      total: this.slots.length,
      available: this.slots.filter((s) => !s.inUse).length,
      inUse: this.slots.filter((s) => s.inUse),
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private async getMainBranch(): Promise<string> {
    try {
      const { stdout } = await git(
        ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
        this.mainPath,
      );
      return stdout.trim().replace('origin/', '');
    } catch {
      // Fallback: check if 'main' or 'master' exists
      try {
        await git(['rev-parse', '--verify', 'refs/heads/main'], this.mainPath);
        return 'main';
      } catch {
        return 'master';
      }
    }
  }
}
