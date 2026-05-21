import type { Express, RequestHandler } from 'express';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import type { ConnectedClient, ActiveRun } from '../conversation/transport/types.js';
import { sendMessage } from '../conversation/transport/broadcast.js';
import { registerProjectsDomain, ProjectRepository, type ProjectChangeEvent } from '../../domains/projects/index.js';
import {
  registerSessionsDomain,
  SessionRepository,
  buildTaskPlanningSession,
  buildTaskExecutingSessionPatch,
  buildTaskPlannedSessionPatch,
  buildTaskUnlockedSessionPatch,
  type SessionEventPublisherPort,
} from '../../domains/sessions/index.js';
import { registerProvidersDomain } from '../../domains/providers/index.js';
import { registerNotificationDomain } from '../../domains/notification-feed/index.js';
import { registerSupervisionDomain, type SupervisionAiRunPort, type SupervisionProjectPort, type SupervisionSessionPort, type SupervisionSessionModelPort } from '../../domains/supervision/index.js';
import { registerLocalPRDomain, type LocalPRAiSessionPort, type LocalPRSchedulingPort } from '../../domains/local-pr/index.js';
import { registerLocalIssueDomain } from '../../domains/local-issues/index.js';
import { registerTurnSummaryDomain } from '../../domains/turn-summaries/index.js';
import { registerAttachmentDomain } from '../../domains/attachments/index.js';
import { registerWorkflowDomain, WorkflowRunRepository, type WorkflowAiRunPort, type WorkflowSchedulingPort } from '../../domains/workflows/index.js';
import { PermissionWorkflowResolver } from '../../domains/workflows/index.js';
import { registerMetaWorkflow } from '../../domains/meta-workflow/register.js';
import { createWorktreeAllocatorFromSupervisor } from './meta-workflow-allocator.js';
import { registerPluginsDomain } from '../plugins/register.js';
import { toolRegistry, workflowStepRegistry, workflowTriggerRegistry } from '../plugins/index.js';
import { createAutomationRoutes } from '../../interfaces/http/automations.js';
import type { NotificationSender } from '../../infrastructure/push/notification-sender.js';
import type { NotificationService } from '../../domains/notification-feed/index.js';
import { PermissionBridge } from '../conversation/agent/permission-bridge.js';
import { AIRiskAnalysisAdapter } from '../conversation/agent/ai-risk-analysis-adapter.js';
import type { WorkflowRunEvent } from '../../domains/workflows/run-events.js';
import { createOneShotRuntime } from '../oneshot/index.js';
import { claudeReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/claude.js';
import { codexReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/codex.js';
import { cursorReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/cursor.js';
import { kimiReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/kimi.js';
import { opencodeReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/opencode.js';
import { ExecutorRegistry, ManualAdapter, ExecutorInstanceRepository } from '../../domains/executor/index.js';
import { ClassicAdapter } from '../../domains/executor/adapters/classic-adapter.js';
import { MetaWorkflowAdapter } from '../../domains/executor/adapters/meta-workflow-adapter.js';
import { SpecChangeRepository } from '../../domains/spec-change/spec-change-repository.js';
import { SpecChangeService, ArchiveService } from '../../domains/openspec/index.js';
import { registerIssueOrchestration, type IssueOrchestration } from '../../domains/issue-orchestration/index.js';


interface RegisterFeatureDomainsDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  clients: Map<string, ConnectedClient>;
  activeRuns: Map<string, ActiveRun>;
  localOnlyMiddleware: RequestHandler;
  broadcastPluginState: () => void;
  notificationSender: NotificationSender;
  handleProjectChanged: (event?: ProjectChangeEvent) => void;
  sessionEvents: SessionEventPublisherPort;
  supervisionAiRunPort: SupervisionAiRunPort;
  localPrAiSessionPort: LocalPRAiSessionPort;
  workflowAiRunPort: WorkflowAiRunPort;
  localPrScheduling: LocalPRSchedulingPort;
  workflowScheduling: WorkflowSchedulingPort;
}

export interface FeatureDomainsResult {
  supervisorService: import('../../domains/supervision/index.js').SupervisorService;
  workflowService: import('../../domains/workflows/index.js').WorkflowService;
  workflowEngine: import('../../domains/workflows/engine.js').WorkflowEngine;
  notificationsService: NotificationService;
  permissionBridge: PermissionBridge;
  cancelWorkflowRun: (runId: string) => void;
  oneShotRuntime: import('../oneshot/types.js').OneShotTaskRuntime;
  permissionWorkflowResolver: PermissionWorkflowResolver;
  metaWorkflowService: import('../../domains/meta-workflow/service.js').MetaWorkflowService;
  executorRegistry: ExecutorRegistry;
  executorInstanceRepo: ExecutorInstanceRepository;
  specChangeRepo: SpecChangeRepository;
  specChangeService: SpecChangeService;
  archiveService: ArchiveService;
  issueOrchestration: IssueOrchestration;
}

function broadcastToAuthenticatedClients(
  clients: Map<string, ConnectedClient>,
  message: unknown,
): void {
  clients.forEach((client) => {
    if (client.authenticated) {
      sendMessage(client.ws, message as any);
    }
  });
}

export function registerFeatureDomains(deps: RegisterFeatureDomainsDeps): FeatureDomainsResult {
  const {
    db,
    app,
    authMiddleware,
    clients,
    activeRuns,
    localOnlyMiddleware,
    broadcastPluginState,
    notificationSender,
    handleProjectChanged,
    sessionEvents,
    supervisionAiRunPort,
    localPrAiSessionPort,
    workflowAiRunPort,
    localPrScheduling,
    workflowScheduling,
  } = deps;

  registerProjectsDomain({ db, app, authMiddleware, onProjectChanged: handleProjectChanged });
  registerSessionsDomain({ app, authMiddleware, db, activeRuns, sessionEvents });
  registerProvidersDomain({ app, authMiddleware, db, toolRegistry });

  const {
    notificationService: notificationsService,
  } = registerNotificationDomain({
    db,
    app,
    authMiddleware,
    broadcastMessage: (msg) => broadcastToAuthenticatedClients(clients, msg),
    notificationSender,
  });

  const svProjectRepo = new ProjectRepository(db);
  const svSessionRepo = new SessionRepository(db);

  const supervisionProjectPort: SupervisionProjectPort = {
    findById: (id) => svProjectRepo.findById(id) ?? undefined,
    findAll: () => svProjectRepo.findAll(),
    update: (id, data) => svProjectRepo.update(id, {
      ...data,
      agent: data.agent === null ? undefined : data.agent,
    }),
  };
  const supervisionSessionPort: SupervisionSessionPort = {
    findById: (id) => svSessionRepo.findById(id) ?? undefined,
    create: (data) => svSessionRepo.create(data),
    update: (id, data) => svSessionRepo.update(id, data),
    findByProjectRole: (projectId, role) => svSessionRepo.findByProjectRole(projectId, role),
  };
  const supervisionSessionModel: SupervisionSessionModelPort = {
    buildTaskPlanningSession,
    buildTaskExecutingSessionPatch,
    buildTaskPlannedSessionPatch,
    buildTaskUnlockedSessionPatch,
  };

  const { supervisorService } = registerSupervisionDomain({
    db,
    app,
    authMiddleware,
    broadcast: (msg) => broadcastToAuthenticatedClients(clients, msg),
    activeRuns,
    aiRunPort: supervisionAiRunPort,
    systemTaskRegistry: localPrScheduling,
    projectPort: supervisionProjectPort,
    sessionPort: supervisionSessionPort,
    sessionModel: supervisionSessionModel,
  });

  registerLocalPRDomain({
    db,
    app,
    authMiddleware,
    broadcast: (_projectId, msg) => broadcastToAuthenticatedClients(clients, msg),
    onProjectChanged: handleProjectChanged,
    isWorktreeAvailable: (projectId) => {
      const pool = supervisorService.getWorktreePoolIfExists(projectId);
      if (!pool) return true;
      return pool.getStatus().available > 0;
    },
    startAISession: localPrAiSessionPort.startAISession,
    scheduling: localPrScheduling,
  });

  // Attachments must be registered before any domain that delegates cascade
  // cleanup to it (e.g. local issues calling attachmentService.deleteByOwner).
  const { attachmentService } = registerAttachmentDomain({
    db,
    app,
    authMiddleware,
    broadcast: (msg) => broadcastToAuthenticatedClients(clients, msg),
  });

  registerLocalIssueDomain({
    db,
    app,
    authMiddleware,
    broadcast: (_projectId, msg) => broadcastToAuthenticatedClients(clients, msg),
    hooks: {
      onDelete: (issueId) => {
        attachmentService.deleteByOwner('local_issue', issueId);
      },
    },
  });

  registerTurnSummaryDomain({
    db,
    app,
    authMiddleware,
  });

  // Permission bridge — connects workflow engine to conversation permission system
  const clearPendingPermissionFromActiveRun = (requestId: string): boolean => {
    for (const [, run] of activeRuns) {
      const pending = run.pendingPermissions.get(requestId);
      if (!pending) continue;
      if (pending.timeout) clearTimeout(pending.timeout);
      run.pendingPermissions.delete(requestId);
      run.db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
        .run('running', Date.now(), run.sessionId);
      return true;
    }
    return false;
  };

  const permissionBridge = new PermissionBridge({
    onWorkflowResolved: ({ requestId, decision, reason, context }) => {
      broadcastToAuthenticatedClients(clients, {
        type: 'permission_auto_resolved',
        requestId,
        sessionId: context.sessionId,
        behavior: decision === 'allow' ? 'approve' : 'deny',
        reason: reason || 'Auto-resolved by permission workflow',
      });
      clearPendingPermissionFromActiveRun(requestId);
    },
  });

  // --- OneShotTaskRuntime bootstrap (before AIRiskAnalysisAdapter which uses it) ---
  const oneShotRuntime = createOneShotRuntime({
    batchAdapters: [
      claudeReviewAdapter,
      codexReviewAdapter,
      cursorReviewAdapter,
      kimiReviewAdapter,
      opencodeReviewAdapter,
    ],
  });

  const aiRiskAnalysisPort = new AIRiskAnalysisAdapter(db, oneShotRuntime);

  const { workflowService, workflowEngine } = registerWorkflowDomain({
    db,
    app,
    authMiddleware,
    broadcast: (_projectId, msg) => broadcastToAuthenticatedClients(clients, msg),
    notificationService: notificationSender,
    workflowStepRegistry,
    workflowTriggerRegistry,
    systemTaskRegistry: workflowScheduling,
    aiRunPort: workflowAiRunPort,
    permissionBridge,
    aiRiskAnalysisPort,
  });
  const permissionWorkflowResolver = new PermissionWorkflowResolver(db, workflowService);
  app.use('/api/automations', authMiddleware, createAutomationRoutes(workflowService));

  // ── Permission workflow progress broadcasting ──
  // Subscribe to workflow engine events and translate to permission-specific messages.
  workflowEngine.dispatcher.onAny((event: WorkflowRunEvent) => {
    const payload = workflowEngine.getRunEventPayload(event.runId);
    if (!payload?.requestId || !payload?.sessionId) return;

    const requestId = payload.requestId as string;
    const sessionId = payload.sessionId as string;

    if (event.type === 'step_started' || event.type === 'step_completed' || event.type === 'step_failed') {
      const runDetail = workflowService.getRun(event.runId);
      if (!runDetail) return;

      const completedSteps = runDetail.stepRuns
        .filter(s => s.status === 'completed')
        .map(s => s.stepId);

      broadcastToAuthenticatedClients(clients, {
        type: 'permission_workflow_progress',
        requestId,
        sessionId,
        workflowRunId: event.runId,
        currentStep: {
          id: event.stepId,
          type: runDetail.stepRuns.find(s => s.stepId === event.stepId)?.stepType || 'unknown',
          status: event.type === 'step_started' ? 'running'
            : event.type === 'step_completed' ? 'completed' : 'failed',
          label: runDetail.stepRuns.find(s => s.stepId === event.stepId)?.stepId || event.stepId,
        },
        completedSteps,
        totalSteps: runDetail.stepRuns.length,
      });

      // Send ai_review_completed when ai_risk_analysis step finishes
      if (event.type === 'step_completed') {
        const stepRun = runDetail.stepRuns.find(s => s.stepId === event.stepId);
        if (stepRun?.stepType === 'ai_risk_analysis' && stepRun.output) {
          broadcastToAuthenticatedClients(clients, {
            type: 'ai_review_completed',
            requestId,
            sessionId,
            decision: stepRun.output.decision || 'uncertain',
            reasoning: stepRun.output.reasoning || '',
            confidence: stepRun.output.confidence ?? 0,
            metadata: stepRun.output.metadata,
          });
        }

        // When permission_decide step resolves the permission, notify the frontend
        // and clean up pendingPermissions (mirrors what handlePermissionDecision does)
        if (stepRun?.stepType === 'permission_decide' && stepRun.output?.resolved) {
          // PermissionBridge normally broadcasts and clears the pending request
          // before releasing the provider. Keep this fallback for older/custom
          // bridge implementations that only resolve the promise.
          if (clearPendingPermissionFromActiveRun(requestId)) {
            const decision = stepRun.output.decision === 'allow' || stepRun.output.decision === 'approve'
              ? 'approve' : 'deny';
            broadcastToAuthenticatedClients(clients, {
              type: 'permission_auto_resolved',
              requestId,
              sessionId,
              behavior: decision,
              reason: (stepRun.output.reason as string) || 'Auto-resolved by permission workflow',
            });
          }
        }
      }
    }
  });

  // Callback for cancelling a workflow run (used when user manually decides a permission)
  const cancelWorkflowRun = (runId: string): void => {
    workflowService.cancelRun(runId);
  };

  // ── Meta Workflow domain ──
  // defaultProjectId: use the first project in the database for Phase D MVP.
  // Phase E will wire per-run projectId through the full call stack.
  // TODO(Phase E): remove this fallback once per-run project context is available.
  const defaultProjectId = svProjectRepo.findAll()[0]?.id ?? 'default';
  const workflowRunRepository = new WorkflowRunRepository(db);

  // Adapt WorkflowAiRunPort → AiRunPort:
  // WorkflowAiRunPort.startVirtualRun requires clientId/sessionId and uses
  // onMessage: (msg: ServerMessage). AiRunPort uses optional args and a simpler
  // onMessage shape. This adapter bridges the two by generating synthetic IDs
  // and re-mapping message shapes.
  const metaWorkflowAiRunPort = {
    async startVirtualRun(args: {
      clientId?: string;
      sessionId?: string;
      input: string;
      workingDirectory?: string;
      providerId?: string;
      systemContext?: string;
      onMessage?: (m: { kind: string; content?: string }) => void;
    }): Promise<void> {
      const clientId = args.clientId ?? `meta-virtual-${Date.now()}`;
      const sessionId = args.sessionId ?? `meta-session-${Date.now()}`;
      const result = workflowAiRunPort.startVirtualRun({
        clientId,
        sessionId,
        input: args.input,
        workingDirectory: args.workingDirectory,
        providerId: args.providerId,
        systemContext: args.systemContext,
        onMessage: (msg) => {
          if (!args.onMessage) return;
          const m = msg as { type?: string; kind?: string; content?: string; data?: unknown };
          // Map ServerMessage shape to AiRunPort's simpler {kind, content} shape.
          const kind = m.kind ?? m.type ?? 'unknown';
          const content = typeof m.content === 'string' ? m.content : undefined;
          args.onMessage({ kind, content });
        },
      });
      if (result instanceof Promise) await result;
    },
  };

  const metaWorkflow = registerMetaWorkflow({
    db,
    workflowEngine,
    workflowRunRepository,
    aiRunPort: metaWorkflowAiRunPort,
    worktreeAllocator: createWorktreeAllocatorFromSupervisor(supervisorService, defaultProjectId),
    defaultProjectId,
  });
  app.use('/api/meta-workflow', authMiddleware, metaWorkflow.routes);

  registerPluginsDomain({
    app,
    authMiddleware,
    localOnlyMiddleware,
    db,
    activeRuns,
    clients,
    broadcastPluginState,
  });

  // ── G1: OpenSpec foundation registries (no-op for existing flows) ──
  // Constructs an ExecutorRegistry and registers the three adapter factories
  // (manual / classic / meta-workflow). Downstream phases (G3+) will resolve
  // executors via this registry; for G1 the wiring is purely structural so
  // existing flows keep working unchanged. 'superpowers' is deliberately
  // omitted here — G6+ may add it.
  const executorRegistry = new ExecutorRegistry();
  const executorInstanceRepo = new ExecutorInstanceRepository(db);
  const specChangeRepo = new SpecChangeRepository(db);
  const changeLifecycle = supervisorService.getChangeLifecycle();
  const metaWorkflowService = metaWorkflow.service;

  executorRegistry.register('manual', (instance) => new ManualAdapter(db, instance));
  executorRegistry.register('classic', (instance) => new ClassicAdapter(db, changeLifecycle, instance));
  executorRegistry.register('meta-workflow', (instance) => new MetaWorkflowAdapter(db, metaWorkflowService, instance));

  // ── G2/G3: OpenSpec SpecChange / Archive services + Issue orchestration ──
  // Wires SpecChangeService, ArchiveService, and the full issue-orchestration
  // bag (ExecutorService + IssueLifecycle + IssueStatusPropagator +
  // AnonymousIssueService) and installs the propagator subscriber.
  //
  // NOTE: `getProjectRoot` is a placeholder that throws. G3 has no UI yet, so
  // nothing exercises these services through the bootstrap; tests construct
  // their own services with injected `getProjectRoot`. G5 will replace this
  // with a real lookup against ProjectService (or whatever project-root
  // registry exists at that point) once the UI consumes these services.
  // TODO(G5): wire `getProjectRoot` to ProjectService.getRoot(projectId).
  const getProjectRootPlaceholder = (projectId: string): string => {
    throw new Error(
      `[issue-orchestration] getProjectRoot not yet wired for project ${projectId} — to be implemented in G5`,
    );
  };
  const specChangeService = new SpecChangeService({
    db,
    getProjectRoot: getProjectRootPlaceholder,
  });
  const archiveService = new ArchiveService({
    db,
    getProjectRoot: getProjectRootPlaceholder,
  });
  const issueOrchestration = registerIssueOrchestration({
    db,
    registry: executorRegistry,
    specChangeService,
    archiveService,
  });

  return {
    supervisorService,
    workflowService,
    workflowEngine,
    notificationsService,
    permissionBridge,
    cancelWorkflowRun,
    oneShotRuntime,
    permissionWorkflowResolver,
    metaWorkflowService,
    executorRegistry,
    executorInstanceRepo,
    specChangeRepo,
    specChangeService,
    archiveService,
    issueOrchestration,
  };
}
