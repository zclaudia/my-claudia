import { v4 as uuidv4 } from 'uuid';
import type { Database } from 'better-sqlite3';
import type { Session } from '@my-claudia/shared/core/session';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type {
  AgentMode,
  ProjectAgent,
  SupervisionTask,
  SupervisionLogEvent,
  SupervisorConfig,
} from '@my-claudia/shared/features/supervision';
import { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import { ProjectRepository } from '../projects/repository.js';
import { SessionRepository } from '../sessions/repository.js';
import { ContextManager, type ContextDocument } from './context-manager.js';
import { TaskRunner } from './task-runner.js';
import { ReviewEngine } from './review-engine.js';
import { WorktreePool } from './worktree-pool.js';
import type { CheckpointEngine } from './checkpoint-engine.js';
import { validatePlanFile, type PlanValidationResult } from './plan-validator.js';
import { TaskScheduler } from './task-scheduler.js';
import { SupervisorGuards } from './supervisor-guards.js';
import { WorktreeManager } from './worktree-manager.js';
import { TaskLifecycle } from './task-lifecycle.js';
import { TaskExecution } from './task-execution.js';
import { TaskAdmin } from './task-admin.js';
import { SupervisorAgentManager } from './supervisor-agent.js';
import { SupervisorContextService } from './supervisor-context.js';
import { buildTaskPrompt as buildSupervisedTaskPrompt } from './task-prompt.js';
import type { SystemTaskRegistryPort } from '../../services/system-task-registry.js';

export class SupervisorService {
  private static cleanupHooksInstalled = false;
  private static activeServices = new Set<SupervisorService>();
  private pollInterval: NodeJS.Timeout | null = null;
  private virtualClients = new Map<string, unknown>(); // taskId → virtualClient
  private taskRunner: TaskRunner;
  private reviewEngine: ReviewEngine;
  private checkpointEngine?: CheckpointEngine;
  private taskScheduler: TaskScheduler;
  private guards: SupervisorGuards;
  private worktreeManager: WorktreeManager;
  private taskLifecycle: TaskLifecycle;
  private taskExecution: TaskExecution;
  private taskAdmin: TaskAdmin;
  private agentManager: SupervisorAgentManager;
  private contextService: SupervisorContextService;

  constructor(
    private db: Database,
    private taskRepo: SupervisionTaskRepository,
    private projectRepo: ProjectRepository,
    private sessionRepo: SessionRepository,
    private broadcastFn: (msg: ServerMessage) => void,
  ) {
    SupervisorService.installCleanupHooks();

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
      broadcastAgentUpdate: (projectId, agent) => this.broadcastAgentUpdate(projectId, agent),
      getTaskPlanStatus: (taskId) => this.getTaskPlanStatus(taskId),
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

    this.taskAdmin = new TaskAdmin({
      taskRepo,
      projectRepo,
      sessionRepo,
      pauseAgent: (projectId, reason) => this.guards.pauseAgent(projectId, reason),
      broadcastTaskUpdate: broadcastTaskUpdateFn,
      broadcastAgentUpdate: (projectId, agent) => this.broadcastAgentUpdate(projectId, agent),
      log: logFn,
    });

    this.contextService = new SupervisorContextService({
      projectRepo,
      pauseAgent: (projectId, reason) => this.guards.pauseAgent(projectId, reason),
      log: logFn,
    });

    this.agentManager = new SupervisorAgentManager({
      taskRepo,
      projectRepo,
      sessionRepo,
      worktreeManager: this.worktreeManager,
      getContextManager: (projectId, rootPath) => this.getContextManager(projectId, rootPath),
      broadcastSessionCreated: (session) => this.broadcastSessionCreated(session),
      broadcastAgentUpdate: (projectId, agent) => this.broadcastAgentUpdate(projectId, agent),
      log: logFn,
    });

    this.taskExecution = new TaskExecution({
      db,
      taskRepo,
      projectRepo,
      sessionRepo,
      taskScheduler: this.taskScheduler,
      worktreeManager: this.worktreeManager,
      virtualClients: this.virtualClients,
      broadcast: this.broadcastFn,
      handleTaskRunMessage: (taskId, projectId, msg) =>
        this.handleTaskRunMessage(taskId, projectId, msg),
      handleLiteTaskMessage: (taskId, projectId, msg) =>
        this.handleLiteTaskMessage(taskId, projectId, msg),
      getContextManager: (projectId, rootPath) => this.getContextManager(projectId, rootPath),
      buildTaskPrompt: (task, projectName, contextInjection) =>
        this.buildTaskPrompt(task, projectName, contextInjection),
      broadcastTaskUpdate: broadcastTaskUpdateFn,
      log: logFn,
    });
  }

  // ========================================
  // Lifecycle
  // ========================================

  start(intervalMs = 5000, registry?: SystemTaskRegistryPort): void {
    if (this.pollInterval) return;
    SupervisorService.activeServices.add(this);
    registry?.register({
      id: 'system:supervisor_polling',
      name: 'Supervisor Polling',
      description: 'Task queue management, dependency checking, and execution scheduling',
      category: 'supervision',
      intervalMs,
    });
    this.pollInterval = setInterval(async () => {
      registry?.markRunStart('system:supervisor_polling');
      const start = Date.now();
      try {
        this.tick();
        registry?.markRunComplete('system:supervisor_polling', Date.now() - start);
      } catch (err) {
        registry?.markRunComplete('system:supervisor_polling', Date.now() - start, String(err));
      }
    }, intervalMs);
    console.log('[Supervisor] Started polling');
  }

  stop(): void {
    SupervisorService.activeServices.delete(this);
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.checkpointEngine?.stop();
    this.worktreeManager.destroyAllPools();
    this.contextService.clearAll();
    console.log('[Supervisor] Stopped');
  }

  setCheckpointEngine(engine: CheckpointEngine): void {
    this.checkpointEngine = engine;
    this.taskScheduler.setCheckpointEngine(engine);
  }

  // ========================================
  // Agent management
  // ========================================

  initAgent(
    projectId: string,
    config?: Partial<SupervisorConfig>,
    providerId?: string,
    mode?: AgentMode,
  ): ProjectAgent {
    return this.agentManager.initAgent(projectId, config, providerId, mode);
  }

  updateAgentPhase(
    projectId: string,
    action: 'pause' | 'resume' | 'archive' | 'approve_setup',
  ): ProjectAgent {
    return this.agentManager.updateAgentPhase(projectId, action);
  }

  getAgent(projectId: string): ProjectAgent | undefined {
    return this.agentManager.getAgent(projectId);
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
    return this.taskAdmin.createTask(projectId, data);
  }

  /**
   * Open (or return existing) session for a task — lazy session creation.
   * Called when user clicks "Edit" on a task card.
   */
  openTaskSession(taskId: string): { sessionId: string } {
    return this.taskAdmin.openTaskSession(taskId);
  }

  approveTask(taskId: string): SupervisionTask {
    return this.taskAdmin.approveTask(taskId);
  }

  rejectTask(taskId: string): SupervisionTask {
    return this.taskAdmin.rejectTask(taskId);
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
    return this.taskLifecycle.submitTaskPlan(taskId);
  }

  updateTask(taskId: string, data: Partial<Pick<SupervisionTask,
    'title' | 'description' | 'priority' | 'dependencies' | 'dependencyMode' |
    'acceptanceCriteria' | 'relevantDocIds' | 'scope' | 'taskSpecificContext'
  >>): SupervisionTask | undefined {
    return this.taskAdmin.updateTask(taskId, data);
  }

  // ========================================
  // Context management
  // ========================================

  getContextDocuments(projectId: string): ContextDocument[] {
    return this.contextService.getContextDocuments(projectId);
  }

  reloadContext(projectId: string): void {
    this.contextService.reloadContext(projectId);
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
    return this.taskExecution.startTask(task);
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
    return this.taskExecution.startLiteTask(task);
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
    return this.taskLifecycle.retryTask(taskId);
  }

  cancelTask(taskId: string): SupervisionTask {
    return this.taskLifecycle.cancelTask(taskId);
  }

  runTaskNow(taskId: string): SupervisionTask {
    return this.taskLifecycle.runTaskNow(taskId);
  }

  // ========================================
  // Prompt construction
  // ========================================

  private buildTaskPrompt(
    task: SupervisionTask,
    projectName: string,
    contextInjection: string,
  ): string {
    return buildSupervisedTaskPrompt(task, projectName, contextInjection);
  }

  // ========================================
  // Context helpers
  // ========================================

  private getContextManager(projectId: string, rootPath: string): ContextManager {
    return this.contextService.getContextManager(projectId, rootPath);
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

  private static installCleanupHooks(): void {
    if (SupervisorService.cleanupHooksInstalled) {
      return;
    }

    const cleanup = () => {
      for (const service of SupervisorService.activeServices) {
        try {
          service.stop();
        } catch (err) {
          console.error('[Supervisor] Failed during process cleanup:', err);
        }
      }
    };

    process.once('exit', cleanup);
    process.once('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.once('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });

    SupervisorService.cleanupHooksInstalled = true;
  }
}
