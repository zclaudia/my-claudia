import { execSync } from 'child_process';
import type { Database } from 'better-sqlite3';
import type { Project } from '@my-claudia/shared/core/project';
import type { Session } from '@my-claudia/shared/core/session';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type {
  ProjectAgent,
  SupervisionTask,
  TaskStatus,
  SupervisionLogEvent,
} from '@my-claudia/shared/features/supervision';
import type { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import type { ProjectRepository } from '../projects/repository.js';
import type { SessionRepository } from '../sessions/repository.js';
import type { CheckpointEngine } from './checkpoint-engine.js';
import { computeNextCronRun } from '../../utils/cron.js';

export interface TaskSchedulerDeps {
  db: Database;
  taskRepo: SupervisionTaskRepository;
  projectRepo: ProjectRepository;
  sessionRepo: SessionRepository;
  broadcastTaskUpdate: (taskId: string, projectId: string) => void;
  broadcastAgentUpdate: (projectId: string, agent: ProjectAgent) => void;
  broadcastSessionCreated: (session: Session) => void;
  broadcastSessionUpdated: (session: Session) => void;
  log: (projectId: string, event: SupervisionLogEvent, detail?: Record<string, unknown>, taskId?: string) => void;
  checkBudgetLimits: (projectId: string) => boolean;
  startTask: (task: SupervisionTask) => Promise<void>;
  startLiteTask: (task: SupervisionTask) => Promise<void>;
  checkpointEngine?: CheckpointEngine;
}

export class TaskScheduler {
  private deps: TaskSchedulerDeps;

  constructor(deps: TaskSchedulerDeps) {
    this.deps = deps;
  }

  setCheckpointEngine(engine: CheckpointEngine | undefined): void {
    this.deps.checkpointEngine = engine;
  }

  tick(): void {
    try {
      const projects = this.deps.projectRepo.findAll();
      for (const project of projects) {
        if (!project.agent) continue;
        if (project.agent.phase !== 'active' && project.agent.phase !== 'idle') continue;

        try {
          this.tickProject(project.id);
        } catch (err) {
          console.error(`[Supervisor] Error ticking project ${project.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[Supervisor] Error in tick:', err);
    }
  }

  tickProject(projectId: string): void {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project?.agent) return;

    const isLite = (project.agent.mode ?? 'full') === 'lite';

    // 1. Check budget limits
    if (!this.deps.checkBudgetLimits(projectId)) {
      return;
    }

    // 1b. Check main session overflow (full mode only)
    if (!isLite) {
      this.checkMainSessionOverflow(projectId);
    }

    // 1c. Check scheduled tasks (lite mode)
    if (isLite) {
      this.checkScheduledTasks(projectId);
    }

    // 2. Determine concurrency limits
    let maxConcurrent: number;
    if (isLite) {
      maxConcurrent = 1; // Lite mode always serial
    } else {
      const isGit = project.rootPath ? this.isGitProject(project.rootPath) : false;
      maxConcurrent = isGit ? project.agent.config.maxConcurrentTasks : 1;
    }

    // 3. Promote pending tasks → queued if dependencies met
    const pendingTasks = this.deps.taskRepo.findByStatus(projectId, 'pending');
    for (const task of pendingTasks) {
      if (this.areDependenciesMet(task, isLite)) {
        this.deps.taskRepo.updateStatus(task.id, 'queued');
        this.deps.broadcastTaskUpdate(task.id, projectId);
        this.deps.log(projectId, 'task_status_changed', {
          taskId: task.id,
          from: 'pending',
          to: 'queued',
        }, task.id);
      }
    }

    // 4. Check cascading failures — mark blocked tasks
    const queuedTasks = this.deps.taskRepo.findByStatus(projectId, 'queued');
    for (const task of queuedTasks) {
      if (task.dependencies.length > 0 && !this.areDependenciesMet(task, isLite)) {
        // areDependenciesMet already marks blocked tasks; nothing extra needed here
      }
    }

    // 5. Schedule tasks based on concurrency mode
    const runningTasks = this.deps.taskRepo.findByStatus(projectId, 'running');
    const reviewingTasks = this.deps.taskRepo.findByStatus(projectId, 'reviewing');

    let available: number;
    if (maxConcurrent <= 1) {
      // Serial mode: block if ANY task is running OR reviewing
      available = (runningTasks.length === 0 && reviewingTasks.length === 0) ? 1 : 0;
    } else {
      // Parallel mode: only count running tasks against the limit
      available = maxConcurrent - runningTasks.length;
    }

    if (available > 0) {
      const readyTasks = this.deps.taskRepo.findByStatus(projectId, 'queued');
      const toStart = readyTasks.slice(0, available);
      for (const task of toStart) {
        if (isLite) {
          this.deps.startLiteTask(task).catch((err) => {
            console.error(`[Supervisor] Failed to start lite task ${task.id}:`, err);
            this.handleTaskStartFailure(task, 'start_lite_failed');
          });
        } else {
          this.deps.startTask(task).catch((err) => {
            console.error(`[Supervisor] Failed to start task ${task.id}:`, err);
            this.handleTaskStartFailure(task, 'start_task_failed');
          });
        }
      }
    }

    // 6. If no active tasks, transition to idle
    const activeStatuses: TaskStatus[] = isLite
      ? ['pending', 'queued', 'running']
      : ['pending', 'queued', 'running', 'reviewing'];
    const activeTasks = this.deps.taskRepo.findByStatus(projectId, ...activeStatuses);
    if (activeTasks.length === 0 && project.agent.phase === 'active') {
      const agent = { ...project.agent, phase: 'idle' as const, updatedAt: Date.now() };
      this.deps.projectRepo.update(projectId, { agent });
      this.deps.broadcastAgentUpdate(projectId, agent);
      this.deps.log(projectId, 'phase_changed', { from: 'active', to: 'idle' });

      // Trigger checkpoint on idle if configured (full mode only)
      if (!isLite && this.deps.checkpointEngine?.shouldTrigger(projectId, 'idle')) {
        this.deps.checkpointEngine.runCheckpoint(projectId).catch((err) => {
          console.error(`[Supervisor] Idle checkpoint failed for ${projectId}:`, err);
        });
      }
    }
  }

  areDependenciesMet(task: SupervisionTask, isLite = false): boolean {
    if (!task.dependencies || task.dependencies.length === 0) {
      return true;
    }

    const depTasks = task.dependencies.map((depId) => this.deps.taskRepo.findById(depId));
    const terminalStatuses: TaskStatus[] = ['integrated', 'completed', 'failed', 'cancelled'];

    // In lite mode, 'completed' is the success status; in full mode, 'integrated'
    const isSuccess = (status: TaskStatus) =>
      isLite ? (status === 'completed' || status === 'integrated')
             : status === 'integrated';

    if (task.dependencyMode === 'any') {
      const anySuccess = depTasks.some((d) => d && isSuccess(d.status));
      if (anySuccess) return true;

      const allTerminal = depTasks.every(
        (d) => d && terminalStatuses.includes(d.status),
      );
      if (allTerminal) {
        this.deps.taskRepo.updateStatus(task.id, 'blocked');
        this.deps.broadcastTaskUpdate(task.id, task.projectId);
        this.deps.log(task.projectId, 'task_status_changed', {
          taskId: task.id,
          from: task.status,
          to: 'blocked',
          reason: 'all_dependencies_terminal_none_succeeded',
        }, task.id);
        return false;
      }

      return false;
    }

    // 'all' mode: every dependency must succeed
    const allSuccess = depTasks.every((d) => d && isSuccess(d.status));
    if (allSuccess) return true;

    const anyFailed = depTasks.some(
      (d) => d && (d.status === 'failed' || d.status === 'cancelled'),
    );
    if (anyFailed) {
      this.deps.taskRepo.updateStatus(task.id, 'blocked');
      this.deps.broadcastTaskUpdate(task.id, task.projectId);
      this.deps.log(task.projectId, 'task_status_changed', {
        taskId: task.id,
        from: task.status,
        to: 'blocked',
        reason: 'dependency_failed_or_cancelled',
      }, task.id);
      return false;
    }

    return false;
  }

  private handleTaskStartFailure(
    task: SupervisionTask,
    reason: 'start_lite_failed' | 'start_task_failed',
  ): void {
    const currentTask = this.deps.taskRepo.findById(task.id);
    if (!currentTask || currentTask.status !== 'queued') {
      return;
    }

    this.deps.taskRepo.updateStatus(task.id, 'failed', {
      result: {
        summary: `Task failed to start: ${reason}`,
        filesChanged: [],
      },
    });
    this.deps.broadcastTaskUpdate(task.id, task.projectId);
    this.deps.log(task.projectId, 'task_status_changed', {
      taskId: task.id,
      from: 'queued',
      to: 'failed',
      reason,
    }, task.id);
  }

  checkScheduledTasks(projectId: string): void {
    const now = Date.now();
    const rows = this.deps.db.prepare(`
      SELECT * FROM supervision_tasks
      WHERE project_id = ? AND schedule_enabled = 1 AND schedule_next_run <= ?
        AND status IN ('completed', 'failed', 'cancelled')
      ORDER BY schedule_next_run ASC
    `).all(projectId, now) as Record<string, unknown>[];

    for (const row of rows) {
      const task = this.deps.taskRepo.mapRow(row);

      // Reset task for re-execution
      this.deps.taskRepo.updateStatus(task.id, 'pending', { attempt: 1 });

      // Compute next run time
      if (task.scheduleCron) {
        const nextRun = computeNextCronRun(task.scheduleCron, now);
        this.deps.db.prepare('UPDATE supervision_tasks SET schedule_next_run = ? WHERE id = ?')
          .run(nextRun, task.id);
      }

      this.deps.broadcastTaskUpdate(task.id, projectId);
      this.deps.log(projectId, 'task_status_changed', {
        taskId: task.id, from: task.status, to: 'pending', trigger: 'schedule',
      }, task.id);

      // Transition agent to active if idle
      const project = this.deps.projectRepo.findById(projectId);
      if (project?.agent?.phase === 'idle') {
        const agent = { ...project.agent, phase: 'active' as const, updatedAt: Date.now() };
        this.deps.projectRepo.update(projectId, { agent });
        this.deps.broadcastAgentUpdate(projectId, agent);
        this.deps.log(projectId, 'phase_changed', { from: 'idle', to: 'active', reason: 'scheduled_task' });
      }
    }
  }

  checkMainSessionOverflow(projectId: string): void {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project?.agent?.mainSessionId) return;

    const row = this.deps.db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE session_id = ?
    `).get(project.agent.mainSessionId) as { count: number };

    if (row.count > 200) {
      this.rotateMainSession(projectId);
    }
  }

  isGitProject(rootPath: string): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: rootPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  private rotateMainSession(projectId: string): void {
    const project = this.deps.projectRepo.findById(projectId);
    if (!project?.agent?.mainSessionId) return;

    // Archive old session
    this.deps.sessionRepo.update(project.agent.mainSessionId, {
      archivedAt: Date.now(),
    });
    const archivedOld = this.deps.sessionRepo.findById(project.agent.mainSessionId);
    if (archivedOld) this.deps.broadcastSessionUpdated(archivedOld);

    // Create new main session
    const newSession = this.deps.sessionRepo.create({
      projectId,
      name: 'Main Session (rotated)',
      type: 'background',
      projectRole: 'main',
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);
    this.deps.broadcastSessionCreated(newSession);

    // Update agent
    const agent: ProjectAgent = {
      ...project.agent,
      mainSessionId: newSession.id,
      updatedAt: Date.now(),
    };
    this.deps.projectRepo.update(projectId, { agent });
    this.deps.broadcastAgentUpdate(projectId, agent);
    this.deps.log(projectId, 'main_session_rotated', {
      oldSessionId: project.agent.mainSessionId,
      newSessionId: newSession.id,
    });
  }
}
