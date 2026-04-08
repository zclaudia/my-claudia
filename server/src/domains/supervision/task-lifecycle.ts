import type { Session } from '@my-claudia/shared/core/session';
import type { RunFailedMessage, ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { ProjectAgent, SupervisionLogEvent } from '@my-claudia/shared/features/supervision';
import { SupervisionTaskRepository } from '../../infrastructure/repositories/supervision-task.js';
import type { SupervisionProjectPort, SupervisionSessionPort, SupervisionSessionModelPort } from './ports.js';
import { TaskRunner } from './task-runner.js';
import { WorktreeManager } from './worktree-manager.js';
import type { CheckpointEngine } from './checkpoint-engine.js';
import { shouldTransitionAgentToActive } from './model.js';
import { TaskAggregate } from './task-aggregate.js';
import type { EventDispatcher } from './event-dispatcher.js';
import type { SupervisionTaskEvent } from './task-events.js';

interface TaskLifecycleDeps {
  taskRepo: SupervisionTaskRepository;
  projectRepo: SupervisionProjectPort;
  sessionRepo: SupervisionSessionPort;
  sessionModel: SupervisionSessionModelPort;
  taskRunner: TaskRunner;
  worktreeManager: WorktreeManager;
  virtualClients: Map<string, unknown>;
  dispatcher: EventDispatcher<SupervisionTaskEvent>;
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
        const task = this.deps.taskRepo.findById(taskId);
        if (task) {
          const agg = new TaskAggregate(task, this.deps.taskRepo);
          agg.transitionToReviewing();
          this.deps.broadcastTaskUpdate(taskId, projectId);
          this.deps.dispatcher.dispatchAll(agg.releaseEvents());
        }
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
      const task = this.deps.taskRepo.findById(taskId);
      if (!task) {
        this.deps.virtualClients.delete(taskId);
        return;
      }

      const errorMsg = 'error' in msg ? (msg as RunFailedMessage).error : 'Run failed';
      const agg = new TaskAggregate(task, this.deps.taskRepo);
      agg.markRunFailed(errorMsg);
      this.deps.broadcastTaskUpdate(taskId, projectId);
      this.deps.log(projectId, 'task_status_changed', {
        taskId,
        from: 'running',
        to: 'failed',
        error: errorMsg,
      }, taskId);
      this.deps.dispatcher.dispatchAll(agg.releaseEvents());

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
      const task = this.deps.taskRepo.findById(taskId);
      if (task) {
        const agg = new TaskAggregate(task, this.deps.taskRepo);
        agg.markLiteCompleted();
        this.deps.broadcastTaskUpdate(taskId, projectId);
        this.deps.log(projectId, 'task_status_changed', {
          taskId,
          from: 'running',
          to: 'completed',
        }, taskId);
        this.deps.dispatcher.dispatchAll(agg.releaseEvents());
      }
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
      const agg = new TaskAggregate(task, this.deps.taskRepo);
      agg.markLiteFailed(errorMsg);

      // Read back the updated snapshot for logging
      const updated = agg.snapshot;
      const events = agg.releaseEvents();
      const liteFailed = events.find((e) => e.type === 'lite_task_failed') as
        | Extract<SupervisionTaskEvent, { type: 'lite_task_failed' }>
        | undefined;

      if (liteFailed?.nextStatus === 'failed') {
        this.deps.log(projectId, 'task_status_changed', {
          taskId,
          from: 'running',
          to: 'failed',
          error: errorMsg,
        }, taskId);
      } else {
        this.deps.log(projectId, 'task_status_changed', {
          taskId,
          from: 'running',
          to: 'pending',
          reason: 'retry',
          attempt: liteFailed?.nextAttempt,
        }, taskId);
      }

      this.deps.broadcastTaskUpdate(taskId, projectId);
      this.deps.dispatcher.dispatchAll(events);
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
        this.deps.sessionRepo.update(
          task.sessionId,
          this.deps.sessionModel.buildTaskUnlockedSessionPatch() as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>,
        );
      }
    } catch (err) {
      console.error(`[Supervisor] Failed to clear read-only for task ${taskId}:`, err);
    }
  }

  submitTaskPlan(taskId: string): { task: import('@my-claudia/shared/features/supervision').SupervisionTask; sessionId: string } {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
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

    // Side effect: update session
    this.deps.sessionRepo.update(
      session.id,
      this.deps.sessionModel.buildTaskPlannedSessionPatch() as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>,
    );

    // Aggregate command
    const agg = new TaskAggregate(task, this.deps.taskRepo);
    agg.submitPlan(session.id, planStatus.path);

    // Side effects
    this.deps.broadcastTaskUpdate(task.id, task.projectId);
    this.deps.log(task.projectId, 'task_plan_submitted', {
      taskId: task.id,
      sessionId: session.id,
      planPath: planStatus.path,
    }, task.id);
    this.deps.dispatcher.dispatchAll(agg.releaseEvents());

    this.deps.tick();
    return { task: this.deps.taskRepo.findById(task.id)!, sessionId: session.id };
  }

  retryTask(taskId: string): import('@my-claudia/shared/features/supervision').SupervisionTask {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const agg = new TaskAggregate(task, this.deps.taskRepo);
    agg.retry();

    // Side effects
    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.log(task.projectId, 'task_status_changed', {
      taskId,
      from: task.status,
      to: 'pending',
      reason: 'manual_retry',
    }, taskId);
    this.deps.dispatcher.dispatchAll(agg.releaseEvents());

    this.transitionAgentToActive(task.projectId, 'manual_retry');
    return agg.snapshot;
  }

  cancelTask(taskId: string): import('@my-claudia/shared/features/supervision').SupervisionTask {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (this.deps.virtualClients.has(taskId)) {
      this.deps.virtualClients.delete(taskId);
    }

    const agg = new TaskAggregate(task, this.deps.taskRepo);
    agg.cancel();

    // Side effects
    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.log(task.projectId, 'task_status_changed', {
      taskId,
      from: task.status,
      to: 'cancelled',
      reason: 'manual_cancel',
    }, taskId);
    this.deps.dispatcher.dispatchAll(agg.releaseEvents());

    return agg.snapshot;
  }

  runTaskNow(taskId: string): import('@my-claudia/shared/features/supervision').SupervisionTask {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const agg = new TaskAggregate(task, this.deps.taskRepo);
    agg.runNow();

    // Side effects
    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.log(task.projectId, 'task_status_changed', {
      taskId,
      from: task.status,
      to: 'pending',
      reason: 'run_now',
    }, taskId);
    this.deps.dispatcher.dispatchAll(agg.releaseEvents());

    this.transitionAgentToActive(task.projectId, 'run_now');
    return agg.snapshot;
  }

  async approveTaskResult(taskId: string): Promise<import('@my-claudia/shared/features/supervision').SupervisionTask> {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
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
        const agg = new TaskAggregate(
          this.deps.taskRepo.findById(taskId)!,
          this.deps.taskRepo,
        );
        agg.markIntegrated();
        this.deps.broadcastTaskUpdate(taskId, task.projectId);
        this.deps.log(task.projectId, 'merge_completed', { taskId }, taskId);
        this.deps.log(task.projectId, 'worktree_released', {
          taskId,
          worktreePath: session!.workingDirectory,
        }, taskId);
        this.deps.dispatcher.dispatchAll(agg.releaseEvents());
      } else {
        const agg = new TaskAggregate(
          this.deps.taskRepo.findById(taskId)!,
          this.deps.taskRepo,
        );
        agg.markMergeConflict(result.conflicts ?? []);
        this.deps.broadcastTaskUpdate(taskId, task.projectId);
        this.deps.log(task.projectId, 'merge_conflict', {
          taskId,
          conflicts: result.conflicts,
        }, taskId);
        this.deps.dispatcher.dispatchAll(agg.releaseEvents());
      }
    } else {
      const agg = new TaskAggregate(task, this.deps.taskRepo);
      agg.markIntegrated();
      this.deps.broadcastTaskUpdate(taskId, task.projectId);
      this.deps.log(task.projectId, 'task_status_changed', {
        taskId,
        from: 'reviewing',
        to: 'integrated',
      }, taskId);
      this.deps.dispatcher.dispatchAll(agg.releaseEvents());
    }

    this.deps.tick();
    return this.deps.taskRepo.findById(taskId)!;
  }

  rejectTaskResult(taskId: string, reviewNotes: string): import('@my-claudia/shared/features/supervision').SupervisionTask {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Side effect: release worktree before aggregate command
    this.deps.worktreeManager.releaseTaskWorktree(task);

    const agg = new TaskAggregate(task, this.deps.taskRepo);
    agg.rejectResult(reviewNotes);

    const events = agg.releaseEvents();
    const rejected = events.find((e) => e.type === 'task_result_rejected') as
      | Extract<SupervisionTaskEvent, { type: 'task_result_rejected' }>
      | undefined;

    if (rejected?.nextStatus === 'failed') {
      this.deps.log(task.projectId, 'task_status_changed', {
        taskId,
        from: 'reviewing',
        to: 'failed',
        reason: 'max_retries_exceeded',
      }, taskId);
    } else {
      this.deps.log(task.projectId, 'task_status_changed', {
        taskId,
        from: 'reviewing',
        to: 'queued',
        attempt: rejected?.nextAttempt,
        reviewNotes,
      }, taskId);
    }

    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.dispatcher.dispatchAll(events);

    return agg.snapshot;
  }

  async resolveConflict(taskId: string): Promise<import('@my-claudia/shared/features/supervision').SupervisionTask> {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error('Task not found');
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

    const agg = new TaskAggregate(
      this.deps.taskRepo.findById(taskId)!,
      this.deps.taskRepo,
    );
    agg.markConflictResolved();
    pool.release(session.workingDirectory);
    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.log(task.projectId, 'merge_completed', { taskId }, taskId);
    this.deps.log(task.projectId, 'worktree_released', {
      taskId,
      worktreePath: session.workingDirectory,
    }, taskId);
    this.deps.dispatcher.dispatchAll(agg.releaseEvents());

    this.deps.tick();
    return this.deps.taskRepo.findById(taskId)!;
  }

  private transitionAgentToActive(projectId: string, reason: 'manual_retry' | 'run_now'): void {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project?.agent || !shouldTransitionAgentToActive(project.agent.phase)) {
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
