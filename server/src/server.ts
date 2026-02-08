import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer as createHttpServer, Server, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import type {
  ClientMessage,
  ServerMessage,
  PongMessage,
  ErrorMessage,
  ProviderConfig,
  AuthResultMessage,
  ToolCall,
  Request as CorrelatedRequest
} from '@my-claudia/shared';
import { isRequest } from '@my-claudia/shared';
import { initDatabase } from './storage/db.js';
import { createProjectRoutes } from './routes/projects.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createProviderRoutes } from './routes/providers.js';
import { createFilesRoutes } from './routes/files.js';
import { createCommandsRoutes } from './routes/commands.js';
import { createGatewayRouter, type GatewayConfig, type GatewayStatus } from './routes/gateway.js';
import { createServerRoutes } from './routes/servers.js';
import { createImportRoutes } from './routes/import.js';
import { runClaude, type PermissionDecision, type SystemInfo } from './providers/claude-sdk.js';
import {
  loadOrCreateApiKey,
  regenerateApiKey,
  getMaskedApiKey,
  getFullApiKey,
  validateApiKey,
  getAuthConfigPath
} from './auth.js';

// Phase 2: Router architecture (CRUD routes migrated to HTTP REST)
import { createRouter } from './router/index.js';
import { loggingMiddleware as routerLoggingMiddleware } from './middleware/logging.js';
import { errorHandlingMiddleware as routerErrorMiddleware } from './middleware/error.js';

// Load API key on startup
const API_KEY = loadOrCreateApiKey();

// Check if input is a slash command
function isSlashCommand(input: string): boolean {
  return input.trim().startsWith('/');
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
    lines.push(`**MCP Servers:** ${systemInfo.mcpServers.length}`);
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
  abortController?: AbortController;
  pendingPermissions: Map<string, {
    resolve: (decision: PermissionDecision) => void;
    timeout: NodeJS.Timeout | null;
  }>;
}

const activeRuns = new Map<string, ActiveRun>();

// Check if request is from localhost
function isLocalhost(req: Request | IncomingMessage): boolean {
  let ip: string | undefined;
  if ('socket' in req && req.socket) {
    ip = req.socket.remoteAddress;
  }
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Authentication middleware for REST API
// All connections require API Key authentication (including localhost)
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
    });
    return;
  }

  const token = authHeader.slice(7);
  if (!validateApiKey(token)) {
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_API_KEY', message: 'Invalid API key' }
    });
    return;
  }

  next();
}

// Local-only middleware (for API key management endpoints)
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

// Export types for Gateway integration
export type { ConnectedClient };
export { sendMessage, handleClientMessage, activeRuns };

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
  handleMessage: (client: ConnectedClient, message: ClientMessage) => Promise<void>;
  getGatewayStatus: () => GatewayStatus;
  connectGateway: (config: GatewayConfig) => Promise<void>;
  disconnectGateway: () => Promise<void>;
  updateGatewayBackendId: (backendId: string | null) => void;
  setGatewayConnector: (connector: (config: GatewayConfig) => Promise<void>) => void;
  setGatewayDisconnector: (disconnector: () => Promise<void>) => void;
}

export async function createServer(): Promise<ServerContext> {
  // Initialize database
  const db = initDatabase();

  // Phase 2: Router (CRUD routes migrated to HTTP REST, router kept for future WS routing needs)
  const router = createRouter(db);
  router.use(routerLoggingMiddleware, routerErrorMiddleware);

  // Create Express app
  const app: Express = express();

  app.use(cors());
  app.use(express.json());

  // WebSocket clients map (declared early so it can be used in auth endpoints)
  const clients = new Map<string, ConnectedClient>();

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Authentication endpoints (some are local-only)

  // Get server info (public - no auth required)
  // Returns whether this connection is from localhost (used by client to determine UI features)
  app.get('/api/server/info', (req: Request, res: Response) => {
    const isLocal = isLocalhost(req);
    res.json({
      success: true,
      data: {
        version: '1.0.0',
        requiresAuth: !isLocal,
        isLocalConnection: isLocal  // Backend determines if client is connecting locally
      }
    });
  });

  // Verify API key (requires auth)
  app.post('/api/auth/verify', authMiddleware, (_req: Request, res: Response) => {
    res.json({ success: true });
  });

  // Get API key info (local only)
  app.get('/api/auth/key', localOnlyMiddleware, (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        maskedKey: getMaskedApiKey(),
        fullKey: getFullApiKey(),
        configPath: getAuthConfigPath()
      }
    });
  });

  // Regenerate API key (local only)
  app.post('/api/auth/key/regenerate', localOnlyMiddleware, (_req: Request, res: Response) => {
    const newKey = regenerateApiKey();

    // Disconnect all remote (non-local) clients
    clients.forEach((client, id) => {
      if (!client.isLocal) {
        client.ws.close(4001, 'API Key rotated');
        clients.delete(id);
      }
    });

    res.json({
      success: true,
      data: {
        maskedKey: getMaskedApiKey(),
        fullKey: newKey,
        configPath: getAuthConfigPath(),
        message: 'API Key regenerated. All remote connections have been disconnected.'
      }
    });
  });

  // Gateway state (managed by index.ts)
  let gatewayStatus: GatewayStatus = {
    enabled: false,
    connected: false,
    backendId: null,
    gatewayUrl: null,
    backendName: null
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
    await gatewayConnector(config);
  };

  const disconnectGateway = async () => {
    await gatewayDisconnector();
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

  // API routes (protected by auth middleware)
  app.use('/api/projects', authMiddleware, createProjectRoutes(db));
  app.use('/api/sessions', authMiddleware, createSessionRoutes(db));
  app.use('/api/providers', authMiddleware, createProviderRoutes(db));
  app.use('/api/servers', authMiddleware, createServerRoutes(db));
  app.use('/api/files', authMiddleware, createFilesRoutes());
  app.use('/api/commands', authMiddleware, createCommandsRoutes());
  app.use('/api/import', localOnlyMiddleware, createImportRoutes(db));
  app.use('/api/server/gateway', localOnlyMiddleware, createGatewayRouter(
    db,
    getGatewayStatus,
    connectGateway,
    disconnectGateway
  ));

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
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Ping interval for connection health
  const pingInterval = setInterval(() => {
    clients.forEach((client, id) => {
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
    // All connections require authentication via API Key
    const client: ConnectedClient = {
      id: clientId,
      ws,
      isAlive: true,
      isLocal: clientIsLocal,
      authenticated: false  // All clients must authenticate with API Key
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
            // Local clients always authenticate successfully (bypass API key validation)
            // Remote clients must provide valid API key
            if (client.isLocal || validateApiKey(message.apiKey)) {
              client.authenticated = true;
              console.log(`Client ${clientId} authenticated successfully (isLocal: ${client.isLocal})`);
              sendMessage(ws, {
                type: 'auth_result',
                success: true,
                isLocalConnection: client.isLocal
              } as AuthResultMessage);
            } else {
              console.log(`Client ${clientId} authentication failed: invalid API key`);
              sendMessage(ws, {
                type: 'auth_result',
                success: false,
                error: 'Invalid API key'
              } as AuthResultMessage);
              ws.close(4001, 'Authentication failed');
            }
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
        await handleClientMessage(client, message, db);
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

      // Cancel any active runs for this client
      activeRuns.forEach((run, runId) => {
        if (run.clientId === clientId) {
          cancelRun(runId);
        }
      });
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
    });
  });

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  return {
    server,
    db,
    handleMessage: async (client: ConnectedClient, message: ClientMessage) => {
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
      await handleClientMessage(client, message, db);
    },
    getGatewayStatus: () => gatewayStatus,
    setGatewayConnector: (connector: (config: GatewayConfig) => Promise<void>) => {
      gatewayConnector = connector;
    },
    setGatewayDisconnector: (disconnector: () => Promise<void>) => {
      gatewayDisconnector = disconnector;
    },
    connectGateway: async (config: GatewayConfig) => {
      gatewayStatus = {
        enabled: true,
        connected: false,
        backendId: null,
        gatewayUrl: config.gatewayUrl,
        backendName: config.backendName
      };
      await gatewayConnector(config);
    },
    disconnectGateway: async () => {
      await gatewayDisconnector();
      gatewayStatus = {
        enabled: false,
        connected: false,
        backendId: null,
        gatewayUrl: null,
        backendName: null
      };
    },
    updateGatewayBackendId: (backendId: string | null) => {
      gatewayStatus.backendId = backendId;
      gatewayStatus.connected = backendId !== null;
      if (backendId) {
        db.prepare(`
          UPDATE gateway_config SET backend_id = ?, updated_at = ? WHERE id = 1
        `).run(backendId, Date.now());
      }
    }
  };
}

function sendMessage(ws: WebSocket, message: ServerMessage): void {
  // Check readyState as number to support both real WebSocket and virtual clients
  // WebSocket.OPEN === 1, but virtual clients may have readyState typed differently
  if ((ws.readyState as number) === 1) {
    ws.send(JSON.stringify(message));
  }
}

function cancelRun(runId: string): void {
  const run = activeRuns.get(runId);
  if (run) {
    // Reject all pending permissions
    run.pendingPermissions.forEach(({ resolve, timeout }) => {
      if (timeout) clearTimeout(timeout);
      resolve({ behavior: 'deny', message: 'Run cancelled' });
    });
    run.pendingPermissions.clear();
    activeRuns.delete(runId);
    console.log(`Run ${runId} cancelled`);
  }
}

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
  db: ReturnType<typeof initDatabase>
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

    default:
      sendMessage(client.ws, {
        type: 'error',
        code: 'UNKNOWN_MESSAGE_TYPE',
        message: `Unknown message type: ${(message as { type: string }).type}`
      } as ErrorMessage);
  }
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
    model?: string;
  },
  db: ReturnType<typeof initDatabase>
): Promise<void> {
  const runId = uuidv4();

  // Get session info
  const session = db.prepare(`
    SELECT s.id, s.project_id, s.sdk_session_id, p.root_path, p.provider_id
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(message.sessionId) as {
    id: string;
    project_id: string;
    sdk_session_id: string | null;
    root_path: string | null;
    provider_id: string | null;
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

  // Create active run tracking
  const activeRun: ActiveRun = {
    runId,
    clientId: client.id,
    pendingPermissions: new Map()
  };
  activeRuns.set(runId, activeRun);

  // Track tool_use_id to tool_name mapping for this run
  const toolUseIdToName = new Map<string, string>();

  // Collect tool calls for persistence in message metadata
  const collectedToolCalls: (ToolCall & { toolUseId: string })[] = [];

  // Send run started
  sendMessage(client.ws, {
    type: 'run_started',
    runId,
    clientRequestId: message.clientRequestId
  });

  // Save user message to database
  const userMessageId = uuidv4();
  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, created_at)
    VALUES (?, ?, 'user', ?, ?)
  `).run(userMessageId, message.sessionId, message.input, Date.now());

  try {
    const cwd = session.root_path || process.cwd();
    let fullContent = '';
    let sdkSessionId = session.sdk_session_id || undefined;
    let systemInfo: SystemInfo | undefined;

    // Process @ mentions - convert file references to context hints
    const processedInput = processAtMentions(message.input, session.root_path);
    console.log('[@ Mention] Original input:', message.input);
    if (processedInput !== message.input) {
      console.log('[@ Mention] Processed input:', processedInput);
    }

    // Run Claude with streaming
    for await (const msg of runClaude(
      processedInput,
      {
        cwd,
        sessionId: sdkSessionId,
        cliPath: providerConfig?.cliPath,
        env: providerConfig?.env,
        permissionMode: message.permissionMode,  // Pass permission mode to SDK
        model: message.model,  // Pass model override to SDK
      },
      // Permission request callback
      async (request) => {
        return new Promise<PermissionDecision>((resolve) => {
          // Set timeout for auto-deny only if timeoutSeconds > 0
          // timeoutSeconds = 0 means no timeout (wait indefinitely)
          let timeout: ReturnType<typeof setTimeout> | null = null;
          if (request.timeoutSeconds > 0) {
            const timeoutMs = request.timeoutSeconds * 1000;
            timeout = setTimeout(() => {
              activeRun.pendingPermissions.delete(request.requestId);
              resolve({ behavior: 'deny', message: 'Permission request timed out' });
            }, timeoutMs);
          }

          // Store the resolver
          activeRun.pendingPermissions.set(request.requestId, { resolve, timeout });
          console.log(`[Permission] Stored pending permission ${request.requestId} in run ${runId} (timeout: ${request.timeoutSeconds > 0 ? request.timeoutSeconds + 's' : 'none'})`);

          // Send permission request to client
          sendMessage(client.ws, {
            type: 'permission_request',
            requestId: request.requestId,
            toolName: request.toolName,
            detail: request.detail,
            timeoutSeconds: request.timeoutSeconds
          });
          console.log(`[Permission] Sent permission request ${request.requestId} to client`);
        });
      }
    )) {
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

            sendMessage(client.ws, {
              type: 'session_created',
              sessionId: message.sessionId,
              sdkSessionId: msg.sessionId
            });
          }
          break;

        case 'assistant':
          if (msg.content) {
            fullContent += msg.content;
            sendMessage(client.ws, {
              type: 'delta',
              runId,
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
          collectedToolCalls.push({
            toolUseId: msg.toolUseId || '',
            name: msg.toolName || '',
            input: msg.toolInput,
          });
          sendMessage(client.ws, {
            type: 'tool_use',
            runId,
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
          const collected = collectedToolCalls.find(tc => tc.toolUseId === msg.toolUseId);
          if (collected) {
            collected.output = msg.toolResult;
            collected.isError = msg.isToolError || false;
          }
          sendMessage(client.ws, {
            type: 'tool_result',
            runId,
            toolUseId: msg.toolUseId || '',
            toolName: toolName,
            result: msg.toolResult,
            isError: msg.isToolError
          });
          break;
        }

        case 'result':
          // If result has content (some commands return content in result), send it
          if (msg.content) {
            fullContent += msg.content;
            sendMessage(client.ws, {
              type: 'delta',
              runId,
              content: msg.content
            });
          }

          // If this was a system-info command and we got no content, use systemInfo
          const inputTrimmed = message.input.trim().toLowerCase();
          if (!fullContent && SYSTEM_INFO_COMMANDS.includes(inputTrimmed) && systemInfo) {
            console.log(`[System Info] Building output for "${message.input}" from init data`);
            const statusOutput = buildStatusOutput(systemInfo);
            if (statusOutput) {
              fullContent = statusOutput;
              sendMessage(client.ws, {
                type: 'delta',
                runId,
                content: statusOutput
              });
            }
          }

          // Save assistant message to database
          if (fullContent) {
            const assistantMessageId = uuidv4();
            // Build metadata with usage and persisted tool calls
            const metadata: Record<string, unknown> = {};
            if (msg.usage) {
              metadata.usage = msg.usage;
            }
            if (collectedToolCalls.length > 0) {
              // Strip internal toolUseId before persisting
              metadata.toolCalls = collectedToolCalls.map(({ name, input, output, isError }) => ({
                name, input, output, isError
              }));
            }
            db.prepare(`
              INSERT INTO messages (id, session_id, role, content, metadata, created_at)
              VALUES (?, ?, 'assistant', ?, ?, ?)
            `).run(
              assistantMessageId,
              message.sessionId,
              fullContent,
              Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
              Date.now()
            );
          }

          sendMessage(client.ws, {
            type: 'run_completed',
            runId,
            usage: msg.usage
          });
          break;
      }
    }
  } catch (error) {
    console.error('Run error:', error);
    sendMessage(client.ws, {
      type: 'run_failed',
      runId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    // Cleanup
    activeRuns.delete(runId);

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

      pending.resolve({
        behavior: message.allow ? 'allow' : 'deny',
        message: message.allow ? undefined : 'User denied permission'
      });

      console.log(`[Permission] ${message.requestId}: ${message.allow ? 'allowed' : 'denied'} - resolved!`);
      return;
    }
  }

  console.warn(`[Permission] Request ${message.requestId} not found in any active run`);
}

