/**
 * Server HTTP route mounting and service initialization.
 *
 * This file is the primary Express/REST API assembly point.
 * It is intentionally separate from `server/src/router`, which is the WebSocket
 * message router used for shared-protocol request.type dispatch.
 */
import type { Express, Request, Response } from 'express';
import { request as httpRequest, type IncomingMessage } from 'http';
import { request as httpsRequest } from 'https';
import { pipeline } from 'stream';
import type { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type {
  ClientMessage,
  ErrorMessage,
  AuthResultMessage,
} from '@my-claudia/shared/protocol/messages';
import type { Request as CorrelatedRequest } from '@my-claudia/shared/protocol/correlation';
import { ALL_SERVER_FEATURES } from '@my-claudia/shared/core/server';
import type { initDatabase } from './infrastructure/storage/db.js';
import type { ProjectChangeEvent } from './domains/projects/routes.js';
import { createFilesRoutes } from './interfaces/http/files.js';
import { createCommandsRoutes } from './interfaces/http/commands.js';
import { createGatewayRouter, type GatewayConfig, type GatewayStatus } from './interfaces/http/gateway.js';
import { createImportRoutes } from './interfaces/http/import.js';
import { createOpenCodeImportRoutes } from './interfaces/http/import-opencode.js';
import { createAgentRoutes } from './interfaces/http/agent.js';
import { createClaudiaRoutes } from './interfaces/http/claudia.js';
import { handleMcpRequest, handleMcpSse, handleMcpSessionClose, getMcpServerInfo } from './mcp/mcp-server.js';
import { createDelegationRoutes } from './interfaces/http/delegation.js';
import type { NotificationService } from './domains/notification-feed/service.js';
import { createMcpServerRoutes } from './interfaces/http/mcp-servers.js';
import { createSystemStatsRoutes } from './interfaces/http/system-stats.js';
import { createDebugRoutes } from './interfaces/http/debug.js';
import { ProcessSupervisor, setGlobalProcessSupervisor } from './services/process-supervisor.js';
import { createSystemTaskRoutes } from './interfaces/http/system-tasks.js';
import { registerLocalPRDomain } from './domains/local-pr/register.js';
import { registerSupervisionDomain } from './domains/supervision/register.js';
import { createWorkspaceRoutes } from './interfaces/http/workspace.js';
import type { LocalPRService } from './domains/local-pr/service.js';
import { registerWorkflowDomain } from './domains/workflows/register.js';
import { registerSessionsDomain } from './domains/sessions/register.js';
import { registerProvidersDomain } from './domains/providers/register.js';
import { registerPluginsDomain } from './application/plugins/register.js';
import { workflowStepRegistry, toolRegistry, workflowTriggerRegistry } from './application/plugins/index.js';
import { registerProjectsDomain } from './domains/projects/register.js';
import { createAutomationRoutes } from './interfaces/http/automations.js';
import { systemTaskRegistry } from './services/system-task-registry.js';
import type { SupervisorService } from './domains/supervision/supervisor-service.js';
import { PushNotificationService } from './infrastructure/push/push-notification-service.js';
import { registerInteractionTools } from './application/conversation/interactions/interaction-tools.js';
import { registerAgentTools } from './application/conversation/agent-tools/index.js';
import { registerOrchestrationDomain } from './application/orchestration/register.js';
import { pluginEvents } from './infrastructure/events/index.js';
import { isLocalhost, localOnlyMiddleware } from './middleware/local-only.js';
import { createExpressAuthMiddleware } from './middleware/express-auth.js';
import { getPublicKeyPem } from './utils/crypto.js';
import { getSdkVersionReport } from './utils/sdk-version-check.js';
import { getGatewayClient } from './infrastructure/gateway/gateway-instance.js';
import { ProcessMonitor } from './utils/process-monitor.js';
import { sendMessage, buildPluginStateMessage, bumpProjectsVersion } from './application/conversation/transport/broadcast.js';
import { getNextOffset } from './application/conversation/runtime/run-lifecycle.js';
import { createVirtualClient, type ConnectedClient, type ActiveRun } from './application/conversation/transport/types.js';
import type { createRouter } from './interfaces/websocket/index.js';
import { registerNotificationDomain } from './domains/notification-feed/register.js';
import { registerInteractionDomain } from './application/conversation/interactions/register.js';

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
  setNotificationService: (ns: PushNotificationService) => void;
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
  notificationService: PushNotificationService;
  supervisorService: SupervisorService;
  notificationsService: NotificationService;
  orchestrator: import('./application/orchestration/types.js').TaskOrchestrator;
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
  const processSupervisor = new ProcessSupervisor(db);
  setGlobalProcessSupervisor(processSupervisor);
  processSupervisor.start();

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Get server info (public - no auth required)
  app.get('/api/server/info', async (req: Request, res: Response) => {
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
    gatewayBackendId: null,
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
      gatewayBackendId: null,
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
      gatewayBackendId: null,
      gatewayUrl: null,
      gatewaySecret: null,
      backendName: null,
      registerAsBackend: true,
      discoveredBackends: []
    };
  };

  const updateGatewayBackendId = (backendId: string | null) => {
    gatewayStatus.gatewayBackendId = backendId;
    if (backendId) {
      db.prepare(`
        UPDATE gateway_config SET backend_id = ?, updated_at = ? WHERE id = 1
      `).run(backendId, Date.now());
    }
  };

  const updateGatewayConnected = (connected: boolean) => {
    gatewayStatus.connected = connected;
  };

  const authMiddleware = createExpressAuthMiddleware((token) => {
    const row = db.prepare(`
      SELECT client_id
      FROM servers
      WHERE client_id = ?
      LIMIT 1
    `).get(token) as { client_id: string } | undefined;

    return !!row?.client_id;
  });

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

  // HTTP API surface (protected by auth middleware).
  // This is the canonical REST mounting point; do not confuse it with server/src/router.
  registerProjectsDomain({ db, app, authMiddleware, onProjectChanged: handleProjectChanged });
  registerSessionsDomain({ app, authMiddleware, db, activeRuns });
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

  // Supervision domain
  const { supervisorService } = registerSupervisionDomain({
    db, app, authMiddleware,
    broadcast: (msg) => {
      clients.forEach((client) => { if (client.authenticated) sendMessage(client.ws, msg); });
    },
    activeRuns,
    createVirtualClient,
    handleRunStart,
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
    startAISession: (opts) => {
      const virtualClient = createVirtualClient(opts.clientId, { send: opts.onMessage });
      handleRunStart(virtualClient, {
        type: 'run_start',
        clientRequestId: `${opts.clientId}_${Date.now()}`,
        sessionId: opts.sessionId,
        input: opts.input,
        workingDirectory: opts.workingDirectory,
        providerId: opts.providerId,
      }, db);
    },
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
    systemTaskRegistry,
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
    getGatewayStatus,
    connectGateway,
    disconnectGateway
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
  import('./application/conversation/agent-tools/browser.js').then(m => m.registerBrowserTool());

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

  registerInteractionDomain({ activeRuns, clients });

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
      pushNotificationService.notify({
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
    setGlobalProcessSupervisor(null);
    processSupervisor.stop();
    supervisorService.stop();
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
    notificationService: pushNotificationService,
    supervisorService,
    notificationsService,
    orchestrator,
    onWssClose,
  };
}
