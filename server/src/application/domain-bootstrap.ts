/**
 * Domain registration and route mounting.
 *
 * Thin composition root for domain wiring and platform routes.
 */
import type { Express } from 'express';
import type { RequestHandler } from 'express';
import type { initDatabase } from '../infrastructure/storage/db.js';
import { createFilesRoutes } from '../interfaces/http/files.js';
import { createCommandsRoutes } from '../interfaces/http/commands.js';
import { createImportRoutes } from '../interfaces/http/import.js';
import { createOpenCodeImportRoutes } from '../interfaces/http/import-opencode.js';
import { createAgentRoutes } from '../interfaces/http/agent.js';
import { createClaudiaRoutes } from '../interfaces/http/claudia.js';
import { createDelegationRoutes } from '../interfaces/http/delegation.js';
import type { NotificationService } from '../domains/notification-feed/index.js';
import type { ProcessSupervisor } from '../infrastructure/services/process-supervisor.js';
import { systemTaskRegistry } from '../application/services/system-task-registry.js';
import type { SupervisorService } from '../domains/supervision/index.js';
import type { NotificationSender } from '../infrastructure/push/notification-sender.js';
import { registerInteractionTools } from '../application/conversation/interactions/interaction-tools.js';
import { registerAgentTools } from '../application/conversation/agent-tools/index.js';
import { registerOrchestrationDomain } from '../application/orchestration/register.js';
import { pluginEvents } from '../infrastructure/events/index.js';
import { localOnlyMiddleware } from '../interfaces/http/middleware/local-only.js';
import { sendMessage } from '../application/conversation/transport/broadcast.js';
import { getNextOffset } from '../application/conversation/runtime/run-lifecycle.js';
import { createVirtualClient, type ConnectedClient, type ActiveRun } from '../application/conversation/transport/types.js';
import { registerInteractionDomain } from '../application/conversation/interactions/register.js';
import type { GatewayState } from '../infrastructure/gateway/gateway-state.js';
import { createDomainPorts } from './bootstrap/domain-ports.js';
import { registerFeatureDomains } from './bootstrap/feature-domains.js';
import { registerPlatformRoutes } from './bootstrap/platform-routes.js';

export interface BootstrapDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  clients: Map<string, ConnectedClient>;
  activeRuns: Map<string, ActiveRun>;
  broadcastPluginState: () => void;
  broadcastHeartbeat: () => void;
  handleRunStart: (...args: any[]) => Promise<void>;
  getServerPort: () => number | null;
  notificationSender: NotificationSender;
  processSupervisor: ProcessSupervisor;
  gateway: GatewayState;
}

export interface BootstrapResult {
  supervisorService: SupervisorService;
  notificationsService: NotificationService;
  orchestrator: import('../application/orchestration/types.js').TaskOrchestrator;
  permissionBridge: import('./conversation/agent/permission-bridge.js').PermissionBridge;
  cancelWorkflowRun: (runId: string) => void;
  permissionWorkflowResolver: import('../domains/workflows/index.js').PermissionWorkflowResolver;
}

export function bootstrapDomains(deps: BootstrapDeps): BootstrapResult {
  const {
    db,
    app,
    authMiddleware,
    clients,
    activeRuns,
    broadcastPluginState,
    broadcastHeartbeat,
    handleRunStart,
    getServerPort,
    notificationSender,
    processSupervisor,
    gateway,
  } = deps;

  const {
    handleProjectChanged,
    sessionEvents,
    supervisionAiRunPort,
    localPrAiSessionPort,
    workflowAiRunPort,
  } = createDomainPorts({
    db,
    handleRunStart,
    broadcastHeartbeat,
  });

  app.use('/api/files', authMiddleware, createFilesRoutes({
    sendMessage,
    getAuthenticatedClients: () => {
      const result: Array<{ ws: import('ws').WebSocket }> = [];
      clients.forEach((client) => {
        if (client.authenticated) {
          result.push({ ws: client.ws });
        }
      });
      return result;
    },
    db,
    getNextOffset: (sid: string) => getNextOffset(db, sid),
  }));
  app.use('/api/commands', authMiddleware, createCommandsRoutes());
  app.use('/api/agent', authMiddleware, createAgentRoutes(db));
  app.use('/api/delegation', authMiddleware, createDelegationRoutes(db));
  app.use('/api/claudia', authMiddleware, createClaudiaRoutes(db));
  app.use('/api/import', localOnlyMiddleware, createImportRoutes(db));
  app.use('/api/import', localOnlyMiddleware, createOpenCodeImportRoutes(db));

  const {
    supervisorService,
    workflowEngine,
    notificationsService,
    permissionBridge,
    cancelWorkflowRun,
    oneShotRuntime,
    permissionWorkflowResolver,
  } = registerFeatureDomains({
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
    localPrScheduling: systemTaskRegistry,
    workflowScheduling: systemTaskRegistry,
  });

  registerPlatformRoutes({
    app,
    db,
    authMiddleware,
    localOnlyMiddleware,
    processSupervisor,
    gateway,
    getServerPort,
    oneShotRuntime,
    workflowEngine,
    permissionWorkflowResolver,
  });

  registerInteractionTools({
    getServerPort,
  });

  registerAgentTools({
    getDb: () => db,
    getProcessSupervisor: () => processSupervisor,
  });

  import('../application/conversation/agent-tools/browser.js').then(m => m.registerBrowserTool());

  const { orchestrator } = registerOrchestrationDomain({
    db,
    clients,
    handleRunStart,
    createVirtualClient,
    getServerPort,
    notificationService: notificationsService,
  });

  pluginEvents.on('run.completed', (event: any) => {
    try {
      const { recordActivity } = require('../memory/activity-log.js');
      const session = db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(event.sessionId) as { project_id: string } | undefined;
      recordActivity(db, {
        projectId: session?.project_id ?? null,
        sessionId: event.sessionId,
        type: 'run_completed',
        summary: `Run completed (${event.usage?.outputTokens ?? 0} output tokens)`,
        metadata: { runId: event.runId, usage: event.usage },
      });
    } catch {
      // Activity log is best-effort, don't break run completion
    }
  });

  registerInteractionDomain({ activeRuns, clients });

  return {
    supervisorService,
    notificationsService,
    orchestrator,
    permissionBridge,
    cancelWorkflowRun,
    permissionWorkflowResolver,
  };
}
