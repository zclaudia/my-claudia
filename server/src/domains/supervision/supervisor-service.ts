import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from 'better-sqlite3';
import type { Session } from '@my-claudia/shared/core/session';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type {
  AcceptanceDecision,
  AgentMode,
  ChangeExecutionPlan,
  DesignGateDecision,
  ExecutionGateDecision,
  ProjectChange,
  ProjectAgent,
  SupervisionTask,
  SupervisionLogEvent,
  SupervisorConfig,
} from '@my-claudia/shared/features/supervision';
import { ProjectChangeRepository } from '../../infrastructure/repositories/project-change.js';
import { ChangeGateReviewRepository } from '../../infrastructure/repositories/change-gate-review.js';
import { ChangeSyncRunRepository } from '../../infrastructure/repositories/change-sync-run.js';
import { SupervisionTaskRepository } from '../../infrastructure/repositories/supervision-task.js';
import type { SupervisionProjectPort, SupervisionSessionPort, SupervisionSessionModelPort } from './ports.js';
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
import { EventDispatcher } from './event-dispatcher.js';
import type { SupervisionTaskEvent } from './task-events.js';
import { SupervisorAgentManager } from './supervisor-agent.js';
import { SupervisorContextService } from './supervisor-context.js';
import { buildTaskPrompt as buildSupervisedTaskPrompt } from './task-prompt.js';
import type { SupervisionAiRunPort, SupervisionSchedulingPort } from './ports.js';
import {
  scanProjectForBaseline,
  generateBaselineWithAi,
  readJsonFile,
  safeReadTopLevelEntries,
  collectInterestingDependencies,
  type BaselineGenerationMode,
  type BaselineLanguage,
  type BaselineInitOptions,
  type BaselineInitResult,
} from './baseline-generator.js';
import {
  renderExecutionPlanMarkdown,
  renderTasksMarkdown,
  renderAcceptanceMarkdown,
  renderSyncLogMarkdown,
} from './change-markdown-renderer.js';

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
  private taskEventDispatcher: EventDispatcher<SupervisionTaskEvent>;
  private agentManager: SupervisorAgentManager;
  private contextService: SupervisorContextService;

  constructor(
    private db: Database,
    private taskRepo: SupervisionTaskRepository,
    private projectRepo: SupervisionProjectPort,
    private sessionRepo: SupervisionSessionPort,
    private sessionModel: SupervisionSessionModelPort,
    private broadcastFn: (msg: ServerMessage) => void,
    private aiRunPort: SupervisionAiRunPort,
    private changeRepo: ProjectChangeRepository = new ProjectChangeRepository(db),
    private gateReviewRepo: ChangeGateReviewRepository = new ChangeGateReviewRepository(db),
    private syncRunRepo: ChangeSyncRunRepository = new ChangeSyncRunRepository(db),
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
      this.aiRunPort,
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

    this.taskEventDispatcher = new EventDispatcher<SupervisionTaskEvent>();

    this.taskLifecycle = new TaskLifecycle({
      taskRepo,
      projectRepo,
      sessionRepo,
      sessionModel: this.sessionModel,
      taskRunner: this.taskRunner,
      worktreeManager: this.worktreeManager,
      virtualClients: this.virtualClients,
      dispatcher: this.taskEventDispatcher,
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
      sessionModel: this.sessionModel,
      dispatcher: this.taskEventDispatcher,
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
      sessionModel: this.sessionModel,
      taskScheduler: this.taskScheduler,
      worktreeManager: this.worktreeManager,
      virtualClients: this.virtualClients,
      aiRunPort: this.aiRunPort,
      dispatcher: this.taskEventDispatcher,
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

  start(intervalMs = 5000, registry?: SupervisionSchedulingPort): void {
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
      changeId?: string;
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
    const activeChange = data.changeId
      ? this.changeRepo.findById(data.changeId)
      : this.changeRepo.findActiveByProjectId(projectId);
    if (data.changeId) {
      if (!activeChange) {
        throw new Error(`Change not found: ${data.changeId}`);
      }
      if (activeChange.projectId !== projectId) {
        throw new Error(`Change ${data.changeId} does not belong to project ${projectId}`);
      }
    }
    const task = this.taskAdmin.createTask(projectId, {
      ...data,
      changeId: activeChange?.id ?? 'legacy-default',
    });
    if (activeChange) {
      this.syncChangeArtifacts(activeChange.id);
    }
    return task;
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

  getTasks(projectId: string, changeId?: string): SupervisionTask[] {
    if (changeId) {
      return this.taskRepo.findByChangeId(projectId, changeId);
    }
    return this.taskRepo.findByProjectId(projectId);
  }

  // ========================================
  // Change management
  // ========================================

  async initBaseline(
    projectId: string,
    options: BaselineInitOptions = {},
  ): Promise<BaselineInitResult> {
    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      throw new Error(`Project ${projectId} has no rootPath`);
    }

    const mode = options.mode ?? 'template';
    const language = options.language ?? 'zh-CN';
    const force = options.force === true;
    const manager = this.getContextManager(projectId, project.rootPath);
    manager.scaffoldBaseline(project.name);

    if (mode === 'template' && !force) {
      return {
        initialized: true,
        mode,
        language,
        usedAi: false,
        regenerated: false,
      };
    }

    const scanned = this.scanProjectForBaseline(project.rootPath, project.name, language);
    const generated = mode === 'ai_scan'
      ? await this.generateBaselineWithAi(projectId, project.rootPath, scanned, {
          providerId: options.providerId,
          language,
        })
      : scanned;

    manager.updateStructuredDocument(
      'baseline/project.md',
      {
        kind: 'baseline',
        section: 'project',
        status: 'draft',
        updatedAt: new Date().toISOString(),
        generationMode: mode,
        language,
        generatedBy: mode === 'ai_scan' ? 'ai' : 'scan',
      },
      generated.projectMd,
    );
    manager.updateStructuredDocument(
      'baseline/architecture.md',
      {
        kind: 'baseline',
        section: 'architecture',
        status: 'draft',
        updatedAt: new Date().toISOString(),
        generationMode: mode,
        language,
        generatedBy: mode === 'ai_scan' ? 'ai' : 'scan',
      },
      generated.architectureMd,
    );

    this.log(projectId, 'context_updated', {
      docType: 'baseline_init',
      mode,
      language,
      providerId: options.providerId,
      regenerated: force,
    });

    return {
      initialized: true,
      mode,
      language,
      usedAi: mode === 'ai_scan',
      regenerated: force || mode !== 'template',
    };
  }

  createChange(
    projectId: string,
    data: {
      title: string;
      summary: string;
      motivation?: string;
      nonGoals?: string[];
      scope?: string[];
      acceptanceCriteria?: string[];
    },
  ): ProjectChange {
    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      throw new Error(`Project ${projectId} has no rootPath`);
    }
    const manager = this.getContextManager(projectId, project.rootPath);
    manager.scaffoldBaseline(project.name);
    const change = this.changeRepo.create({ projectId, ...data });
    manager.scaffoldChangeWorkspace({
      id: change.id,
      title: change.title,
      summary: change.summary,
    });
    this.syncChangeArtifacts(change.id);
    this.log(projectId, 'change_created', { changeId: change.id, title: change.title });
    return change;
  }

  getChanges(projectId: string): ProjectChange[] {
    return this.changeRepo.findByProjectId(projectId);
  }

  getActiveChange(projectId: string): ProjectChange | undefined {
    return this.changeRepo.findActiveByProjectId(projectId);
  }

  getChange(changeId: string): ProjectChange | undefined {
    return this.changeRepo.findById(changeId);
  }

  getExecutionPlan(changeId: string): ChangeExecutionPlan {
    const change = this.changeRepo.findById(changeId);
    if (!change) {
      throw new Error(`Change not found: ${changeId}`);
    }
    return {
      changeId,
      designVersion: 1,
      summary: change.summary,
      automation: {
        strategy: 'serial',
        autoReview: true,
        autoRetry: true,
        autoSyncDraft: true,
      },
      verification: [],
      updatedAt: change.updatedAt,
    };
  }

  requestDesignGate(changeId: string, notes?: string): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) throw new Error(`Change not found: ${changeId}`);
    this.gateReviewRepo.request(changeId, 'design', notes);
    const updated = this.changeRepo.updateStatus(changeId, 'awaiting_design_review');
    this.syncChangeArtifacts(changeId);
    this.log(change.projectId, 'design_gate_requested', { changeId, notes });
    return updated;
  }

  resolveDesignGate(changeId: string, decision: DesignGateDecision, notes?: string): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) throw new Error(`Change not found: ${changeId}`);
    let updated: ProjectChange;
    if (decision === 'approve_design') {
      updated = this.changeRepo.updateFields(changeId, {
        status: 'planning',
        designApprovedAt: Date.now(),
      });
      this.gateReviewRepo.resolve(changeId, 'design', 'approved', decision, notes);
    } else if (decision === 'revise_design') {
      updated = this.changeRepo.updateStatus(changeId, 'designing');
      this.gateReviewRepo.resolve(changeId, 'design', 'revision_requested', decision, notes);
    } else {
      updated = this.changeRepo.updateStatus(changeId, 'draft');
      this.gateReviewRepo.resolve(changeId, 'design', 'revision_requested', decision, notes);
    }
    this.syncChangeArtifacts(changeId);
    this.log(change.projectId, 'design_gate_resolved', { changeId, decision, notes });
    return updated;
  }

  requestExecutionGate(changeId: string, notes?: string): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) throw new Error(`Change not found: ${changeId}`);
    this.gateReviewRepo.request(changeId, 'execution', notes);
    const updated = this.changeRepo.updateStatus(changeId, 'awaiting_execution_review');
    this.syncChangeArtifacts(changeId);
    this.log(change.projectId, 'execution_gate_requested', { changeId, notes });
    return updated;
  }

  resolveExecutionGate(changeId: string, decision: ExecutionGateDecision, notes?: string): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) throw new Error(`Change not found: ${changeId}`);
    let updated: ProjectChange;
    if (decision === 'approve_execution') {
      updated = this.changeRepo.updateFields(changeId, {
        status: 'executing',
        executionApprovedAt: Date.now(),
      });
      this.gateReviewRepo.resolve(changeId, 'execution', 'approved', decision, notes);
    } else if (decision === 'revise_plan') {
      updated = this.changeRepo.updateStatus(changeId, 'planning');
      this.gateReviewRepo.resolve(changeId, 'execution', 'revision_requested', decision, notes);
    } else if (decision === 'revise_design') {
      updated = this.changeRepo.updateStatus(changeId, 'designing');
      this.gateReviewRepo.resolve(changeId, 'execution', 'revision_requested', decision, notes);
    } else {
      updated = this.changeRepo.updateStatus(changeId, 'draft');
      this.gateReviewRepo.resolve(changeId, 'execution', 'revision_requested', decision, notes);
    }
    this.syncChangeArtifacts(changeId);
    this.log(change.projectId, 'execution_gate_resolved', { changeId, decision, notes });
    return updated;
  }

  requestAcceptance(changeId: string, notes?: string): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) throw new Error(`Change not found: ${changeId}`);
    if (change.status !== 'executing') {
      throw new Error(`Cannot request acceptance when change is in status '${change.status}'`);
    }
    const updated = this.changeRepo.updateStatus(changeId, 'accepting');
    this.syncChangeArtifacts(changeId);
    this.log(change.projectId, 'change_acceptance_requested', { changeId, notes });
    return updated;
  }

  resolveAcceptance(changeId: string, decision: AcceptanceDecision, notes?: string): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) throw new Error(`Change not found: ${changeId}`);
    if (change.status !== 'accepting') {
      throw new Error(`Cannot resolve acceptance when change is in status '${change.status}'`);
    }
    let updated: ProjectChange;
    if (decision === 'approve_acceptance') {
      updated = this.changeRepo.updateStatus(changeId, 'syncing');
      this.syncRunRepo.create(changeId, notes ?? `Acceptance approved for ${change.title}`);
    } else {
      updated = this.changeRepo.updateStatus(changeId, 'executing');
    }
    this.syncChangeArtifacts(changeId);
    this.log(change.projectId, 'change_acceptance_resolved', { changeId, decision, notes });
    return updated;
  }

  requestChangeSync(changeId: string, summary?: string): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) throw new Error(`Change not found: ${changeId}`);
    if (change.status !== 'accepting') {
      throw new Error(`Cannot request sync when change is in status '${change.status}'`);
    }
    const updated = this.changeRepo.updateStatus(changeId, 'syncing');
    this.syncRunRepo.create(changeId, summary ?? `Sync requested for ${change.title}`);
    this.syncChangeArtifacts(changeId, summary);
    this.log(change.projectId, 'change_sync_requested', { changeId, summary: summary ?? null });
    return updated;
  }

  completeChange(changeId: string, summary?: string): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) throw new Error(`Change not found: ${changeId}`);
    if (change.status !== 'syncing') {
      throw new Error(`Cannot complete change when status is '${change.status}'`);
    }
    this.syncRunRepo.markApplied(changeId);
    const updated = this.changeRepo.updateFields(changeId, {
      status: 'completed',
      active: false,
      syncApprovedAt: Date.now(),
      completedAt: Date.now(),
    });
    this.syncChangeArtifacts(changeId, summary);
    this.log(change.projectId, 'change_sync_completed', { changeId, summary: summary ?? null });
    return updated;
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
    const task = this.taskAdmin.updateTask(taskId, data);
    if (task?.changeId) {
      this.syncChangeArtifacts(task.changeId);
    }
    return task;
  }

  private syncChangeArtifacts(changeId: string, syncSummary?: string): void {
    const change = this.changeRepo.findById(changeId);
    if (!change) return;
    const project = this.projectRepo.findById(change.projectId);
    if (!project?.rootPath) return;

    const manager = this.getContextManager(change.projectId, project.rootPath);
    const tasks = this.taskRepo.findByChangeId(change.projectId, change.id);
    const plan = this.getExecutionPlan(changeId);
    const latestSyncRun = this.syncRunRepo.findLatest(changeId);
    const now = new Date().toISOString();

    manager.updateStructuredDocument(`changes/${change.id}/execution.md`, {
      kind: 'execution',
      changeId: change.id,
      status: change.status,
      designVersion: plan.designVersion,
      updatedAt: now,
    }, this.renderExecutionPlanMarkdown(change, plan, tasks));

    manager.updateStructuredDocument(`changes/${change.id}/tasks.md`, {
      kind: 'tasks',
      changeId: change.id,
      status: tasks.length > 0 ? 'planned' : 'draft',
      updatedAt: now,
      taskCount: tasks.length,
    }, this.renderTasksMarkdown(change, tasks));

    manager.updateStructuredDocument(`changes/${change.id}/acceptance.md`, {
      kind: 'acceptance',
      changeId: change.id,
      status: change.status === 'completed'
        ? 'passed'
        : change.status === 'syncing'
          ? 'approved'
          : change.status === 'accepting'
            ? 'in_review'
            : (tasks.length > 0 && tasks.every((task) => ['approved', 'integrated'].includes(task.status)) ? 'ready' : 'pending'),
      updatedAt: now,
    }, this.renderAcceptanceMarkdown(change, tasks));

    manager.updateStructuredDocument(`changes/${change.id}/sync-log.md`, {
      kind: 'sync-log',
      changeId: change.id,
      status: latestSyncRun?.status ?? (change.status === 'completed' ? 'applied' : 'draft'),
      updatedAt: now,
    }, this.renderSyncLogMarkdown(change, latestSyncRun?.summary ?? syncSummary));
  }

  private renderExecutionPlanMarkdown(change: ProjectChange, plan: ChangeExecutionPlan, tasks: SupervisionTask[]): string {
    return renderExecutionPlanMarkdown(change, plan, tasks);
  }

  private renderTasksMarkdown(change: ProjectChange, tasks: SupervisionTask[]): string {
    return renderTasksMarkdown(change, tasks);
  }

  private renderAcceptanceMarkdown(change: ProjectChange, tasks: SupervisionTask[]): string {
    return renderAcceptanceMarkdown(change, tasks);
  }

  private renderSyncLogMarkdown(change: ProjectChange, summary?: string): string {
    return renderSyncLogMarkdown(change, summary);
  }

  // ========================================
  // Context management
  // ========================================

  getContextDocuments(projectId: string): ContextDocument[] {
    return this.contextService.getContextDocuments(projectId);
  }

  updateChangeDocument(
    changeId: string,
    docType: 'design' | 'execution' | 'tasks',
    content: string,
  ): ProjectChange {
    const change = this.changeRepo.findById(changeId);
    if (!change) {
      throw new Error(`Change not found: ${changeId}`);
    }
    const project = this.projectRepo.findById(change.projectId);
    if (!project?.rootPath) {
      throw new Error(`Project ${change.projectId} has no rootPath`);
    }

    const manager = this.getContextManager(change.projectId, project.rootPath);
    if (typeof (manager as { updateDocument?: unknown }).updateDocument === 'function') {
      manager.updateDocument(`changes/${change.id}/${docType}.md`, content, {
        category: docType,
        source: 'user',
      });
    } else {
      manager.updateStructuredDocument(
        `changes/${change.id}/${docType}.md`,
        { category: docType, source: 'user' },
        content,
      );
    }

    let updated = change;
    if (docType === 'design') {
      updated = this.changeRepo.updateFields(changeId, {
        status: 'designing',
        designApprovedAt: null,
        executionApprovedAt: null,
      });
    } else if (docType === 'execution') {
      updated = this.changeRepo.updateFields(changeId, {
        status: 'planning',
        executionApprovedAt: null,
      });
    }

    this.log(change.projectId, 'context_updated', {
      changeId,
      docType,
      docId: `changes/${change.id}/${docType}.md`,
    });
    return updated;
  }

  updateBaselineDocument(
    projectId: string,
    docType: 'project' | 'architecture',
    content: string,
  ): { projectId: string; docId: string } {
    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      throw new Error(`Project ${projectId} has no rootPath`);
    }

    const manager = this.getContextManager(projectId, project.rootPath);
    const docId = `baseline/${docType}.md`;
    if (typeof (manager as { updateDocument?: unknown }).updateDocument === 'function') {
      manager.updateDocument(docId, content, {
        category: 'baseline',
        source: 'user',
      });
    } else {
      manager.updateStructuredDocument(
        docId,
        { category: 'baseline', source: 'user' },
        content,
      );
    }

    this.log(projectId, 'context_updated', {
      docType,
      docId,
    });

    return { projectId, docId };
  }

  private scanProjectForBaseline(rootPath: string, projectName: string, language: BaselineLanguage) {
    return scanProjectForBaseline(rootPath, projectName, language);
  }

  private async generateBaselineWithAi(
    _projectId: string,
    rootPath: string,
    scanned: { projectMd: string; architectureMd: string },
    options: { providerId?: string; language: BaselineLanguage },
  ) {
    return generateBaselineWithAi(this.db, rootPath, scanned, options);
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
