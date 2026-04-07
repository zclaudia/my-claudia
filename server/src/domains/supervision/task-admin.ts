import type { Session } from '@my-claudia/shared/core/session';
import type {
  ProjectAgent,
  SupervisionLogEvent,
  SupervisionTask,
  TaskStatus,
} from '@my-claudia/shared/features/supervision';
import type { SupervisionTaskRepository } from '../../infrastructure/repositories/supervision-task.js';
import type { SupervisionProjectPort, SupervisionSessionPort, SupervisionSessionModelPort } from './ports.js';
import { computeNextCronRun } from '../../utils/cron.js';
import { assertTaskStatus, assertTaskTransition } from './status-machine.js';
import {
  resolveCreatedTaskStatus,
  shouldActivateAgentForTaskStatus,
} from './model.js';

interface CreateTaskInput {
  title: string;
  description: string;
  source?: 'user' | 'agent_discovered';
  priority?: number;
  dependencies?: string[];
  dependencyMode?: 'all' | 'any';
  relevantDocIds?: string[];
  taskSpecificContext?: string;
  scope?: string[];
  acceptanceCriteria?: string[];
  maxRetries?: number;
  scheduleCron?: string;
  scheduleEnabled?: boolean;
  retryDelayMs?: number;
}

interface TaskAdminDeps {
  taskRepo: SupervisionTaskRepository;
  projectRepo: SupervisionProjectPort;
  sessionRepo: SupervisionSessionPort;
  sessionModel: SupervisionSessionModelPort;
  pauseAgent: (projectId: string, reason: 'budget') => void;
  broadcastTaskUpdate: (taskId: string, projectId: string) => void;
  broadcastAgentUpdate: (projectId: string, agent: ProjectAgent) => void;
  log: (
    projectId: string,
    event: SupervisionLogEvent,
    detail?: Record<string, unknown>,
    taskId?: string,
  ) => void;
}

export class TaskAdmin {
  constructor(private deps: TaskAdminDeps) {}

  createTask(projectId: string, data: CreateTaskInput): SupervisionTask {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project?.agent) {
      throw new Error(`No agent found for project: ${projectId}`);
    }

    const source = data.source ?? 'user';
    const trustLevel = project.agent.config.trustLevel;

    const status: TaskStatus = resolveCreatedTaskStatus(source, trustLevel);

    if (project.agent.config.maxTotalTasks !== undefined) {
      const currentCount = this.deps.taskRepo.countByProject(projectId);
      if (currentCount >= project.agent.config.maxTotalTasks) {
        this.deps.pauseAgent(projectId, 'budget');
        throw new Error(
          `Budget limit exceeded: maxTotalTasks=${project.agent.config.maxTotalTasks} reached. Agent paused.`,
        );
      }
    }

    let scheduleNextRun: number | undefined;
    if (data.scheduleCron && data.scheduleEnabled) {
      scheduleNextRun = computeNextCronRun(data.scheduleCron);
    }

    const task = this.deps.taskRepo.create({
      projectId,
      title: data.title,
      description: data.description,
      source,
      status,
      priority: data.priority,
      dependencies: data.dependencies,
      dependencyMode: data.dependencyMode,
      relevantDocIds: data.relevantDocIds,
      taskSpecificContext: data.taskSpecificContext,
      scope: data.scope,
      acceptanceCriteria: data.acceptanceCriteria,
      maxRetries: data.maxRetries,
      scheduleCron: data.scheduleCron,
      scheduleEnabled: data.scheduleEnabled,
      scheduleNextRun,
      retryDelayMs: data.retryDelayMs,
    });

    this.deps.broadcastTaskUpdate(task.id, projectId);
    this.deps.log(projectId, 'task_created', {
      taskId: task.id,
      title: task.title,
      status,
    }, task.id);

    if (shouldActivateAgentForTaskStatus(project.agent.phase, status)) {
      const agent = { ...project.agent, phase: 'active' as const, updatedAt: Date.now() };
      this.deps.projectRepo.update(projectId, { agent });
      this.deps.broadcastAgentUpdate(projectId, agent);
      this.deps.log(projectId, 'phase_changed', {
        from: 'idle',
        to: 'active',
        reason: 'new_task',
      });
    }

    return task;
  }

  openTaskSession(taskId: string): { sessionId: string } {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.sessionId) {
      const existing = this.deps.sessionRepo.findById(task.sessionId);
      if (existing) {
        return { sessionId: existing.id };
      }
    }

    const project = this.deps.projectRepo.findById(task.projectId);
    const taskSession = this.deps.sessionRepo.create(
      this.deps.sessionModel.buildTaskPlanningSession({
        projectId: task.projectId,
        title: task.title,
        taskId: task.id,
        parentSessionId: project?.agent?.mainSessionId,
        providerId: project?.providerId,
        workingDirectory: project?.rootPath,
      }),
    );

    assertTaskTransition(task.status, 'planning');
    this.deps.taskRepo.updateStatus(task.id, 'planning', { sessionId: taskSession.id });
    this.deps.log(task.projectId, 'task_session_opened', {
      taskId: task.id,
      sessionId: taskSession.id,
    }, task.id);

    return { sessionId: taskSession.id };
  }

  approveTask(taskId: string): SupervisionTask {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    assertTaskStatus(task.status, 'proposed', 'approve');

    assertTaskTransition('proposed', 'pending');
    this.deps.taskRepo.updateStatus(taskId, 'pending');
    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.log(task.projectId, 'task_status_changed', {
      taskId,
      from: 'proposed',
      to: 'pending',
    }, taskId);

    return this.deps.taskRepo.findById(taskId)!;
  }

  rejectTask(taskId: string): SupervisionTask {
    const task = this.deps.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    assertTaskStatus(task.status, 'proposed', 'reject');

    assertTaskTransition('proposed', 'cancelled');
    this.deps.taskRepo.updateStatus(taskId, 'cancelled');
    this.deps.broadcastTaskUpdate(taskId, task.projectId);
    this.deps.log(task.projectId, 'task_status_changed', {
      taskId,
      from: 'proposed',
      to: 'cancelled',
    }, taskId);

    return this.deps.taskRepo.findById(taskId)!;
  }

  updateTask(
    taskId: string,
    data: Partial<Pick<SupervisionTask,
      'title' | 'description' | 'priority' | 'dependencies' | 'dependencyMode' |
      'acceptanceCriteria' | 'relevantDocIds' | 'scope' | 'taskSpecificContext'
    >>,
  ): SupervisionTask | undefined {
    const task = this.deps.taskRepo.update(taskId, data);
    if (task) {
      this.deps.broadcastTaskUpdate(task.id, task.projectId);
    }
    return task;
  }
}
