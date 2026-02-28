import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer as createHttpServer, Server, IncomingMessage, request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import type {
  ClientMessage,
  ServerMessage,
  PongMessage,
  ErrorMessage,
  ProviderConfig,
  AuthResultMessage,
  ToolCall,
  Request as CorrelatedRequest,
  StateHeartbeatMessage
} from '@my-claudia/shared';
import { isRequest, ALL_SERVER_FEATURES } from '@my-claudia/shared';
import type { AgentPermissionPolicy } from '@my-claudia/shared';
import { initDatabase } from './storage/db.js';
import { initFileStore } from './storage/fileStore.js';
import { createProjectRoutes } from './routes/projects.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createProviderRoutes } from './routes/providers.js';
import { createFilesRoutes } from './routes/files.js';
import { createCommandsRoutes } from './routes/commands.js';
import { createGatewayRouter, type GatewayConfig, type GatewayStatus } from './routes/gateway.js';
import { createServerRoutes } from './routes/servers.js';
import { createImportRoutes } from './routes/import.js';
import { createOpenCodeImportRoutes } from './routes/import-opencode.js';
import { createAgentRoutes } from './routes/agent.js';
import { createSupervisionRoutes } from './routes/supervisions.js';
import { createNotificationRoutes } from './routes/notifications.js';
import { SupervisorService } from './services/supervisor-service.js';
import { NotificationService } from './services/notification-service.js';
import { PermissionEvaluator, getAgentPermissionPolicy, getProjectPermissionOverride, mergePolicy, normalizePolicy } from './agent/permission-evaluator.js';
import type { PermissionDecision, SystemInfo } from './providers/claude-sdk.js';
import { openCodeServerManager } from './providers/opencode-sdk.js';
import { providerRegistry } from './providers/registry.js';
import { safeCompare } from './auth.js';
import { extractAndIndexMetadata, removeIndexedMetadata } from './storage/metadata-extractor.js';
import { TerminalManager } from './terminal-manager.js';
import { generateKeyPair, getPublicKeyPem, decryptCredential } from './utils/crypto.js';
import { getGatewayClientMode } from './gateway-instance.js';

// Phase 2: Router architecture (CRUD routes migrated to HTTP REST)
import { createRouter } from './router/index.js';
import { loggingMiddleware as routerLoggingMiddleware } from './middleware/logging.js';
import { errorHandlingMiddleware as routerErrorMiddleware } from './middleware/error.js';

// Default permission policy base (used when only project override exists, no global policy)
const DEFAULT_PERMISSION_POLICY: AgentPermissionPolicy = {
  enabled: false,
  trustLevel: 'conservative',
  customRules: [],
  escalateAlways: ['AskUserQuestion'],
};

// Check if input is a slash command
function isSlashCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

/**
 * Detect if a tool call is a sudo command that needs a password.
 * Returns true for Bash/shell tool calls containing sudo.
 */
function isSudoCommand(toolName: string, toolInput: unknown): boolean {
  const bashTools = ['bash', 'execute_command', 'run_terminal_cmd', 'terminal'];
  if (!bashTools.includes(toolName.toLowerCase())) return false;

  const input = toolInput as { command?: string } | undefined;
  if (!input?.command) return false;

  // Match sudo at the start of the command or after && / || / ; / | / $()
  return /(?:^|&&|\|\||;|\||\$\()[\s]*sudo\s/m.test(input.command);
}

/**
 * Rewrite a sudo command to inject the password via stdin using printf (shell builtin).
 * printf is used instead of echo because it's a builtin in most shells,
 * so the password won't appear in the process list (`ps`).
 *
 * Original: `sudo apt install vim`
 * Rewritten: `printf '%s\n' '<password>' | sudo -S apt install vim`
 *
 * For chained commands (&&, ;), only rewrites sudo invocations.
 */
function rewriteSudoCommand(command: string, password: string): string {
  // Escape single quotes in the password for safe shell interpolation
  const escaped = password.replace(/'/g, "'\\''");

  // Replace each `sudo ` occurrence with the stdin-based version
  // This handles: sudo cmd, && sudo cmd, ; sudo cmd, etc.
  return command.replace(
    /((?:^|(?:&&|\|\||;|\|)\s*))sudo\s+(?!-S\s)/gm,
    (_, prefix) => `${prefix}printf '%s\\n' '${escaped}' | sudo -S `,
  );
}

// Process @ mentions in user input, converting them to context hints for Claude
function processAtMentions(input: string, projectRoot: string | null): string {
  if (!projectRoot) return input;

  // Match @path/to/file patterns (paths that don't contain spaces)
  // This pattern matches @ followed by a path-like string
  const atPattern = /@([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/g;
  const mentions: string[] = [];

  let match;
  while ((match = atPattern.exec(input)) !== null) {
    const relativePath = match[1];
    const absolutePath = path.join(projectRoot, relativePath);
    mentions.push(absolutePath);
  }

  if (mentions.length === 0) return input;

  // Build context hint for Claude
  const contextHint = mentions
    .map(p => `Please read the file at ${p} for context.`)
    .join('\n');

  return `[Context Reference]\n${contextHint}\n\n${input}`;
}

// Build status output from system info
function buildStatusOutput(systemInfo: SystemInfo): string {
  const lines: string[] = [];

  if (systemInfo.model) {
    lines.push(`**Model:** ${systemInfo.model}`);
  }
  if (systemInfo.claudeCodeVersion) {
    lines.push(`**Claude Code Version:** ${systemInfo.claudeCodeVersion}`);
  }
  if (systemInfo.cwd) {
    lines.push(`**Working Directory:** ${systemInfo.cwd}`);
  }
  if (systemInfo.permissionMode) {
    lines.push(`**Permission Mode:** ${systemInfo.permissionMode}`);
  }
  if (systemInfo.apiKeySource) {
    lines.push(`**API Key Source:** ${systemInfo.apiKeySource}`);
  }
  if (systemInfo.tools && systemInfo.tools.length > 0) {
    lines.push(`**Available Tools:** ${systemInfo.tools.length}`);
    lines.push(`  ${systemInfo.tools.join(', ')}`);
  }
  if (systemInfo.mcpServers && systemInfo.mcpServers.length > 0) {
    lines.push(`**MCP Servers:** ${systemInfo.mcpServers.map(s => `${s.name} (${s.status})`).join(', ')}`);
  }
  if (systemInfo.slashCommands && systemInfo.slashCommands.length > 0) {
    lines.push(`**Slash Commands:** ${systemInfo.slashCommands.join(', ')}`);
  }
  if (systemInfo.agents && systemInfo.agents.length > 0) {
    lines.push(`**Agents:** ${systemInfo.agents.join(', ')}`);
  }

  return lines.join('\n');
}

// Commands that can be handled using system info from init message
const SYSTEM_INFO_COMMANDS = ['/status'];

interface ConnectedClient {
  id: string;
  ws: WebSocket;
  isAlive: boolean;
  isLocal: boolean;       // Whether this is a localhost connection
  authenticated: boolean; // Whether the client has been authenticated
}

// Track active runs and their permission callbacks
interface ActiveRun {
  runId: string;
  clientId: string;
  client: ConnectedClient;      // Direct reference (works for both real WS and virtual gateway clients)
  abortController?: AbortController;
  providerType?: string;         // Provider type for this run (e.g. 'claude', 'opencode')
  providerSessionId?: string;    // Provider session ID (for abort support)
  providerCwd?: string;          // Provider cwd (for abort support)
  pendingPermissions: Map<string, {
    resolve: (decision: PermissionDecision) => void;
    timeout: NodeJS.Timeout | null;
    originalToolInput?: unknown;
    // Original request info for state heartbeat reconstruction
    originalRequest?: {
      toolName: string;
      detail: string;
      timeoutSeconds: number;
      sessionId?: string;
      requiresCredential?: boolean;
      credentialHint?: string;
      questions?: any[];
    };
  }>;
  // Streaming state for message persistence (allows cancelRun to save partial content)
  db: ReturnType<typeof initDatabase>;
  sessionId: string;
  assistantMessageId: string;
  fullContent: string;
  collectedToolCalls: (ToolCall & { toolUseId: string })[];
  saveInterval?: NodeJS.Timeout;
}

const activeRuns = new Map<string, ActiveRun>();

// Module-level clients map (set in createServer, used by broadcastHeartbeat)
let connectedClients = new Map<string, ConnectedClient>();

// Module-level notification service (initialized in createServer)
let notificationService: NotificationService;

// Module-level server port (set after listen, used by handleRunStart for file push injection)
let serverPort: number | null = null;

// Check if request is from localhost
function isLocalhost(req: Request | IncomingMessage): boolean {
  let ip: string | undefined;
  if ('socket' in req && req.socket) {
    ip = req.socket.remoteAddress;
  }
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Local-only middleware (for admin endpoints like import, gateway config)
function localOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isLocalhost(req)) {
    res.status(403).json({
      success: false,
      error: { code: 'LOCAL_ONLY', message: 'This endpoint is only accessible from localhost' }
    });
    return;
  }
  next();
}

// Module-level supervisor service reference (set during createServer)
let supervisorService: SupervisorService | null = null;

// Export types for Gateway integration
export type { ConnectedClient };
export { sendMessage, handleClientMessage, activeRuns, handleRunStart, connectedClients };

// Message sender interface for abstraction
export interface MessageSender {
  send: (message: ServerMessage) => void;
}

// Create a virtual client for Gateway-forwarded messages
export function createVirtualClient(
  clientId: string,
  sender: MessageSender
): ConnectedClient {
  return {
    id: clientId,
    ws: {
      readyState: 1, // WebSocket.OPEN
      send: (data: string) => {
        const message = JSON.parse(data);
        sender.send(message);
      }
    } as WebSocket,
    isAlive: true,
    isLocal: false,
    authenticated: true
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
  updateGatewayBackendId: (backendId: string | null) => void;
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

  // Generate ephemeral RSA keypair for E2E credential encryption
  generateKeyPair();

  // Phase 2: Router (CRUD routes migrated to HTTP REST, router kept for future WS routing needs)
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

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Get server info (public - no auth required)
  app.get('/api/server/info', (req: Request, res: Response) => {
    const isLocal = isLocalhost(req);
    const publicKey = getPublicKeyPem();
    res.json({
      success: true,
      data: {
        version: '1.1.0',
        isLocalConnection: isLocal,
        features: ALL_SERVER_FEATURES,
        ...(publicKey && { publicKey }),
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

  // Gateway connector functions (to be implemented when gateway client support is added)
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
      // Update database
      db.prepare(`
        UPDATE gateway_config SET backend_id = ?, updated_at = ? WHERE id = 1
      `).run(backendId, Date.now());
    }
  };

  // Authentication middleware for REST API
  // Local requests are always allowed. Remote requests require gateway secret.
  const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    // Local connections are always trusted
    if (isLocalhost(req)) {
      next();
      return;
    }

    // Remote connections: require gateway secret as Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && gatewayStatus.gatewaySecret) {
      const token = authHeader.slice(7);
      // Support both plain gatewaySecret and legacy gatewaySecret:apiKey format
      const secretPart = token.includes(':') ? token.split(':')[0] : token;
      if (safeCompare(secretPart, gatewayStatus.gatewaySecret)) {
        next();
        return;
      }
    }

    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
    });
  };

  // API routes (protected by auth middleware)
  app.use('/api/projects', authMiddleware, createProjectRoutes(db));
  app.use('/api/sessions', authMiddleware, createSessionRoutes(db, activeRuns));
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

  // Supervision routes + service
  supervisorService = new SupervisorService(db);
  app.use('/api/supervisions', authMiddleware, createSupervisionRoutes(supervisorService));

  // Notification routes + service
  notificationService = new NotificationService(db);
  app.use('/api/notifications', authMiddleware, createNotificationRoutes(notificationService));

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
    // Extract the rest of the path after backendId
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
      // Build target URL: gateway's HTTP proxy endpoint
      const targetUrl = `${clientMode.gatewayUrl}/api/proxy/${backendId}/${subPath}`;
      // Preserve query string
      const qs = req.originalUrl.split('?')[1];
      const fullUrl = qs ? `${targetUrl}?${qs}` : targetUrl;

      // Forward headers, inject gateway auth
      const headers: Record<string, string> = {
        'authorization': `Bearer ${clientMode.gatewaySecret}`,
        'content-type': req.headers['content-type'] || 'application/json',
      };
      if (req.headers['accept']) {
        headers['accept'] = req.headers['accept'] as string;
      }

      // Use SOCKS5 agent if configured
      // NOTE: Node.js native fetch ignores the `agent` option.
      // We must use http(s).request for SocksProxyAgent to work.
      const agent = clientMode.createHttpAgent();
      const body = !['GET', 'HEAD'].includes(req.method) ? JSON.stringify(req.body) : undefined;

      const parsed = new URL(fullUrl);
      const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

      const proxyRes = await new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
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
              body: Buffer.concat(chunks).toString('utf-8'),
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
      res.send(proxyRes.body);
    } catch (error) {
      console.error(`[GatewayProxy] Error proxying to backend ${backendId}:`, error);
      res.status(502).json({
        success: false,
        error: { code: 'PROXY_ERROR', message: 'Failed to proxy request to gateway' },
      });
    }
  });

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message || 'Internal server error'
      }
    });
  });

  // Create HTTP server
  const server = createHttpServer(app);

  // Create WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  // Upgrade handler routes to WebSocketServer
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = req.url || '';

    if (url === '/ws' || url.startsWith('/ws?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    // Unknown WS path — reject
    socket.destroy();
  });

  // Ping interval for connection health (skip virtual/gateway clients)
  const pingInterval = setInterval(() => {
    clients.forEach((client, id) => {
      if (typeof client.ws.ping !== 'function') return; // virtual client
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
        // Parse message - supports both old and new correlation formats
        const { request, isOldFormat } = parseMessage(data.toString());

        // Extract the actual message (from payload if old format, or use request directly)
        const message: ClientMessage = isOldFormat ? request.payload as ClientMessage : request.payload as ClientMessage;

        // Handle auth message for unauthenticated clients
        if (!client.authenticated) {
          if (message.type === 'auth') {
            // All direct WebSocket clients are trusted (local connections)
            // Remote access is handled via gateway, not direct WebSocket
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

            // Re-attach any orphaned runs (from previous client that disconnected/refreshed)
            // to this newly authenticated client so they receive streaming output again.
            activeRuns.forEach((run) => {
              if (!clients.has(run.clientId)) {
                console.log(`[Reconnect] Re-attaching orphaned run ${run.runId} (session ${run.sessionId}) to new client ${clientId}`);
                run.clientId = clientId;
                run.client = client;
              }
            });

            // Always send state heartbeat on connect/reconnect so clients can
            // restore active runs AND clean up stale runs that completed while disconnected
            sendMessage(ws, buildStateHeartbeat());
            return;
          }

          // Reject non-auth messages from unauthenticated clients
          sendMessage(ws, {
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Authentication required. Send an auth message first.'
          } as ErrorMessage);
          return;
        }

        // Authenticated - first try router, then fall back to switch statement
        // Phase 2: Try new router system first
        try {
          const response = await router.route(client, request);
          if (response) {
            // Router handled the message, send correlated response
            if ((ws.readyState as number) === 1) {
              ws.send(JSON.stringify(response));
            }
            return;
          }
        } catch (error) {
          console.error('[Router] Error routing message:', error);
          // Fall through to legacy handler
        }

        // No router match - handle with legacy switch statement
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
      terminalManager.destroyForClient(clientId);

      // Don't cancel active runs on disconnect — let them continue running.
      // The client may be refreshing or reconnecting. Orphaned runs will be
      // re-attached when a new client authenticates (see auth handler below).
      // The run output continues to accumulate in memory and is periodically
      // saved to the database, so no data is lost during the disconnection.
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
  });

  // Wire notification service into supervisor
  supervisorService.setNotificationService(notificationService);

  // Start supervisor polling with broadcast to all authenticated clients
  supervisorService.setBroadcast((msg) => {
    clients.forEach((client) => {
      if (client.authenticated) {
        sendMessage(client.ws, msg);
      }
    });
  });
  supervisorService.start(3000);

  // Periodic state heartbeat broadcast (every 30s)
  // Always broadcast even when no active runs — this is the safety net for
  // cleaning up stale runs if a run_completed message was lost.
  const heartbeatInterval = setInterval(() => {
    const heartbeat = buildStateHeartbeat();
    clients.forEach((client) => {
      if (client.authenticated) {
        sendMessage(client.ws, heartbeat);
      }
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return {
    server,
    db,
    terminalManager,
    getStateHeartbeat: buildStateHeartbeat,
    handleMessage: async (client: ConnectedClient, message: ClientMessage) => {
      // Register virtual/gateway clients so TerminalManager callbacks can find them
      if (!clients.has(client.id)) {
        clients.set(client.id, client);
      }

      // Wrap in Request envelope for router (same as parseMessage for old format)
      const request: CorrelatedRequest = {
        id: uuidv4(),
        type: message.type,
        payload: message,
        timestamp: Date.now(),
        metadata: { timeout: 30000, requiresAuth: false }
      };

      // Try router first, then fall back to legacy handler
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

      // No router match - handle with legacy switch statement
      await handleClientMessage(client, message, db, clients, terminalManager);
    },
    getGatewayStatus: () => gatewayStatus,
    setGatewayConnector: (connector: (config: GatewayConfig) => Promise<void>) => {
      gatewayConnector = connector;
    },
    setGatewayDisconnector: (disconnector: () => Promise<void>) => {
      gatewayDisconnector = disconnector;
    },
    connectGateway,
    disconnectGateway,
    updateGatewayBackendId: (backendId: string | null) => {
      gatewayStatus.backendId = backendId;
      gatewayStatus.connected = backendId !== null;
      if (backendId) {
        db.prepare(`
          UPDATE gateway_config SET backend_id = ?, updated_at = ? WHERE id = 1
        `).run(backendId, Date.now());
      }
    },
    updateDiscoveredBackends: (backends: import('@my-claudia/shared').GatewayBackendInfo[]) => {
      gatewayStatus.discoveredBackends = backends;
    },
    setServerPort: (port: number) => {
      serverPort = port;
    },
  };
}

function sendMessage(ws: WebSocket, message: ServerMessage): void {
  // Check readyState as number to support both real WebSocket and virtual clients
  // WebSocket.OPEN === 1, but virtual clients may have readyState typed differently
  if ((ws.readyState as number) === 1) {
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      console.error(`[WS] Failed to send message type=${message.type}:`, err);
    }
  }
}

function buildStateHeartbeat(): StateHeartbeatMessage {
  const runs: StateHeartbeatMessage['activeRuns'] = [];
  const permissions: StateHeartbeatMessage['pendingPermissions'] = [];
  const questions: StateHeartbeatMessage['pendingQuestions'] = [];

  for (const [runId, run] of activeRuns) {
    runs.push({ runId, sessionId: run.sessionId });
    for (const [requestId, pending] of run.pendingPermissions) {
      if (!pending.originalRequest) continue;
      if (pending.originalRequest.toolName === 'AskUserQuestion') {
        questions.push({
          requestId,
          sessionId: pending.originalRequest.sessionId || run.sessionId,
          questions: pending.originalRequest.questions || [],
        });
      } else {
        permissions.push({
          requestId,
          sessionId: pending.originalRequest.sessionId || run.sessionId,
          toolName: pending.originalRequest.toolName,
          detail: pending.originalRequest.detail,
          timeoutSeconds: pending.originalRequest.timeoutSeconds,
          requiresCredential: pending.originalRequest.requiresCredential,
          credentialHint: pending.originalRequest.credentialHint,
        });
      }
    }
  }

  return { type: 'state_heartbeat', activeRuns: runs, pendingPermissions: permissions, pendingQuestions: questions };
}

/** Broadcast a state heartbeat to all authenticated clients immediately. */
function broadcastHeartbeat(): void {
  const heartbeat = buildStateHeartbeat();
  connectedClients.forEach((client) => {
    if (client.authenticated) {
      sendMessage(client.ws, heartbeat);
    }
  });
}

function cancelRun(runId: string): void {
  const run = activeRuns.get(runId);
  if (run) {
    // Stop periodic save
    if (run.saveInterval) {
      clearInterval(run.saveInterval);
      run.saveInterval = undefined;
    }

    // Reject all pending permissions
    run.pendingPermissions.forEach(({ resolve, timeout }) => {
      if (timeout) clearTimeout(timeout);
      resolve({ behavior: 'deny', message: 'Run cancelled' });
    });
    run.pendingPermissions.clear();

    // Abort provider session if applicable
    if (run.providerSessionId && run.providerCwd && run.providerType) {
      const adapter = providerRegistry.get(run.providerType);
      adapter?.abort?.(run.providerSessionId, run.providerCwd).catch(err => {
        console.error(`Failed to abort provider session: ${err}`);
      });
    }

    // Save accumulated content before discarding the run
    try {
      upsertAssistantMessage(run, { indexMetadata: true });
      if (run.fullContent) {
        console.log(`[Cancel] Saved partial assistant message for run ${runId} (${run.fullContent.length} chars)`);
      }
    } catch (err) {
      console.error(`[Cancel] Failed to save partial message for run ${runId}:`, err);
    }

    // Notify client that run was cancelled (uses stored client ref — works for both
    // real WebSocket clients and virtual gateway clients)
    sendMessage(run.client.ws, {
      type: 'run_failed',
      runId,
      sessionId: run.sessionId,
      error: 'Run cancelled by user'
    });

    activeRuns.delete(runId);
    broadcastHeartbeat();
    console.log(`Run ${runId} cancelled`);
  }
}

/**
 * Get the next sequential offset for a message in a session.
 */
function getNextOffset(db: import('better-sqlite3').Database, sessionId: string): number {
  const row = db.prepare(
    'SELECT COALESCE(MAX(offset), 0) + 1 as next FROM messages WHERE session_id = ?'
  ).get(sessionId) as { next: number };
  return row.next;
}

/**
 * Upsert assistant message to database.
 * Uses INSERT ... ON CONFLICT to avoid duplicates — safe to call multiple times
 * with the same assistantMessageId (periodic saves, cancel saves, final save).
 */
function upsertAssistantMessage(
  run: ActiveRun,
  options?: { usage?: { inputTokens: number; outputTokens: number }; indexMetadata?: boolean }
): void {
  if (!run.fullContent) return;

  const metadata: Record<string, unknown> = {};
  if (options?.usage) {
    metadata.usage = options.usage;
  }
  if (run.collectedToolCalls.length > 0) {
    metadata.toolCalls = run.collectedToolCalls.map(({ name, input, output, isError }) => ({
      name, input, output, isError
    }));
  }

  const metadataJson = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;

  const assistantOffset = getNextOffset(run.db, run.sessionId);
  run.db.prepare(`
    INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset)
    VALUES (?, ?, 'assistant', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      metadata = excluded.metadata
  `).run(
    run.assistantMessageId,
    run.sessionId,
    run.fullContent,
    metadataJson,
    Date.now(),
    assistantOffset
  );

  // Extended indexing (file_references, tool_call_records) — only on final/cancel save
  if (options?.indexMetadata && metadataJson) {
    const row = run.db.prepare('SELECT rowid FROM messages WHERE id = ?').get(run.assistantMessageId) as { rowid: number } | undefined;
    if (row) {
      // Clean previous index entries then re-extract
      removeIndexedMetadata(run.db, run.assistantMessageId);
      extractAndIndexMetadata(run.db, run.assistantMessageId, row.rowid, run.sessionId, metadata as any, Date.now());
    }
  }
}

const PERIODIC_SAVE_INTERVAL_MS = 5000;

/**
 * Parse incoming message - supports both old and new formats
 * This enables backward compatibility during migration to correlation protocol.
 *
 * Old format: { type: 'get_projects', ... }
 * New format: { id: '...', type: 'projects.list.request', payload: {...}, ... }
 *
 * Old messages are wrapped in a Request envelope for consistent handling.
 */
function parseMessage(data: string): { request: CorrelatedRequest; isOldFormat: boolean } {
  const parsed = JSON.parse(data);

  // Check if already in new correlation format
  if (isRequest(parsed)) {
    return { request: parsed, isOldFormat: false };
  }

  // Old format - wrap in Request envelope
  const request: CorrelatedRequest = {
    id: uuidv4(),
    type: parsed.type,
    payload: parsed,
    timestamp: Date.now(),
    metadata: {
      timeout: 30000,
      requiresAuth: false
    }
  };

  return { request, isOldFormat: true };
}

async function handleClientMessage(
  client: ConnectedClient,
  message: ClientMessage,
  db: ReturnType<typeof initDatabase>,
  clients: Map<string, ConnectedClient>,
  termMgr?: TerminalManager
): Promise<void> {
  switch (message.type) {
    case 'auth':
      // Auth is handled in the ws.on('message') handler before this function
      // If we reach here, the client is already authenticated (ignore duplicate auth)
      break;

    case 'ping':
      sendMessage(client.ws, { type: 'pong' } as PongMessage);
      break;

    case 'run_start':
      await handleRunStart(client, message, db);
      break;

    case 'run_cancel':
      handleRunCancel(message.runId);
      break;

    case 'permission_decision':
      handlePermissionDecision(message);
      break;

    case 'ask_user_answer':
      handleAskUserAnswer(message);
      break;

    case 'terminal_open': {
      if (!termMgr) break;
      const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(message.projectId) as { root_path: string } | undefined;
      let cwd = project?.root_path || process.env.HOME || '/';
      // Validate cwd exists — posix_spawnp fails if cwd doesn't exist
      if (!fs.existsSync(cwd)) {
        console.warn(`[Terminal] cwd does not exist: ${cwd}, falling back to HOME`);
        cwd = process.env.HOME || '/';
      }
      try {
        termMgr.create(message.terminalId, client.id, cwd, message.cols, message.rows);
        sendMessage(client.ws, { type: 'terminal_opened', terminalId: message.terminalId, success: true });
      } catch (err) {
        sendMessage(client.ws, {
          type: 'terminal_opened',
          terminalId: message.terminalId,
          success: false,
          error: err instanceof Error ? err.message : 'Failed to create terminal',
        });
      }
      break;
    }

    case 'terminal_input':
      termMgr?.write(message.terminalId, message.data);
      break;

    case 'terminal_resize':
      termMgr?.resize(message.terminalId, message.cols, message.rows);
      break;

    case 'terminal_close':
      termMgr?.destroy(message.terminalId);
      break;

    default:
      sendMessage(client.ws, {
        type: 'error',
        code: 'UNKNOWN_MESSAGE_TYPE',
        message: `Unknown message type: ${(message as { type: string }).type}`
      } as ErrorMessage);
  }
}

/** Build compact system prompt instructions for the file push API. */
function buildFilePushContext(apiUrl: string, sessionId: string): string {
  return `## File Push (send files to user's device)
When you build or generate files (APK, image, binary, export, etc.) that the user needs, push them:
\`\`\`bash
curl -s -X POST ${apiUrl}/api/files/push \\
  -H "Content-Type: application/json" \\
  -d '{"filePath":"/absolute/path/to/file","sessionId":"${sessionId}","description":"Brief description"}'
\`\`\`
Images and files <500KB auto-download; larger files show a download notification.`;
}

async function handleRunStart(
  client: ConnectedClient,
  message: {
    type: 'run_start';
    clientRequestId: string;
    sessionId: string;
    input: string;
    providerId?: string;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    mode?: string;   // Generic mode/agent ID (new unified field)
    model?: string;
    systemContext?: string;
  },
  db: ReturnType<typeof initDatabase>
): Promise<void> {
  const runId = uuidv4();

  // Get session info
  const session = db.prepare(`
    SELECT s.id, s.project_id, s.sdk_session_id, s.type as session_type,
           p.root_path, COALESCE(s.provider_id, p.provider_id) as provider_id, p.system_prompt
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(message.sessionId) as {
    id: string;
    project_id: string;
    sdk_session_id: string | null;
    session_type: 'regular' | 'background' | null;
    root_path: string | null;
    provider_id: string | null;
    system_prompt: string | null;
  } | undefined;

  if (!session) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'SESSION_NOT_FOUND',
      message: 'Session not found'
    } as ErrorMessage);
    return;
  }

  // Get provider config if specified
  const providerId = message.providerId || session.provider_id;
  let providerConfig: ProviderConfig | undefined;

  if (providerId) {
    const providerRow = db.prepare(`
      SELECT id, name, type, cli_path as cliPath, env, is_default as isDefault,
             created_at as createdAt, updated_at as updatedAt
      FROM providers WHERE id = ?
    `).get(providerId) as {
      id: string;
      name: string;
      type: string;
      cliPath: string | null;
      env: string | null;
      isDefault: number;
      createdAt: number;
      updatedAt: number;
    } | undefined;

    if (providerRow) {
      providerConfig = {
        id: providerRow.id,
        name: providerRow.name,
        type: providerRow.type as ProviderConfig['type'],
        cliPath: providerRow.cliPath || undefined,
        env: providerRow.env ? JSON.parse(providerRow.env) : undefined,
        isDefault: providerRow.isDefault === 1,
        createdAt: providerRow.createdAt,
        updatedAt: providerRow.updatedAt
      };
    }
  }

  // Create active run tracking (includes streaming state for message persistence)
  const activeRun: ActiveRun = {
    runId,
    clientId: client.id,
    client,
    pendingPermissions: new Map(),
    db,
    sessionId: message.sessionId,
    assistantMessageId: uuidv4(),
    fullContent: '',
    collectedToolCalls: [],
  };
  activeRuns.set(runId, activeRun);

  // Session type: 'regular' or 'background'
  const sessionType = session.session_type || 'regular';

  // Track tool_use_id to tool_name mapping for this run
  const toolUseIdToName = new Map<string, string>();

  // Save user message to database (before sending run_started so IDs are available)
  const userMessageId = uuidv4();
  const userOffset = getNextOffset(db, message.sessionId);
  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, created_at, offset)
    VALUES (?, ?, 'user', ?, ?, ?)
  `).run(userMessageId, message.sessionId, message.input, Date.now(), userOffset);

  // Send run started (include real DB message IDs for client-side dedup)
  sendMessage(client.ws, {
    type: 'run_started',
    runId,
    sessionId: message.sessionId,
    clientRequestId: message.clientRequestId,
    userMessageId,
    assistantMessageId: activeRun.assistantMessageId,
  });

  // Notify background task started
  if (sessionType === 'background') {
    sendMessage(client.ws, {
      type: 'background_task_update',
      sessionId: message.sessionId,
      status: 'running',
    } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);
  }

  let sdkSessionId = session.sdk_session_id || undefined;

  try {
    const cwd = session.root_path || process.cwd();
    let systemInfo: SystemInfo | undefined;

    // Process @ mentions - convert file references to context hints
    const processedInput = processAtMentions(message.input, session.root_path);
    console.log('[@ Mention] Original input:', message.input);
    if (processedInput !== message.input) {
      console.log('[@ Mention] Processed input:', processedInput);
    }

    // Permission request callback (shared by claude and opencode)
    // Unified: ALL sessions (including agent sessions) go through the strategy chain.
    const permissionCallback = async (request: import('@my-claudia/shared').PermissionRequest) => {
      return new Promise<PermissionDecision>((resolve) => {
        // --- Unified permission strategy chain ---
        // Check both global and project-level policies.
        // Project override can independently enable auto-approve.
        const globalPolicy = getAgentPermissionPolicy(db);
        const projectOverride = getProjectPermissionOverride(db, session.project_id);
        const effectivePolicy = globalPolicy
          ? mergePolicy(globalPolicy, projectOverride)
          : projectOverride?.enabled
            ? normalizePolicy({ ...DEFAULT_PERMISSION_POLICY, ...projectOverride } as AgentPermissionPolicy)
            : null;
        const _cmdPreview = request.toolName === 'Bash' ? ` | cmd=${JSON.stringify((request.toolInput as any)?.command || request.detail).slice(0, 120)}` : '';
        console.log(`[Permission] Tool=${request.toolName}${_cmdPreview} | globalPolicy=${globalPolicy?.enabled ? 'enabled/' + globalPolicy.trustLevel : 'null/disabled'} | projectOverride=${projectOverride?.enabled ? 'enabled/' + projectOverride.trustLevel : 'null/disabled'} | effective=${effectivePolicy?.enabled ? 'enabled/' + effectivePolicy.trustLevel : 'null/disabled'} | project_id=${session.project_id}`);
        if (effectivePolicy?.enabled) {
          const evaluator = new PermissionEvaluator();
          const decision = evaluator.evaluate(
            request.toolName, request.toolInput, request.detail,
            effectivePolicy,
            { rootPath: cwd, sessionType }
          );
          console.log(`[Permission] Decision=${decision} for ${request.toolName} (trustLevel=${effectivePolicy.trustLevel})`);
          if (decision === 'approve') {
            console.log(`[Permission] Auto-approved ${request.toolName} for run ${runId} (${effectivePolicy.trustLevel})`);
            sendMessage(client.ws, {
              type: 'agent_permission_intercepted',
              toolName: request.toolName,
              decision: 'approve',
              reason: `Auto-approved by policy (${effectivePolicy.trustLevel})`,
              sessionId: message.sessionId,
              runId,
            } as import('@my-claudia/shared').AgentPermissionInterceptedMessage);
            resolve({ behavior: 'allow', updatedInput: request.toolInput });
            return;
          }
          if (decision === 'deny') {
            console.log(`[Permission] Auto-denied ${request.toolName} for run ${runId} (${effectivePolicy.trustLevel})`);
            sendMessage(client.ws, {
              type: 'agent_permission_intercepted',
              toolName: request.toolName,
              decision: 'deny',
              reason: `Auto-denied by policy (${effectivePolicy.trustLevel})`,
              sessionId: message.sessionId,
              runId,
            } as import('@my-claudia/shared').AgentPermissionInterceptedMessage);
            resolve({ behavior: 'deny', message: 'Denied by policy' });
            return;
          }
          // 'escalate' → fall through to user UI flow
        }
        // --- End strategy chain ---

        // For background sessions, escalate sends a notification instead of blocking UI
        if (sessionType === 'background') {
          sendMessage(client.ws, {
            type: 'background_permission_pending',
            sessionId: message.sessionId,
            requestId: request.requestId,
            toolName: request.toolName,
            detail: request.detail,
            timeoutSeconds: request.timeoutSeconds,
          } as import('@my-claudia/shared').BackgroundPermissionPendingMessage);

          sendMessage(client.ws, {
            type: 'background_task_update',
            sessionId: message.sessionId,
            status: 'paused',
            reason: `Permission needed: ${request.toolName}`,
          } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);

          notificationService.notify({
            type: 'background_permission',
            title: 'Background task needs attention',
            body: `${request.toolName}: ${request.detail.slice(0, 200)}`,
            priority: 'urgent',
            tags: ['rotating_light'],
          });
        }

        let timeout: ReturnType<typeof setTimeout> | null = null;
        if (request.timeoutSeconds > 0) {
          const timeoutMs = request.timeoutSeconds * 1000;
          timeout = setTimeout(() => {
            activeRun.pendingPermissions.delete(request.requestId);
            resolve({ behavior: 'deny', message: 'Permission request timed out' });
          }, timeoutMs);
        }

        const isAskUserQuestion = request.toolName === 'AskUserQuestion';
        const toolInput = request.toolInput as any;
        const requiresCredential = !isAskUserQuestion && isSudoCommand(request.toolName, request.toolInput);
        activeRun.pendingPermissions.set(request.requestId, {
          resolve,
          timeout,
          originalToolInput: request.toolInput,
          originalRequest: {
            toolName: request.toolName,
            detail: request.detail,
            timeoutSeconds: request.timeoutSeconds,
            sessionId: message.sessionId,
            ...(requiresCredential && { requiresCredential: true, credentialHint: 'sudo_password' }),
            ...(isAskUserQuestion && { questions: toolInput.questions || [] }),
          }
        });
        console.log(`[Permission] Stored pending permission ${request.requestId} in run ${runId} (timeout: ${request.timeoutSeconds > 0 ? request.timeoutSeconds + 's' : 'none'}, session: ${sessionType})`);

        // For regular sessions: send UI prompts as before
        if (sessionType !== 'background') {
          if (request.toolName === 'AskUserQuestion') {
            const toolInput = request.toolInput as { questions?: Array<any> };
            sendMessage(client.ws, {
              type: 'ask_user_question',
              requestId: request.requestId,
              sessionId: message.sessionId,
              questions: toolInput.questions || [],
            } as import('@my-claudia/shared').AskUserQuestionMessage);
            console.log(`[Permission] Sent ask_user_question ${request.requestId} to client (${(toolInput.questions || []).length} questions)`);
            const firstQuestion = (toolInput.questions || [])[0];
            notificationService.notify({
              type: 'ask_user_question',
              title: 'Claude has a question',
              body: firstQuestion?.question?.slice(0, 200) || 'Interactive question',
              priority: 'high',
              tags: ['question'],
            });
          } else {
            // Detect sudo commands and flag for credential input
            const requiresCredential = isSudoCommand(request.toolName, request.toolInput);
            sendMessage(client.ws, {
              type: 'permission_request',
              requestId: request.requestId,
              sessionId: message.sessionId,
              toolName: request.toolName,
              detail: request.detail,
              timeoutSeconds: request.timeoutSeconds,
              ...(requiresCredential && {
                requiresCredential: true,
                credentialHint: 'sudo_password',
              }),
            });
            console.log(`[Permission] Sent permission request ${request.requestId} to client${requiresCredential ? ' (requires sudo credential)' : ''}`);
            notificationService.notify({
              type: 'permission_request',
              title: 'Permission Required',
              body: `${request.toolName}: ${request.detail.slice(0, 200)}`,
              priority: 'urgent',
              tags: ['warning'],
            });
          }
        }
      });
    };

    // Select provider runner via registry
    // Resolve mode: prefer new unified `mode` field, fall back to legacy `permissionMode`
    let modeValue = message.mode || message.permissionMode || 'default';
    const providerType = providerConfig?.type || 'claude';

    // Note: Agent sessions no longer force bypassPermissions.
    // All sessions (including agent) go through the unified permission strategy chain.
    const adapter = providerRegistry.getOrDefault(providerType);

    // Auto-inject planning system prompt if session has an active planning supervision
    if (!message.systemContext && supervisorService) {
      const planningPrompt = supervisorService.getPlanningSystemPromptForSession(message.sessionId);
      if (planningPrompt) {
        message.systemContext = planningPrompt;
      }
    }

    // Inject file push context (env vars + system prompt) so AI agents can push files to user's device
    const filePushEnv: Record<string, string> = {};
    let filePushContext: string | undefined;
    if (serverPort) {
      const apiUrl = `http://127.0.0.1:${serverPort}`;
      filePushEnv.MY_CLAUDIA_API_URL = apiUrl;
      filePushEnv.MY_CLAUDIA_SESSION_ID = message.sessionId;
      filePushContext = buildFilePushContext(apiUrl, message.sessionId);
    }

    const runOptions = {
      cwd,
      sessionId: sdkSessionId,
      cliPath: providerConfig?.cliPath,
      env: { ...(providerConfig?.env || {}), ...filePushEnv },
      mode: modeValue,
      model: message.model,
      systemPrompt: [message.systemContext, filePushContext, session.system_prompt].filter(Boolean).join('\n\n') || undefined,
    };

    const providerRunner = adapter.run(processedInput, runOptions, permissionCallback);

    // Store provider info for abort support
    activeRun.providerType = providerType;
    const runState = adapter.getRunState?.(runOptions) || {};
    Object.assign(activeRun, runState);

    // Start periodic save for message persistence (survives cancel/disconnect)
    activeRun.saveInterval = setInterval(() => {
      try {
        upsertAssistantMessage(activeRun);
      } catch (err) {
        console.error(`[Periodic Save] Failed for run ${runId}:`, err);
      }
    }, PERIODIC_SAVE_INTERVAL_MS);

    // Run provider with streaming
    for await (const msg of providerRunner) {
      // Check if run was cancelled
      if (!activeRuns.has(runId)) {
        break;
      }

      switch (msg.type) {
        case 'init':
          // Save system info for potential use in /status command
          if (msg.systemInfo) {
            systemInfo = msg.systemInfo;
            // Send system info to client for display
            sendMessage(client.ws, {
              type: 'system_info',
              runId,
              systemInfo: {
                model: msg.systemInfo.model,
                claudeCodeVersion: msg.systemInfo.claudeCodeVersion,
                cwd: msg.systemInfo.cwd,
                permissionMode: msg.systemInfo.permissionMode,
                apiKeySource: msg.systemInfo.apiKeySource,
                tools: msg.systemInfo.tools,
                mcpServers: msg.systemInfo.mcpServers,
                slashCommands: msg.systemInfo.slashCommands,
                agents: msg.systemInfo.agents
              }
            });
          }
          if (msg.sessionId && !sdkSessionId) {
            sdkSessionId = msg.sessionId;
            // Update session with SDK session ID
            db.prepare(`
              UPDATE sessions SET sdk_session_id = ?, updated_at = ? WHERE id = ?
            `).run(sdkSessionId, Date.now(), message.sessionId);

            // Store session ID for provider abort support
            activeRun.providerSessionId = sdkSessionId;

            sendMessage(client.ws, {
              type: 'session_created',
              sessionId: message.sessionId,
              sdkSessionId: msg.sessionId
            });
          }
          break;

        case 'assistant':
          if (msg.content) {
            activeRun.fullContent += msg.content;
            sendMessage(client.ws, {
              type: 'delta',
              runId,
              sessionId: activeRun.sessionId,
              content: msg.content
            });
          }
          break;

        case 'tool_use':
          // Forward tool use to client
          console.log(`[Tool Use] ${msg.toolName} (${msg.toolUseId})`);
          // Track tool_use_id to tool_name mapping
          if (msg.toolUseId && msg.toolName) {
            toolUseIdToName.set(msg.toolUseId, msg.toolName);
          }
          // Collect for persistence
          activeRun.collectedToolCalls.push({
            toolUseId: msg.toolUseId || '',
            name: msg.toolName || '',
            input: msg.toolInput,
          });
          sendMessage(client.ws, {
            type: 'tool_use',
            runId,
            sessionId: activeRun.sessionId,
            toolUseId: msg.toolUseId || '',
            toolName: msg.toolName || '',
            toolInput: msg.toolInput
          });
          break;

        case 'tool_result': {
          // Forward tool result to client
          // Look up tool name from our tracking map
          const toolName = msg.toolUseId ? toolUseIdToName.get(msg.toolUseId) || '' : '';
          console.log(`[Tool Result] ${msg.toolUseId} (${toolName}) - error: ${msg.isToolError}`);
          // Update collected tool call with output
          const collected = activeRun.collectedToolCalls.find(tc => tc.toolUseId === msg.toolUseId);
          if (collected) {
            collected.output = msg.toolResult;
            collected.isError = msg.isToolError || false;
          }
          sendMessage(client.ws, {
            type: 'tool_result',
            runId,
            sessionId: activeRun.sessionId,
            toolUseId: msg.toolUseId || '',
            toolName: toolName,
            result: msg.toolResult,
            isError: msg.isToolError
          });
          // Claude-specific: sync plan mode state to client
          if (activeRun.providerType === 'claude' && !msg.isToolError) {
            if (toolName === 'EnterPlanMode') {
              sendMessage(client.ws, { type: 'mode_change', runId, sessionId: activeRun.sessionId, mode: 'plan' });
            } else if (toolName === 'ExitPlanMode') {
              sendMessage(client.ws, { type: 'mode_change', runId, sessionId: activeRun.sessionId, mode: 'default' });
            }
          }
          break;
        }

        case 'result':
          // If result has content that wasn't already streamed via 'assistant' events, send it.
          // (Some providers only return content in the result, not through streaming.)
          if (msg.content && !activeRun.fullContent) {
            activeRun.fullContent = msg.content;
            sendMessage(client.ws, {
              type: 'delta',
              runId,
              sessionId: activeRun.sessionId,
              content: msg.content
            });
          }

          // If this was a system-info command and we got no content, use systemInfo
          const inputTrimmed = message.input.trim().toLowerCase();
          if (!activeRun.fullContent && SYSTEM_INFO_COMMANDS.includes(inputTrimmed) && systemInfo) {
            console.log(`[System Info] Building output for "${message.input}" from init data`);
            const statusOutput = buildStatusOutput(systemInfo);
            if (statusOutput) {
              activeRun.fullContent = statusOutput;
              sendMessage(client.ws, {
                type: 'delta',
                runId,
                sessionId: activeRun.sessionId,
                content: statusOutput
              });
            }
          }

          // Final save — upsert with usage info and metadata indexing
          upsertAssistantMessage(activeRun, {
            usage: msg.usage,
            indexMetadata: true
          });

          sendMessage(client.ws, {
            type: 'run_completed',
            runId,
            sessionId: activeRun.sessionId,
            usage: msg.usage
          });
          notificationService.notify({
            type: 'run_completed',
            title: 'Run completed',
            body: `Session: ${message.sessionId}`,
            priority: 'default',
            tags: ['white_check_mark'],
          });
          // Notify background task completion
          if (sessionType === 'background') {
            sendMessage(client.ws, {
              type: 'background_task_update',
              sessionId: message.sessionId,
              status: 'completed',
            } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);
          }
          break;
      }
    }
  } catch (error) {
    console.error('Run error:', error);

    // If the Claude CLI process crashed (exit code 1), the SDK session may be
    // corrupted (e.g. bad model stored in transcript). Clear sdk_session_id so
    // the next attempt creates a fresh session instead of resuming the broken one.
    const errMsg = error instanceof Error ? error.message : '';
    if (errMsg.includes('process exited with code') && sdkSessionId) {
      console.log(`[Recovery] Clearing corrupted sdk_session_id ${sdkSessionId} for session ${message.sessionId}`);
      db.prepare(`UPDATE sessions SET sdk_session_id = NULL, updated_at = ? WHERE id = ?`)
        .run(Date.now(), message.sessionId);
    }

    // Save any accumulated content before reporting failure
    try {
      upsertAssistantMessage(activeRun, { indexMetadata: true });
    } catch (saveErr) {
      console.error(`[Error Save] Failed for run ${runId}:`, saveErr);
    }
    sendMessage(client.ws, {
      type: 'run_failed',
      runId,
      sessionId: activeRun.sessionId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    notificationService.notify({
      type: 'run_failed',
      title: 'Run failed',
      body: error instanceof Error ? error.message.slice(0, 200) : 'Unknown error',
      priority: 'high',
      tags: ['x'],
    });
    // Notify background task failure
    if (sessionType === 'background') {
      sendMessage(client.ws, {
        type: 'background_task_update',
        sessionId: message.sessionId,
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Unknown error',
      } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);
    }
  } finally {
    // Stop periodic save
    if (activeRun.saveInterval) {
      clearInterval(activeRun.saveInterval);
      activeRun.saveInterval = undefined;
    }

    // Cleanup
    activeRuns.delete(runId);
    broadcastHeartbeat();

    // Update session updated_at
    db.prepare(`
      UPDATE sessions SET updated_at = ? WHERE id = ?
    `).run(Date.now(), message.sessionId);
  }
}

function handleRunCancel(runId: string): void {
  cancelRun(runId);
}

function handlePermissionDecision(message: {
  type: 'permission_decision';
  requestId: string;
  allow: boolean;
  remember?: boolean;
  encryptedCredential?: string;
}): void {
  console.log(`[Permission] Received decision for ${message.requestId}: ${message.allow ? 'allow' : 'deny'}`);
  console.log(`[Permission] Active runs: ${activeRuns.size}`);

  // Find the run with this pending permission
  for (const [runId, run] of activeRuns.entries()) {
    console.log(`[Permission] Checking run ${runId}, pending permissions: ${run.pendingPermissions.size}`);
    const pending = run.pendingPermissions.get(message.requestId);
    if (pending) {
      // Clear timeout if it was set (timeout is null when timeoutSeconds = 0)
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      run.pendingPermissions.delete(message.requestId);

      // If credential was provided (e.g. sudo password), decrypt and rewrite the command
      let updatedInput: unknown | undefined;
      if (message.allow && message.encryptedCredential) {
        try {
          const password = decryptCredential(message.encryptedCredential);
          const originalInput = pending.originalToolInput as { command?: string } | undefined;
          if (originalInput?.command) {
            updatedInput = {
              ...originalInput,
              command: rewriteSudoCommand(originalInput.command, password),
            };
            console.log(`[Permission] ${message.requestId}: Rewrote sudo command with credential`);
          }
        } catch (err) {
          console.error(`[Permission] Failed to decrypt credential for ${message.requestId}:`, err);
          pending.resolve({ behavior: 'deny', message: 'Failed to decrypt credential' });
          return;
        }
      }

      const decision: PermissionDecision = {
        behavior: message.allow ? 'allow' : 'deny',
        message: message.allow ? undefined : 'User denied permission',
      };
      if (updatedInput !== undefined) {
        decision.updatedInput = updatedInput;
      }
      pending.resolve(decision);

      // Broadcast resolution to all clients (so other devices close their modals)
      sendMessage(run.client.ws, {
        type: 'permission_resolved',
        requestId: message.requestId,
        sessionId: run.sessionId,
        decision: message.allow ? 'allow' : 'deny',
      } as any);

      console.log(`[Permission] ${message.requestId}: ${message.allow ? 'allowed' : 'denied'} - resolved!`);
      return;
    }
  }

  // requestId not found — already resolved by another device. Broadcast idempotent resolution.
  console.warn(`[Permission] Request ${message.requestId} not found in any active run — broadcasting permission_resolved`);
  // Find any active run's client to broadcast through (they all share the same virtualClient in gateway mode)
  for (const [, run] of activeRuns.entries()) {
    sendMessage(run.client.ws, {
      type: 'permission_resolved',
      requestId: message.requestId,
      decision: message.allow ? 'allow' : 'deny',
    } as any);
    break;
  }
}

function handleAskUserAnswer(message: {
  type: 'ask_user_answer';
  requestId: string;
  formattedAnswer: string;
}): void {
  console.log(`[AskUser] Received answer for ${message.requestId}`);

  // Find the run with this pending permission (reuses the same pendingPermissions map)
  for (const [, run] of activeRuns.entries()) {
    const pending = run.pendingPermissions.get(message.requestId);
    if (pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
      run.pendingPermissions.delete(message.requestId);
      // Resolve with deny + user's formatted answer as the message
      // Claude reads this message and treats it as the user's response
      pending.resolve({ behavior: 'deny', message: message.formattedAnswer });

      // Broadcast resolution to all clients
      sendMessage(run.client.ws, {
        type: 'ask_user_question_resolved',
        requestId: message.requestId,
        sessionId: run.sessionId,
      } as any);

      console.log(`[AskUser] ${message.requestId}: answered - resolved!`);
      return;
    }
  }

  // requestId not found — already resolved by another device. Broadcast idempotent resolution.
  console.warn(`[AskUser] Request ${message.requestId} not found in any active run — broadcasting ask_user_question_resolved`);
  for (const [, run] of activeRuns.entries()) {
    sendMessage(run.client.ws, {
      type: 'ask_user_question_resolved',
      requestId: message.requestId,
    } as any);
    break;
  }
}

