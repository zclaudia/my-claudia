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
import { initAttachmentStore } from './infrastructure/storage/attachmentStore.js';
import { initWorkspace } from './application/services/workspace.js';
import type { GatewayConfig, GatewayStatus } from './interfaces/http/gateway.js';
import { TerminalManager } from './terminal-manager.js';
import { generateKeyPair, getPublicKeyPem } from './utils/crypto.js';
import { GatewayNotificationSender } from './infrastructure/push/notification-sender.js';
import { ClaudiaBranchService } from './application/orchestration/claudia-branch-service.js';
import { getGatewayClient } from './infrastructure/gateway/gateway-instance.js';

// WebSocket message-router architecture.
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
  buildPluginStateMessage,
} from './application/conversation/transport/broadcast.js';
import {
  handleClientMessage as _handleClientMessage,
} from './application/conversation/transport/message-handler.js';
import {
  cancelRun as _cancelRun,
  parseMessage,
  type CancelRunOptions,
} from './application/conversation/runtime/run-lifecycle.js';
import {
  handleRunStart as _handleRunStart,
} from './application/conversation/runtime/run-handler.js';
import { setupRoutesAndServices } from './server-setup.js';
import { providerRegistry } from './infrastructure/providers/registry.js';

// Centralized server state
import { serverState } from './server-state.js';

// Expose activeRuns and connectedClients as module-level references for backward compatibility
const activeRuns = serverState.activeRuns;
let connectedClients = serverState.connectedClients;

// Re-exports for backward compatibility
export type { ConnectedClient, MessageSender };
export { sendMessage, handleClientMessage, activeRuns, handleRunStart, connectedClients, createVirtualClient, cancelRun };

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
  serverState.database = db;
  serverState.branchAllocator = new ClaudiaBranchService(db);

  // Initialize file store (DB + disk persistence) — for transient session files
  initFileStore(db);
  // Initialize attachment store — for persistent business attachments
  initAttachmentStore();

  // Initialize Agent Workspace (SOUL.md, AGENTS.md, TOOLS.md, skills)
  await initWorkspace();

  // Generate ephemeral RSA keypair for E2E credential encryption
  generateKeyPair();

  // Legacy/WS message router.
  const router = createRouter(db);
  router.use(routerLoggingMiddleware, routerErrorMiddleware);

  // Create Express app
  const app: Express = express();

  app.use(cors());
  app.use('/api/gateway-proxy', express.raw({ type: '*/*', limit: '100mb' }));
  app.use('/api/gateway-direct', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '15mb' }));

  // WebSocket clients map
  const clients = new Map<string, ConnectedClient>();
  serverState.connectedClients = clients;
  connectedClients = clients;

  // Terminal manager for remote PTY sessions
  const terminalManager = new TerminalManager((clientId, msg) => {
    const client = clients.get(clientId);
    if (client) sendMessage(client.ws, msg);
  });

  // Create notification sender — always gateway-aware.
  serverState.notificationSender = new GatewayNotificationSender(() => getGatewayClient());

  // Setup routes, services, and periodic tasks
  const setup = setupRoutesAndServices({
    db, app, router, clients, activeRuns,
    buildStateHeartbeat: () => serverState.buildStateHeartbeat(),
    broadcastHeartbeat: () => serverState.broadcastHeartbeat(),
    broadcastPluginState: () => serverState.broadcastPluginState(),
    handleRunStart,
    getServerPort: () => serverState.serverPort,
    notificationSender: serverState.notificationSender,
    setProcessMonitor: (pm) => { serverState.processMonitor = pm; },
  });
  serverState.notificationsService = setup.notificationsService;
  serverState.permissionBridge = setup.permissionBridge;
  serverState.cancelWorkflowRun = setup.cancelWorkflowRun;
  serverState.permissionWorkflowResolver = setup.permissionWorkflowResolver;
  serverState.taskOrchestrator = setup.orchestrator;
  serverState.metaWorkflowService = setup.metaWorkflowService;

  // Error handling middleware (must be after routes)
  app.use(expressErrorHandler);

  // Create HTTP server
  const server = createHttpServer(app);

  // Create WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  // Create facade WebSocket server (for /ws/backend-facade)
  const facadeWss = new WebSocketServer({ noServer: true });
  facadeWss.on('connection', (ws) => {
    if (serverState.facadeHubRef) {
      serverState.facadeHubRef.attachClient(ws);
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
  const HEARTBEAT_ACTIVE_MS = 5_000;
  const HEARTBEAT_IDLE_MS = 30_000;
  let stateHeartbeatInterval = setInterval(tickHeartbeat, HEARTBEAT_ACTIVE_MS);
  let lastHeartbeatHadRuns = true;

  function tickHeartbeat(): void {
    if (clients.size > 0) {
      serverState.broadcastHeartbeat();
    }
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

            sendMessage(ws, serverState.buildStateHeartbeat());
            const claudiaSnapshot = serverState.buildClaudiaTaskSnapshot();
            if (claudiaSnapshot) {
              sendMessage(ws, claudiaSnapshot);
            }

            // Always send plugin_state so the client can clear stale cached plugins
            sendMessage(ws, buildPluginStateMessage());
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
    getStateHeartbeat: () => serverState.buildStateHeartbeat(),
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
      serverState.serverPort = port;
    },
    setFacadeHub: (hub) => {
      serverState.facadeHubRef = hub;
    },
  };
}

// Thin wrapper that delegates to extracted cancelRun
function cancelRun(runId: string, options?: CancelRunOptions): void {
  _cancelRun(runId, {
    activeRuns,
    processMonitor: serverState.processMonitor,
    broadcastHeartbeat: () => serverState.broadcastHeartbeat(),
    providerRegistry,
  }, options);
}

// Thin wrapper that delegates to the extracted message handler
async function handleClientMessage(
  client: ConnectedClient,
  message: ClientMessage,
  db: ReturnType<typeof initDatabase>,
  clients: Map<string, ConnectedClient>,
  termMgr?: TerminalManager
): Promise<void> {
  return _handleClientMessage(
    client, message, db, clients,
    serverState.getMessageHandlerContext(handleRunStart, cancelRun),
    termMgr,
  );
}

// Thin wrapper that delegates to extracted handleRunStart
async function handleRunStart(
  client: ConnectedClient,
  message: any,
  db: ReturnType<typeof initDatabase>,
  recoveryState: { sessionResetRetryCount?: number } = {},
  clients?: Map<string, ConnectedClient>,
): Promise<void> {
  return _handleRunStart(client, message, db, recoveryState, clients, serverState.getRunHandlerContext());
}
