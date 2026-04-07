import { execSync } from 'child_process';
import type { Database } from 'better-sqlite3';
import type { Project } from '@my-claudia/shared/core/project';
import type { Session } from '@my-claudia/shared/core/session';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { SupervisionLogEvent, SupervisionTask } from '@my-claudia/shared/features/supervision';
import type { SupervisionTaskRepository } from '../../infrastructure/repositories/supervision-task.js';
import type { SupervisionProjectPort, SupervisionSessionPort, SupervisionSessionModelPort } from './ports.js';
import type { ContextManager } from './context-manager.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { TaskScheduler } from './task-scheduler.js';
import type { SupervisionAiRunPort } from './ports.js';
import { assertTaskTransition } from './status-machine.js';

interface TaskExecutionDeps {
  db: Database;
  taskRepo: SupervisionTaskRepository;
  projectRepo: SupervisionProjectPort;
  sessionRepo: SupervisionSessionPort;
  sessionModel: SupervisionSessionModelPort;
  taskScheduler: TaskScheduler;
  worktreeManager: WorktreeManager;
  virtualClients: Map<string, unknown>;
  aiRunPort: SupervisionAiRunPort;
  broadcast: (msg: ServerMessage) => void;
  handleTaskRunMessage: (taskId: string, projectId: string, msg: ServerMessage) => void;
  handleLiteTaskMessage: (taskId: string, projectId: string, msg: ServerMessage) => void;
  getContextManager: (projectId: string, rootPath: string) => ContextManager;
  buildTaskPrompt: (
    task: SupervisionTask,
    projectName: string,
    contextInjection: string,
  ) => string;
  log: (
    projectId: string,
    event: SupervisionLogEvent,
    detail?: Record<string, unknown>,
    taskId?: string,
  ) => void;
  broadcastTaskUpdate: (taskId: string, projectId: string) => void;
}

export class TaskExecution {
  constructor(private deps: TaskExecutionDeps) {}

  async startTask(task: SupervisionTask): Promise<void> {
    const project = this.deps.projectRepo.findById(task.projectId);
    if (!project?.rootPath) {
      const error = new Error(`Cannot start task ${task.id}: project has no rootPath`);
      this.markTaskStartFailed(task, task.status, 'queued', error);
      throw error;
    }

    const isGit = this.deps.taskScheduler.isGitProject(project.rootPath);
    const maxConcurrent = project.agent?.config?.maxConcurrentTasks ?? 1;
    let workingDirectory = project.rootPath;
    let acquiredFromPool = false;
    let taskMarkedRunning = false;
    let virtualClientRegistered = false;

    if (isGit && maxConcurrent > 1) {
      try {
        await this.deps.worktreeManager.ensurePoolInitialized(task.projectId);
        const pool = this.deps.worktreeManager.getWorktreePool(task.projectId);
        workingDirectory = await pool.acquire(task.id, task.attempt);
        acquiredFromPool = true;
        this.deps.log(task.projectId, 'worktree_acquired', {
          taskId: task.id,
          worktreePath: workingDirectory,
        }, task.id);
      } catch (err) {
        console.error(`[Supervisor] Failed to acquire worktree for task ${task.id}:`, err);
        this.markTaskStartFailed(task, task.status, 'queued', err);
        throw err;
      }
    }

    try {
      const session = this.prepareTaskSession(task, workingDirectory);
      const extra: { sessionId: string; baseCommit?: string } = { sessionId: session.id };

      if (isGit) {
        try {
          const commit = execSync('git rev-parse HEAD', {
            cwd: workingDirectory,
            encoding: 'utf-8',
          }).trim();
          extra.baseCommit = commit;
        } catch {
          // Base commit is best-effort metadata.
        }
      }

      assertTaskTransition(task.status, 'running');
      this.deps.taskRepo.updateStatus(task.id, 'running', extra);
      taskMarkedRunning = true;
      this.deps.broadcastTaskUpdate(task.id, task.projectId);
      this.deps.log(task.projectId, 'task_status_changed', {
        taskId: task.id,
        from: task.status,
        to: 'running',
        sessionId: session.id,
        workingDirectory,
      }, task.id);

      const contextManager = this.deps.getContextManager(task.projectId, project.rootPath);
      const contextInjection = contextManager.getContextForTask(task.relevantDocIds);
      const systemPrompt = this.deps.buildTaskPrompt(task, project.name, contextInjection);
      const clientId = `supervisor_task_${task.id}`;
      this.deps.virtualClients.set(task.id, { clientId, sessionId: session.id });
      virtualClientRegistered = true;

      this.deps.aiRunPort.startVirtualRun({
        clientId,
        sessionId: session.id,
        input: systemPrompt,
        workingDirectory,
        onMessage: (msg) => {
          this.deps.handleTaskRunMessage(task.id, task.projectId, msg);
          this.deps.broadcast(msg);
        },
      });
    } catch (err) {
      console.error(`[Supervisor] Failed to initialize task ${task.id}:`, err);
      if (virtualClientRegistered) {
        this.deps.virtualClients.delete(task.id);
      }
      this.markTaskStartFailed(task, task.status, taskMarkedRunning ? 'running' : 'queued', err);
      if (acquiredFromPool && taskMarkedRunning) {
        const currentTask = this.deps.taskRepo.findById(task.id);
        if (currentTask) {
          this.deps.worktreeManager.releaseTaskWorktree(currentTask);
        }
      }
      if (acquiredFromPool && !taskMarkedRunning) {
        const pool = this.deps.worktreeManager.getPoolsMap().get(task.projectId);
        pool?.release(workingDirectory);
        this.deps.log(task.projectId, 'worktree_released', {
          taskId: task.id,
          worktreePath: workingDirectory,
          reason: 'start_task_failed_before_running',
        }, task.id);
      }
    }
  }

  async startLiteTask(task: SupervisionTask): Promise<void> {
    const project = this.deps.projectRepo.findById(task.projectId);
    if (!project?.rootPath) {
      const error = new Error(`Cannot start lite task ${task.id}: project has no rootPath`);
      this.markTaskStartFailed(task, task.status, 'queued', error);
      throw error;
    }

    let virtualClientRegistered = false;

    try {
      const session = this.resolveLiteTaskSession(task, project);

      assertTaskTransition(task.status, 'running');
      this.deps.taskRepo.updateStatus(task.id, 'running', { sessionId: session.id });
      this.deps.broadcastTaskUpdate(task.id, task.projectId);
      this.deps.log(task.projectId, 'task_status_changed', {
        taskId: task.id,
        from: task.status,
        to: 'running',
        sessionId: session.id,
      }, task.id);

      const clientId = `lite_task_${task.id}`;
      this.deps.virtualClients.set(task.id, { clientId, sessionId: session.id });
      virtualClientRegistered = true;

      this.deps.aiRunPort.startVirtualRun({
        clientId,
        sessionId: session.id,
        input: task.description,
        workingDirectory: project.rootPath,
        onMessage: (msg) => {
          this.deps.handleLiteTaskMessage(task.id, task.projectId, msg);
          this.deps.broadcast(msg);
        },
      });
    } catch (err) {
      console.error(`[Supervisor] Failed to initialize lite task ${task.id}:`, err);
      if (virtualClientRegistered) {
        this.deps.virtualClients.delete(task.id);
      }
      this.markTaskStartFailed(task, task.status, 'running', err);
      throw err;
    }
  }

  private prepareTaskSession(task: SupervisionTask, workingDirectory: string): Session {
    if (task.sessionId) {
      const existing = this.deps.sessionRepo.findById(task.sessionId);
      if (existing) {
        const patch = this.deps.sessionModel.buildTaskExecutingSessionPatch(workingDirectory);
        this.deps.sessionRepo.update(
          existing.id,
          patch as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>,
        );
        return {
          ...existing,
          ...patch,
        };
      }
    }

    return this.deps.sessionRepo.create({
      ...this.deps.sessionModel.buildTaskPlanningSession({
        projectId: task.projectId,
        title: task.title,
        taskId: task.id,
        workingDirectory,
      }),
      ...this.deps.sessionModel.buildTaskExecutingSessionPatch(workingDirectory),
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);
  }

  private resolveLiteTaskSession(task: SupervisionTask, project: Project): Session {
    if (task.sessionId) {
      const existing = this.deps.sessionRepo.findById(task.sessionId);
      if (existing) {
        return existing;
      }
    }

    return this.deps.sessionRepo.create(
      this.deps.sessionModel.buildTaskPlanningSession({
        projectId: task.projectId,
        title: task.title,
        taskId: task.id,
        parentSessionId: project.agent?.mainSessionId,
        providerId: project.providerId,
        workingDirectory: project.rootPath,
      }),
    );
  }

  private markTaskStartFailed(
    task: SupervisionTask,
    fromStatus: string,
    fallbackCurrentStatus: 'queued' | 'running',
    err: unknown,
  ): void {
    const currentTask = this.deps.taskRepo.findById(task.id);
    const effectiveFrom = (currentTask?.status ?? fallbackCurrentStatus) as SupervisionTask['status'];

    assertTaskTransition(effectiveFrom, 'failed');
    this.deps.taskRepo.updateStatus(task.id, 'failed', {
      result: {
        summary: `Task failed to start: ${err instanceof Error ? err.message : String(err)}`,
        filesChanged: [],
      },
    });
    this.deps.broadcastTaskUpdate(task.id, task.projectId);
    this.deps.log(task.projectId, 'task_status_changed', {
      taskId: task.id,
      from: effectiveFrom || fromStatus,
      to: 'failed',
      reason: 'start_failed',
      error: err instanceof Error ? err.message : String(err),
    }, task.id);
  }
}
