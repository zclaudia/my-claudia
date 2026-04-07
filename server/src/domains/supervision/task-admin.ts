import type { Session } from '@my-claudia/shared/core/session';
import type {
  ProjectAgent,
  SupervisionLogEvent,
  SupervisionTask,
  TaskStatus,
} from '@my-claudia/shared/features/supervision';
import type { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import type { ProjectRepository } from '../projects/repository.js';
import type { SessionRepository } from '../sessions/repository.js';
import { computeNextCronRun } from '../../utils/cron.js';

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
  projectRepo: ProjectRepository;
  sessionRepo: SessionRepository;
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

    let status: TaskStatus;
    if (source === 'user') {
      status = 'pending';
    } else if (source === 'agent_discovered' && trustLevel === 'high') {
      status = 'pending';
    } else {
      status = 'proposed';
    }

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

    if (project.agent.phase === 'idle' && status === 'pending') {
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
    const taskSession = this.deps.sessionRepo.create({
      projectId: task.projectId,
      name: `Task: ${task.title}`,
      type: 'regular',
      projectRole: 'task',
      taskId: task.id,
      parentSessionId: project?.agent?.mainSessionId,
      providerId: project?.providerId,
      workingDirectory: project?.rootPath,
      planStatus: 'planning',
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

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
    if (task.status !== 'proposed') {
      throw new Error(`Cannot approve task in status '${task.status}'; must be 'proposed'`);
    }

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
    if (task.status !== 'proposed') {
      throw new Error(`Cannot reject task in status '${task.status}'; must be 'proposed'`);
    }

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
