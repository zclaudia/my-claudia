import type {
  ProjectAgent,
  RunFailedMessage,
  ServerMessage,
  Session,
  SupervisionLogEvent,
} from '@my-claudia/shared';
import { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import { ProjectRepository } from '../projects/repository.js';
import { SessionRepository } from '../sessions/repository.js';
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
  broadcastAgentUpdate: (projectId: string, agent: ProjectAgent) => void;
  getTaskPlanStatus: (taskId: string) => {
    ready: boolean;
    missing: string[];
    path?: string;
  };
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

  submitTaskPlan(taskId: string): { task: import('@my-claudia/shared').SupervisionTask; sessionId: string } {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'planning') {
      throw new Error(`Task ${taskId} is not in planning status`);
    }
    if (!task.sessionId) {
      throw new Error(`Task ${taskId} has no planning session`);
    }

    const session = this.deps.sessionRepo.findById(task.sessionId);
    if (!session) {
      throw new Error(`Planning session not found for task ${taskId}`);
    }

    const planStatus = this.deps.getTaskPlanStatus(taskId);
    if (!planStatus.ready) {
      throw new Error(`Plan is incomplete: missing ${planStatus.missing.join(', ')}`);
    }

    this.deps.sessionRepo.update(session.id, {
      planStatus: 'planned',
      isReadOnly: true,
    } as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>);

    this.deps.taskRepo.updateStatus(task.id, 'queued');
    this.deps.broadcastTaskUpdate(task.id, task.projectId);
    this.deps.log(task.projectId, 'task_plan_submitted', {
      taskId: task.id,
      sessionId: session.id,
      planPath: planStatus.path,
    }, task.id);

    this.deps.tick();
    return { task: this.deps.taskRepo.findById(task.id)!, sessionId: session.id };
  }

  retryTask(taskId: string): import('@my-claudia/shared').SupervisionTask {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!['failed', 'cancelled', 'completed', 'blocked'].includes(task.status)) {
      throw new Error(`Cannot retry task in status '${task.status}'`);
    }

    this.deps.taskRepo.updateStatus(taskId, 'pending', { attempt: 1 });
    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.log(task.projectId, 'task_status_changed', {
      taskId,
      from: task.status,
      to: 'pending',
      reason: 'manual_retry',
    }, taskId);

    this.transitionAgentToActive(task.projectId, 'manual_retry');
    return this.deps.taskRepo.findById(taskId)!;
  }

  cancelTask(taskId: string): import('@my-claudia/shared').SupervisionTask {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (this.deps.virtualClients.has(taskId)) {
      this.deps.virtualClients.delete(taskId);
    }

    this.deps.taskRepo.updateStatus(taskId, 'cancelled');
    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.log(task.projectId, 'task_status_changed', {
      taskId,
      from: task.status,
      to: 'cancelled',
      reason: 'manual_cancel',
    }, taskId);

    return this.deps.taskRepo.findById(taskId)!;
  }

  runTaskNow(taskId: string): import('@my-claudia/shared').SupervisionTask {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
      throw new Error(`Cannot run-now task in status '${task.status}'; must be terminal`);
    }

    this.deps.taskRepo.updateStatus(taskId, 'pending', { attempt: 1 });
    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.log(task.projectId, 'task_status_changed', {
      taskId,
      from: task.status,
      to: 'pending',
      reason: 'run_now',
    }, taskId);

    this.transitionAgentToActive(task.projectId, 'run_now');
    return this.deps.taskRepo.findById(taskId)!;
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

  private transitionAgentToActive(projectId: string, reason: 'manual_retry' | 'run_now'): void {
    const project = this.deps.projectRepo.findById(projectId);
    if (project?.agent?.phase !== 'idle') {
      return;
    }

    const agent = { ...project.agent, phase: 'active' as const, updatedAt: Date.now() };
    this.deps.projectRepo.update(projectId, { agent });
    this.deps.broadcastAgentUpdate(projectId, agent);
    this.deps.log(projectId, 'phase_changed', {
      from: 'idle',
      to: 'active',
      reason,
    });
  }
}
