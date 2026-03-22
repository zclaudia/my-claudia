/**
 * Server route mounting and service initialization.
 * Extracted from createServer() to reduce file size.
 */
import type { Express, Request, Response } from 'express';
import { request as httpRequest, type IncomingMessage } from 'http';
import { request as httpsRequest } from 'https';
import type { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type {
  ClientMessage,
  ServerMessage,
  ErrorMessage,
  AuthResultMessage,
  Request as CorrelatedRequest,
} from '@my-claudia/shared';
import { ALL_SERVER_FEATURES } from '@my-claudia/shared';
import type { initDatabase } from './storage/db.js';
import { createProjectRoutes } from './routes/projects.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createSessionDraftRoutes } from './routes/sessionDrafts.js';
import { createProviderRoutes } from './routes/providers.js';
import { createFilesRoutes } from './routes/files.js';
import { createCommandsRoutes } from './routes/commands.js';
import { createGatewayRouter, type GatewayConfig, type GatewayStatus } from './routes/gateway.js';
import { createImportRoutes } from './routes/import.js';
import { createOpenCodeImportRoutes } from './routes/import-opencode.js';
import { createAgentRoutes } from './routes/agent.js';
import { createAgentFeedRoutes } from './routes/agent-feed.js';
import { createClaudiaRoutes } from './routes/claudia.js';
import { createAgentTriggerRoutes } from './routes/agent-triggers.js';
import { AgentFeedService } from './domains/agent-feed/service.js';
import { AgentTriggerService } from './domains/agent-triggers/service.js';
import { createDelegationRoutes } from './routes/delegation.js';
import { createNotificationRoutes } from './routes/notifications.js';
import { createPluginToolsRoutes } from './routes/plugin-tools.js';
import { createPluginRoutes } from './routes/plugins.js';
import { createMcpServerRoutes } from './routes/mcp-servers.js';
import { createSystemStatsRoutes } from './routes/system-stats.js';
import { registerLocalPRDomain } from './domains/local-pr/register.js';
import { registerSupervisionDomain } from './domains/supervision/register.js';
import { registerScheduledTaskDomain } from './domains/scheduled-tasks/register.js';
import { createWorkspaceRoutes } from './routes/workspace.js';
import type { LocalPRService } from './domains/local-pr/service.js';
import { registerWorkflowDomain } from './domains/workflows/register.js';
import type { SupervisorService } from './services/supervision/supervisor-service.js';
import { NotificationService } from './services/notification-service.js';
import { registerInteractionTools } from './interactions/interaction-tools.js';
import { registerAgentTools } from './agent-tools/index.js';
import { registerTaskTools } from './agent-tools/task-tools.js';
import { createTaskOrchestrator } from './orchestration/task-orchestrator.js';
import { interactionDispatcher } from './interactions/interaction-dispatcher.js';
import { pluginEvents } from './events/index.js';
import { pluginLoader } from './plugins/loader.js';
import { permissionManager as pluginPermissionManager } from './plugins/permissions.js';
import { isLocalhost, localOnlyMiddleware } from './middleware/local-only.js';
import { createExpressAuthMiddleware } from './middleware/express-auth.js';
import { getPublicKeyPem } from './utils/crypto.js';
import { getSdkVersionReport } from './utils/sdk-version-check.js';
import { getGatewayClientMode } from './gateway-instance.js';
import { ProcessMonitor } from './utils/process-monitor.js';
import { sendMessage, broadcastToOtherAuthenticatedClients, buildPluginStateMessage } from './ws/broadcast.js';
import { getNextOffset } from './ws/run-lifecycle.js';
import type { ConnectedClient, ActiveRun } from './ws/types.js';
import type { createRouter } from './router/index.js';

export interface SetupDependencies {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  router: ReturnType<typeof createRouter>;
  clients: Map<string, ConnectedClient>;
  activeRuns: Map<string, ActiveRun>;
  buildStateHeartbeat: () => import('@my-claudia/shared').StateHeartbeatMessage;
  broadcastHeartbeat: () => void;
  broadcastPluginState: () => void;
  handleRunStart: (...args: any[]) => Promise<void>;
  getServerPort: () => number | null;
  setNotificationService: (ns: NotificationService) => void;
  setProcessMonitor: (pm: ProcessMonitor) => void;
}

export interface SetupResult {
  gatewayStatus: GatewayStatus;
  getGatewayStatus: () => GatewayStatus;
  connectGateway: (config: GatewayConfig) => Promise<void>;
  disconnectGateway: () => Promise<void>;
  updateGatewayConnected: (connected: boolean) => void;
  updateGatewayBackendId: (backendId: string | null) => void;
  updateGatewayIdentity: (instanceId: string, deviceId: string) => void;
  updateDiscoveredBackends: (backends: import('@my-claudia/shared').GatewayBackendInfo[]) => void;
  setGatewayConnector: (connector: (config: GatewayConfig) => Promise<void>) => void;
  setGatewayDisconnector: (disconnector: () => Promise<void>) => void;
  notificationService: NotificationService;
  supervisorService: SupervisorService;
  agentFeedService: AgentFeedService;
  orchestrator: import('./orchestration/types.js').TaskOrchestrator;
  /** Cleanup function: call when WebSocket server closes */
  onWssClose: () => void;
}

export function setupRoutesAndServices(deps: SetupDependencies): SetupResult {
  const {
    db, app, router, clients, activeRuns,
    buildStateHeartbeat, broadcastHeartbeat, broadcastPluginState,
    handleRunStart, getServerPort,
    setNotificationService, setProcessMonitor,
  } = deps;

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Get server info (public - no auth required)
  app.get('/api/server/info', (req: Request, res: Response) => {
    const isLocal = isLocalhost(req);
    const publicKey = getPublicKeyPem();
    const sdkVersions = getSdkVersionReport();
    res.json({
      success: true,
      data: {
        version: '1.1.0',
        isLocalConnection: isLocal,
        features: ALL_SERVER_FEATURES,
        ...(publicKey && { publicKey }),
        ...(sdkVersions && { sdkVersions }),
      }
    });
  });

  // Gateway state (managed by index.ts)
  let gatewayStatus: GatewayStatus = {
    enabled: false,
    connected: false,
    backendId: null,
    gatewayUrl: null,
    gatewaySecret: null,
    backendName: null,
    registerAsBackend: true,
    discoveredBackends: []
  };

  let gatewayConnector: ((config: GatewayConfig) => Promise<void>) = async () => {
    console.warn('[Gateway] Gateway connector not implemented');
  };
  let gatewayDisconnector: (() => Promise<void>) = async () => {
    console.warn('[Gateway] Gateway disconnector not implemented');
  };

  const getGatewayStatus = () => gatewayStatus;

  const connectGateway = async (config: GatewayConfig) => {
    gatewayStatus = {
      enabled: true,
      connected: false,
      backendId: null,
      gatewayUrl: config.gatewayUrl,
      gatewaySecret: config.gatewaySecret,
      backendName: config.backendName,
      registerAsBackend: config.registerAsBackend !== false,
      discoveredBackends: []
    };
    await gatewayConnector(config);
  };

  const disconnectGateway = async () => {
    await gatewayDisconnector();
    gatewayStatus = {
      enabled: false,
      connected: false,
      backendId: null,
      gatewayUrl: null,
      gatewaySecret: null,
      backendName: null,
      registerAsBackend: true,
      discoveredBackends: []
    };
  };

  const updateGatewayBackendId = (backendId: string | null) => {
    gatewayStatus.backendId = backendId;
    if (backendId) {
      db.prepare(`
        UPDATE gateway_config SET backend_id = ?, updated_at = ? WHERE id = 1
      `).run(backendId, Date.now());
    }
  };

  const updateGatewayConnected = (connected: boolean) => {
    gatewayStatus.connected = connected;
  };

  const authMiddleware = createExpressAuthMiddleware(() => gatewayStatus.gatewaySecret);

  // API routes (protected by auth middleware)
  app.use('/api/projects', authMiddleware, createProjectRoutes(db));
  app.use('/api/sessions', authMiddleware, createSessionRoutes(db, activeRuns));
  app.use('/api/sessions', authMiddleware, createSessionDraftRoutes(db));
  app.use('/api/providers', authMiddleware, createProviderRoutes(db));
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

  let notificationService: NotificationService | null = null;

  // Agent Feed Service
  const agentFeedService = new AgentFeedService({
    db,
    broadcastFn: (msg) => {
      for (const client of clients.values()) {
        if (client.authenticated) sendMessage(client.ws, msg);
      }
    },
    notifyFn: (item) => {
      if (!notificationService) return;
      void notificationService.notify({
        type: item.status === 'failed' ? 'run_failed' : 'run_completed',
        title: item.title,
        body: item.summary || item.error || '',
        tags: ['agent', 'feed'],
      });
    },
  });
  app.use('/api/agent-feed', authMiddleware, createAgentFeedRoutes(agentFeedService));
  app.use('/api/claudia', authMiddleware, createClaudiaRoutes(db));
  app.use('/api/import', localOnlyMiddleware, createImportRoutes(db));
  app.use('/api/import', localOnlyMiddleware, createOpenCodeImportRoutes(db));

  // Supervision domain
  const { supervisorService } = registerSupervisionDomain({
    db, app, authMiddleware, clients, activeRuns, handleRunStart,
  });

  // Local PR domain
  const { localPRService } = registerLocalPRDomain({
    db, app, authMiddleware, clients,
    isWorktreeAvailable: (projectId) => {
      const pool = supervisorService.getWorktreePoolIfExists(projectId);
      if (!pool) return true;
      return pool.getStatus().available > 0;
    },
  });

  // Scheduled tasks domain
  const { scheduledTaskService } = registerScheduledTaskDomain({
    db, app, authMiddleware, clients,
  });

  // Notification routes + service
  notificationService = new NotificationService(db);
  setNotificationService(notificationService);
  app.use('/api/notifications', authMiddleware, createNotificationRoutes(notificationService));

  // Workflow domain
  registerWorkflowDomain({
    db, app, authMiddleware, clients, notificationService,
  });

  // Plugin routes
  app.use('/api/plugins', authMiddleware, createPluginRoutes());
  app.use('/api/plugins', localOnlyMiddleware, createPluginToolsRoutes({
    getActiveProfile: (sessionId) => {
      for (const run of activeRuns.values()) {
        if (run.sessionId === sessionId && !run.completed) {
          return run.effectiveProfile;
        }
      }
      return undefined;
    },
    getSessionType: (sessionId) => {
      const row = db.prepare('SELECT type FROM sessions WHERE id = ?').get(sessionId) as { type: string } | undefined;
      return row?.type;
    },
  }));

  // MCP server management routes
  app.use('/api/mcp-servers', authMiddleware, createMcpServerRoutes(db));

  // System stats + plugin storage reader (local only)
  app.use('/api/system', localOnlyMiddleware, createSystemStatsRoutes());

  // Workspace routes (Agent personality configuration)
  app.use('/api/workspace', authMiddleware, createWorkspaceRoutes());

  app.use('/api/server/gateway', localOnlyMiddleware, createGatewayRouter(
    db,
    getGatewayStatus,
    connectGateway,
    disconnectGateway
  ));

  // Gateway relay: list available remote backends (local only)
  app.get('/api/gateway/backends', localOnlyMiddleware, async (_req: Request, res: Response) => {
    try {
      const clientMode = getGatewayClientMode();
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

    const clientMode = getGatewayClientMode();
    if (!clientMode || !clientMode.isConnected()) {
      res.status(502).json({
        success: false,
        error: { code: 'GATEWAY_NOT_CONNECTED', message: 'Gateway client mode not connected' },
      });
      return;
    }

    try {
      const targetUrl = `${clientMode.gatewayUrl}/api/proxy/${backendId}/${subPath}`;
      const qs = req.originalUrl.split('?')[1];
      const fullUrl = qs ? `${targetUrl}?${qs}` : targetUrl;

      const headers: Record<string, string> = {
        'authorization': `Bearer ${clientMode.gatewaySecret}`,
        'content-type': req.headers['content-type'] || 'application/json',
      };
      if (req.headers['accept']) {
        headers['accept'] = req.headers['accept'] as string;
      }

      const agent = clientMode.createHttpAgent();
      const body = !['GET', 'HEAD'].includes(req.method) ? JSON.stringify(req.body) : undefined;

      const parsed = new URL(fullUrl);
      const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

      const proxyRes = await new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
        const proxyReq = transport(fullUrl, {
          method: req.method,
          headers,
          agent: agent || undefined,
        }, (upstream) => {
          const chunks: Buffer[] = [];
          upstream.on('data', (chunk: Buffer) => chunks.push(chunk));
          upstream.on('end', () => {
            const respHeaders: Record<string, string> = {};
            for (const [key, val] of Object.entries(upstream.headers)) {
              if (val && key.toLowerCase() !== 'transfer-encoding') {
                respHeaders[key] = Array.isArray(val) ? val.join(', ') : val;
              }
            }
            resolve({
              status: upstream.statusCode || 502,
              headers: respHeaders,
              body: Buffer.concat(chunks),
            });
          });
          upstream.on('error', reject);
        });
        proxyReq.on('error', reject);
        if (body) proxyReq.write(body);
        proxyReq.end();
      });

      res.status(proxyRes.status);
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        res.setHeader(key, value);
      }
      res.end(proxyRes.body);
    } catch (error) {
      console.error(`[GatewayProxy] Error proxying to backend ${backendId}:`, error);
      res.status(502).json({
        success: false,
        error: { code: 'PROXY_ERROR', message: 'Failed to proxy request to gateway' },
      });
    }
  });

  // Wire plugin loader broadcast for UI notifications
  pluginLoader.setBroadcast((msg: ServerMessage) => {
    clients.forEach((client) => {
      if (client.authenticated) {
        sendMessage(client.ws, msg);
      }
    });
  });

  // Register internal interaction tools
  registerInteractionTools({
    getServerPort,
  });

  // Register agent assistant tools (scope: agent-assistant)
  registerAgentTools({
    getDb: () => db,
  });

  // Register browser tool (lightweight URL fetcher)
  import('./agent-tools/browser.js').then(m => m.registerBrowserTool());

  // TaskOrchestrator — unified task orchestration (Phase 2: agent tasks only)
  const orchestrator = createTaskOrchestrator({
    db,
    handleRunStart,
    getClients: () => clients,
    serverPort: getServerPort(),
    agentFeedService,
    onTaskStatusChange: (task) => {
      if (task.initiator !== 'claudia') return;
      // Broadcast claudia_task_update to all authenticated clients
      const update: import('@my-claudia/shared').ClaudiaTaskUpdateMessage = {
        type: 'claudia_task_update',
        taskId: task.id,
        status: task.status as import('@my-claudia/shared').ClaudiaTaskStatus,
        sessionId: task.sessionId ?? undefined,
        input: task.task,
        title: task.task.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Claudia Task',
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        summary: task.resultSummary,
        error: task.errorSummary,
      };
      for (const [, client] of clients) {
        if (client.authenticated) sendMessage(client.ws, update);
      }
    },
  });
  // Register task orchestration tools (spawn_task, steer_task, etc.)
  registerTaskTools(orchestrator, () => db);

  // Start orchestrator ticker (10s, agent tasks only)
  orchestrator.start(10000);

  // Agent Trigger Service — bridges events and schedules to agent tasks
  const agentTriggerService = new AgentTriggerService({
    db,
    orchestrator,
    feedService: agentFeedService,
    pluginEvents,
  });
  scheduledTaskService.setAgentTriggerService(agentTriggerService);
  agentTriggerService.start();
  app.use('/api/agent-triggers', authMiddleware, createAgentTriggerRoutes(agentTriggerService));
  pluginLoader.agentTriggerService = agentTriggerService;

  // Record activity log on run completion (Layer 1 — session-level summaries)
  pluginEvents.on('run.completed', (event: any) => {
    try {
      const { recordActivity } = require('./memory/activity-log.js');
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

  // Wire interaction dispatcher to send events via WS
  interactionDispatcher.setSendFunction((sessionId, event) => {
    for (const [, run] of activeRuns) {
      if (run.sessionId === sessionId) {
        sendMessage(run.client.ws, event);
        if (clients) broadcastToOtherAuthenticatedClients(clients, run.clientId, event);
        return;
      }
    }
    console.warn(`[InteractionDispatcher] No active run for session ${sessionId}`);
  });

  // Broadcast plugin state when plugins are activated/deactivated/errored
  pluginEvents.on('plugin.activated', () => broadcastPluginState());
  pluginEvents.on('plugin.deactivated', () => broadcastPluginState());
  pluginEvents.on('plugin.error', () => broadcastPluginState());

  // Forward permission requests to connected frontends
  pluginPermissionManager.onRequest((request) => {
    const msg: import('@my-claudia/shared').PluginPermissionRequestMessage = {
      type: 'plugin_permission_request',
      pluginId: request.pluginId,
      pluginName: request.pluginName,
      permissions: request.permissions as string[],
    };
    clients.forEach((client) => {
      if (client.authenticated) {
        sendMessage(client.ws, msg);
      }
    });
  });

  // Periodic state heartbeat broadcast (every 30s)
  const heartbeatInterval = setInterval(() => {
    const heartbeat = buildStateHeartbeat();
    clients.forEach((client) => {
      if (client.authenticated) {
        sendMessage(client.ws, heartbeat);
      }
    });
  }, 30000);

  // Process leak monitor
  const processMonitor = new ProcessMonitor(
    () => activeRuns.size,
    (report) => {
      const pids = report.leakedProcesses.map(p => `PID=${p.pid}(${p.command}, ${p.elapsedSeconds}s)`).join(', ');
      console.warn(`[ProcessMonitor] Leaked processes detected (activeRuns=${report.activeRunCount}): ${pids}`);
      notificationService.notify({
        type: 'process_leak',
        title: 'Leaked processes detected',
        body: `${report.leakedProcesses.length} orphaned process(es) found: ${pids}`,
        priority: 'high',
        tags: ['warning'],
      });
    },
    {
      autoKill: false,
      minElapsedSeconds: 120,
      ignoreCommands: ['opencode', 'mcp-bridge', 'mcp-server'],
    },
  );
  processMonitor.start();
  setProcessMonitor(processMonitor);

  const onWssClose = () => {
    clearInterval(heartbeatInterval);
    processMonitor.stop();
    supervisorService.stop();
    agentTriggerService.stop();
  };

  return {
    gatewayStatus,
    getGatewayStatus,
    connectGateway,
    disconnectGateway,
    updateGatewayConnected,
    updateGatewayBackendId,
    updateGatewayIdentity: (instanceId: string, deviceId: string) => {
      gatewayStatus.instanceId = instanceId;
      gatewayStatus.currentDeviceId = deviceId;
    },
    updateDiscoveredBackends: (backends: import('@my-claudia/shared').GatewayBackendInfo[]) => {
      gatewayStatus.discoveredBackends = backends;
    },
    setGatewayConnector: (connector: (config: GatewayConfig) => Promise<void>) => {
      gatewayConnector = connector;
    },
    setGatewayDisconnector: (disconnector: () => Promise<void>) => {
      gatewayDisconnector = disconnector;
    },
    notificationService,
    supervisorService,
    agentFeedService,
    orchestrator,
    onWssClose,
  };
}
