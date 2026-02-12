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
import { isRequest, ALL_SERVER_FEATURES } from '@my-claudia/shared';
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
import { runOpenCode, abortOpenCodeSession, openCodeServerManager } from './providers/opencode-sdk.js';
import { safeCompare } from './auth.js';
import { extractAndIndexMetadata, removeIndexedMetadata } from './storage/metadata-extractor.js';

// Phase 2: Router architecture (CRUD routes migrated to HTTP REST)
import { createRouter } from './router/index.js';
import { loggingMiddleware as routerLoggingMiddleware } from './middleware/logging.js';
import { errorHandlingMiddleware as routerErrorMiddleware } from './middleware/error.js';

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
  client: ConnectedClient;      // Direct reference (works for both real WS and virtual gateway clients)
  abortController?: AbortController;
  openCodeSessionId?: string;  // For aborting opencode runs
  openCodeCwd?: string;        // cwd for opencode server lookup
  pendingPermissions: Map<string, {
    resolve: (decision: PermissionDecision) => void;
    timeout: NodeJS.Timeout | null;
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
  updateDiscoveredBackends: (backends: import('@my-claudia/shared').GatewayBackendInfo[]) => void;
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

  // Get server info (public - no auth required)
  app.get('/api/server/info', (req: Request, res: Response) => {
    const isLocal = isLocalhost(req);
    res.json({
      success: true,
      data: {
        version: '1.1.0',
        isLocalConnection: isLocal,
        features: ALL_SERVER_FEATURES,
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
            sendMessage(ws, {
              type: 'auth_result',
              success: true,
              isLocalConnection: client.isLocal,
              serverVersion: '1.1.0',
              features: ALL_SERVER_FEATURES,
            } as AuthResultMessage);
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
        await handleClientMessage(client, message, db, clients);
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
      await handleClientMessage(client, message, db, clients);
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
        gatewaySecret: config.gatewaySecret,
        backendName: config.backendName,
        registerAsBackend: config.registerAsBackend !== false,
        discoveredBackends: []
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
        gatewaySecret: null,
        backendName: null,
        registerAsBackend: true,
        discoveredBackends: []
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
    },
    updateDiscoveredBackends: (backends: import('@my-claudia/shared').GatewayBackendInfo[]) => {
      gatewayStatus.discoveredBackends = backends;
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

    // Abort opencode session if applicable
    if (run.openCodeSessionId && run.openCodeCwd) {
      abortOpenCodeSession(run.openCodeCwd, run.openCodeSessionId).catch(err => {
        console.error(`Failed to abort opencode session: ${err}`);
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
      error: 'Run cancelled by user'
    });

    activeRuns.delete(runId);
    console.log(`Run ${runId} cancelled`);
  }
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

  run.db.prepare(`
    INSERT INTO messages (id, session_id, role, content, metadata, created_at)
    VALUES (?, ?, 'assistant', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      metadata = excluded.metadata
  `).run(
    run.assistantMessageId,
    run.sessionId,
    run.fullContent,
    metadataJson,
    Date.now()
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
  clients: Map<string, ConnectedClient>
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
    mode?: string;   // Generic mode/agent ID (new unified field)
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

  // Track tool_use_id to tool_name mapping for this run
  const toolUseIdToName = new Map<string, string>();

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
    let sdkSessionId = session.sdk_session_id || undefined;
    let systemInfo: SystemInfo | undefined;

    // Process @ mentions - convert file references to context hints
    const processedInput = processAtMentions(message.input, session.root_path);
    console.log('[@ Mention] Original input:', message.input);
    if (processedInput !== message.input) {
      console.log('[@ Mention] Processed input:', processedInput);
    }

    // Permission request callback (shared by claude and opencode)
    const permissionCallback = async (request: import('@my-claudia/shared').PermissionRequest) => {
      return new Promise<PermissionDecision>((resolve) => {
        let timeout: ReturnType<typeof setTimeout> | null = null;
        if (request.timeoutSeconds > 0) {
          const timeoutMs = request.timeoutSeconds * 1000;
          timeout = setTimeout(() => {
            activeRun.pendingPermissions.delete(request.requestId);
            resolve({ behavior: 'deny', message: 'Permission request timed out' });
          }, timeoutMs);
        }

        activeRun.pendingPermissions.set(request.requestId, { resolve, timeout });
        console.log(`[Permission] Stored pending permission ${request.requestId} in run ${runId} (timeout: ${request.timeoutSeconds > 0 ? request.timeoutSeconds + 's' : 'none'})`);

        // AskUserQuestion: send interactive question UI instead of generic permission dialog
        if (request.toolName === 'AskUserQuestion') {
          const toolInput = request.toolInput as { questions?: Array<any> };
          sendMessage(client.ws, {
            type: 'ask_user_question',
            requestId: request.requestId,
            questions: toolInput.questions || [],
          } as import('@my-claudia/shared').AskUserQuestionMessage);
          console.log(`[Permission] Sent ask_user_question ${request.requestId} to client (${(toolInput.questions || []).length} questions)`);
        } else {
          sendMessage(client.ws, {
            type: 'permission_request',
            requestId: request.requestId,
            toolName: request.toolName,
            detail: request.detail,
            timeoutSeconds: request.timeoutSeconds
          });
          console.log(`[Permission] Sent permission request ${request.requestId} to client`);
        }
      });
    };

    // Select provider runner based on type
    // Resolve mode: prefer new unified `mode` field, fall back to legacy `permissionMode`
    const modeValue = message.mode || message.permissionMode || 'default';
    const providerType = providerConfig?.type || 'claude';
    const providerRunner = providerType === 'opencode'
      ? runOpenCode(processedInput, {
          cwd,
          sessionId: sdkSessionId,
          cliPath: providerConfig?.cliPath,
          env: providerConfig?.env,
          model: message.model,
          agent: modeValue,       // OpenCode: mode maps to agent
        }, permissionCallback)
      : runClaude(processedInput, {
          cwd,
          sessionId: sdkSessionId,
          cliPath: providerConfig?.cliPath,
          env: providerConfig?.env,
          permissionMode: modeValue as 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan',
          model: message.model,
        }, permissionCallback);

    // Store opencode session info for abort support
    if (providerType === 'opencode') {
      activeRun.openCodeCwd = cwd;
      // openCodeSessionId will be set when we receive the init message
    }

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

            // Store for opencode abort support
            if (providerType === 'opencode') {
              activeRun.openCodeSessionId = sdkSessionId;
            }

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
            activeRun.fullContent += msg.content;
            sendMessage(client.ws, {
              type: 'delta',
              runId,
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
            usage: msg.usage
          });
          break;
      }
    }
  } catch (error) {
    console.error('Run error:', error);
    // Save any accumulated content before reporting failure
    try {
      upsertAssistantMessage(activeRun, { indexMetadata: true });
    } catch (saveErr) {
      console.error(`[Error Save] Failed for run ${runId}:`, saveErr);
    }
    sendMessage(client.ws, {
      type: 'run_failed',
      runId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    // Stop periodic save
    if (activeRun.saveInterval) {
      clearInterval(activeRun.saveInterval);
      activeRun.saveInterval = undefined;
    }

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
      console.log(`[AskUser] ${message.requestId}: answered - resolved!`);
      return;
    }
  }

  console.warn(`[AskUser] Request ${message.requestId} not found in any active run`);
}

