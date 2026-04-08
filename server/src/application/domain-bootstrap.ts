/**
 * Domain registration and route mounting.
 *
 * Extracted from server-setup.ts — contains all domain registrations,
 * route mounting, port adapter creation, and orchestration wiring.
 */
import type { Express, Request, Response } from 'express';
import type { RequestHandler } from 'express';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { pipeline } from 'stream';
import type { initDatabase } from '../infrastructure/storage/db.js';
import type { ProjectChangeEvent } from '../domains/projects/index.js';
import { createFilesRoutes } from '../interfaces/http/files.js';
import { createCommandsRoutes } from '../interfaces/http/commands.js';
import { createGatewayRouter, type GatewayConfig, type GatewayStatus } from '../interfaces/http/gateway.js';
import { createImportRoutes } from '../interfaces/http/import.js';
import { createOpenCodeImportRoutes } from '../interfaces/http/import-opencode.js';
import { createAgentRoutes } from '../interfaces/http/agent.js';
import { createClaudiaRoutes } from '../interfaces/http/claudia.js';
import { handleMcpRequest, handleMcpSse, handleMcpSessionClose, getMcpServerInfo } from '../interfaces/mcp/mcp-server.js';
import { createDelegationRoutes } from '../interfaces/http/delegation.js';
import type { NotificationService } from '../domains/notification-feed/index.js';
import { createMcpServerRoutes } from '../interfaces/http/mcp-servers.js';
import { createDebugRoutes } from '../interfaces/http/debug.js';
import type { ProcessSupervisor } from '../infrastructure/services/process-supervisor.js';
import { createSystemTaskRoutes } from '../interfaces/http/system-tasks.js';
import { registerLocalPRDomain } from '../domains/local-pr/index.js';
import { registerSupervisionDomain, type SupervisionProjectPort, type SupervisionSessionPort, type SupervisionSessionModelPort } from '../domains/supervision/index.js';
import { ProjectRepository } from '../domains/projects/index.js';
import {
  SessionRepository,
  buildTaskPlanningSession,
  buildTaskExecutingSessionPatch,
  buildTaskPlannedSessionPatch,
  buildTaskUnlockedSessionPatch,
} from '../domains/sessions/index.js';
import { createWorkspaceRoutes } from '../interfaces/http/workspace.js';
import type { LocalPRService } from '../domains/local-pr/index.js';
import { registerWorkflowDomain } from '../domains/workflows/index.js';
import { registerSessionsDomain } from '../domains/sessions/index.js';
import { registerProvidersDomain } from '../domains/providers/index.js';
import { registerPluginsDomain } from '../application/plugins/register.js';
import { workflowStepRegistry, toolRegistry, workflowTriggerRegistry } from '../application/plugins/index.js';
import { registerProjectsDomain } from '../domains/projects/index.js';
import { createAutomationRoutes } from '../interfaces/http/automations.js';
import { systemTaskRegistry } from '../application/services/system-task-registry.js';
import type { SupervisorService } from '../domains/supervision/index.js';
import { PushNotificationService } from '../infrastructure/push/push-notification-service.js';
import { registerInteractionTools } from '../application/conversation/interactions/interaction-tools.js';
import { registerAgentTools } from '../application/conversation/agent-tools/index.js';
import { registerOrchestrationDomain } from '../application/orchestration/register.js';
import { pluginEvents } from '../infrastructure/events/index.js';
import { localOnlyMiddleware } from '../interfaces/http/middleware/local-only.js';
import { getGatewayClient } from '../infrastructure/gateway/gateway-instance.js';
import { sendMessage, bumpProjectsVersion } from '../application/conversation/transport/broadcast.js';
import { getNextOffset } from '../application/conversation/runtime/run-lifecycle.js';
import { createVirtualClient, type ConnectedClient, type ActiveRun } from '../application/conversation/transport/types.js';
import type { SessionEventPublisherPort } from '../domains/sessions/index.js';
import type { LocalPRAiSessionPort, LocalPRSchedulingPort } from '../domains/local-pr/index.js';
import type { SupervisionAiRunPort } from '../domains/supervision/index.js';
import type { WorkflowAiRunPort, WorkflowSchedulingPort } from '../domains/workflows/index.js';
import { registerNotificationDomain } from '../domains/notification-feed/index.js';
import { registerInteractionDomain } from '../application/conversation/interactions/register.js';
import { createSystemStatsRoutes } from '../interfaces/http/system-stats.js';
import type { GatewayState } from '../infrastructure/gateway/gateway-state.js';

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
  setNotificationService: (ns: PushNotificationService) => void;
  processSupervisor: ProcessSupervisor;
  gateway: GatewayState;
}

export interface BootstrapResult {
  supervisorService: SupervisorService;
  notificationsService: NotificationService;
  pushNotificationService: PushNotificationService;
  orchestrator: import('../application/orchestration/types.js').TaskOrchestrator;
}

export function bootstrapDomains(deps: BootstrapDeps): BootstrapResult {
  const {
    db, app, authMiddleware, clients, activeRuns,
    broadcastPluginState, broadcastHeartbeat,
    handleRunStart, getServerPort,
    setNotificationService, processSupervisor,
    gateway,
  } = deps;

  const handleProjectChanged = (event?: ProjectChangeEvent) => {
    bumpProjectsVersion();
    broadcastHeartbeat();

    if (!event) return;
    const gatewayClient = getGatewayClient();
    if (!gatewayClient) return;

    if (event.type === 'project_upsert') {
      gatewayClient.commands.backendData.broadcastProjectEvent('updated', event.project);
    } else {
      gatewayClient.commands.backendData.broadcastProjectEvent('deleted', { id: event.projectId });
    }
  };

  const sessionEvents: SessionEventPublisherPort = {
    publishSessionEvent: (type, session) => {
      const gatewayClient = getGatewayClient();
      gatewayClient?.commands.backendData.broadcastSessionEvent(type, session);
    },
  };

  const supervisionAiRunPort: SupervisionAiRunPort = {
    startVirtualRun: async ({ clientId, sessionId, input, workingDirectory, onMessage }) => {
      const virtualClient = createVirtualClient(clientId, { send: onMessage });
      await handleRunStart(virtualClient, {
        type: 'run_start',
        clientRequestId: `${clientId}_${Date.now()}`,
        sessionId,
        input,
        workingDirectory,
      }, db);
    },
  };

  const localPrAiSessionPort: LocalPRAiSessionPort = {
    startAISession: async ({ clientId, sessionId, input, workingDirectory, providerId, onMessage }) => {
      const virtualClient = createVirtualClient(clientId, { send: onMessage });
      await handleRunStart(virtualClient, {
        type: 'run_start',
        clientRequestId: `${clientId}_${Date.now()}`,
        sessionId,
        input,
        workingDirectory,
        providerId,
      }, db);
    },
  };

  const localPrScheduling: LocalPRSchedulingPort = systemTaskRegistry;

  const workflowAiRunPort: WorkflowAiRunPort = {
    startVirtualRun: async ({ clientId, sessionId, input, workingDirectory, providerId, systemContext, onMessage }) => {
      const virtualClient = createVirtualClient(clientId, { send: onMessage });
      await handleRunStart(virtualClient, {
        type: 'run_start',
        clientRequestId: clientId,
        sessionId,
        input,
        workingDirectory,
        providerId,
        systemContext,
      }, db);
    },
  };

  const workflowScheduling: WorkflowSchedulingPort = systemTaskRegistry;

  // HTTP API surface (protected by auth middleware).
  // This is the canonical REST mounting point; do not confuse it with server/src/router.
  registerProjectsDomain({ db, app, authMiddleware, onProjectChanged: handleProjectChanged });
  registerSessionsDomain({ app, authMiddleware, db, activeRuns, sessionEvents });
  registerProvidersDomain({ app, authMiddleware, db, toolRegistry });
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

  const {
    pushNotificationService,
    notificationService: notificationsService,
  } = registerNotificationDomain({
    db,
    app,
    authMiddleware,
    broadcastMessage: (msg) => {
      for (const client of clients.values()) {
        if (client.authenticated) sendMessage(client.ws, msg);
      }
    },
    setPushNotificationService: setNotificationService,
  });
  app.use('/api/claudia', authMiddleware, createClaudiaRoutes(db));
  app.use('/api/import', localOnlyMiddleware, createImportRoutes(db));
  app.use('/api/import', localOnlyMiddleware, createOpenCodeImportRoutes(db));

  // Supervision domain — construct cross-domain port adapters
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
    db, app, authMiddleware,
    broadcast: (msg) => {
      clients.forEach((client) => { if (client.authenticated) sendMessage(client.ws, msg); });
    },
    activeRuns,
    aiRunPort: supervisionAiRunPort,
    systemTaskRegistry,
    projectPort: supervisionProjectPort,
    sessionPort: supervisionSessionPort,
    sessionModel: supervisionSessionModel,
  });

  // Local PR domain
  const { localPRService } = registerLocalPRDomain({
    db, app, authMiddleware,
    broadcast: (projectId, msg) => {
      clients.forEach((client) => { if (client.authenticated) sendMessage(client.ws, msg); });
    },
    onProjectChanged: handleProjectChanged,
    isWorktreeAvailable: (projectId) => {
      const pool = supervisorService.getWorktreePoolIfExists(projectId);
      if (!pool) return true;
      return pool.getStatus().available > 0;
    },
    startAISession: localPrAiSessionPort.startAISession,
    scheduling: localPrScheduling,
  });

  // Workflow domain
  const { workflowService } = registerWorkflowDomain({
    db, app, authMiddleware,
    broadcast: (projectId, msg) => {
      clients.forEach((client) => { if (client.authenticated) sendMessage(client.ws, msg as any); });
    },
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

  // MCP server management routes
  app.use('/api/mcp-servers', authMiddleware, createMcpServerRoutes(db));

  // MCP Streamable HTTP endpoint — exposes all registered tools to external AI
  {
    app.post('/mcp', authMiddleware, async (req: Request, res: Response) => {
      await handleMcpRequest(req, res, req.body);
    });
    app.get('/mcp', authMiddleware, async (req: Request, res: Response) => {
      await handleMcpSse(req, res);
    });
    app.delete('/mcp', authMiddleware, async (req: Request, res: Response) => {
      await handleMcpSessionClose(req, res);
    });
    app.get('/mcp/info', authMiddleware, (_req: Request, res: Response) => {
      res.json(getMcpServerInfo());
    });
  }

  // MCP export config — returns JSON for external AI tools to connect
  app.get('/api/mcp-export', authMiddleware, (_req: Request, res: Response) => {
    const port = getServerPort() ?? 3100;
    res.json({
      claudia: {
        type: 'url',
        url: `http://localhost:${port}/mcp`,
      },
    });
  });

  // System stats + plugin storage reader (local only)
  app.use('/api/system', localOnlyMiddleware, createSystemStatsRoutes());
  app.use('/api/debug', localOnlyMiddleware, createDebugRoutes(processSupervisor));
  app.use('/api', authMiddleware, createSystemTaskRoutes());

  // Workspace routes (Agent personality configuration)
  app.use('/api/workspace', authMiddleware, createWorkspaceRoutes());

  app.use('/api/server/gateway', localOnlyMiddleware, createGatewayRouter(
    db,
    gateway.getGatewayStatus,
    gateway.connectGateway,
    gateway.disconnectGateway
  ));

  // Gateway relay: list available remote backends (local only)
  app.get('/api/gateway/backends', localOnlyMiddleware, async (_req: Request, res: Response) => {
    try {
      const clientMode: any = null; // GatewayClientMode removed in v2
      if (!clientMode || !clientMode.isConnected()) {
        res.json({ success: true, data: [] });
        return;
      }
      const backends = await clientMode.listBackends();
      res.json({ success: true, data: backends });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list backends' },
      });
    }
  });

  // Gateway relay: HTTP proxy to remote backend via gateway (local only)
  app.all('/api/gateway-proxy/:backendId/*', localOnlyMiddleware, async (req: Request, res: Response) => {
    const { backendId } = req.params;
    const subPath = req.params[0] || '';

    const gatewayClient = getGatewayClient();
    if (!gatewayClient || !gatewayClient.queries.connection.isConnected()) {
      res.status(502).json({
        success: false,
        error: { code: 'GATEWAY_NOT_CONNECTED', message: 'Gateway client not connected' },
      });
      return;
    }

    try {
      const targetUrl = `${gatewayClient.queries.connection.getGatewayUrl()}/api/proxy/${backendId}/${subPath}`;
      const qs = req.originalUrl.split('?')[1];
      const fullUrl = qs ? `${targetUrl}?${qs}` : targetUrl;

      const headers: Record<string, string> = {
        authorization: `Bearer ${gatewayClient.queries.connection.getGatewaySecret()}`,
      };
      for (const [key, value] of Object.entries(req.headers)) {
        const lowerKey = key.toLowerCase();
        if (value == null) continue;
        if (lowerKey === 'authorization' || lowerKey === 'host' || lowerKey === 'connection') continue;
        headers[key] = Array.isArray(value) ? value.join(', ') : value;
      }

      const agent = gatewayClient.queries.connection.createHttpAgent();
      const body = !['GET', 'HEAD'].includes(req.method)
        ? (Buffer.isBuffer(req.body)
          ? req.body
          : typeof req.body === 'string'
            ? Buffer.from(req.body)
            : req.body != null
              ? Buffer.from(JSON.stringify(req.body))
              : null)
        : null;
      if (body) {
        headers['content-length'] = String(body.length);
      } else {
        delete headers['content-length'];
      }

      const parsed = new URL(fullUrl);
      const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

      await new Promise<void>((resolve, reject) => {
        const proxyReq = transport(fullUrl, {
          method: req.method,
          headers,
          agent: agent || undefined,
        }, (upstream) => {
          res.status(upstream.statusCode || 502);
          for (const [key, val] of Object.entries(upstream.headers)) {
            if (!val || key.toLowerCase() === 'transfer-encoding') continue;
            res.setHeader(key, Array.isArray(val) ? val.join(', ') : val);
          }

          pipeline(upstream, res, (error) => {
            if (error && !res.writableEnded) {
              reject(error);
              return;
            }
            resolve();
          });
        });

        const abortUpstream = () => {
          proxyReq.destroy();
        };

        req.on('aborted', abortUpstream);
        res.on('close', abortUpstream);
        proxyReq.on('error', reject);
        proxyReq.on('close', () => {
          req.off('aborted', abortUpstream);
          res.off('close', abortUpstream);
        });

        if (body) {
          proxyReq.end(body);
        } else {
          proxyReq.end();
        }
      });
    } catch (error) {
      console.error(`[GatewayProxy] Error proxying to backend ${backendId}:`, error);
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      res.status(502).json({
        success: false,
        error: { code: 'PROXY_ERROR', message: 'Failed to proxy request to gateway' },
      });
    }
  });

  // Register internal interaction tools
  registerInteractionTools({
    getServerPort,
  });

  // Register agent assistant tools (scope: agent-assistant)
  registerAgentTools({
    getDb: () => db,
    getProcessSupervisor: () => processSupervisor,
  });

  // Register browser tool (lightweight URL fetcher)
  import('../application/conversation/agent-tools/browser.js').then(m => m.registerBrowserTool());

  const { orchestrator } = registerOrchestrationDomain({
    db,
    clients,
    handleRunStart,
    createVirtualClient,
    getServerPort,
    notificationService: notificationsService,
  });

  // Record activity log on run completion (Layer 1 — session-level summaries)
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
    pushNotificationService,
    orchestrator,
  };
}
