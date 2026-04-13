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
import { registerWorkflowDomain, type WorkflowAiRunPort, type WorkflowSchedulingPort } from '../../domains/workflows/index.js';
import { registerPluginsDomain } from '../plugins/register.js';
import { toolRegistry, workflowStepRegistry, workflowTriggerRegistry } from '../plugins/index.js';
import { createAutomationRoutes } from '../../interfaces/http/automations.js';
import type { NotificationSender } from '../../infrastructure/push/notification-sender.js';
import type { NotificationService } from '../../domains/notification-feed/index.js';
import { PermissionBridge } from '../conversation/agent/permission-bridge.js';
import { AIRiskAnalysisAdapter } from '../conversation/agent/ai-risk-analysis-adapter.js';
import type { WorkflowRunEvent } from '../../domains/workflows/run-events.js';


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
  notificationsService: NotificationService;
  permissionBridge: PermissionBridge;
  cancelWorkflowRun: (runId: string) => void;
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

  // Permission bridge — connects workflow engine to conversation permission system
  const permissionBridge = new PermissionBridge();
  const aiRiskAnalysisPort = new AIRiskAnalysisAdapter();

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
          const decision = stepRun.output.decision === 'allow' || stepRun.output.decision === 'approve'
            ? 'approve' : 'deny';
          broadcastToAuthenticatedClients(clients, {
            type: 'permission_auto_resolved',
            requestId,
            sessionId,
            behavior: decision,
            reason: (stepRun.output.reason as string) || 'Auto-resolved by permission workflow',
          });

          // Clean up pending permission from active run
          for (const [, run] of activeRuns) {
            if (run.pendingPermissions.has(requestId)) {
              run.pendingPermissions.delete(requestId);
              run.db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
                .run('running', Date.now(), run.sessionId);
              break;
            }
          }
        }
      }
    }
  });

  // Callback for cancelling a workflow run (used when user manually decides a permission)
  const cancelWorkflowRun = (runId: string): void => {
    workflowService.cancelRun(runId);
  };

  registerPluginsDomain({
    app,
    authMiddleware,
    localOnlyMiddleware,
    db,
    activeRuns,
    clients,
    broadcastPluginState,
  });

  return {
    supervisorService,
    workflowService,
    notificationsService,
    permissionBridge,
    cancelWorkflowRun,
  };
}
