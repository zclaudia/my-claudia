# Phase 3: Parallel Execution & Git Workspaces

> **Goal**: Enable `maxConcurrentTasks > 1` with git worktree isolation, branch-based task execution, and mutex-protected merge flow.
>
> **Prerequisite**: Phase 1 + Phase 2 completed.
>
> **Value delivered**: Multiple tasks run simultaneously in isolated worktrees, merged back automatically — dramatically faster for multi-faceted projects.

---

## 1. Overview

Phase 2 runs tasks serially in the main project directory. Phase 3 introduces:

1. **WorktreePool** — pre-allocates git worktrees, manages acquire/release lifecycle
2. **Branch-based execution** — each task runs on `task/{taskId}/r{attempt}`
3. **Mutex-protected merge** — `mergeBack()` serialized to prevent race conditions
4. **Non-git fallback** — non-git projects remain serial (`maxConcurrentTasks = 1`)
5. **Scheduler upgrade** — parallel-aware scheduling respecting `maxConcurrentTasks`

---

## 2. WorktreePool (`server/src/services/worktree-pool.ts`)

New file. Manages a pool of pre-created git worktrees.

### Public API

```typescript
import { Mutex } from 'async-mutex';

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
}

interface WorktreeSlot {
  path: string;
  inUse: boolean;
  taskId?: string;
}

export class WorktreePool {
  private slots: WorktreeSlot[] = [];
  private mergeLock = new Mutex();
  private mainPath: string;

  constructor(mainPath: string) {
    this.mainPath = mainPath;
  }

  // Initialize pool: create N worktrees under .worktrees/
  async init(size: number): Promise<void>;

  // Acquire a worktree for a task: reset to main, create task branch
  async acquire(taskId: string, attempt: number): Promise<string>;

  // Release a worktree back to pool (after merge or failure)
  release(wtPath: string): void;

  // Merge task branch back to main (mutex-protected)
  async mergeBack(taskId: string, attempt: number, wtPath: string): Promise<MergeResult>;

  // Cleanup: remove all worktrees
  async destroy(): Promise<void>;

  // Get pool status (for debugging/monitoring)
  getStatus(): { total: number; available: number; inUse: WorktreeSlot[] };
}
```

### Implementation

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

export class WorktreePool {
  private slots: WorktreeSlot[] = [];
  private mergeLock = new Mutex();
  private mainPath: string;
  private worktreeDir: string;

  constructor(mainPath: string) {
    this.mainPath = mainPath;
    this.worktreeDir = path.join(mainPath, '.worktrees', 'supervision');
  }

  async init(size: number): Promise<void> {
    // Ensure worktree directory exists
    await fs.mkdir(this.worktreeDir, { recursive: true });

    // Check which worktrees already exist
    const { stdout } = await git(['worktree', 'list', '--porcelain'], this.mainPath);
    const existingPaths = new Set(
      stdout.split('\n')
        .filter(l => l.startsWith('worktree '))
        .map(l => l.replace('worktree ', ''))
    );

    for (let i = 0; i < size; i++) {
      const wtPath = path.join(this.worktreeDir, `slot-${i}`);

      if (!existingPaths.has(wtPath)) {
        // Create new worktree with detached HEAD
        await git(['worktree', 'add', '--detach', wtPath], this.mainPath);
      }

      this.slots.push({ path: wtPath, inUse: false });
    }
  }

  async acquire(taskId: string, attempt: number): Promise<string> {
    const slot = this.slots.find(s => !s.inUse);
    if (!slot) {
      throw new Error('No available worktree slots');
    }

    slot.inUse = true;
    slot.taskId = taskId;

    // Reset to latest main
    await git(['checkout', 'main'], slot.path);
    await git(['reset', '--hard', 'origin/main'], slot.path).catch(() =>
      git(['reset', '--hard', 'main'], slot.path)
    );
    await git(['clean', '-fd'], slot.path);

    // Create task branch
    const branch = `task/${taskId}/r${attempt}`;
    await git(['checkout', '-b', branch], slot.path);

    return slot.path;
  }

  release(wtPath: string): void {
    const slot = this.slots.find(s => s.path === wtPath);
    if (slot) {
      slot.inUse = false;
      slot.taskId = undefined;
    }
  }

  async mergeBack(taskId: string, attempt: number, wtPath: string): Promise<MergeResult> {
    return this.mergeLock.runExclusive(async () => {
      const branch = `task/${taskId}/r${attempt}`;

      try {
        await git(['checkout', 'main'], this.mainPath);
        await git(['merge', '--no-ff', branch, '-m', `Merge task ${taskId} (attempt ${attempt})`], this.mainPath);
      } catch (err: any) {
        // Merge conflict — abort and report
        await git(['merge', '--abort'], this.mainPath).catch(() => {});
        const conflictOutput = err.stderr || err.stdout || '';
        const conflicts = conflictOutput
          .split('\n')
          .filter((l: string) => l.includes('CONFLICT'))
          .map((l: string) => l.trim());
        return { success: false, conflicts };
      }

      // Checkout main in worktree so the task branch can be deleted
      await git(['checkout', 'main'], wtPath);
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
  }

  getStatus() {
    return {
      total: this.slots.length,
      available: this.slots.filter(s => !s.inUse).length,
      inUse: this.slots.filter(s => s.inUse),
    };
  }
}
```

### Worktree Location

Worktrees are created under `{projectRoot}/.worktrees/supervision/slot-{N}`. This:
- Avoids polluting the project root
- Is easy to `.gitignore` (add `.worktrees/` to project's `.gitignore`)
- Coexists with existing worktree support in the app (`server/src/utils/git-worktrees.ts`)

---

## 3. Scheduler Upgrade

### Modified `tick()` in SupervisorV2Service

```typescript
tick(projectId: string): void {
  const agent = this.getAgent(projectId);
  if (!agent || agent.phase !== 'active') return;

  const project = this.projectRepo.findById(projectId)!;
  const isGit = this.isGitProject(project.rootPath);
  const maxConcurrent = isGit ? agent.config.maxConcurrentTasks : 1;

  // 1. Promote pending → queued
  const pending = this.taskRepo.findByStatus(projectId, 'pending');
  for (const task of pending) {
    if (this.areDependenciesMet(task)) {
      this.taskRepo.updateStatus(task.id, 'queued');
      this.broadcastTaskUpdate(task);
    }
  }

  // 2. Start queued tasks up to maxConcurrent
  const running = this.taskRepo.findByStatus(projectId, 'running');
  const available = maxConcurrent - running.length;

  if (available <= 0) return;

  const queued = this.taskRepo.findByStatus(projectId, 'queued');
  const toStart = queued.slice(0, available);

  for (const task of toStart) {
    this.startTask(task, isGit);
  }

  // 3. Check idle transition
  if (running.length === 0 && queued.length === 0 && toStart.length === 0) {
    this.checkIdleTransition(projectId);
  }
}
```

### Modified `startTask()`

```typescript
private async startTask(task: SupervisionTask, isGit: boolean): Promise<void> {
  const project = this.projectRepo.findById(task.projectId)!;
  let workingDirectory = project.rootPath!;
  let baseCommit: string | undefined;

  // Acquire worktree for parallel execution
  if (isGit && project.agent!.config.maxConcurrentTasks > 1) {
    const pool = this.getWorktreePool(project.id);
    workingDirectory = await pool.acquire(task.id, task.attempt);

    // Record base commit for deterministic review
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workingDirectory });
    baseCommit = stdout.trim();
  } else if (isGit) {
    // Serial mode — still record base commit for review
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workingDirectory });
    baseCommit = stdout.trim();
  }

  // Create task session
  const session = this.sessionRepo.create({
    projectId: task.projectId,
    name: `Task: ${task.title}`,
    type: 'background',
    projectRole: 'task',
    taskId: task.id,
    providerId: project.providerId,
    workingDirectory,
  });

  // Update task status with session and base commit
  this.taskRepo.updateStatus(task.id, 'running', {
    sessionId: session.id,
    baseCommit,
  });

  // Build and send prompt
  const contextInjection = this.contextManager.getContextForTask(task.relevantDocIds);
  const prompt = this.buildTaskSystemPrompt(task, contextInjection);
  this.triggerProviderRun(session, prompt);
}
```

---

## 4. Merge Integration

### After Review Approval

In `ReviewEngine.handleReviewComplete()`:

```typescript
async handleReviewComplete(task: SupervisionTask, verdict: ReviewVerdict): Promise<void> {
  if (verdict.approved) {
    this.taskRepo.updateStatus(task.id, 'approved');

    // Attempt merge (if using worktree)
    const session = this.sessionRepo.findById(task.sessionId!);
    const project = this.projectRepo.findById(task.projectId)!;

    if (session?.workingDirectory && session.workingDirectory !== project.rootPath) {
      const pool = this.getWorktreePool(project.id);
      const result = await pool.mergeBack(task.id, task.attempt, session.workingDirectory);

      if (result.success) {
        this.taskRepo.updateStatus(task.id, 'integrated');
        pool.release(session.workingDirectory);
      } else {
        this.taskRepo.updateStatus(task.id, 'merge_conflict', {
          result: {
            ...task.result,
            reviewNotes: `Merge conflicts: ${result.conflicts?.join(', ')}`,
          },
        });
        // Don't release worktree — keep it for manual conflict resolution
      }
    } else {
      // Serial mode — approved = integrated
      this.taskRepo.updateStatus(task.id, 'integrated');
    }

    // Write review result
    this.contextManager.writeReviewResult(task.id, this.formatReviewResult(verdict));

  } else {
    // Rejected — retry or fail
    this.handleRejection(task, verdict);
  }

  // Archive review session
  this.archiveReviewSession(task);
}
```

### Merge Conflict Resolution (Manual)

When a task enters `merge_conflict`:
1. The worktree is NOT released — user can inspect it
2. User resolves conflicts manually in the worktree
3. User calls API: `POST /tasks/:taskId/resolve-conflict`
4. Backend attempts merge again or commits the resolution

New API endpoint:

```
POST /api/v2/supervision/tasks/:taskId/resolve-conflict
```

Implementation:
```typescript
async resolveConflict(taskId: string): Promise<void> {
  const task = this.taskRepo.findById(taskId);
  if (!task || task.status !== 'merge_conflict') throw new Error('Task not in merge_conflict state');

  const session = this.sessionRepo.findById(task.sessionId!);
  if (!session?.workingDirectory) throw new Error('No worktree for this task');

  const pool = this.getWorktreePool(task.projectId);
  const result = await pool.mergeBack(task.id, task.attempt, session.workingDirectory);

  if (result.success) {
    this.taskRepo.updateStatus(task.id, 'integrated');
    pool.release(session.workingDirectory);
  } else {
    throw new Error(`Still has conflicts: ${result.conflicts?.join(', ')}`);
  }
}
```

---

## 5. WorktreePool Lifecycle Management

### Pool per Project

```typescript
private worktreePools = new Map<string, WorktreePool>();

getWorktreePool(projectId: string): WorktreePool {
  if (!this.worktreePools.has(projectId)) {
    const project = this.projectRepo.findById(projectId)!;
    const pool = new WorktreePool(project.rootPath!);
    this.worktreePools.set(projectId, pool);
  }
  return this.worktreePools.get(projectId)!;
}
```

### Pool Initialization Timing

The pool is lazily initialized when the first task transitions to `running` with `maxConcurrentTasks > 1`:

```typescript
async ensurePoolInitialized(projectId: string): Promise<void> {
  const pool = this.getWorktreePool(projectId);
  if (pool.getStatus().total === 0) {
    const agent = this.getAgent(projectId)!;
    await pool.init(agent.config.maxConcurrentTasks);
  }
}
```

### Pool Cleanup

When agent is archived or project is deleted:

```typescript
async cleanupPool(projectId: string): Promise<void> {
  const pool = this.worktreePools.get(projectId);
  if (pool) {
    await pool.destroy();
    this.worktreePools.delete(projectId);
  }
}
```

---

## 6. Review Evidence Update

Phase 2 collects git diff from the main directory. Phase 3 changes this to work with worktrees:

```typescript
async collectGitEvidence(task: SupervisionTask): Promise<string> {
  const session = this.sessionRepo.findById(task.sessionId!);
  const cwd = session?.workingDirectory || this.project.rootPath!;

  if (task.baseCommit) {
    const { stdout } = await execAsync(
      `git diff ${task.baseCommit}..HEAD`,
      { cwd, maxBuffer: 1024 * 1024 },
    );
    return this.truncateDiff(stdout);
  }

  // Fallback: diff against main
  const { stdout } = await execAsync('git diff main..HEAD', { cwd, maxBuffer: 1024 * 1024 });
  return this.truncateDiff(stdout);
}
```

---

## 7. pnpm Install in Worktrees

Since worktrees share the same `.git` but have separate working directories, `node_modules` may need setup:

```typescript
async setupWorktreeDeps(wtPath: string, mainPath: string): Promise<void> {
  // Check if pnpm-lock.yaml exists (pnpm workspace)
  const lockFile = path.join(mainPath, 'pnpm-lock.yaml');
  if (await fs.access(lockFile).then(() => true).catch(() => false)) {
    // pnpm uses a global store — install is fast for worktrees
    await execAsync('pnpm install --frozen-lockfile', { cwd: wtPath, timeout: 120_000 });
  }
}
```

This runs during `acquire()` after branch checkout, only if a lockfile exists.

---

## 8. Non-Git Project Handling

Non-git projects in Phase 3 continue to operate exactly as Phase 2:
- `maxConcurrentTasks` forced to 1
- No worktrees, no branching
- `approved` = `integrated` directly
- Snapshot-based integration deferred to Phase 4

Detection:

```typescript
isGitProject(rootPath?: string): boolean {
  if (!rootPath) return false;
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: rootPath, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
```

---

## 9. File Changes Summary

### New Files

| File | Description |
|------|-------------|
| `server/src/services/worktree-pool.ts` | Git worktree pool management |

### Modified Files

| File | Changes |
|------|---------|
| `server/src/services/supervisor-v2-service.ts` | Parallel scheduler, worktree acquisition, pool management |
| `server/src/services/review-engine.ts` | Worktree-aware evidence collection, merge flow on approval |
| `server/src/services/task-runner.ts` | Worktree-aware auto-commit, pnpm install |
| `server/src/routes/supervision-v2.ts` | Add `resolve-conflict` endpoint |

### New Dependencies

| Package | Workspace | Purpose |
|---------|-----------|---------|
| `async-mutex` | server | Mutex for merge serialization |

```bash
pnpm add --filter server async-mutex
```

---

## 10. Testing Strategy

### Unit Tests

| Test File | Covers |
|-----------|--------|
| `server/src/services/__tests__/worktree-pool.test.ts` | Init, acquire, release, merge, conflict, destroy |

### Integration Tests

| Test | Scenario |
|------|----------|
| Parallel schedule | 2 tasks queued, both start when `maxConcurrentTasks = 2` |
| Merge success | Task branch merges cleanly to main |
| Merge conflict | Task branch conflicts with main → `merge_conflict` status |
| Merge mutex | Two tasks complete near-simultaneously → merges serialized |
| Serial fallback | Non-git project → `maxConcurrentTasks` forced to 1 |
| Pool resize | Agent config changes `maxConcurrentTasks` → pool re-initialized |
| Worktree cleanup | Archive agent → worktrees removed |

### Key Test Scenarios

1. **Concurrent merge safety**: two tasks finishing within ms of each other, mutex ensures no corruption
2. **Worktree reuse**: after task completes, worktree is cleaned and reused by next task
3. **Branch naming**: `task/{taskId}/r{attempt}` — unique per retry, no collisions
4. **Git clean**: untracked files from previous task don't leak into next task
5. **Base commit recording**: `baseCommit` correctly captures HEAD before task starts
6. **Merge conflict keeps worktree**: worktree NOT released when conflict detected

---

## 11. Acceptance Criteria

- [ ] `maxConcurrentTasks > 1` allows multiple tasks to run simultaneously
- [ ] Each parallel task gets its own worktree with isolated task branch
- [ ] Worktrees reset to latest main before each task (no state leakage)
- [ ] Merge is mutex-protected — no race conditions
- [ ] Merge conflicts detected and task enters `merge_conflict` status
- [ ] `resolve-conflict` API allows manual conflict resolution
- [ ] Non-git projects silently degrade to serial execution
- [ ] Worktree pool lazily initialized, cleaned up on agent archive
- [ ] `pnpm install` runs in worktrees when lockfile present
- [ ] Review evidence collection works in worktree context
- [ ] Base commit recorded at task start for deterministic diffs
