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
import { PushNotificationService } from '../../infrastructure/push/push-notification-service.js';
import type { NotificationService } from '../../domains/notification-feed/index.js';

interface RegisterFeatureDomainsDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  clients: Map<string, ConnectedClient>;
  activeRuns: Map<string, ActiveRun>;
  localOnlyMiddleware: RequestHandler;
  broadcastPluginState: () => void;
  setPushNotificationService: (ns: PushNotificationService) => void;
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
  pushNotificationService: PushNotificationService;
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
    setPushNotificationService,
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
    pushNotificationService,
    notificationService: notificationsService,
  } = registerNotificationDomain({
    db,
    app,
    authMiddleware,
    broadcastMessage: (msg) => broadcastToAuthenticatedClients(clients, msg),
    setPushNotificationService,
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

  const { workflowService } = registerWorkflowDomain({
    db,
    app,
    authMiddleware,
    broadcast: (_projectId, msg) => broadcastToAuthenticatedClients(clients, msg),
    notificationService: pushNotificationService,
    workflowStepRegistry,
    workflowTriggerRegistry,
    systemTaskRegistry: workflowScheduling,
    aiRunPort: workflowAiRunPort,
  });
  app.use('/api/automations', authMiddleware, createAutomationRoutes(workflowService));

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
    pushNotificationService,
  };
}
