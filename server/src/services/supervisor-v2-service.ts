import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from 'better-sqlite3';
import type {
  Project,
  Session,
  ProjectAgent,
  AgentMode,
  SupervisorConfig,
  SupervisionTask,
  TaskStatus,
  TaskResult,
  ServerMessage,
  SupervisionV2LogEvent,
} from '@my-claudia/shared';
import { SupervisionTaskRepository } from '../repositories/supervision-task.js';
import { ProjectRepository } from '../repositories/project.js';
import { SessionRepository } from '../repositories/session.js';
import { ContextManager, type ContextDocument } from './context-manager.js';
import { TaskRunner } from './task-runner.js';
import { ReviewEngine } from './review-engine.js';
import { WorktreePool } from './worktree-pool.js';
import type { CheckpointEngine } from './checkpoint-engine.js';
import { createVirtualClient, handleRunStart, activeRuns } from '../server.js';
import { computeNextCronRun } from '../utils/cron.js';
import { validatePlanFile, type PlanValidationResult } from './plan-validator.js';

export class SupervisorV2Service {
  private pollInterval: NodeJS.Timeout | null = null;
  private contextManagers = new Map<string, ContextManager>();
  private virtualClients = new Map<string, any>(); // taskId → virtualClient
  private worktreePools = new Map<string, WorktreePool>();
  private taskRunner: TaskRunner;
  private reviewEngine: ReviewEngine;
  private checkpointEngine?: CheckpointEngine;

  constructor(
    private db: Database,
    private taskRepo: SupervisionTaskRepository,
    private projectRepo: ProjectRepository,
    private sessionRepo: SessionRepository,
    private broadcastFn: (msg: ServerMessage) => void,
  ) {
    const getContextManagerFn = (projectId: string) => {
      const project = this.projectRepo.findById(projectId);
      if (!project?.rootPath) throw new Error(`Project ${projectId} has no rootPath`);
      return this.getContextManager(projectId, project.rootPath);
    };

    const broadcastTaskUpdateFn = (taskId: string, projectId: string) =>
      this.broadcastTaskUpdate(taskId, projectId);

    const logFn = (
      projectId: string,
      event: SupervisionV2LogEvent,
      detail?: Record<string, unknown>,
      taskId?: string,
    ) => this.log(projectId, event, detail, taskId);

    this.taskRunner = new TaskRunner(
      db,
      taskRepo,
      projectRepo,
      getContextManagerFn,
      broadcastTaskUpdateFn,
      logFn,
      (task) => this.reviewEngine.createReview(task),
    );

    this.reviewEngine = new ReviewEngine(
      db,
      taskRepo,
      projectRepo,
      sessionRepo,
      getContextManagerFn,
      broadcastTaskUpdateFn,
      logFn,
      (cwd, baseCommit) => this.taskRunner.collectGitEvidence(cwd, baseCommit),
      (projectId) => this.getWorktreePool(projectId),
    );
  }

  // ========================================
  // Lifecycle
  // ========================================

  start(intervalMs = 5000): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.tick(), intervalMs);
    console.log('[SupervisorV2] Started polling');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.checkpointEngine?.stop();
    // Best-effort cleanup of worktree pools
    for (const [, pool] of this.worktreePools) {
      pool.destroy().catch(() => {});
    }
    this.worktreePools.clear();
    console.log('[SupervisorV2] Stopped');
  }

  setCheckpointEngine(engine: CheckpointEngine): void {
    this.checkpointEngine = engine;
  }

  // ========================================
  // Agent management
  // ========================================

  initAgent(projectId: string, config?: Partial<SupervisorConfig>, providerId?: string, mode?: AgentMode): ProjectAgent {
    const project = this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    if (!project.rootPath) {
      throw new Error(`Project ${projectId} has no rootPath configured`);
    }

    const agentMode = mode ?? 'full';
    const sessionName = agentMode === 'lite' ? 'Workflow Runner' : 'Supervisor';

    // Create the supervisor main session (visible, user-navigable)
    const mainSession = this.sessionRepo.create({
      projectId,
      name: sessionName,
      type: 'regular',
      projectRole: 'main',
      providerId: providerId ?? project.providerId,
      workingDirectory: project.rootPath,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    const now = Date.now();
    const agent: ProjectAgent = {
      type: 'supervisor',
      mode: agentMode,
      phase: 'idle',  // Skip initializing/setup — go straight to idle
      config: {
        maxConcurrentTasks: agentMode === 'lite' ? 1 : (config?.maxConcurrentTasks ?? 1),
        trustLevel: config?.trustLevel ?? 'low',
        autoDiscoverTasks: false,
        ...config,
      },
      mainSessionId: mainSession.id,
      createdAt: now,
      updatedAt: now,
    };

    this.projectRepo.update(projectId, { agent });

    // Initialize ContextManager and scaffold if needed (full mode only)
    if (agentMode === 'full') {
      const cm = this.getContextManager(projectId, project.rootPath);
      if (!cm.isInitialized()) {
        cm.scaffold(project.name);
      }
    }

    this.broadcastAgentUpdate(projectId, agent);
    this.log(projectId, 'agent_initialized', {
      config: agent.config,
      mode: agentMode,
      mainSessionId: mainSession.id,
    });

    return agent;
  }

  updateAgentPhase(
    projectId: string,
    action: 'pause' | 'resume' | 'archive' | 'approve_setup',
  ): ProjectAgent {
    const project = this.projectRepo.findById(projectId);
    if (!project?.agent) {
      throw new Error(`No agent found for project: ${projectId}`);
    }

    const agent = { ...project.agent };
    const previousPhase = agent.phase;

    switch (action) {
      case 'pause': {
        if (agent.phase !== 'active' && agent.phase !== 'idle') {
          throw new Error(
            `Cannot pause agent in phase '${agent.phase}'; must be 'active' or 'idle'`,
          );
        }
        agent.phase = 'paused';
        agent.pausedReason = 'user';
        agent.pausedAt = Date.now();
        break;
      }
      case 'resume': {
        if (agent.phase !== 'paused') {
          throw new Error(`Cannot resume agent in phase '${agent.phase}'; must be 'paused'`);
        }
        agent.phase = 'active';
        agent.pausedReason = undefined;
        agent.pausedAt = undefined;
        break;
      }
      case 'archive': {
        agent.phase = 'archived';
        agent.pausedReason = undefined;
        agent.pausedAt = undefined;
        this.cleanupPool(projectId).catch((err) => {
          console.error(`[SupervisorV2] Failed to cleanup pool for ${projectId}:`, err);
        });
        break;
      }
      case 'approve_setup': {
        if (agent.phase !== 'setup' && agent.phase !== 'initializing') {
          throw new Error(
            `Cannot approve setup for agent in phase '${agent.phase}'; must be 'setup' or 'initializing'`,
          );
        }
        // Transition to active or idle depending on whether tasks exist
        const tasks = this.taskRepo.findByStatus(projectId, 'pending', 'queued', 'running');
        agent.phase = tasks.length > 0 ? 'active' : 'idle';
        break;
      }
    }

    agent.updatedAt = Date.now();
    this.projectRepo.update(projectId, { agent });
    this.broadcastAgentUpdate(projectId, agent);
    this.log(projectId, 'phase_changed', {
      from: previousPhase,
      to: agent.phase,
      action,
    });

    return agent;
  }

  getAgent(projectId: string): ProjectAgent | undefined {
    return this.projectRepo.findById(projectId)?.agent;
  }

  // ========================================
  // Task management
  // ========================================

  createTask(
    projectId: string,
    data: {
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
    },
  ): SupervisionTask {
    const project = this.projectRepo.findById(projectId);
    if (!project?.agent) {
      throw new Error(`No agent found for project: ${projectId}`);
    }

    const source = data.source ?? 'user';
    const trustLevel = project.agent.config.trustLevel;

    // Determine initial status based on source and trust level
    let status: TaskStatus;
    if (source === 'user') {
      status = 'pending';
    } else if (source === 'agent_discovered' && trustLevel === 'high') {
      status = 'pending';
    } else {
      // agent_discovered + low/medium trust → proposed (needs user approval)
      status = 'proposed';
    }

    // Check budget limits
    if (project.agent.config.maxTotalTasks !== undefined) {
      const currentCount = this.taskRepo.countByProject(projectId);
      if (currentCount >= project.agent.config.maxTotalTasks) {
        this.pauseAgent(projectId, 'budget');
        throw new Error(
          `Budget limit exceeded: maxTotalTasks=${project.agent.config.maxTotalTasks} reached. Agent paused.`,
        );
      }
    }

    // Compute initial scheduleNextRun if cron is provided
    let scheduleNextRun: number | undefined;
    if (data.scheduleCron && data.scheduleEnabled) {
      scheduleNextRun = computeNextCronRun(data.scheduleCron);
    }

    const task = this.taskRepo.create({
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

    // Session is NOT created here — it's created lazily when user opens the task
    // or when startTask() begins execution. This prevents session count explosion.

    this.broadcastTaskUpdate(task.id, projectId);
    this.log(projectId, 'task_created', {
      taskId: task.id, title: task.title, status,
    }, task.id);

    // If agent is idle, transition to active (newly created tasks are either 'pending' or 'proposed')
    if (project.agent.phase === 'idle' && status === 'pending') {
      const agent = { ...project.agent, phase: 'active' as const, updatedAt: Date.now() };
      this.projectRepo.update(projectId, { agent });
      this.broadcastAgentUpdate(projectId, agent);
      this.log(projectId, 'phase_changed', { from: 'idle', to: 'active', reason: 'new_task' });
    }

    return task;
  }

  /**
   * Open (or return existing) session for a task — lazy session creation.
   * Called when user clicks "Edit" on a task card.
   */
  openTaskSession(taskId: string): { sessionId: string } {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // If session already exists, return it
    if (task.sessionId) {
      const existing = this.sessionRepo.findById(task.sessionId);
      if (existing) {
        return { sessionId: existing.id };
      }
    }

    // Create session on demand
    const project = this.projectRepo.findById(task.projectId);
    const taskSession = this.sessionRepo.create({
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

    // Link session to task and set status to planning
    this.taskRepo.updateStatus(task.id, 'planning', { sessionId: taskSession.id });

    this.log(task.projectId, 'task_session_opened', {
      taskId: task.id, sessionId: taskSession.id,
    }, task.id);

    return { sessionId: taskSession.id };
  }

  approveTask(taskId: string): SupervisionTask {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'proposed') {
      throw new Error(`Cannot approve task in status '${task.status}'; must be 'proposed'`);
    }

    this.taskRepo.updateStatus(taskId, 'pending');
    this.broadcastTaskUpdate(taskId, task.projectId);
    this.log(task.projectId, 'task_status_changed', {
      taskId,
      from: 'proposed',
      to: 'pending',
    }, taskId);

    return this.taskRepo.findById(taskId)!;
  }

  rejectTask(taskId: string): SupervisionTask {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'proposed') {
      throw new Error(`Cannot reject task in status '${task.status}'; must be 'proposed'`);
    }

    this.taskRepo.updateStatus(taskId, 'cancelled');
    this.broadcastTaskUpdate(taskId, task.projectId);
    this.log(task.projectId, 'task_status_changed', {
      taskId,
      from: 'proposed',
      to: 'cancelled',
    }, taskId);

    return this.taskRepo.findById(taskId)!;
  }

  async approveTaskResult(taskId: string): Promise<SupervisionTask> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'reviewing') {
      throw new Error(
        `Cannot approve result for task in status '${task.status}'; must be 'reviewing'`,
      );
    }

    const project = this.projectRepo.findById(task.projectId);
    const session = task.sessionId ? this.sessionRepo.findById(task.sessionId) : undefined;
    const isWorktreeTask =
      session?.workingDirectory && project?.rootPath &&
      session.workingDirectory !== project.rootPath;

    if (isWorktreeTask) {
      // Parallel mode: attempt merge
      const pool = this.getWorktreePool(task.projectId);
      this.log(task.projectId, 'merge_started', { taskId }, taskId);

      const result = await pool.mergeBack(task.id, task.attempt, session!.workingDirectory!);

      if (result.success) {
        pool.release(session!.workingDirectory!);
        this.taskRepo.updateStatus(taskId, 'integrated');
        this.broadcastTaskUpdate(taskId, task.projectId);
        this.log(task.projectId, 'merge_completed', { taskId }, taskId);
        this.log(task.projectId, 'worktree_released', {
          taskId, worktreePath: session!.workingDirectory,
        }, taskId);
      } else {
        this.taskRepo.updateStatus(taskId, 'merge_conflict', {
          result: {
            ...(task.result ?? { summary: '', filesChanged: [] }),
            reviewNotes: `Merge conflicts: ${result.conflicts?.join(', ')}`,
          },
        });
        this.broadcastTaskUpdate(taskId, task.projectId);
        this.log(task.projectId, 'merge_conflict', {
          taskId, conflicts: result.conflicts,
        }, taskId);
        // Don't release worktree — keep for manual resolution
      }
    } else {
      // Serial mode: approved = integrated directly
      this.taskRepo.updateStatus(taskId, 'integrated');
      this.broadcastTaskUpdate(taskId, task.projectId);
      this.log(task.projectId, 'task_status_changed', {
        taskId,
        from: 'reviewing',
        to: 'integrated',
      }, taskId);
    }

    // Trigger tick to process next tasks
    this.tick();

    return this.taskRepo.findById(taskId)!;
  }

  rejectTaskResult(taskId: string, reviewNotes: string): SupervisionTask {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'reviewing') {
      throw new Error(
        `Cannot reject result for task in status '${task.status}'; must be 'reviewing'`,
      );
    }

    // Release worktree if applicable
    this.releaseTaskWorktree(task);

    const newAttempt = task.attempt + 1;
    const maxRetries = task.maxRetries;

    if (newAttempt > maxRetries + 1) {
      // Exceeded max retries — mark as failed
      this.taskRepo.updateStatus(taskId, 'failed', {
        result: { ...(task.result ?? { summary: '', filesChanged: [] }), reviewNotes },
        attempt: newAttempt,
      });
      this.broadcastTaskUpdate(taskId, task.projectId);
      this.log(task.projectId, 'task_status_changed', {
        taskId,
        from: 'reviewing',
        to: 'failed',
        reason: 'max_retries_exceeded',
      }, taskId);
    } else {
      // Re-queue with review notes injected
      this.taskRepo.updateStatus(taskId, 'queued', {
        result: { ...(task.result ?? { summary: '', filesChanged: [] }), reviewNotes },
        attempt: newAttempt,
      });
      this.broadcastTaskUpdate(taskId, task.projectId);
      this.log(task.projectId, 'task_status_changed', {
        taskId,
        from: 'reviewing',
        to: 'queued',
        attempt: newAttempt,
        reviewNotes,
      }, taskId);
    }

    return this.taskRepo.findById(taskId)!;
  }

  async resolveConflict(taskId: string): Promise<SupervisionTask> {
    const task = this.taskRepo.findById(taskId);
    if (!task || task.status !== 'merge_conflict') {
      throw new Error('Task not in merge_conflict state');
    }

    const session = task.sessionId ? this.sessionRepo.findById(task.sessionId) : undefined;
    if (!session?.workingDirectory) {
      throw new Error('No worktree found for this task');
    }

    const pool = this.getWorktreePool(task.projectId);
    this.log(task.projectId, 'merge_started', { taskId, retry: true }, taskId);

    const result = await pool.mergeBack(task.id, task.attempt, session.workingDirectory);

    if (result.success) {
      this.taskRepo.updateStatus(taskId, 'integrated');
      pool.release(session.workingDirectory);
      this.broadcastTaskUpdate(taskId, task.projectId);
      this.log(task.projectId, 'merge_completed', { taskId }, taskId);
      this.log(task.projectId, 'worktree_released', {
        taskId, worktreePath: session.workingDirectory,
      }, taskId);
    } else {
      throw new Error(`Still has conflicts: ${result.conflicts?.join(', ')}`);
    }

    this.tick();
    return this.taskRepo.findById(taskId)!;
  }

  getTasks(projectId: string): SupervisionTask[] {
    return this.taskRepo.findByProjectId(projectId);
  }

  getTaskPlanStatus(taskId: string): PlanValidationResult {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const project = this.projectRepo.findById(task.projectId);
    if (!project?.rootPath) {
      throw new Error(`Project ${task.projectId} has no rootPath`);
    }
    return validatePlanFile(project.rootPath, taskId);
  }

  submitTaskPlan(taskId: string): { task: SupervisionTask; sessionId: string } {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'planning') {
      throw new Error(`Task ${taskId} is not in planning status`);
    }
    if (!task.sessionId) {
      throw new Error(`Task ${taskId} has no planning session`);
    }

    const session = this.sessionRepo.findById(task.sessionId);
    if (!session) {
      throw new Error(`Planning session not found for task ${taskId}`);
    }

    const planStatus = this.getTaskPlanStatus(taskId);
    if (!planStatus.ready) {
      throw new Error(`Plan is incomplete: missing ${planStatus.missing.join(', ')}`);
    }

    this.sessionRepo.update(session.id, {
      planStatus: 'planned',
      isReadOnly: true,
    } as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>);

    this.taskRepo.updateStatus(task.id, 'queued');
    this.broadcastTaskUpdate(task.id, task.projectId);
    this.log(task.projectId, 'task_plan_submitted', {
      taskId: task.id,
      sessionId: session.id,
      planPath: planStatus.path,
    }, task.id);

    // Prompt scheduler to pick it up quickly
    this.tick();

    return { task: this.taskRepo.findById(task.id)!, sessionId: session.id };
  }

  updateTask(taskId: string, data: Partial<Pick<SupervisionTask,
    'title' | 'description' | 'priority' | 'dependencies' | 'dependencyMode' |
    'acceptanceCriteria' | 'relevantDocIds' | 'scope' | 'taskSpecificContext'
  >>): SupervisionTask | undefined {
    const task = this.taskRepo.update(taskId, data);
    if (task) {
      this.broadcastTaskUpdate(task.id, task.projectId);
    }
    return task;
  }

  // ========================================
  // Context management
  // ========================================

  getContextDocuments(projectId: string): ContextDocument[] {
    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      return [];
    }

    const cm = this.getContextManager(projectId, project.rootPath);
    try {
      return cm.loadAll().documents;
    } catch {
      return [];
    }
  }

  reloadContext(projectId: string): void {
    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      throw new Error(`Project ${projectId} has no rootPath`);
    }

    // Delete cached ContextManager and re-create
    this.contextManagers.delete(projectId);
    const cm = this.getContextManager(projectId, project.rootPath);

    try {
      cm.loadAll();
      // Success — clear any error state
      this.projectRepo.update(projectId, { contextSyncStatus: 'synced' as any });
    } catch (err) {
      // Parse error — mark as error and pause agent
      console.error(`[SupervisorV2] Context reload failed for project ${projectId}:`, err);
      this.projectRepo.update(projectId, { contextSyncStatus: 'error' });
      if (project.agent) {
        this.pauseAgent(projectId, 'sync_error');
      }
      this.log(projectId, 'context_sync_error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ========================================
  // Polling loop
  // ========================================

  private tick(): void {
    try {
      const projects = this.projectRepo.findAll();
      for (const project of projects) {
        if (!project.agent) continue;
        if (project.agent.phase !== 'active' && project.agent.phase !== 'idle') continue;

        try {
          this.tickProject(project.id);
        } catch (err) {
          console.error(`[SupervisorV2] Error ticking project ${project.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[SupervisorV2] Error in tick:', err);
    }
  }

  private tickProject(projectId: string): void {
    const project = this.projectRepo.findById(projectId);
    if (!project?.agent) return;

    const isLite = (project.agent.mode ?? 'full') === 'lite';

    // 1. Check budget limits
    if (!this.checkBudgetLimits(projectId)) {
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
    const pendingTasks = this.taskRepo.findByStatus(projectId, 'pending');
    for (const task of pendingTasks) {
      if (this.areDependenciesMet(task, isLite)) {
        this.taskRepo.updateStatus(task.id, 'queued');
        this.broadcastTaskUpdate(task.id, projectId);
        this.log(projectId, 'task_status_changed', {
          taskId: task.id,
          from: 'pending',
          to: 'queued',
        }, task.id);
      }
    }

    // 4. Check cascading failures — mark blocked tasks
    const queuedTasks = this.taskRepo.findByStatus(projectId, 'queued');
    for (const task of queuedTasks) {
      if (task.dependencies.length > 0 && !this.areDependenciesMet(task, isLite)) {
        // areDependenciesMet already marks blocked tasks; nothing extra needed here
      }
    }

    // 5. Schedule tasks based on concurrency mode
    const runningTasks = this.taskRepo.findByStatus(projectId, 'running');
    const reviewingTasks = this.taskRepo.findByStatus(projectId, 'reviewing');

    let available: number;
    if (maxConcurrent <= 1) {
      // Serial mode: block if ANY task is running OR reviewing
      available = (runningTasks.length === 0 && reviewingTasks.length === 0) ? 1 : 0;
    } else {
      // Parallel mode: only count running tasks against the limit
      available = maxConcurrent - runningTasks.length;
    }

    if (available > 0) {
      const readyTasks = this.taskRepo.findByStatus(projectId, 'queued');
      const toStart = readyTasks.slice(0, available);
      for (const task of toStart) {
        if (isLite) {
          this.startLiteTask(task).catch((err) => {
            console.error(`[SupervisorV2] Failed to start lite task ${task.id}:`, err);
          });
        } else {
          this.startTask(task).catch((err) => {
            console.error(`[SupervisorV2] Failed to start task ${task.id}:`, err);
          });
        }
      }
    }

    // 6. If no active tasks, transition to idle
    const activeStatuses: TaskStatus[] = isLite
      ? ['pending', 'queued', 'running']
      : ['pending', 'queued', 'running', 'reviewing'];
    const activeTasks = this.taskRepo.findByStatus(projectId, ...activeStatuses);
    if (activeTasks.length === 0 && project.agent.phase === 'active') {
      const agent = { ...project.agent, phase: 'idle' as const, updatedAt: Date.now() };
      this.projectRepo.update(projectId, { agent });
      this.broadcastAgentUpdate(projectId, agent);
      this.log(projectId, 'phase_changed', { from: 'active', to: 'idle' });

      // Trigger checkpoint on idle if configured (full mode only)
      if (!isLite && this.checkpointEngine?.shouldTrigger(projectId, 'idle')) {
        this.checkpointEngine.runCheckpoint(projectId).catch((err) => {
          console.error(`[SupervisorV2] Idle checkpoint failed for ${projectId}:`, err);
        });
      }
    }
  }

  // ========================================
  // Dependency checking
  // ========================================

  private areDependenciesMet(task: SupervisionTask, isLite = false): boolean {
    if (!task.dependencies || task.dependencies.length === 0) {
      return true;
    }

    const depTasks = task.dependencies.map((depId) => this.taskRepo.findById(depId));
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
        this.taskRepo.updateStatus(task.id, 'blocked');
        this.broadcastTaskUpdate(task.id, task.projectId);
        this.log(task.projectId, 'task_status_changed', {
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
      this.taskRepo.updateStatus(task.id, 'blocked');
      this.broadcastTaskUpdate(task.id, task.projectId);
      this.log(task.projectId, 'task_status_changed', {
        taskId: task.id,
        from: task.status,
        to: 'blocked',
        reason: 'dependency_failed_or_cancelled',
      }, task.id);
      return false;
    }

    return false;
  }

  // ========================================
  // Task execution
  // ========================================

  private async startTask(task: SupervisionTask): Promise<void> {
    const project = this.projectRepo.findById(task.projectId);
    if (!project?.rootPath) {
      console.error(`[SupervisorV2] Cannot start task ${task.id}: project has no rootPath`);
      return;
    }

    const isGit = this.isGitProject(project.rootPath);
    const maxConcurrent = project.agent?.config?.maxConcurrentTasks ?? 1;
    let workingDirectory = project.rootPath;

    // Acquire worktree for parallel git execution
    if (isGit && maxConcurrent > 1) {
      try {
        await this.ensurePoolInitialized(task.projectId);
        const pool = this.getWorktreePool(task.projectId);
        workingDirectory = await pool.acquire(task.id, task.attempt);
        this.log(task.projectId, 'worktree_acquired', {
          taskId: task.id, worktreePath: workingDirectory,
        }, task.id);
      } catch (err) {
        console.error(`[SupervisorV2] Failed to acquire worktree for task ${task.id}:`, err);
        return; // Don't start the task if we can't get a worktree
      }
    }

    // 1. Reuse existing child session (created by createTask) or create a new one
    let session: Session;
    if (task.sessionId) {
      const existing = this.sessionRepo.findById(task.sessionId);
      if (existing) {
        // Update session: set to executing, read-only, and assign worktree
        this.sessionRepo.update(existing.id, {
          workingDirectory,
          planStatus: 'executing',
          isReadOnly: true,
        } as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>);
        session = { ...existing, workingDirectory, planStatus: 'executing', isReadOnly: true };
      } else {
        // Fallback: create new session if linked one was deleted
        session = this.sessionRepo.create({
          projectId: task.projectId,
          name: `Task: ${task.title}`,
          type: 'regular',
          projectRole: 'task',
          taskId: task.id,
          workingDirectory,
          planStatus: 'executing',
          isReadOnly: true,
        } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);
      }
    } else {
      // Legacy path: task was created without a child session
      session = this.sessionRepo.create({
        projectId: task.projectId,
        name: `Task: ${task.title}`,
        type: 'regular',
        projectRole: 'task',
        taskId: task.id,
        workingDirectory,
        planStatus: 'executing',
        isReadOnly: true,
      } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);
    }

    // 2. Update task status → running with sessionId
    const extra: { sessionId: string; baseCommit?: string } = {
      sessionId: session.id,
    };

    // 3. Record baseCommit if git project
    if (isGit) {
      try {
        const commit = execSync('git rev-parse HEAD', {
          cwd: workingDirectory,
          encoding: 'utf-8',
        }).trim();
        extra.baseCommit = commit;
      } catch {
        // Not critical if we can't get the commit
      }
    }

    this.taskRepo.updateStatus(task.id, 'running', extra);
    this.broadcastTaskUpdate(task.id, task.projectId);
    this.log(task.projectId, 'task_status_changed', {
      taskId: task.id,
      from: task.status,
      to: 'running',
      sessionId: session.id,
      workingDirectory,
    }, task.id);

    // 4. Build task system prompt with context injection
    const cm = this.getContextManager(task.projectId, project.rootPath);
    const contextInjection = cm.getContextForTask(task.relevantDocIds);
    const systemPrompt = this.buildTaskPrompt(task, project.name, contextInjection);

    // 5. Create virtual client and trigger run
    const clientId = `supervisor_v2_task_${task.id}`;
    const virtualClient = createVirtualClient(clientId, {
      send: (msg: ServerMessage) => {
        this.handleTaskRunMessage(task.id, task.projectId, msg);
        // Forward streaming messages to connected clients
        this.broadcastFn(msg);
      },
    });
    this.virtualClients.set(task.id, virtualClient);

    const clientRequestId = `sv2_${task.id}_${Date.now()}`;

    // Fire and forget — results come via virtual client callback
    handleRunStart(
      virtualClient,
      {
        type: 'run_start',
        clientRequestId,
        sessionId: session.id,
        input: systemPrompt,
        workingDirectory,
      },
      this.db as any,
    );
  }

  private handleTaskRunMessage(
    taskId: string,
    projectId: string,
    msg: ServerMessage,
  ): void {
    if (msg.type === 'run_completed') {
      // Clear read-only on the task session
      this.clearTaskSessionReadOnly(taskId);

      // Delegate to TaskRunner (handles parsing, workflow, auto-commit, review trigger)
      this.taskRunner.onTaskComplete(taskId, projectId).catch((err) => {
        console.error(`[SupervisorV2] TaskRunner.onTaskComplete failed for ${taskId}:`, err);
        // Fallback: mark as reviewing without review (can be manually reviewed)
        this.taskRepo.updateStatus(taskId, 'reviewing', {
          result: { summary: 'Task completed but review pipeline failed', filesChanged: [] },
        });
        this.broadcastTaskUpdate(taskId, projectId);
      });
      this.virtualClients.delete(taskId);

      // Trigger checkpoint if configured
      if (this.checkpointEngine?.shouldTrigger(projectId, 'task_complete')) {
        this.checkpointEngine.runCheckpoint(projectId).catch((err) => {
          console.error(`[SupervisorV2] Checkpoint failed after task ${taskId}:`, err);
        });
      }
      return;
    }

    if (msg.type === 'run_failed') {
      // Clear read-only on the task session
      this.clearTaskSessionReadOnly(taskId);

      try {
        const errorMsg = 'error' in msg ? (msg as any).error : 'Run failed';
        this.taskRepo.updateStatus(taskId, 'failed', {
          result: { summary: `Run failed: ${errorMsg}`, filesChanged: [] },
        });
        this.broadcastTaskUpdate(taskId, projectId);
        this.log(projectId, 'task_status_changed', {
          taskId,
          from: 'running',
          to: 'failed',
          error: errorMsg,
        }, taskId);

        // Release worktree if applicable
        const failedTask = this.taskRepo.findById(taskId);
        if (failedTask) {
          this.releaseTaskWorktree(failedTask);
        }
      } catch (err) {
        console.error(`[SupervisorV2] Error handling run_failed for task ${taskId}:`, err);
      } finally {
        this.virtualClients.delete(taskId);
      }
    }
  }

  /**
   * Clear read-only flag on a task's session when execution ends.
   */
  private clearTaskSessionReadOnly(taskId: string): void {
    try {
      const task = this.taskRepo.findById(taskId);
      if (task?.sessionId) {
        this.sessionRepo.update(task.sessionId, {
          isReadOnly: false,
          planStatus: null,
        } as Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>);
      }
    } catch (err) {
      console.error(`[SupervisorV2] Failed to clear read-only for task ${taskId}:`, err);
    }
  }

  // ========================================
  // Lite mode — task execution
  // ========================================

  private async startLiteTask(task: SupervisionTask): Promise<void> {
    const project = this.projectRepo.findById(task.projectId);
    if (!project?.rootPath) {
      console.error(`[SupervisorV2] Cannot start lite task ${task.id}: project has no rootPath`);
      return;
    }

    const workingDirectory = project.rootPath;

    // Reuse or create session
    let session: Session;
    if (task.sessionId) {
      const existing = this.sessionRepo.findById(task.sessionId);
      if (existing) {
        session = existing;
      } else {
        session = this.createLiteTaskSession(task, project);
      }
    } else {
      session = this.createLiteTaskSession(task, project);
    }

    // Update task → running
    this.taskRepo.updateStatus(task.id, 'running', { sessionId: session.id });
    this.broadcastTaskUpdate(task.id, task.projectId);
    this.log(task.projectId, 'task_status_changed', {
      taskId: task.id,
      from: task.status,
      to: 'running',
      sessionId: session.id,
    }, task.id);

    // Create virtual client and fire prompt
    const clientId = `lite_task_${task.id}`;
    const virtualClient = createVirtualClient(clientId, {
      send: (msg: ServerMessage) => {
        this.handleLiteTaskMessage(task.id, task.projectId, msg);
        this.broadcastFn(msg);
      },
    });
    this.virtualClients.set(task.id, virtualClient);

    handleRunStart(
      virtualClient,
      {
        type: 'run_start',
        clientRequestId: `lite_${task.id}_${Date.now()}`,
        sessionId: session.id,
        input: task.description,
        workingDirectory,
      },
      this.db as any,
    );
  }

  private createLiteTaskSession(task: SupervisionTask, project: Project): Session {
    return this.sessionRepo.create({
      projectId: task.projectId,
      name: `Task: ${task.title}`,
      type: 'regular',
      projectRole: 'task',
      taskId: task.id,
      parentSessionId: project.agent?.mainSessionId,
      providerId: project.providerId,
      workingDirectory: project.rootPath,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);
  }

  private handleLiteTaskMessage(
    taskId: string,
    projectId: string,
    msg: ServerMessage,
  ): void {
    if (msg.type === 'run_completed') {
      // Lite mode: skip review, go straight to completed
      this.taskRepo.updateStatus(taskId, 'completed', {
        result: { summary: 'Task completed', filesChanged: [] },
      });
      this.broadcastTaskUpdate(taskId, projectId);
      this.log(projectId, 'task_status_changed', {
        taskId,
        from: 'running',
        to: 'completed',
      }, taskId);
      this.virtualClients.delete(taskId);
      return;
    }

    if (msg.type === 'run_failed') {
      try {
        const task = this.taskRepo.findById(taskId);
        if (!task) { this.virtualClients.delete(taskId); return; }

        const errorMsg = 'error' in msg ? (msg as any).error : 'Run failed';
        const newAttempt = task.attempt + 1;

        if (newAttempt > task.maxRetries + 1) {
          // Max retries exceeded
          this.taskRepo.updateStatus(taskId, 'failed', {
            result: { summary: `Failed after ${task.maxRetries} retries: ${errorMsg}`, filesChanged: [] },
            attempt: newAttempt,
          });
          this.log(projectId, 'task_status_changed', {
            taskId, from: 'running', to: 'failed', error: errorMsg,
          }, taskId);
        } else {
          // Re-queue for retry
          this.taskRepo.updateStatus(taskId, 'pending', { attempt: newAttempt });
          this.log(projectId, 'task_status_changed', {
            taskId, from: 'running', to: 'pending',
            reason: 'retry', attempt: newAttempt,
          }, taskId);
        }

        this.broadcastTaskUpdate(taskId, projectId);
      } catch (err) {
        console.error(`[SupervisorV2] Error handling lite run_failed for task ${taskId}:`, err);
      } finally {
        this.virtualClients.delete(taskId);
      }
    }
  }

  // ========================================
  // Lite mode — scheduling
  // ========================================

  private checkScheduledTasks(projectId: string): void {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT * FROM supervision_tasks
      WHERE project_id = ? AND schedule_enabled = 1 AND schedule_next_run <= ?
        AND status IN ('completed', 'failed', 'cancelled')
      ORDER BY schedule_next_run ASC
    `).all(projectId, now) as any[];

    for (const row of rows) {
      const task = this.taskRepo.mapRow(row);

      // Reset task for re-execution
      this.taskRepo.updateStatus(task.id, 'pending', { attempt: 1 });

      // Compute next run time
      if (task.scheduleCron) {
        const nextRun = computeNextCronRun(task.scheduleCron, now);
        this.db.prepare('UPDATE supervision_tasks SET schedule_next_run = ? WHERE id = ?')
          .run(nextRun, task.id);
      }

      this.broadcastTaskUpdate(task.id, projectId);
      this.log(projectId, 'task_status_changed', {
        taskId: task.id, from: task.status, to: 'pending', trigger: 'schedule',
      }, task.id);

      // Transition agent to active if idle
      const project = this.projectRepo.findById(projectId);
      if (project?.agent?.phase === 'idle') {
        const agent = { ...project.agent, phase: 'active' as const, updatedAt: Date.now() };
        this.projectRepo.update(projectId, { agent });
        this.broadcastAgentUpdate(projectId, agent);
        this.log(projectId, 'phase_changed', { from: 'idle', to: 'active', reason: 'scheduled_task' });
      }
    }
  }

  // ========================================
  // Lite mode — convenience methods
  // ========================================

  retryTask(taskId: string): SupervisionTask {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!['failed', 'cancelled', 'completed', 'blocked'].includes(task.status)) {
      throw new Error(`Cannot retry task in status '${task.status}'`);
    }

    this.taskRepo.updateStatus(taskId, 'pending', { attempt: 1 });
    this.broadcastTaskUpdate(taskId, task.projectId);
    this.log(task.projectId, 'task_status_changed', {
      taskId, from: task.status, to: 'pending', reason: 'manual_retry',
    }, taskId);

    // Transition agent to active if idle
    const project = this.projectRepo.findById(task.projectId);
    if (project?.agent?.phase === 'idle') {
      const agent = { ...project.agent, phase: 'active' as const, updatedAt: Date.now() };
      this.projectRepo.update(task.projectId, { agent });
      this.broadcastAgentUpdate(task.projectId, agent);
      this.log(task.projectId, 'phase_changed', { from: 'idle', to: 'active', reason: 'manual_retry' });
    }

    return this.taskRepo.findById(taskId)!;
  }

  cancelTask(taskId: string): SupervisionTask {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    // If running, kill the virtual client
    const vc = this.virtualClients.get(taskId);
    if (vc) {
      this.virtualClients.delete(taskId);
    }

    this.taskRepo.updateStatus(taskId, 'cancelled');
    this.broadcastTaskUpdate(taskId, task.projectId);
    this.log(task.projectId, 'task_status_changed', {
      taskId, from: task.status, to: 'cancelled', reason: 'manual_cancel',
    }, taskId);

    return this.taskRepo.findById(taskId)!;
  }

  runTaskNow(taskId: string): SupervisionTask {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
      throw new Error(`Cannot run-now task in status '${task.status}'; must be terminal`);
    }

    this.taskRepo.updateStatus(taskId, 'pending', { attempt: 1 });
    this.broadcastTaskUpdate(taskId, task.projectId);
    this.log(task.projectId, 'task_status_changed', {
      taskId, from: task.status, to: 'pending', reason: 'run_now',
    }, taskId);

    // Transition agent to active if idle
    const project = this.projectRepo.findById(task.projectId);
    if (project?.agent?.phase === 'idle') {
      const agent = { ...project.agent, phase: 'active' as const, updatedAt: Date.now() };
      this.projectRepo.update(task.projectId, { agent });
      this.broadcastAgentUpdate(task.projectId, agent);
      this.log(task.projectId, 'phase_changed', { from: 'idle', to: 'active', reason: 'run_now' });
    }

    return this.taskRepo.findById(taskId)!;
  }

  // ========================================
  // Prompt construction
  // ========================================

  private buildTaskPrompt(
    task: SupervisionTask,
    projectName: string,
    contextInjection: string,
  ): string {
    let prompt = `[SUPERVISED TASK]
Project: ${projectName}
Task: ${task.title}
Attempt: ${task.attempt}

== Project Context ==
${contextInjection || '(no project context available)'}

== Task Description ==
${task.description}
`;

    if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
      prompt += `\n== Acceptance Criteria ==\n`;
      for (const ac of task.acceptanceCriteria) {
        prompt += `- ${ac}\n`;
      }
    }

    if (task.taskSpecificContext) {
      prompt += `\n== Additional Context ==\n${task.taskSpecificContext}\n`;
    }

    if (task.attempt > 1 && task.result?.reviewNotes) {
      prompt += `\n== Previous Review Feedback ==\n${task.result.reviewNotes}\n`;
    }

    prompt += `
== Instructions ==
Complete the task described above. When finished, output your results in this exact format:

[TASK_RESULT]
- summary: <brief summary of what was done>
- files_changed: <comma-separated list of files modified>
- tests: <test results if applicable>
[/TASK_RESULT]
`;

    return prompt;
  }

  // ========================================
  // Context helpers
  // ========================================

  private getContextManager(projectId: string, rootPath: string): ContextManager {
    let cm = this.contextManagers.get(projectId);
    if (!cm) {
      cm = new ContextManager(rootPath);
      this.contextManagers.set(projectId, cm);
    }
    return cm;
  }

  // ========================================
  // Broadcasting
  // ========================================

  private broadcastTaskUpdate(taskId: string, projectId: string): void {
    const task = this.taskRepo.findById(taskId);
    if (!task) return;

    this.broadcastFn({
      type: 'supervision_task_update',
      task,
      projectId,
    } as ServerMessage);
  }

  private broadcastAgentUpdate(projectId: string, agent: ProjectAgent): void {
    this.broadcastFn({
      type: 'supervision_agent_update',
      projectId,
      agent,
    } as ServerMessage);
  }

  // ========================================
  // Logging
  // ========================================

  private log(
    projectId: string,
    event: SupervisionV2LogEvent,
    detail?: Record<string, unknown>,
    taskId?: string,
  ): void {
    const id = uuidv4();
    const now = Date.now();

    try {
      this.db
        .prepare(
          `INSERT INTO supervision_v2_logs (id, project_id, task_id, event, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, projectId, taskId ?? null, event, detail ? JSON.stringify(detail) : null, now);
    } catch (err) {
      console.error(`[SupervisorV2] Failed to write log:`, err);
    }
  }

  // ========================================
  // Log query
  // ========================================

  getLogs(projectId: string, limit = 100): Array<{
    id: string;
    projectId: string;
    taskId?: string;
    event: SupervisionV2LogEvent;
    detail?: Record<string, unknown>;
    createdAt: number;
  }> {
    const rows = this.db.prepare(`
      SELECT id, project_id, task_id, event, detail, created_at
      FROM supervision_v2_logs
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectId, limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id || undefined,
      event: row.event as SupervisionV2LogEvent,
      detail: row.detail ? JSON.parse(row.detail) : undefined,
      createdAt: row.created_at,
    }));
  }

  // ========================================
  // Budget & guardrails
  // ========================================

  private checkBudgetLimits(projectId: string): boolean {
    const project = this.projectRepo.findById(projectId);
    if (!project?.agent) return false;

    const { maxTotalTasks, maxTokenBudget } = project.agent.config;
    if (maxTotalTasks !== undefined) {
      const totalCount = this.taskRepo.countByProject(projectId);
      if (totalCount >= maxTotalTasks) {
        this.pauseAgent(projectId, 'budget');
        return false;
      }
    }

    if (maxTokenBudget !== undefined) {
      const usage = this.getTokenUsage(projectId);
      if (usage >= maxTokenBudget) {
        this.pauseAgent(projectId, 'budget');
        this.log(projectId, 'budget_paused', {
          reason: 'token_budget_exceeded',
          usage,
          limit: maxTokenBudget,
        });
        return false;
      }
    }

    return true;
  }

  private pauseAgent(
    projectId: string,
    reason: 'user' | 'budget' | 'sync_error',
  ): void {
    const project = this.projectRepo.findById(projectId);
    if (!project?.agent) return;

    const agent: ProjectAgent = {
      ...project.agent,
      phase: 'paused',
      pausedReason: reason,
      pausedAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.projectRepo.update(projectId, { agent });
    this.broadcastAgentUpdate(projectId, agent);
    this.log(projectId, 'phase_changed', {
      from: project.agent.phase,
      to: 'paused',
      reason,
    });
  }

  // ========================================
  // Utility
  // ========================================

  // ========================================
  // Worktree pool public accessors (for StateRecovery)
  // ========================================

  hasWorktreePool(projectId: string): boolean {
    return this.worktreePools.has(projectId);
  }

  getWorktreePoolIfExists(projectId: string): WorktreePool | undefined {
    return this.worktreePools.get(projectId);
  }

  // ========================================
  // Token budget
  // ========================================

  getTokenUsage(projectId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(
        COALESCE(json_extract(metadata, '$.usage.input_tokens'), 0) +
        COALESCE(json_extract(metadata, '$.usage.output_tokens'), 0)
      ), 0) as total
      FROM messages
      WHERE session_id IN (
        SELECT id FROM sessions WHERE project_id = ?
      )
    `).get(projectId) as { total: number };
    return row.total;
  }

  // ========================================
  // Main session overflow
  // ========================================

  checkMainSessionOverflow(projectId: string): void {
    const project = this.projectRepo.findById(projectId);
    if (!project?.agent?.mainSessionId) return;

    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE session_id = ?
    `).get(project.agent.mainSessionId) as { count: number };

    if (row.count > 200) {
      this.rotateMainSession(projectId);
    }
  }

  private rotateMainSession(projectId: string): void {
    const project = this.projectRepo.findById(projectId);
    if (!project?.agent?.mainSessionId) return;

    // Archive old session
    this.sessionRepo.update(project.agent.mainSessionId, {
      archivedAt: Date.now(),
    });

    // Create new main session
    const newSession = this.sessionRepo.create({
      projectId,
      name: 'Main Session (rotated)',
      type: 'background',
      projectRole: 'main',
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    // Update agent
    const agent: ProjectAgent = {
      ...project.agent,
      mainSessionId: newSession.id,
      updatedAt: Date.now(),
    };
    this.projectRepo.update(projectId, { agent });
    this.broadcastAgentUpdate(projectId, agent);
    this.log(projectId, 'main_session_rotated', {
      oldSessionId: project.agent.mainSessionId,
      newSessionId: newSession.id,
    });
  }

  private isGitProject(rootPath: string): boolean {
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

  // ========================================
  // Worktree pool management
  // ========================================

  private getWorktreePool(projectId: string): WorktreePool {
    if (!this.worktreePools.has(projectId)) {
      const project = this.projectRepo.findById(projectId);
      if (!project?.rootPath) {
        throw new Error(`Project ${projectId} has no rootPath for worktree pool`);
      }
      const pool = new WorktreePool(project.rootPath);
      this.worktreePools.set(projectId, pool);
    }
    return this.worktreePools.get(projectId)!;
  }

  private async ensurePoolInitialized(projectId: string): Promise<void> {
    const pool = this.getWorktreePool(projectId);
    if (!pool.isInitialized()) {
      const project = this.projectRepo.findById(projectId);
      const maxConcurrent = project?.agent?.config?.maxConcurrentTasks ?? 2;
      await pool.init(maxConcurrent);
    }
  }

  private async cleanupPool(projectId: string): Promise<void> {
    const pool = this.worktreePools.get(projectId);
    if (pool) {
      await pool.destroy();
      this.worktreePools.delete(projectId);
    }
  }

  private releaseTaskWorktree(task: SupervisionTask): void {
    const session = task.sessionId ? this.sessionRepo.findById(task.sessionId) : undefined;
    const project = this.projectRepo.findById(task.projectId);
    if (
      session?.workingDirectory &&
      project?.rootPath &&
      session.workingDirectory !== project.rootPath
    ) {
      const pool = this.worktreePools.get(task.projectId);
      pool?.release(session.workingDirectory);
      this.log(task.projectId, 'worktree_released', {
        taskId: task.id, worktreePath: session.workingDirectory,
      }, task.id);
    }
  }
}
