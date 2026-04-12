import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer as createHttpServer, Server, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type {
  ClientMessage,
  ServerMessage,
  ErrorMessage,
  AuthResultMessage,
  StateHeartbeatMessage,
} from '@my-claudia/shared/protocol/messages';
import type { Request as CorrelatedRequest } from '@my-claudia/shared/protocol/correlation';
import { ALL_SERVER_FEATURES } from '@my-claudia/shared/core/server';
import { initDatabase } from './infrastructure/storage/db.js';
import { initFileStore } from './infrastructure/storage/fileStore.js';
import { initWorkspace } from './application/services/workspace.js';
import type { GatewayConfig, GatewayStatus } from './interfaces/http/gateway.js';
import { TerminalManager } from './terminal-manager.js';
import { generateKeyPair, getPublicKeyPem } from './utils/crypto.js';
import { pluginLoader } from './application/plugins/loader.js';
import type { ProcessMonitor } from './utils/process-monitor.js';
import type { NotificationSender } from './infrastructure/push/notification-sender.js';
import { GatewayNotificationSender } from './infrastructure/push/notification-sender.js';
import { ClaudiaBranchService } from './application/orchestration/claudia-branch-service.js';
import type { TaskCoordinationPort } from './application/conversation/task-coordination-port.js';
import type { SessionSyncPort } from './application/conversation/session-sync-port.js';
import { getGatewayClient } from './infrastructure/gateway/gateway-instance.js';
import { providerRegistry } from './infrastructure/providers/registry.js';

// WebSocket message-router architecture.
// This router is not the HTTP REST entrypoint; REST routes are mounted in server-setup.ts.
import { createRouter } from './interfaces/websocket/index.js';
import { loggingMiddleware as routerLoggingMiddleware } from './interfaces/http/middleware/logging.js';
import { errorHandlingMiddleware as routerErrorMiddleware } from './interfaces/http/middleware/error.js';
import { isLocalhost } from './interfaces/http/middleware/local-only.js';
import { expressErrorHandler } from './interfaces/http/middleware/express-error.js';

// Extracted modules
import type { ConnectedClient, ActiveRun, MessageSender } from './application/conversation/transport/types.js';
import { createVirtualClient } from './application/conversation/transport/types.js';
import {
  sendMessage,
  broadcastToOtherAuthenticatedClients,
  buildStateHeartbeat as _buildStateHeartbeat,
  broadcastHeartbeat as _broadcastHeartbeat,
  buildPluginStateMessage,
  broadcastPluginState as _broadcastPluginState,
} from './application/conversation/transport/broadcast.js';
import {
  handleClientMessage as _handleClientMessage,
  type MessageHandlerContext,
} from './application/conversation/transport/message-handler.js';
import {
  cancelRun as _cancelRun,
  findProcessPidsByTaskCommand,
  parseMessage,
  type CancelRunOptions,
} from './application/conversation/runtime/run-lifecycle.js';
import {
  handleRunStart as _handleRunStart,
  type RunHandlerContext,
} from './application/conversation/runtime/run-handler.js';
import { setupRoutesAndServices } from './server-setup.js';

let database: ReturnType<typeof initDatabase> | null = null;

// Thin wrappers for broadcast functions that close over module-level state
function broadcastHeartbeat(): void {
  _broadcastHeartbeat(connectedClients, activeRuns);
}
function broadcastPluginState(): void {
  _broadcastPluginState(connectedClients);
}
function buildStateHeartbeat(): StateHeartbeatMessage {
  const heartbeat = _buildStateHeartbeat(activeRuns);
  heartbeat.unreadFeedCount = notificationsService?.getUnreadCount() ?? 0;
  return heartbeat;
}

function buildClaudiaTaskSnapshot(): import('@my-claudia/shared/protocol/messages').ClaudiaTaskSnapshotMessage | null {
  const orch = taskOrchestrator;
  if (!orch || !database) return null;
  const branchService = new ClaudiaBranchService(database);
  const getLastAssistantMessage = database.prepare(
    `SELECT content FROM messages
     WHERE session_id = ? AND role = 'assistant'
     ORDER BY created_at DESC LIMIT 1`
  );
  const getToolCount = database.prepare(
    `SELECT COUNT(*) as count
     FROM tool_call_records
     WHERE session_id = ?`
  );

  const collectTasks = (parentId?: string): import('./application/orchestration/types.js').OrchestratorTask[] => {
    const direct = orch.listTasks(parentId);
    return direct.flatMap((task) => [task, ...collectTasks(task.id)]);
  };

  const tasks = collectTasks()
    .filter((task) => task.initiator === 'claudia')
    .map((task) => {
      const responseText = task.responseText ?? (
        task.sessionId && (task.status === 'completed' || task.status === 'failed')
          ? (getLastAssistantMessage.get(task.sessionId) as { content: string } | undefined)?.content
          : undefined
      );
      const toolCount = task.toolCount ?? (
        task.sessionId
          ? (getToolCount.get(task.sessionId) as { count: number } | undefined)?.count
          : undefined
      );
      return {
        id: task.id,
        sessionId: task.sessionId,
        branchId: task.branchId,
        branchAction: task.branchAction,
        contextReset: task.contextReset,
        input: task.task,
        title: task.task.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Claudia Task',
        status: task.status as import('@my-claudia/shared/protocol/messages').ClaudiaTaskStatus,
        summary: task.resultSummary,
        error: task.errorSummary,
        responseText,
        toolCount: toolCount && toolCount > 0 ? toolCount : undefined,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  return {
    type: 'claudia_task_snapshot',
    tasks,
    activeBranches: branchService.listActiveBranches(),
  };
}

const activeRuns = new Map<string, ActiveRun>();

// Module-level shared state (initialized in createServer)
let processMonitor: ProcessMonitor | null = null;
let connectedClients = new Map<string, ConnectedClient>();
let notificationSender: NotificationSender;
let serverPort: number | null = null;
let notificationsService: import('./domains/notification-feed/index.js').NotificationService | undefined;
let permissionBridge: import('./application/conversation/agent/permission-bridge.js').PermissionBridge | undefined;
let cancelWorkflowRun: ((runId: string) => void) | undefined;
let taskOrchestrator: import('./application/orchestration/types.js').TaskOrchestrator | undefined;
let branchAllocator: ClaudiaBranchService | undefined;
let facadeHubRef: import('./infrastructure/gateway/ws-hub.js').FacadeWsHub | null = null;

function getTaskCoordination(): TaskCoordinationPort | undefined {
  const orch = taskOrchestrator;
  const alloc = branchAllocator;
  if (!orch || !alloc) return undefined;
  return {
    getTask: (taskId) => orch.getTask(taskId),
    spawnTask: (parentId, config) => orch.spawnTask(parentId, config),
    killTask: (taskId) => orch.killTask(taskId),
    allocateBranch: (opts) => alloc.allocateBranch(opts),
    allocateForContinue: (opts) => alloc.allocateForContinue(opts),
    setActiveBranchId: (hostProjectId, branchId) => alloc.setActiveBranchId(hostProjectId, branchId),
    attachSession: (branchId, sessionId) => alloc.attachSession(branchId, sessionId),
    updateBranchTask: (branchId, taskId, sessionId) => alloc.updateBranchTask(branchId, taskId, sessionId),
  };
}

function getSessionSync(): SessionSyncPort {
  return {
    broadcastSessionUpdated: (sessionId, db) => {
      const gatewayClient = getGatewayClient();
      if (!gatewayClient) return;

      const updatedSession = db.prepare(`
        SELECT s.id, s.name, s.updated_at as updatedAt, s.archived_at as archivedAt
        FROM sessions s
        WHERE s.id = ?
      `).get(sessionId);

      if (updatedSession) {
        gatewayClient.commands.backendData.broadcastSessionEvent('updated', updatedSession);
      }
    },
  };
}

// Re-exports for backward compatibility
export type { ConnectedClient, MessageSender };
export { sendMessage, handleClientMessage, activeRuns, handleRunStart, connectedClients, createVirtualClient, cancelRun };

// Message handler context — created once, used by handleClientMessage wrapper
function getMessageHandlerContext(): MessageHandlerContext {
  return {
    activeRuns,
    connectedClients,
    processMonitor,
    handleRunStart,
    cancelRun,
    broadcastPluginState,
    findProcessPidsByTaskCommand,
    notificationService: notificationsService,
    taskCoordination: getTaskCoordination(),
    providerRegistry,
    permissionBridge,
    cancelWorkflowRun,
  };
}

// Run handler context — module-level state injected into handleRunStart
function getRunHandlerContext(): RunHandlerContext {
  return {
    activeRuns,
    processMonitor,
    notificationService: notificationSender,
    notificationsService,
    serverPort,
    broadcastHeartbeat,
    permissionBridge,
    sessionSync: getSessionSync(),
    providerRegistry,
  };
}

export interface ServerContext {
  server: Server;
  db: ReturnType<typeof initDatabase>;
  terminalManager: TerminalManager;
  handleMessage: (client: ConnectedClient, message: ClientMessage) => Promise<void>;
  getGatewayStatus: () => GatewayStatus;
  getStateHeartbeat: () => StateHeartbeatMessage;
  connectGateway: (config: GatewayConfig) => Promise<void>;
  disconnectGateway: () => Promise<void>;
  updateGatewayConnected: (connected: boolean) => void;
  updateGatewayBackendId: (backendId: string | null) => void;
  updateGatewayIdentity: (instanceId: string, deviceId: string) => void;
  updateDiscoveredBackends: (backends: import('@my-claudia/shared/core/server').GatewayBackendInfo[]) => void;
  setGatewayConnector: (connector: (config: GatewayConfig) => Promise<void>) => void;
  setGatewayDisconnector: (disconnector: () => Promise<void>) => void;
  setServerPort: (port: number) => void;
  setFacadeHub: (hub: import('./infrastructure/gateway/ws-hub.js').FacadeWsHub | null) => void;
}

export async function createServer(): Promise<ServerContext> {
  // Initialize database
  const db = initDatabase();
  database = db;
  branchAllocator = new ClaudiaBranchService(db);

  // Initialize file store (DB + disk persistence)
  initFileStore(db);

  // Initialize Agent Workspace (SOUL.md, AGENTS.md, TOOLS.md, skills)
  await initWorkspace();

  // Generate ephemeral RSA keypair for E2E credential encryption
  generateKeyPair();

  // Legacy/WS message router.
  // CRUD-style WebSocket message handlers still register here, but HTTP API routes live in setupRoutesAndServices().
  const router = createRouter(db);
  router.use(routerLoggingMiddleware, routerErrorMiddleware);

  // Create Express app
  const app: Express = express();

  app.use(cors());
  // Preserve raw bytes for gateway-proxy requests so binary and multipart payloads
  // are forwarded without JSON/body-parser mutation.
  app.use('/api/gateway-proxy', express.raw({ type: '*/*', limit: '100mb' }));
  app.use('/api/gateway-direct', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '15mb' }));

  // WebSocket clients map (declared early so it can be used in auth endpoints)
  const clients = new Map<string, ConnectedClient>();
  connectedClients = clients;

  // Terminal manager for remote PTY sessions
  const terminalManager = new TerminalManager((clientId, msg) => {
    const client = clients.get(clientId);
    if (client) sendMessage(client.ws, msg);
  });

  // Create notification sender — always gateway-aware.
  // GatewayNotificationSender lazily calls getGatewayClient() on each notify(),
  // so it gracefully no-ops when no gateway is connected yet.
  notificationSender = new GatewayNotificationSender(() => getGatewayClient());

  // Setup routes, services, and periodic tasks
  const setup = setupRoutesAndServices({
    db, app, router, clients, activeRuns,
    buildStateHeartbeat, broadcastHeartbeat, broadcastPluginState,
    handleRunStart,
    getServerPort: () => serverPort,
    notificationSender,
    setProcessMonitor: (pm) => { processMonitor = pm; },
  });
  notificationsService = setup.notificationsService;
  permissionBridge = setup.permissionBridge;
  cancelWorkflowRun = setup.cancelWorkflowRun;
  taskOrchestrator = setup.orchestrator;

  // Error handling middleware (must be after routes)
  app.use(expressErrorHandler);

  // Create HTTP server
  const server = createHttpServer(app);

  // Create WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  // Create facade WebSocket server (for /ws/backend-facade)
  const facadeWss = new WebSocketServer({ noServer: true });
  facadeWss.on('connection', (ws) => {
    if (facadeHubRef) {
      facadeHubRef.attachClient(ws);
    } else {
      ws.close();
    }
  });

  // Upgrade handler routes to WebSocketServer
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    socket.on('error', (err) => {
      console.warn(`[WS Upgrade] Socket error: ${(err as NodeJS.ErrnoException).code || err.message}`);
    });

    const url = req.url || '';
    if (url === '/ws' || url.startsWith('/ws?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    if (url === '/ws/backend-facade' || url.startsWith('/ws/backend-facade?')) {
      facadeWss.handleUpgrade(req, socket, head, (ws) => {
        facadeWss.emit('connection', ws, req);
      });
      return;
    }

    socket.destroy();
  });

  // Catch client-side TCP errors
  server.on('clientError', (err, socket) => {
    console.warn(`[HTTP] Client error: ${(err as NodeJS.ErrnoException).code || err.message}`);
    socket.destroy();
  });

  // Ping interval for connection health (skip virtual/gateway clients)
  const pingInterval = setInterval(() => {
    clients.forEach((client, id) => {
      if (typeof client.ws.ping !== 'function') return;
      if (!client.isAlive) {
        console.log(`Client ${id} disconnected (ping timeout)`);
        client.ws.terminate();
        clients.delete(id);
        return;
      }
      client.isAlive = false;
      client.ws.ping();
    });
  }, 30000);

  // Periodic state heartbeat as fallback sync mechanism.
  // Ensures remote clients eventually converge on correct state even if
  // individual events were lost during a transport glitch (e.g. mobile disconnect).
  // Active runs → 5s (run state is volatile, clients need timely updates).
  // Idle        → 30s (only version reconciliation for projects/plugins).
  const HEARTBEAT_ACTIVE_MS = 5_000;
  const HEARTBEAT_IDLE_MS = 30_000;
  let stateHeartbeatInterval = setInterval(tickHeartbeat, HEARTBEAT_ACTIVE_MS);
  let lastHeartbeatHadRuns = true; // start in active cadence

  function tickHeartbeat(): void {
    if (clients.size > 0) {
      broadcastHeartbeat();
    }
    // Switch cadence when run presence changes
    const hasRuns = activeRuns.size > 0;
    if (hasRuns !== lastHeartbeatHadRuns) {
      lastHeartbeatHadRuns = hasRuns;
      clearInterval(stateHeartbeatInterval);
      stateHeartbeatInterval = setInterval(tickHeartbeat, hasRuns ? HEARTBEAT_ACTIVE_MS : HEARTBEAT_IDLE_MS);
    }
  }

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const clientId = uuidv4();
    const clientIsLocal = isLocalhost(req);
    const client: ConnectedClient = {
      id: clientId,
      ws,
      isAlive: true,
      isLocal: clientIsLocal,
      authenticated: false
    };
    clients.set(clientId, client);

    console.log(`Client connected: ${clientId} (local: ${clientIsLocal}, awaiting authentication)`);

    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const { request, isOldFormat } = parseMessage(data.toString());
        const message: ClientMessage = isOldFormat ? request.payload as ClientMessage : request.payload as ClientMessage;

        // Handle auth message for unauthenticated clients
        if (!client.authenticated) {
          if (message.type === 'auth') {
            client.authenticated = true;
            console.log(`Client ${clientId} authenticated (isLocal: ${client.isLocal})`);
            const authPublicKey = getPublicKeyPem();
            sendMessage(ws, {
              type: 'auth_result',
              success: true,
              isLocalConnection: client.isLocal,
              serverVersion: '1.1.0',
              features: ALL_SERVER_FEATURES,
              ...(authPublicKey && { publicKey: authPublicKey }),
            } as AuthResultMessage);

            // Re-attach orphaned runs
            activeRuns.forEach((run) => {
              if (!clients.has(run.clientId)) {
                console.log(`[Reconnect] Re-attaching orphaned run ${run.runId} (session ${run.sessionId}) to new client ${clientId}`);
                run.clientId = clientId;
                run.client = client;
              }
            });

            sendMessage(ws, buildStateHeartbeat());
            const claudiaSnapshot = buildClaudiaTaskSnapshot();
            if (claudiaSnapshot) {
              sendMessage(ws, claudiaSnapshot);
            }

            if (pluginLoader.getPlugins().length > 0) {
              const pluginState = buildPluginStateMessage();
              sendMessage(ws, pluginState);
            }
            return;
          }

          sendMessage(ws, {
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Authentication required. Send an auth message first.'
          } as ErrorMessage);
          return;
        }

        // Try router first, then legacy handler
        try {
          const response = await router.route(client, request);
          if (response) {
            if ((ws.readyState as number) === 1) {
              ws.send(JSON.stringify(response));
            }
            return;
          }
        } catch (error) {
          console.error('[Router] Error routing message:', error);
        }

        await handleClientMessage(client, message, db, clients, terminalManager);
      } catch (error) {
        console.error('Error handling message:', error);
        sendMessage(ws, {
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: error instanceof Error ? error.message : 'Invalid message format'
        });
      }
    });

    ws.on('close', () => {
      console.log(`Client disconnected: ${clientId}`);
      clients.delete(clientId);
      terminalManager.detachClient(clientId);

      const orphanedRuns: string[] = [];
      activeRuns.forEach((run, runId) => {
        if (run.clientId === clientId) {
          orphanedRuns.push(runId);
        }
      });
      if (orphanedRuns.length > 0) {
        console.log(`Client ${clientId} had ${orphanedRuns.length} active run(s) — keeping alive for reconnect`);
      }
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
    });
  });

  wss.on('close', () => {
    clearInterval(pingInterval);
    clearInterval(stateHeartbeatInterval);
    setup.onWssClose();
  });

  return {
    server,
    db,
    terminalManager,
    getStateHeartbeat: buildStateHeartbeat,
    handleMessage: async (client: ConnectedClient, message: ClientMessage) => {
      if (!clients.has(client.id)) {
        clients.set(client.id, client);
      }

      const request: CorrelatedRequest = {
        id: uuidv4(),
        type: message.type,
        payload: message,
        timestamp: Date.now(),
        metadata: { timeout: 30000, requiresAuth: false }
      };

      try {
        const response = await router.route(client, request);
        if (response) {
          if ((client.ws.readyState as number) === 1) {
            client.ws.send(JSON.stringify(response));
          }
          return;
        }
      } catch (error) {
        console.error('[Router] Error routing gateway message:', error);
      }

      await handleClientMessage(client, message, db, clients, terminalManager);
    },
    getGatewayStatus: setup.getGatewayStatus,
    setGatewayConnector: setup.setGatewayConnector,
    setGatewayDisconnector: setup.setGatewayDisconnector,
    connectGateway: setup.connectGateway,
    disconnectGateway: setup.disconnectGateway,
    updateGatewayConnected: setup.updateGatewayConnected,
    updateGatewayIdentity: setup.updateGatewayIdentity,
    updateGatewayBackendId: (backendId: string | null) => {
      setup.gatewayStatus.gatewayBackendId = backendId;
      if (backendId) {
        db.prepare(`
          UPDATE gateway_config SET backend_id = ?, updated_at = ? WHERE id = 1
        `).run(backendId, Date.now());
      }
    },
    updateDiscoveredBackends: setup.updateDiscoveredBackends,
    setServerPort: (port: number) => {
      serverPort = port;
    },
    setFacadeHub: (hub) => {
      facadeHubRef = hub;
    },
  };
}

// Thin wrapper that delegates to extracted cancelRun
function cancelRun(runId: string, options?: CancelRunOptions): void {
  _cancelRun(runId, { activeRuns, processMonitor, broadcastHeartbeat, providerRegistry }, options);
}

// Thin wrapper that delegates to the extracted message handler
async function handleClientMessage(
  client: ConnectedClient,
  message: ClientMessage,
  db: ReturnType<typeof initDatabase>,
  clients: Map<string, ConnectedClient>,
  termMgr?: TerminalManager
): Promise<void> {
  return _handleClientMessage(client, message, db, clients, getMessageHandlerContext(), termMgr);
}

// Thin wrapper that delegates to extracted handleRunStart
async function handleRunStart(
  client: ConnectedClient,
  message: any,
  db: ReturnType<typeof initDatabase>,
  recoveryState: { sessionResetRetryCount?: number } = {},
  clients?: Map<string, ConnectedClient>,
): Promise<void> {
  return _handleRunStart(client, message, db, recoveryState, clients, getRunHandlerContext());
}
