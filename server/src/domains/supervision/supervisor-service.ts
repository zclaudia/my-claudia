import { execSync } from 'child_process';
import { systemTaskRegistry } from '../../services/system-task-registry.js';
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
  ServerMessage,
  SupervisionLogEvent,
} from '@my-claudia/shared';
import { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import { ProjectRepository } from '../../repositories/project.js';
import { SessionRepository } from '../../repositories/session.js';
import { ContextManager, type ContextDocument } from './context-manager.js';
import { TaskRunner } from './task-runner.js';
import { ReviewEngine } from './review-engine.js';
import { WorktreePool } from './worktree-pool.js';
import type { CheckpointEngine } from './checkpoint-engine.js';
import { createVirtualClient, handleRunStart } from '../../server.js';
import { computeNextCronRun } from '../../utils/cron.js';
import { validatePlanFile, type PlanValidationResult } from './plan-validator.js';
import { TaskScheduler } from './task-scheduler.js';
import { SupervisorGuards } from './supervisor-guards.js';
import { WorktreeManager } from './worktree-manager.js';
import { TaskLifecycle } from './task-lifecycle.js';

export class SupervisorService {
  private pollInterval: NodeJS.Timeout | null = null;
  private contextManagers = new Map<string, ContextManager>();
  private virtualClients = new Map<string, any>(); // taskId → virtualClient
  private taskRunner: TaskRunner;
  private reviewEngine: ReviewEngine;
  private checkpointEngine?: CheckpointEngine;
  private taskScheduler: TaskScheduler;
  private guards: SupervisorGuards;
  private worktreeManager: WorktreeManager;
  private taskLifecycle: TaskLifecycle;

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
      event: SupervisionLogEvent,
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
      (projectId) => this.worktreeManager.getWorktreePool(projectId),
    );

    // Initialize sub-modules
    this.guards = new SupervisorGuards({
      db,
      taskRepo,
      projectRepo,
      broadcastAgentUpdate: (projectId, agent) => this.broadcastAgentUpdate(projectId, agent),
      log: logFn,
    });

    this.worktreeManager = new WorktreeManager({
      projectRepo,
      sessionRepo,
      log: logFn,
    });

    this.taskLifecycle = new TaskLifecycle({
      taskRepo,
      projectRepo,
      sessionRepo,
      taskRunner: this.taskRunner,
      worktreeManager: this.worktreeManager,
      virtualClients: this.virtualClients,
      getCheckpointEngine: () => this.checkpointEngine,
      tick: () => this.tick(),
      broadcastTaskUpdate: broadcastTaskUpdateFn,
      log: logFn,
    });

    this.taskScheduler = new TaskScheduler({
      db,
      taskRepo,
      projectRepo,
      sessionRepo,
      broadcastTaskUpdate: broadcastTaskUpdateFn,
      broadcastAgentUpdate: (projectId, agent) => this.broadcastAgentUpdate(projectId, agent),
      broadcastSessionCreated: (session) => this.broadcastSessionCreated(session),
      broadcastSessionUpdated: (session) => this.broadcastSessionUpdated(session),
      log: logFn,
      checkBudgetLimits: (projectId) => this.guards.checkBudgetLimits(projectId),
      startTask: (task) => this.startTask(task),
      startLiteTask: (task) => this.startLiteTask(task),
    });
  }

  // ========================================
  // Lifecycle
  // ========================================

  start(intervalMs = 5000): void {
    if (this.pollInterval) return;
    systemTaskRegistry.register({
      id: 'system:supervisor_polling',
      name: 'Supervisor Polling',
      description: 'Task queue management, dependency checking, and execution scheduling',
      category: 'supervision',
      intervalMs,
    });
    this.pollInterval = setInterval(async () => {
      systemTaskRegistry.markRunStart('system:supervisor_polling');
      const start = Date.now();
      try {
        this.tick();
        systemTaskRegistry.markRunComplete('system:supervisor_polling', Date.now() - start);
      } catch (err) {
        systemTaskRegistry.markRunComplete('system:supervisor_polling', Date.now() - start, String(err));
      }
    }, intervalMs);
    console.log('[Supervisor] Started polling');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.checkpointEngine?.stop();
    this.worktreeManager.destroyAllPools();
    console.log('[Supervisor] Stopped');
  }

  setCheckpointEngine(engine: CheckpointEngine): void {
    this.checkpointEngine = engine;
    this.taskScheduler.setCheckpointEngine(engine);
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
    this.broadcastSessionCreated(mainSession);

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
        this.worktreeManager.cleanupPool(projectId).catch((err) => {
          console.error(`[Supervisor] Failed to cleanup pool for ${projectId}:`, err);
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
        this.guards.pauseAgent(projectId, 'budget');
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
    return this.taskLifecycle.approveTaskResult(taskId);
  }

  rejectTaskResult(taskId: string, reviewNotes: string): SupervisionTask {
    return this.taskLifecycle.rejectTaskResult(taskId, reviewNotes);
  }

  async resolveConflict(taskId: string): Promise<SupervisionTask> {
    return this.taskLifecycle.resolveConflict(taskId);
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
      this.projectRepo.update(projectId, { contextSyncStatus: 'synced' });
    } catch (err) {
      // Parse error — mark as error and pause agent
      console.error(`[Supervisor] Context reload failed for project ${projectId}:`, err);
      this.projectRepo.update(projectId, { contextSyncStatus: 'error' });
      if (project.agent) {
        this.guards.pauseAgent(projectId, 'sync_error');
      }
      this.log(projectId, 'context_sync_error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ========================================
  // Polling loop (delegates to TaskScheduler)
  // ========================================

  private tick(): void {
    this.taskScheduler.tick();
  }

  // Keep these as private delegates so tests using (service as any) still work
  private areDependenciesMet(task: SupervisionTask, isLite = false): boolean {
    return this.taskScheduler.areDependenciesMet(task, isLite);
  }

  private checkBudgetLimits(projectId: string): boolean {
    return this.guards.checkBudgetLimits(projectId);
  }

  private checkScheduledTasks(projectId: string): void {
    this.taskScheduler.checkScheduledTasks(projectId);
  }

  // ========================================
  // Task execution
  // ========================================

  private async startTask(task: SupervisionTask): Promise<void> {
    const project = this.projectRepo.findById(task.projectId);
    if (!project?.rootPath) {
      console.error(`[Supervisor] Cannot start task ${task.id}: project has no rootPath`);
      return;
    }

    const isGit = this.taskScheduler.isGitProject(project.rootPath);
    const maxConcurrent = project.agent?.config?.maxConcurrentTasks ?? 1;
    let workingDirectory = project.rootPath;
    let acquiredFromPool = false;
    let taskMarkedRunning = false;

    // Acquire worktree for parallel git execution
    if (isGit && maxConcurrent > 1) {
      try {
        await this.worktreeManager.ensurePoolInitialized(task.projectId);
        const pool = this.worktreeManager.getWorktreePool(task.projectId);
        workingDirectory = await pool.acquire(task.id, task.attempt);
        acquiredFromPool = true;
        this.log(task.projectId, 'worktree_acquired', {
          taskId: task.id, worktreePath: workingDirectory,
        }, task.id);
      } catch (err) {
        console.error(`[Supervisor] Failed to acquire worktree for task ${task.id}:`, err);
        return; // Don't start the task if we can't get a worktree
      }
    }

    try {
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
      taskMarkedRunning = true;
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
      const clientId = `supervisor_task_${task.id}`;
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
        this.db,
      );
    } catch (err) {
      console.error(`[Supervisor] Failed to initialize task ${task.id}:`, err);
      if (acquiredFromPool && !taskMarkedRunning) {
        const pool = this.worktreeManager.getPoolsMap().get(task.projectId);
        pool?.release(workingDirectory);
        this.log(task.projectId, 'worktree_released', {
          taskId: task.id,
          worktreePath: workingDirectory,
          reason: 'start_task_failed_before_running',
        }, task.id);
      }
    }
  }

  private handleTaskRunMessage(
    taskId: string,
    projectId: string,
    msg: ServerMessage,
  ): void {
    this.taskLifecycle.handleTaskRunMessage(taskId, projectId, msg);
  }

  /**
   * Clear read-only flag on a task's session when execution ends.
   */
  private clearTaskSessionReadOnly(taskId: string): void {
    this.taskLifecycle.clearTaskSessionReadOnly(taskId);
  }

  // ========================================
  // Lite mode — task execution
  // ========================================

  private async startLiteTask(task: SupervisionTask): Promise<void> {
    const project = this.projectRepo.findById(task.projectId);
    if (!project?.rootPath) {
      console.error(`[Supervisor] Cannot start lite task ${task.id}: project has no rootPath`);
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
      this.db,
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
    this.taskLifecycle.handleLiteTaskMessage(taskId, projectId, msg);
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

  private broadcastSessionCreated(session: Session): void {
    this.broadcastFn({
      type: 'sessions_created',
      session,
    } as ServerMessage);
  }

  private broadcastSessionUpdated(session: Session): void {
    this.broadcastFn({
      type: 'sessions_updated',
      session,
    } as ServerMessage);
  }

  // ========================================
  // Logging
  // ========================================

  private log(
    projectId: string,
    event: SupervisionLogEvent,
    detail?: Record<string, unknown>,
    taskId?: string,
  ): void {
    const id = uuidv4();
    const now = Date.now();

    try {
      this.db
        .prepare(
          `INSERT INTO supervision_logs (id, project_id, task_id, event, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, projectId, taskId ?? null, event, detail ? JSON.stringify(detail) : null, now);
    } catch (err) {
      console.error(`[Supervisor] Failed to write log:`, err);
    }
  }

  // ========================================
  // Log query
  // ========================================

  getLogs(projectId: string, limit = 100): Array<{
    id: string;
    projectId: string;
    taskId?: string;
    event: SupervisionLogEvent;
    detail?: Record<string, unknown>;
    createdAt: number;
  }> {
    const rows = this.db.prepare(`
      SELECT id, project_id, task_id, event, detail, created_at
      FROM supervision_logs
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectId, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      projectId: row.project_id as string,
      taskId: (row.task_id as string) || undefined,
      event: row.event as SupervisionLogEvent,
      detail: row.detail ? JSON.parse(row.detail as string) : undefined,
      createdAt: row.created_at as number,
    }));
  }

  // ========================================
  // Worktree pool public accessors (delegates to WorktreeManager)
  // ========================================

  hasWorktreePool(projectId: string): boolean {
    return this.worktreeManager.hasWorktreePool(projectId);
  }

  getWorktreePoolIfExists(projectId: string): WorktreePool | undefined {
    return this.worktreeManager.getWorktreePoolIfExists(projectId);
  }

  // ========================================
  // Token budget (delegates to SupervisorGuards)
  // ========================================

  getTokenUsage(projectId: string): number {
    return this.guards.getTokenUsage(projectId);
  }

  // ========================================
  // Main session overflow (delegates to TaskScheduler)
  // ========================================

  checkMainSessionOverflow(projectId: string): void {
    this.taskScheduler.checkMainSessionOverflow(projectId);
  }

  // ========================================
  // Worktree pool management — private delegate for (service as any) test access
  // ========================================

  private getWorktreePool(projectId: string): WorktreePool {
    return this.worktreeManager.getWorktreePool(projectId);
  }

  private get worktreePools(): Map<string, WorktreePool> {
    return this.worktreeManager.getPoolsMap();
  }

  private isGitProject(rootPath: string): boolean {
    return this.taskScheduler.isGitProject(rootPath);
  }
}
