import type {
  RunFailedMessage,
  ServerMessage,
  Session,
  SupervisionLogEvent,
} from '@my-claudia/shared';
import { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import { ProjectRepository } from '../../repositories/project.js';
import { SessionRepository } from '../../repositories/session.js';
import { TaskRunner } from './task-runner.js';
import { WorktreeManager } from './worktree-manager.js';
import type { CheckpointEngine } from './checkpoint-engine.js';

interface TaskLifecycleDeps {
  taskRepo: SupervisionTaskRepository;
  projectRepo: ProjectRepository;
  sessionRepo: SessionRepository;
  taskRunner: TaskRunner;
  worktreeManager: WorktreeManager;
  virtualClients: Map<string, unknown>;
  getCheckpointEngine: () => CheckpointEngine | undefined;
  tick: () => void;
  broadcastTaskUpdate: (taskId: string, projectId: string) => void;
  log: (
    projectId: string,
    event: SupervisionLogEvent,
    detail?: Record<string, unknown>,
    taskId?: string,
  ) => void;
}

export class TaskLifecycle {
  constructor(private deps: TaskLifecycleDeps) {}

  handleTaskRunMessage(
    taskId: string,
    projectId: string,
    msg: ServerMessage,
  ): void {
    if (msg.type === 'run_completed') {
      this.clearTaskSessionReadOnly(taskId);

      this.deps.taskRunner.onTaskComplete(taskId, projectId).catch((err) => {
        console.error(`[Supervisor] TaskRunner.onTaskComplete failed for ${taskId}:`, err);
        this.deps.taskRepo.updateStatus(taskId, 'reviewing', {
          result: { summary: 'Task completed but review pipeline failed', filesChanged: [] },
        });
        this.deps.broadcastTaskUpdate(taskId, projectId);
      });
      this.deps.virtualClients.delete(taskId);

      const checkpointEngine = this.deps.getCheckpointEngine();
      if (checkpointEngine?.shouldTrigger(projectId, 'task_complete')) {
        checkpointEngine.runCheckpoint(projectId).catch((err) => {
          console.error(`[Supervisor] Checkpoint failed after task ${taskId}:`, err);
        });
      }
      return;
    }

    if (msg.type !== 'run_failed') return;

    this.clearTaskSessionReadOnly(taskId);

    try {
      const errorMsg = 'error' in msg ? (msg as RunFailedMessage).error : 'Run failed';
      this.deps.taskRepo.updateStatus(taskId, 'failed', {
        result: { summary: `Run failed: ${errorMsg}`, filesChanged: [] },
      });
      this.deps.broadcastTaskUpdate(taskId, projectId);
      this.deps.log(projectId, 'task_status_changed', {
        taskId,
        from: 'running',
        to: 'failed',
        error: errorMsg,
      }, taskId);

      const failedTask = this.deps.taskRepo.findById(taskId);
      if (failedTask) {
        this.deps.worktreeManager.releaseTaskWorktree(failedTask);
      }
    } catch (err) {
      console.error(`[Supervisor] Error handling run_failed for task ${taskId}:`, err);
    } finally {
      this.deps.virtualClients.delete(taskId);
    }
  }

  handleLiteTaskMessage(
    taskId: string,
    projectId: string,
    msg: ServerMessage,
  ): void {
    if (msg.type === 'run_completed') {
      this.deps.taskRepo.updateStatus(taskId, 'completed', {
        result: { summary: 'Task completed', filesChanged: [] },
      });
      this.deps.broadcastTaskUpdate(taskId, projectId);
      this.deps.log(projectId, 'task_status_changed', {
        taskId,
        from: 'running',
        to: 'completed',
      }, taskId);
      this.deps.virtualClients.delete(taskId);
      return;
    }

    if (msg.type !== 'run_failed') return;

    try {
      const task = this.deps.taskRepo.findById(taskId);
      if (!task) {
        this.deps.virtualClients.delete(taskId);
        return;
      }

      const errorMsg = 'error' in msg ? (msg as RunFailedMessage).error : 'Run failed';
      const newAttempt = task.attempt + 1;

      if (newAttempt > task.maxRetries + 1) {
        this.deps.taskRepo.updateStatus(taskId, 'failed', {
          result: { summary: `Failed after ${task.maxRetries} retries: ${errorMsg}`, filesChanged: [] },
          attempt: newAttempt,
        });
        this.deps.log(projectId, 'task_status_changed', {
          taskId,
          from: 'running',
          to: 'failed',
          error: errorMsg,
        }, taskId);
      } else {
        this.deps.taskRepo.updateStatus(taskId, 'pending', { attempt: newAttempt });
        this.deps.log(projectId, 'task_status_changed', {
          taskId,
          from: 'running',
          to: 'pending',
          reason: 'retry',
          attempt: newAttempt,
        }, taskId);
      }

      this.deps.broadcastTaskUpdate(taskId, projectId);
    } catch (err) {
      console.error(`[Supervisor] Error handling lite run_failed for task ${taskId}:`, err);
    } finally {
      this.deps.virtualClients.delete(taskId);
    }
  }

  clearTaskSessionReadOnly(taskId: string): void {
    try {
      const task = this.deps.taskRepo.findById(taskId);
      if (task?.sessionId) {
        this.deps.sessionRepo.update(task.sessionId, {
          isReadOnly: false,
          planStatus: null,
        } as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>);
      }
    } catch (err) {
      console.error(`[Supervisor] Failed to clear read-only for task ${taskId}:`, err);
    }
  }

  async approveTaskResult(taskId: string): Promise<import('@my-claudia/shared').SupervisionTask> {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'reviewing') {
      throw new Error(
        `Cannot approve result for task in status '${task.status}'; must be 'reviewing'`,
      );
    }

    const project = this.deps.projectRepo.findById(task.projectId);
    const session = task.sessionId ? this.deps.sessionRepo.findById(task.sessionId) : undefined;
    const isWorktreeTask =
      session?.workingDirectory && project?.rootPath &&
      session.workingDirectory !== project.rootPath;

    if (isWorktreeTask) {
      const pool = this.deps.worktreeManager.getWorktreePool(task.projectId);
      this.deps.log(task.projectId, 'merge_started', { taskId }, taskId);

      const result = await pool.mergeBack(task.id, task.attempt, session!.workingDirectory!);

      if (result.success) {
        pool.release(session!.workingDirectory!);
        this.deps.taskRepo.updateStatus(taskId, 'integrated');
        this.deps.broadcastTaskUpdate(taskId, task.projectId);
        this.deps.log(task.projectId, 'merge_completed', { taskId }, taskId);
        this.deps.log(task.projectId, 'worktree_released', {
          taskId,
          worktreePath: session!.workingDirectory,
        }, taskId);
      } else {
        this.deps.taskRepo.updateStatus(taskId, 'merge_conflict', {
          result: {
            ...(task.result ?? { summary: '', filesChanged: [] }),
            reviewNotes: `Merge conflicts: ${result.conflicts?.join(', ')}`,
          },
        });
        this.deps.broadcastTaskUpdate(taskId, task.projectId);
        this.deps.log(task.projectId, 'merge_conflict', {
          taskId,
          conflicts: result.conflicts,
        }, taskId);
      }
    } else {
      this.deps.taskRepo.updateStatus(taskId, 'integrated');
      this.deps.broadcastTaskUpdate(taskId, task.projectId);
      this.deps.log(task.projectId, 'task_status_changed', {
        taskId,
        from: 'reviewing',
        to: 'integrated',
      }, taskId);
    }

    this.deps.tick();
    return this.deps.taskRepo.findById(taskId)!;
  }

  rejectTaskResult(taskId: string, reviewNotes: string): import('@my-claudia/shared').SupervisionTask {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'reviewing') {
      throw new Error(
        `Cannot reject result for task in status '${task.status}'; must be 'reviewing'`,
      );
    }

    this.deps.worktreeManager.releaseTaskWorktree(task);

    const newAttempt = task.attempt + 1;
    if (newAttempt > task.maxRetries + 1) {
      this.deps.taskRepo.updateStatus(taskId, 'failed', {
        result: { ...(task.result ?? { summary: '', filesChanged: [] }), reviewNotes },
        attempt: newAttempt,
      });
      this.deps.broadcastTaskUpdate(taskId, task.projectId);
      this.deps.log(task.projectId, 'task_status_changed', {
        taskId,
        from: 'reviewing',
        to: 'failed',
        reason: 'max_retries_exceeded',
      }, taskId);
    } else {
      this.deps.taskRepo.updateStatus(taskId, 'queued', {
        result: { ...(task.result ?? { summary: '', filesChanged: [] }), reviewNotes },
        attempt: newAttempt,
      });
      this.deps.broadcastTaskUpdate(taskId, task.projectId);
      this.deps.log(task.projectId, 'task_status_changed', {
        taskId,
        from: 'reviewing',
        to: 'queued',
        attempt: newAttempt,
        reviewNotes,
      }, taskId);
    }

    return this.deps.taskRepo.findById(taskId)!;
  }

  async resolveConflict(taskId: string): Promise<import('@my-claudia/shared').SupervisionTask> {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task || task.status !== 'merge_conflict') {
      throw new Error('Task not in merge_conflict state');
    }

    const session = task.sessionId ? this.deps.sessionRepo.findById(task.sessionId) : undefined;
    if (!session?.workingDirectory) {
      throw new Error('No worktree found for this task');
    }

    const pool = this.deps.worktreeManager.getWorktreePool(task.projectId);
    this.deps.log(task.projectId, 'merge_started', { taskId, retry: true }, taskId);

    const result = await pool.mergeBack(task.id, task.attempt, session.workingDirectory);
    if (!result.success) {
      throw new Error(`Still has conflicts: ${result.conflicts?.join(', ')}`);
    }

    this.deps.taskRepo.updateStatus(taskId, 'integrated');
    pool.release(session.workingDirectory);
    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.log(task.projectId, 'merge_completed', { taskId }, taskId);
    this.deps.log(task.projectId, 'worktree_released', {
      taskId,
      worktreePath: session.workingDirectory,
    }, taskId);

    this.deps.tick();
    return this.deps.taskRepo.findById(taskId)!;
  }
}
