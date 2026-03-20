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
  Request as CorrelatedRequest,
  StateHeartbeatMessage,
} from '@my-claudia/shared';
import { ALL_SERVER_FEATURES } from '@my-claudia/shared';
import { initDatabase } from './storage/db.js';
import { initFileStore } from './storage/fileStore.js';
import { initWorkspace } from './services/workspace.js';
import type { GatewayConfig, GatewayStatus } from './routes/gateway.js';
import { TerminalManager } from './terminal-manager.js';
import { generateKeyPair, getPublicKeyPem } from './utils/crypto.js';
import { pluginLoader } from './plugins/loader.js';
import type { ProcessMonitor } from './utils/process-monitor.js';
import type { NotificationService } from './services/notification-service.js';

// Phase 2: Router architecture
import { createRouter } from './router/index.js';
import { loggingMiddleware as routerLoggingMiddleware } from './middleware/logging.js';
import { errorHandlingMiddleware as routerErrorMiddleware } from './middleware/error.js';
import { isLocalhost } from './middleware/local-only.js';
import { expressErrorHandler } from './middleware/express-error.js';

// Extracted modules
import type { ConnectedClient, ActiveRun, MessageSender } from './ws/types.js';
import { createVirtualClient } from './ws/types.js';
import {
  sendMessage,
  broadcastToOtherAuthenticatedClients,
  buildStateHeartbeat as _buildStateHeartbeat,
  broadcastHeartbeat as _broadcastHeartbeat,
  buildPluginStateMessage,
  broadcastPluginState as _broadcastPluginState,
} from './ws/broadcast.js';
import {
  handleClientMessage as _handleClientMessage,
  type MessageHandlerContext,
} from './ws/message-handler.js';
import {
  cancelRun as _cancelRun,
  findProcessPidsByTaskCommand,
  parseMessage,
} from './ws/run-lifecycle.js';
import {
  handleRunStart as _handleRunStart,
  type RunHandlerContext,
} from './ws/run-handler.js';
import { setupRoutesAndServices } from './server-setup.js';

// Thin wrappers for broadcast functions that close over module-level state
function broadcastHeartbeat(): void {
  _broadcastHeartbeat(connectedClients, activeRuns);
}
function broadcastPluginState(): void {
  _broadcastPluginState(connectedClients);
}
function buildStateHeartbeat(): StateHeartbeatMessage {
  return _buildStateHeartbeat(activeRuns);
}

const activeRuns = new Map<string, ActiveRun>();

// Module-level shared state (initialized in createServer)
let processMonitor: ProcessMonitor | null = null;
let connectedClients = new Map<string, ConnectedClient>();
let notificationService: NotificationService;
let serverPort: number | null = null;

// Re-exports for backward compatibility
export type { ConnectedClient, MessageSender };
export { sendMessage, handleClientMessage, activeRuns, handleRunStart, connectedClients, createVirtualClient };

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
  };
}

// Run handler context — module-level state injected into handleRunStart
function getRunHandlerContext(): RunHandlerContext {
  return {
    activeRuns,
    processMonitor,
    notificationService,
    serverPort,
    broadcastHeartbeat,
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
  updateDiscoveredBackends: (backends: import('@my-claudia/shared').GatewayBackendInfo[]) => void;
  setGatewayConnector: (connector: (config: GatewayConfig) => Promise<void>) => void;
  setGatewayDisconnector: (disconnector: () => Promise<void>) => void;
  setServerPort: (port: number) => void;
}

export async function createServer(): Promise<ServerContext> {
  // Initialize database
  const db = initDatabase();

  // Initialize file store (DB + disk persistence)
  initFileStore(db);

  // Initialize Agent Workspace (SOUL.md, AGENTS.md, TOOLS.md, skills)
  await initWorkspace();

  // Generate ephemeral RSA keypair for E2E credential encryption
  generateKeyPair();

  // Phase 2: Router (CRUD routes migrated to HTTP REST)
  const router = createRouter(db);
  router.use(routerLoggingMiddleware, routerErrorMiddleware);

  // Create Express app
  const app: Express = express();

  app.use(cors());
  app.use(express.json({ limit: '15mb' }));

  // WebSocket clients map (declared early so it can be used in auth endpoints)
  const clients = new Map<string, ConnectedClient>();
  connectedClients = clients;

  // Terminal manager for remote PTY sessions
  const terminalManager = new TerminalManager((clientId, msg) => {
    const client = clients.get(clientId);
    if (client) sendMessage(client.ws, msg);
  });

  // Setup routes, services, and periodic tasks
  const setup = setupRoutesAndServices({
    db, app, router, clients, activeRuns,
    buildStateHeartbeat, broadcastHeartbeat, broadcastPluginState,
    handleRunStart,
    getServerPort: () => serverPort,
    setNotificationService: (ns) => { notificationService = ns; },
    setProcessMonitor: (pm) => { processMonitor = pm; },
  });

  // Error handling middleware (must be after routes)
  app.use(expressErrorHandler);

  // Create HTTP server
  const server = createHttpServer(app);

  // Create WebSocket server
  const wss = new WebSocketServer({ noServer: true });

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
      setup.gatewayStatus.backendId = backendId;
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
  };
}

// Thin wrapper that delegates to extracted cancelRun
function cancelRun(runId: string): void {
  _cancelRun(runId, { activeRuns, processMonitor, broadcastHeartbeat });
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
