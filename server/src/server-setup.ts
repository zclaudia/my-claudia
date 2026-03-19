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
import { createServerRoutes } from './routes/servers.js';
import { createImportRoutes } from './routes/import.js';
import { createOpenCodeImportRoutes } from './routes/import-opencode.js';
import { createAgentRoutes } from './routes/agent.js';
import { createSupervisionRoutes } from './routes/supervision.js';
import { createNotificationRoutes } from './routes/notifications.js';
import { createPluginToolsRoutes } from './routes/plugin-tools.js';
import { createPluginRoutes } from './routes/plugins.js';
import { createMcpServerRoutes } from './routes/mcp-servers.js';
import { createSystemStatsRoutes } from './routes/system-stats.js';
import { createLocalPRRoutes } from './routes/local-prs.js';
import { createScheduledTaskRoutes } from './routes/scheduled-tasks.js';
import { createSystemTaskRoutes } from './routes/system-tasks.js';
import { createWorkspaceRoutes } from './routes/workspace.js';
import { LocalPRService } from './services/local-pr-service.js';
import { ScheduledTaskService } from './services/scheduled-task-service.js';
import { WorkflowService } from './services/workflow-service.js';
import { WorkflowGeneratorService } from './services/workflow-generator.js';
import { createWorkflowRoutes } from './routes/workflows.js';
import { SupervisorService } from './services/supervisor-service.js';
import { StateRecovery } from './services/state-recovery.js';
import { CheckpointEngine } from './services/checkpoint-engine.js';
import { ContextManager } from './services/context-manager.js';
import { SupervisionTaskRepository } from './repositories/supervision-task.js';
import { ProjectRepository } from './repositories/project.js';
import { SessionRepository } from './repositories/session.js';
import { NotificationService } from './services/notification-service.js';
import { registerInteractionTools } from './interactions/interaction-tools.js';
import { interactionDispatcher } from './interactions/interaction-dispatcher.js';
import { systemTaskRegistry } from './services/system-task-registry.js';
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
import { createVirtualClient } from './ws/types.js';
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
  updateGatewayBackendId: (backendId: string | null) => void;
  updateDiscoveredBackends: (backends: import('@my-claudia/shared').GatewayBackendInfo[]) => void;
  setGatewayConnector: (connector: (config: GatewayConfig) => Promise<void>) => void;
  setGatewayDisconnector: (disconnector: () => Promise<void>) => void;
  notificationService: NotificationService;
  supervisorService: SupervisorService;
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

  const authMiddleware = createExpressAuthMiddleware(() => gatewayStatus.gatewaySecret);

  // API routes (protected by auth middleware)
  app.use('/api/projects', authMiddleware, createProjectRoutes(db));
  app.use('/api/sessions', authMiddleware, createSessionRoutes(db, activeRuns));
  app.use('/api/sessions', authMiddleware, createSessionDraftRoutes(db));
  app.use('/api/providers', authMiddleware, createProviderRoutes(db));
  app.use('/api/servers', authMiddleware, createServerRoutes(db));
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
  app.use('/api/import', localOnlyMiddleware, createImportRoutes(db));
  app.use('/api/import', localOnlyMiddleware, createOpenCodeImportRoutes(db));

  // Supervision v2 routes + service
  const taskRepo = new SupervisionTaskRepository(db);
  const projectRepo = new ProjectRepository(db);
  const sessionRepo = new SessionRepository(db);
  const supervisorService = new SupervisorService(
    db, taskRepo, projectRepo, sessionRepo,
    (msg) => {
      clients.forEach((client) => {
        if (client.authenticated) {
          sendMessage(client.ws, msg);
        }
      });
    }
  );
  app.use('/api', authMiddleware, createSupervisionRoutes(supervisorService));
  app.use('/api/supervision', authMiddleware, createSupervisionRoutes(supervisorService));

  // Local PR workflow service + routes
  const localPRService = new LocalPRService(db, (projectId, message) => {
    clients.forEach((client) => {
      if (client.authenticated) sendMessage(client.ws, message);
    });
  }, (projectId) => {
    const pool = supervisorService.getWorktreePoolIfExists(projectId);
    if (!pool) return true;
    return pool.getStatus().available > 0;
  });
  app.use('/api', authMiddleware, createLocalPRRoutes(localPRService, db));

  // Scheduled task service + routes
  const scheduledTaskService = new ScheduledTaskService(db, (message) => {
    clients.forEach((client) => {
      if (client.authenticated) sendMessage(client.ws, message);
    });
  });
  app.use('/api', authMiddleware, createScheduledTaskRoutes(scheduledTaskService));
  app.use('/api', authMiddleware, createSystemTaskRoutes(scheduledTaskService.getTaskRunRepo()));

  // Notification routes + service
  const notificationService = new NotificationService(db);
  setNotificationService(notificationService);
  app.use('/api/notifications', authMiddleware, createNotificationRoutes(notificationService));

  // Workflow service + routes
  const workflowService = new WorkflowService(db, (projectId, message) => {
    clients.forEach((client) => {
      if (client.authenticated) sendMessage(client.ws, message);
    });
  }, notificationService);
  workflowService.initialize();
  const workflowGeneratorService = new WorkflowGeneratorService(db);
  app.use('/api', authMiddleware, createWorkflowRoutes(workflowService, workflowGeneratorService));

  // Plugin routes
  app.use('/api/plugins', authMiddleware, createPluginRoutes());
  app.use('/api/plugins', localOnlyMiddleware, createPluginToolsRoutes());

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

  // State recovery — re-hydrate stuck tasks before starting polling
  const stateRecovery = new StateRecovery(
    db, taskRepo, sessionRepo, projectRepo, supervisorService, activeRuns,
  );
  const recoveryReport = stateRecovery.recover();
  if (recoveryReport.actions.length > 0) {
    console.log(`[StateRecovery] Recovered ${recoveryReport.actions.length} items on startup`);
  }

  // CheckpointEngine
  const checkpointEngine = new CheckpointEngine(
    db, taskRepo, projectRepo, sessionRepo,
    (projectId: string) => {
      const project = projectRepo.findById(projectId);
      if (!project?.rootPath) throw new Error(`Project ${projectId} has no rootPath`);
      return new ContextManager(project.rootPath);
    },
    (msg) => {
      clients.forEach((client) => {
        if (client.authenticated) {
          sendMessage(client.ws, msg);
        }
      });
    },
    (projectId, event, detail, taskIdArg) => {
      const id = crypto.randomUUID();
      try {
        db.prepare(
          `INSERT INTO supervision_logs (id, project_id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, projectId, taskIdArg ?? null, event, detail ? JSON.stringify(detail) : null, Date.now());
      } catch { /* best effort */ }
    },
    (projectId, data) => supervisorService.createTask(projectId, data),
    createVirtualClient,
    handleRunStart as any,
  );
  supervisorService.setCheckpointEngine(checkpointEngine);

  // Start supervision v2 polling
  supervisorService.start(5000);

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

  // Auto-trigger Local PR when a regular session with a working directory completes
  pluginEvents.on('run.completed', async (data) => {
    try {
      const sessionId = data.sessionId as string | undefined;
      if (!sessionId) return;
      const sessionRow = db
        .prepare('SELECT project_id, type, working_directory FROM sessions WHERE id = ?')
        .get(sessionId) as { project_id: string; type: string; working_directory?: string } | undefined;
      if (!sessionRow?.working_directory || sessionRow.type !== 'regular') return;
      await localPRService.maybeAutoCreatePR(sessionRow.project_id, sessionRow.working_directory);
    } catch (err) {
      console.error('[LocalPR] Auto-trigger error:', err);
    }
  });

  // Register and start system tasks
  systemTaskRegistry.register({
    id: 'system:local_pr_scheduler',
    name: 'Local PR Scheduler',
    description: 'Processes pending local PR reviews and merges',
    category: 'scheduling',
    intervalMs: 10000,
  });
  setInterval(async () => {
    systemTaskRegistry.markRunStart('system:local_pr_scheduler');
    const start = Date.now();
    try {
      await localPRService.tick();
      systemTaskRegistry.markRunComplete('system:local_pr_scheduler', Date.now() - start);
    } catch (err) {
      systemTaskRegistry.markRunComplete('system:local_pr_scheduler', Date.now() - start, String(err));
      console.error('[LocalPR] Tick error:', err);
    }
  }, 10000);

  systemTaskRegistry.register({
    id: 'system:scheduled_task_engine',
    name: 'Scheduled Task Engine',
    description: 'Checks for due tasks and executes them',
    category: 'scheduling',
    intervalMs: 10000,
  });
  setInterval(async () => {
    systemTaskRegistry.markRunStart('system:scheduled_task_engine');
    const start = Date.now();
    try {
      await scheduledTaskService.tick();
      systemTaskRegistry.markRunComplete('system:scheduled_task_engine', Date.now() - start);
    } catch (err) {
      systemTaskRegistry.markRunComplete('system:scheduled_task_engine', Date.now() - start, String(err));
      console.error('[ScheduledTasks] Tick error:', err);
    }
  }, 10000);

  systemTaskRegistry.register({
    id: 'system:workflow_scheduler',
    name: 'Workflow Scheduler',
    description: 'Checks for due workflow schedules and starts runs',
    category: 'scheduling',
    intervalMs: 10000,
  });
  setInterval(async () => {
    systemTaskRegistry.markRunStart('system:workflow_scheduler');
    const start = Date.now();
    try {
      await workflowService.tick();
      systemTaskRegistry.markRunComplete('system:workflow_scheduler', Date.now() - start);
    } catch (err) {
      systemTaskRegistry.markRunComplete('system:workflow_scheduler', Date.now() - start, String(err));
      console.error('[Workflow] Tick error:', err);
    }
  }, 10000);

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
  };

  return {
    gatewayStatus,
    getGatewayStatus,
    connectGateway,
    disconnectGateway,
    updateGatewayBackendId,
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
    onWssClose,
  };
}
