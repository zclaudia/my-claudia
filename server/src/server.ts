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
  ContentBlock,
  Request as CorrelatedRequest,
  StateHeartbeatMessage,
  RunHealthStatus
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
import { createSupervisionV2Routes } from './routes/supervision-v2.js';
import { createNotificationRoutes } from './routes/notifications.js';
import { createPluginToolsRoutes } from './routes/plugin-tools.js';
import { createPluginRoutes } from './routes/plugins.js';
import { createMcpServerRoutes } from './routes/mcp-servers.js';
import { createSystemStatsRoutes } from './routes/system-stats.js';
import { createLocalPRRoutes } from './routes/local-prs.js';
import { LocalPRService } from './services/local-pr-service.js';
import { ScheduledTaskService } from './services/scheduled-task-service.js';
import { createScheduledTaskRoutes } from './routes/scheduled-tasks.js';
import { SupervisorV2Service } from './services/supervisor-v2-service.js';
import { StateRecovery } from './services/state-recovery.js';
import { CheckpointEngine } from './services/checkpoint-engine.js';
import { ContextManager } from './services/context-manager.js';
import { SupervisionTaskRepository } from './repositories/supervision-task.js';
import { ProjectRepository } from './repositories/project.js';
import { SessionRepository } from './repositories/session.js';
import { NotificationService } from './services/notification-service.js';
import { PermissionEvaluator, getAgentPermissionPolicy, getProjectPermissionOverride, mergePolicy, normalizePolicy } from './agent/permission-evaluator.js';
import type { PermissionDecision, SystemInfo } from './providers/claude-sdk.js';
import { openCodeServerManager } from './providers/opencode-sdk.js';
import { providerRegistry } from './providers/registry.js';
import { safeCompare } from './auth.js';
import { extractAndIndexMetadata, removeIndexedMetadata } from './storage/metadata-extractor.js';
import { TerminalManager } from './terminal-manager.js';
import { generateKeyPair, getPublicKeyPem, decryptCredential } from './utils/crypto.js';
import { getSdkVersionReport } from './utils/sdk-version-check.js';
import { getGatewayClientMode } from './gateway-instance.js';
import { generateToolSignature, detectLoop } from './loop-detection.js';
import { pluginEvents } from './events/index.js';
import { pluginLoader } from './plugins/loader.js';
import { permissionManager as pluginPermissionManager } from './plugins/permissions.js';
import { toolRegistry as pluginToolRegistry } from './plugins/tool-registry.js';
import { commandRegistry as pluginCommandRegistry } from './commands/registry.js';

// Phase 2: Router architecture (CRUD routes migrated to HTTP REST)
import { createRouter } from './router/index.js';
import { loggingMiddleware as routerLoggingMiddleware } from './middleware/logging.js';
import { errorHandlingMiddleware as routerErrorMiddleware } from './middleware/error.js';

// Default permission policy base (used when only project override exists, no global policy)
const DEFAULT_PERMISSION_POLICY: AgentPermissionPolicy = {
  enabled: false,
  trustLevel: 'conservative',
  customRules: [],
  escalateAlways: ['AskUserQuestion', 'ExitPlanMode'],
};

// Permission timeout policies: keyed by tool name, applied when the request times out.
// condition() is evaluated at request time against the current ActiveRun state.
const PERMISSION_TIMEOUT_POLICIES: Map<string, {
  behavior: 'approve' | 'deny';
  /** Override timeoutSeconds when the request has no timeout (0). */
  timeoutSeconds?: number;
  condition?: (run: { aiInitiatedPlanMode?: boolean }) => boolean;
}> = new Map([
  ['ExitPlanMode', {
    behavior: 'approve',
    timeoutSeconds: 120, // 2 minutes
    condition: (run) => !!run.aiInitiatedPlanMode,
  }],
]);

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

function isBashLikeTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'bash' || lower === 'execute_command' || lower === 'run_terminal_cmd' || lower === 'terminal';
}

function providerSupportsNativePlanMode(providerType: string): boolean {
  return providerType === 'claude' || providerType === 'cursor' || providerType === 'codex';
}

function buildNonNativePlanPrompt(providerType: string): string {
  return [
    'You are in STRICT PLAN MODE (enforced by platform policy).',
    `Provider: ${providerType}.`,
    '',
    'Rules:',
    '- Do analysis and planning only.',
    '- Do NOT modify files, create files, delete files, or run mutating shell commands.',
    '- If implementation is needed, describe it as a future execution plan.',
    '',
    'Output format:',
    '1) Goal',
    '2) Assumptions',
    '3) Step-by-step plan',
    '4) Risks/unknowns',
    '5) Verification checklist',
  ].join('\n');
}

function buildPlanDocumentPrompt(taskId: string): string {
  return [
    'Plan document requirement:',
    `- Keep the plan synchronized in: .supervision/plans/task-${taskId}.plan.md`,
    '- Use markdown headings: # Goal, # Scope, # Steps, # Verification',
    '- Optional headings: # Risks, # Assumptions',
  ].join('\n');
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

function formatProviderErrorMessage(raw: string, providerType?: string): string {
  const msg = raw.trim();
  const lower = msg.toLowerCase();
  const isLimitLike =
    lower.includes('rate limit') ||
    lower.includes('ratelimit') ||
    lower.includes('too many requests') ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota') ||
    lower.includes('billing') ||
    lower.includes('usage limit') ||
    lower.includes('429');

  if (!isLimitLike) return msg || 'Unknown error';
  const provider = providerType ? providerType.toUpperCase() : 'Provider';
  return `${provider} request limit reached. Please wait and retry, or switch account/model. (${msg})`;
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
      aiInitiated?: boolean;
    };
  }>;
  // Streaming state for message persistence (allows cancelRun to save partial content)
  db: ReturnType<typeof initDatabase>;
  sessionId: string;
  assistantMessageId: string;
  fullContent: string;
  collectedToolCalls: (ToolCall & { toolUseId: string })[];
  contentBlocks: ContentBlock[];
  saveInterval?: NodeJS.Timeout;
  completed?: boolean;  // True after run_completed/run_failed sent; hides from heartbeat while for-await drains
  sessionType: 'regular' | 'background';  // Whether this is a background task run
  /** True when AI called EnterPlanMode during a non-plan-mode run (not user-initiated). */
  aiInitiatedPlanMode?: boolean;
  // Stuck/loop detection
  startedAt: number;
  lastActivityAt: number;
  recentToolCalls: string[];  // Last N tool names (sliding window for loop detection)
  loopHeartbeatStreak: number; // Consecutive heartbeats that detect a loop pattern
  latestSystemInfo?: SystemInfo; // Used for heartbeat reconciliation on late-joining clients
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

  // Supervision v2 routes + service
  const taskRepo = new SupervisionTaskRepository(db);
  const projectRepo = new ProjectRepository(db);
  const sessionRepo = new SessionRepository(db);
  const supervisorV2Service = new SupervisorV2Service(
    db, taskRepo, projectRepo, sessionRepo,
    (msg) => {
      clients.forEach((client) => {
        if (client.authenticated) {
          sendMessage(client.ws, msg);
        }
      });
    }
  );
  // Supervision V2 canonical routes (frontend uses /api/v2/*)
  app.use('/api/v2', authMiddleware, createSupervisionV2Routes(supervisorV2Service));
  // Backward-compat alias for older clients that still use /api/v2/supervision/*
  app.use('/api/v2/supervision', authMiddleware, createSupervisionV2Routes(supervisorV2Service));

  // Local PR workflow service + routes
  const localPRService = new LocalPRService(db, (projectId, message) => {
    clients.forEach((client) => {
      if (client.authenticated) sendMessage(client.ws, message);
    });
  });
  app.use('/api', authMiddleware, createLocalPRRoutes(localPRService, db));

  // Scheduled task service + routes
  const scheduledTaskService = new ScheduledTaskService(db, (message) => {
    clients.forEach((client) => {
      if (client.authenticated) sendMessage(client.ws, message);
    });
  });
  app.use('/api', authMiddleware, createScheduledTaskRoutes(scheduledTaskService));

  // Notification routes + service
  notificationService = new NotificationService(db);
  app.use('/api/notifications', authMiddleware, createNotificationRoutes(notificationService));

  // Plugin routes
  app.use('/api/plugins', authMiddleware, createPluginRoutes());
  app.use('/api/plugins', localOnlyMiddleware, createPluginToolsRoutes());

  // MCP server management routes
  app.use('/api/mcp-servers', authMiddleware, createMcpServerRoutes(db));

  // System stats + plugin storage reader (local only)
  app.use('/api/system', localOnlyMiddleware, createSystemStatsRoutes());

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

            // Send plugin state to newly authenticated client
            if (pluginLoader.getPlugins().length > 0) {
              const pluginState = buildPluginStateMessage();
              sendMessage(ws, pluginState);
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

  // State recovery — re-hydrate stuck tasks before starting polling
  const stateRecovery = new StateRecovery(
    db, taskRepo, sessionRepo, projectRepo, supervisorV2Service, activeRuns,
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
      // Log via db directly (same pattern as supervisor-v2-service)
      const id = crypto.randomUUID();
      try {
        db.prepare(
          `INSERT INTO supervision_v2_logs (id, project_id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, projectId, taskIdArg ?? null, event, detail ? JSON.stringify(detail) : null, Date.now());
      } catch { /* best effort */ }
    },
    (projectId, data) => supervisorV2Service.createTask(projectId, data),
    createVirtualClient,
    handleRunStart as any,
  );
  supervisorV2Service.setCheckpointEngine(checkpointEngine);

  // Start supervision v2 polling
  supervisorV2Service.start(5000);

  // Wire plugin loader broadcast for UI notifications
  pluginLoader.setBroadcast((msg: ServerMessage) => {
    clients.forEach((client) => {
      if (client.authenticated) {
        sendMessage(client.ws, msg);
      }
    });
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

  // Local PR scheduler (runs on same cadence as supervision: every 10s)
  setInterval(() => {
    localPRService.tick().catch((err) => console.error('[LocalPR] Tick error:', err));
  }, 10000);

  // Scheduled task scheduler (every 10s)
  setInterval(() => {
    scheduledTaskService.tick().catch((err) => console.error('[ScheduledTasks] Tick error:', err));
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
    supervisorV2Service.stop();
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
    if (run.completed) continue;  // Run finished but for-await still draining SDK messages
    const idleSec = (Date.now() - run.lastActivityAt) / 1000;
    const loop = detectLoop(run.recentToolCalls);
    if (loop.detected) {
      run.loopHeartbeatStreak += 1;
    } else {
      run.loopHeartbeatStreak = 0;
    }
    let health: RunHealthStatus = 'healthy';
    if (loop.detected && run.loopHeartbeatStreak >= 3) health = 'loop';
    else if (idleSec > 60) health = 'idle';
    runs.push({
      runId,
      sessionId: run.sessionId,
      startedAt: run.startedAt,
      lastActivityAt: run.lastActivityAt,
      health,
      loopPattern: (loop.detected && run.loopHeartbeatStreak >= 3) ? loop.pattern : undefined,
      sessionType: run.sessionType,
      systemInfo: run.latestSystemInfo,
    });
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
          aiInitiated: pending.originalRequest.aiInitiated,
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

/** Build a PluginStateMessage with current plugin states. */
function buildPluginStateMessage(): import('@my-claudia/shared').PluginStateMessage {
  const plugins = pluginLoader.getPlugins().map(p => ({
    id: p.manifest.id,
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    status: (p.isActive ? 'active' : p.error ? 'error' : 'inactive') as 'active' | 'inactive' | 'error',
    enabled: p.isActive,
    error: p.error,
    permissions: p.manifest.permissions || [],
    grantedPermissions: pluginPermissionManager.getGrantedPermissions(p.manifest.id),
    tools: pluginToolRegistry.getByPlugin(p.manifest.id).map(t => t.definition.function.name),
    commands: pluginCommandRegistry.getByPlugin(p.manifest.id).map(c => c.command),
    path: p.path,
  }));
  return { type: 'plugin_state', plugins };
}

/** Broadcast plugin state to all authenticated clients. */
function broadcastPluginState(): void {
  const msg = buildPluginStateMessage();
  connectedClients.forEach((client) => {
    if (client.authenticated) {
      sendMessage(client.ws, msg);
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
    metadata.toolCalls = run.collectedToolCalls.map(({ toolUseId, name, input, output, isError }) => ({
      toolUseId, name, input, output, isError
    }));
  }
  if (run.contentBlocks.length > 0) {
    metadata.contentBlocks = run.contentBlocks;
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
      // Pass the target cwd to TerminalManager — it spawns at $HOME then cd's to this path
      // (avoids macOS TCC permission dialogs that block pty.spawn)
      const cwd = message.workingDirectory || project?.root_path || process.env.HOME || '/';
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

    case 'plugin_permission_response': {
      const { pluginId, granted, permanently } = message as import('@my-claudia/shared').PluginPermissionResponseMessage;
      pluginPermissionManager.respondToRequest(pluginId, granted, permanently);
      broadcastPluginState();
      break;
    }

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
    permissionOverride?: Partial<import('@my-claudia/shared').AgentPermissionPolicy>;
    systemContext?: string;
    workingDirectory?: string;  // Optional working directory override
    resend?: boolean;  // True when resending — skip inserting duplicate user message
  },
  db: ReturnType<typeof initDatabase>
): Promise<void> {
  const runId = uuidv4();

  // Get session info
  const session = db.prepare(`
    SELECT s.id, s.project_id, s.sdk_session_id, s.type as session_type,
           s.working_directory, s.project_role, s.plan_status, s.task_id,
           p.root_path, COALESCE(s.provider_id, p.provider_id) as provider_id, p.system_prompt
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(message.sessionId) as {
    id: string;
    project_id: string;
    sdk_session_id: string | null;
    session_type: 'regular' | 'background' | null;
    working_directory: string | null;
    project_role: string | null;
    plan_status: string | null;
    task_id: string | null;
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

  // Hard guard: never allow overlapping runs in the same session.
  const existingRunId = (() => {
    for (const [id, run] of activeRuns.entries()) {
      if (run.sessionId === message.sessionId && !run.completed) return id;
    }
    return null;
  })();
  if (existingRunId) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'SESSION_BUSY',
      message: `Session is already running (runId: ${existingRunId})`,
    } as ErrorMessage);
    return;
  }

  // Get provider config: message override → session → project → system default
  const explicitProviderId = message.providerId || session.provider_id;
  const providerId = explicitProviderId || (() => {
    const defaultRow = db.prepare(`SELECT id FROM providers WHERE is_default = 1 LIMIT 1`).get() as { id: string } | undefined;
    return defaultRow?.id || null;
  })();
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

  // Session type: 'regular' or 'background'
  const sessionType = (session.session_type || 'regular') as 'regular' | 'background';

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
    contentBlocks: [],
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    recentToolCalls: [],
    loopHeartbeatStreak: 0,
    sessionType,
    aiInitiatedPlanMode: false,
  };
  activeRuns.set(runId, activeRun);

  // Persist run status for crash recovery
  db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
    .run('running', Date.now(), message.sessionId);

  // Track tool_use_id to tool_name mapping for this run
  const toolUseIdToName = new Map<string, string>();

  // Save user message to database (before sending run_started so IDs are available)
  // Skip when resending — the user message already exists in the DB
  let userMessageId: string | undefined;
  if (!message.resend) {
    userMessageId = uuidv4();
    const userOffset = getNextOffset(db, message.sessionId);
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at, offset)
      VALUES (?, ?, 'user', ?, ?, ?)
    `).run(userMessageId, message.sessionId, message.input, Date.now(), userOffset);
  }

  // Send run started (include real DB message IDs for client-side dedup)
  sendMessage(client.ws, {
    type: 'run_started',
    runId,
    sessionId: message.sessionId,
    clientRequestId: message.clientRequestId,
    userMessageId,
    assistantMessageId: activeRun.assistantMessageId,
    sessionType,
  });

  // Emit plugin event
  pluginEvents.emit('run.started', {
    runId,
    sessionId: message.sessionId,
    input: message.input,
    providerId,
    providerType: providerConfig?.type,
  }).catch(() => {});

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
    // Priority: message override > session working_directory > project root_path > fallback
    const cwd = message.workingDirectory
      || session.working_directory
      || session.root_path
      || process.cwd();

    // Validate cwd exists — spawn() fails with cryptic ENOENT if cwd is invalid
    if (!fs.existsSync(cwd)) {
      console.warn(`[Run] cwd does not exist: ${cwd}`);
      sendMessage(client.ws, {
        type: 'run_failed',
        runId,
        sessionId: activeRun.sessionId,
        error: `Project path does not exist: ${cwd}`
      });
      activeRun.completed = true;
      broadcastHeartbeat();
      activeRuns.delete(runId);
      return;
    }
    let systemInfo: SystemInfo | undefined;

    // Process @ mentions - convert file references to context hints
    const processedInput = processAtMentions(message.input, session.root_path);
    console.log('[@ Mention] Original input:', message.input);
    if (processedInput !== message.input) {
      console.log('[@ Mention] Processed input:', processedInput);
    }

    const providerType = providerConfig?.type || 'claude';
    const forcedPlanBySession = session.project_role === 'task' && session.plan_status === 'planning';
    let modeValue = forcedPlanBySession
      ? 'plan'
      : (message.mode || message.permissionMode || 'default');
    if (forcedPlanBySession && modeValue !== (message.mode || message.permissionMode || 'default')) {
      console.log(`[Mode] Forced plan mode for task planning session ${message.sessionId}`);
    }

    // Permission request callback (shared by claude and opencode)
    // Unified: ALL sessions (including agent sessions) go through the strategy chain.
    const sessionPermissionOverride = message.permissionOverride;
    const permissionCallback = async (request: import('@my-claudia/shared').PermissionRequest) => {
      return new Promise<PermissionDecision>((resolve) => {
        // Strict plan guard is only for Supervisor-forced planning sessions.
        // Normal user-selected plan mode must still allow ExitPlanMode approval flow.
        if (forcedPlanBySession && modeValue === 'plan') {
          const planReadOnlyTools = new Set([
            'read', 'glob', 'grep', 'webfetch', 'websearch', 'todowrite', 'ls', 'askuserquestion',
          ]);
          const normalizedTool = request.toolName.toLowerCase();
          const isAllowedReadTool = planReadOnlyTools.has(normalizedTool);
          const shouldDeny = isBashLikeTool(request.toolName) || !isAllowedReadTool;
          if (shouldDeny) {
            const reason = `Denied by strict Plan Mode: ${request.toolName} is not allowed.`;
            sendMessage(client.ws, {
              type: 'agent_permission_intercepted',
              toolName: request.toolName,
              decision: 'deny',
              reason,
              sessionId: message.sessionId,
              runId,
            } as import('@my-claudia/shared').AgentPermissionInterceptedMessage);
            resolve({ behavior: 'deny', message: reason });
            return;
          }
        }

        // --- Unified permission strategy chain ---
        // Check global, project-level, and session-level policies.
        // Session override has highest priority.
        const globalPolicy = getAgentPermissionPolicy(db);
        const projectOverride = getProjectPermissionOverride(db, session.project_id);

        // Merge: global → project → session
        let effectivePolicy = globalPolicy
          ? mergePolicy(globalPolicy, projectOverride)
          : projectOverride?.enabled
            ? normalizePolicy({ ...DEFAULT_PERMISSION_POLICY, ...projectOverride } as AgentPermissionPolicy)
            : null;

        // Apply session-level override if present
        if (effectivePolicy && sessionPermissionOverride) {
          effectivePolicy = mergePolicy(effectivePolicy, sessionPermissionOverride);
        } else if (!effectivePolicy && sessionPermissionOverride?.enabled) {
          effectivePolicy = normalizePolicy({ ...DEFAULT_PERMISSION_POLICY, ...sessionPermissionOverride } as AgentPermissionPolicy);
        }

        const _cmdPreview = request.toolName === 'Bash' ? ` | cmd=${JSON.stringify((request.toolInput as any)?.command || request.detail).slice(0, 120)}` : '';
        console.log(`[Permission] Tool=${request.toolName}${_cmdPreview} | globalPolicy=${globalPolicy?.enabled ? 'enabled/' + globalPolicy.trustLevel : 'null/disabled'} | projectOverride=${projectOverride?.enabled ? 'enabled/' + projectOverride.trustLevel : 'null/disabled'} | sessionOverride=${sessionPermissionOverride?.enabled ? 'enabled/' + sessionPermissionOverride.trustLevel : 'null/disabled'} | effective=${effectivePolicy?.enabled ? 'enabled/' + effectivePolicy.trustLevel : 'null/disabled'} | project_id=${session.project_id}`);
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

        // Determine effective timeout behavior from policy table
        const timeoutPolicy = PERMISSION_TIMEOUT_POLICIES.get(request.toolName);
        const policyApplies = timeoutPolicy && (!timeoutPolicy.condition || timeoutPolicy.condition(activeRun));
        const effectiveTimeoutBehavior: 'approve' | 'deny' =
          policyApplies ? timeoutPolicy!.behavior : (request.timeoutBehavior || 'deny');
        let effectiveTimeoutSeconds = request.timeoutSeconds;
        if (policyApplies && effectiveTimeoutSeconds === 0 && timeoutPolicy!.timeoutSeconds) {
          effectiveTimeoutSeconds = timeoutPolicy!.timeoutSeconds;
        }
        const aiInitiated = policyApplies && timeoutPolicy!.behavior === 'approve';

        let timeout: ReturnType<typeof setTimeout> | null = null;
        if (effectiveTimeoutSeconds > 0) {
          const timeoutMs = effectiveTimeoutSeconds * 1000;
          timeout = setTimeout(() => {
            activeRun.pendingPermissions.delete(request.requestId);
            sendMessage(client.ws, {
              type: 'permission_auto_resolved',
              requestId: request.requestId,
              sessionId: message.sessionId,
              behavior: effectiveTimeoutBehavior,
            } as import('@my-claudia/shared').PermissionAutoResolvedMessage);
            if (effectiveTimeoutBehavior === 'approve') {
              console.log(`[Permission] Auto-approved ${request.requestId} (${request.toolName}) on timeout`);
              resolve({ behavior: 'allow', updatedInput: request.toolInput });
            } else {
              console.log(`[Permission] Auto-denied ${request.requestId} (${request.toolName}) on timeout`);
              resolve({ behavior: 'deny', message: 'Permission request timed out' });
            }
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
            timeoutSeconds: effectiveTimeoutSeconds,
            sessionId: message.sessionId,
            ...(requiresCredential && { requiresCredential: true, credentialHint: 'sudo_password' }),
            ...(isAskUserQuestion && { questions: toolInput.questions || [] }),
            ...(aiInitiated && { aiInitiated: true }),
          }
        });
        console.log(`[Permission] Stored pending permission ${request.requestId} in run ${runId} (timeout: ${effectiveTimeoutSeconds > 0 ? effectiveTimeoutSeconds + 's' : 'none'}, behavior: ${effectiveTimeoutBehavior}, aiInitiated: ${aiInitiated}, session: ${sessionType})`);

        // Persist waiting status for crash recovery
        db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
          .run('waiting', Date.now(), activeRun.sessionId);

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
              timeoutSeconds: effectiveTimeoutSeconds,
              ...(requiresCredential && {
                requiresCredential: true,
                credentialHint: 'sudo_password',
              }),
              ...(aiInitiated && { aiInitiated: true }),
            });
            console.log(`[Permission] Sent permission request ${request.requestId} to client${requiresCredential ? ' (requires sudo credential)' : ''}${aiInitiated ? ' (ai-initiated, auto-approve on timeout)' : ''}`);
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

    // Note: Agent sessions no longer force bypassPermissions.
    // All sessions (including agent) go through the unified permission strategy chain.
    const adapter = providerRegistry.getOrDefault(providerType);



    // Inject file push context (env vars + system prompt) so AI agents can push files to user's device
    const filePushEnv: Record<string, string> = {};
    let filePushContext: string | undefined;
    if (serverPort) {
      const apiUrl = `http://127.0.0.1:${serverPort}`;
      filePushEnv.MY_CLAUDIA_API_URL = apiUrl;
      filePushEnv.MY_CLAUDIA_SESSION_ID = message.sessionId;
      filePushContext = buildFilePushContext(apiUrl, message.sessionId);
    }

    const injectNonNativePlanPrompt = modeValue === 'plan' && !providerSupportsNativePlanMode(providerType);
    const nonNativePlanPrompt = injectNonNativePlanPrompt
      ? buildNonNativePlanPrompt(providerType)
      : undefined;
    const planDocumentPrompt = forcedPlanBySession && session.task_id
      ? buildPlanDocumentPrompt(session.task_id)
      : undefined;

    const runOptions = {
      cwd,
      sessionId: sdkSessionId,
      cliPath: providerConfig?.cliPath,
      env: { ...(providerConfig?.env || {}), ...filePushEnv },
      mode: modeValue,
      model: message.model,
      systemPrompt: [message.systemContext, nonNativePlanPrompt, planDocumentPrompt, filePushContext, session.system_prompt].filter(Boolean).join('\n\n') || undefined,
      serverPort: serverPort || undefined,
      db,
    };

    // Debug: log all run parameters for 403 diagnosis
    console.log(`[Run Debug] session=${message.sessionId} sdk_session=${sdkSessionId || 'NEW'} provider=${providerType} mode=${modeValue} model=${message.model || 'default'} cwd=${cwd} cliPath=${providerConfig?.cliPath || 'default'}`);

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

      // Track activity for stuck detection
      activeRun.lastActivityAt = Date.now();

      switch (msg.type) {
        case 'init':
          // Save system info for potential use in /status command
          if (msg.systemInfo) {
            systemInfo = msg.systemInfo;
            activeRun.latestSystemInfo = msg.systemInfo;
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
          if (msg.sessionId && msg.sessionId !== sdkSessionId) {
            sdkSessionId = msg.sessionId;
            // Update session with SDK session ID (handles both new and replaced sessions)
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
            // Track content blocks for segmented rendering
            const lastBlock = activeRun.contentBlocks[activeRun.contentBlocks.length - 1];
            if (lastBlock && lastBlock.type === 'text') {
              lastBlock.content += msg.content;
            } else {
              activeRun.contentBlocks.push({ type: 'text', content: msg.content });
            }
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
          // Track for loop detection (sliding window of last 20 tool signatures)
          if (msg.toolName) {
            const input = msg.toolInput as Record<string, unknown> | undefined;
            const toolSignature = generateToolSignature(msg.toolName, input, activeRun.providerType);
            activeRun.recentToolCalls.push(toolSignature);
            if (activeRun.recentToolCalls.length > 20) {
              activeRun.recentToolCalls.shift();
            }
          }
          // Collect for persistence
          activeRun.collectedToolCalls.push({
            toolUseId: msg.toolUseId || '',
            name: msg.toolName || '',
            input: msg.toolInput,
          });
          // Track content blocks for segmented rendering
          activeRun.contentBlocks.push({ type: 'tool_use', toolUseId: msg.toolUseId || '' });
          sendMessage(client.ws, {
            type: 'tool_use',
            runId,
            sessionId: activeRun.sessionId,
            toolUseId: msg.toolUseId || '',
            toolName: msg.toolName || '',
            toolInput: msg.toolInput
          });
          pluginEvents.emit('run.toolCall', {
            runId,
            sessionId: activeRun.sessionId,
            toolName: msg.toolName,
            toolUseId: msg.toolUseId,
            toolInput: msg.toolInput,
          }).catch(() => {});
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
          pluginEvents.emit('run.toolResult', {
            runId,
            sessionId: activeRun.sessionId,
            toolName,
            toolUseId: msg.toolUseId,
            result: msg.toolResult,
            isError: msg.isToolError,
          }).catch(() => {});
          // Claude-specific: sync plan mode state to client
          if (activeRun.providerType === 'claude' && !msg.isToolError) {
            if (toolName === 'EnterPlanMode') {
              sendMessage(client.ws, { type: 'mode_change', runId, sessionId: activeRun.sessionId, mode: 'plan' });
              // Track AI-initiated plan mode (only when the run didn't start in plan mode)
              if (modeValue !== 'plan') {
                activeRun.aiInitiatedPlanMode = true;
                console.log(`[Permission] AI entered plan mode during ${modeValue} run — ExitPlanMode will auto-approve`);
              }
            } else if (toolName === 'ExitPlanMode') {
              sendMessage(client.ws, { type: 'mode_change', runId, sessionId: activeRun.sessionId, mode: 'default' });
              activeRun.aiInitiatedPlanMode = false;
            }
          }
          break;
        }

        case 'result':
          // If result has content that wasn't already streamed via 'assistant' events, send it.
          // (Some providers only return content in the result, not through streaming.)
          if (msg.content && !activeRun.fullContent) {
            activeRun.fullContent = msg.content;
            // Non-streaming fallback: build content block for the full response
            activeRun.contentBlocks.push({ type: 'text', content: msg.content });
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

          // OpenCode fallback: some task/subagent flows may only emit tool events and no
          // assistant text. Ensure users still get a visible completion message.
          if (
            !activeRun.fullContent &&
            activeRun.providerType === 'opencode' &&
            activeRun.collectedToolCalls.length > 0
          ) {
            const fallback = 'Task execution completed, but the provider did not return a final visible text response. Send "summarize the result" to get a structured conclusion.';
            activeRun.fullContent = fallback;
            activeRun.contentBlocks.push({ type: 'text', content: fallback });
            sendMessage(client.ws, {
              type: 'delta',
              runId,
              sessionId: activeRun.sessionId,
              content: fallback
            });
          }

          // Detect truncated completions — the model's last output was a thinking
          // block (ending with </think>) with no subsequent text or tool_use.
          // This commonly happens with third-party models via LiteLLM proxies that
          // have limited compatibility with Claude Code's tool_use protocol, or when
          // output token limits are hit mid-generation.
          {
            const lastBlock = activeRun.contentBlocks[activeRun.contentBlocks.length - 1];
            const endsWithThinking = lastBlock?.type === 'text' &&
              lastBlock.content.trimEnd().endsWith('</think>');
            if (endsWithThinking) {
              console.warn(`[Truncation] Run ${runId} ended with a thinking block as last output. Possible provider truncation.`);
              const warning = '\n\n⚠️ *The model appeared to stop mid-thought without producing a response. This may be caused by output token limits or provider compatibility issues. Try sending "continue" or starting a new session.*';
              activeRun.fullContent += warning;
              activeRun.contentBlocks.push({ type: 'text', content: warning });
              sendMessage(client.ws, {
                type: 'delta',
                runId,
                sessionId: activeRun.sessionId,
                content: warning
              });
            }
          }

          // Final save — upsert with usage info and metadata indexing
          upsertAssistantMessage(activeRun, {
            usage: msg.usage,
            indexMetadata: true
          });

          if (activeRun.completed) {
            // Early run_completed was already sent (background task triggered it).
            // Send usage info separately so the client can update token counts.
            if (msg.usage) {
              sendMessage(client.ws, {
                type: 'run_completed',
                runId,
                sessionId: activeRun.sessionId,
                usage: msg.usage
              });
            }
            console.log(`[Result] Run ${runId} already completed (early completion), sending final usage`);
          } else {
            sendMessage(client.ws, {
              type: 'run_completed',
              runId,
              sessionId: activeRun.sessionId,
              usage: msg.usage
            });
            // Mark completed immediately so heartbeat no longer reports this run as active.
            // The for-await loop may still receive trailing SDK messages (e.g. task_notification)
            // but the client should see the session as idle.
            activeRun.completed = true;
            pluginEvents.emit('run.completed', {
              runId,
              sessionId: activeRun.sessionId,
              usage: msg.usage,
            }).catch(() => {});
            broadcastHeartbeat();
            notificationService.notify({
              type: 'run_completed',
              title: 'Run completed',
              body: `Session: ${message.sessionId}`,
              priority: 'default',
              tags: ['white_check_mark'],
            });
          }
          // Notify background task completion
          if (sessionType === 'background') {
            sendMessage(client.ws, {
              type: 'background_task_update',
              sessionId: message.sessionId,
              status: 'completed',
            } as import('@my-claudia/shared').BackgroundTaskUpdateMessage);
          }
          break;

        case 'error': {
          const rawProviderError = (msg.error || 'Provider error') as string;
          const errorMessage = formatProviderErrorMessage(rawProviderError, activeRun.providerType);
          console.error(`[Provider Error] runId=${runId} provider=${activeRun.providerType}: ${rawProviderError}`);

          if (!activeRun.completed) {
            try {
              upsertAssistantMessage(activeRun, { indexMetadata: true });
            } catch (saveErr) {
              console.error(`[Error Save] Failed for run ${runId}:`, saveErr);
            }
            sendMessage(client.ws, {
              type: 'run_failed',
              runId,
              sessionId: activeRun.sessionId,
              error: errorMessage,
            });
            activeRun.completed = true;
            pluginEvents.emit('run.error', {
              runId,
              sessionId: activeRun.sessionId,
              error: errorMessage,
            }).catch(() => {});
            broadcastHeartbeat();
            notificationService.notify({
              type: 'run_failed',
              title: 'Run failed',
              body: errorMessage.slice(0, 200),
              priority: 'high',
              tags: ['x'],
            });
          }
          // Mark run as ended now; for-await loop exits on next iteration by guard.
          activeRuns.delete(runId);
          break;
        }

        case 'task_notification':
          // Background task launched — the main conversation turn is functionally complete.
          // The SDK won't yield 'result' until all background tasks finish, but the user
          // shouldn't see a loading spinner for the main session during that time.
          if (!activeRun.completed) {
            console.log(`[Background Task] Sending early run_completed for run ${runId} (background task started)`);
            upsertAssistantMessage(activeRun, { indexMetadata: true });
            sendMessage(client.ws, {
              type: 'run_completed',
              runId,
              sessionId: activeRun.sessionId,
            });
            activeRun.completed = true;
            broadcastHeartbeat();
          }
          // Forward background task notifications (e.g. process exited) to client
          console.log(`[Task Notification] taskId=${msg.taskId} status=${msg.taskStatus} message=${msg.taskMessage}`);
          sendMessage(client.ws, {
            type: 'task_notification',
            runId,
            sessionId: activeRun.sessionId,
            taskId: msg.taskId,
            status: msg.taskStatus,
            message: msg.taskMessage,
          } as import('@my-claudia/shared').TaskNotificationMessage);
          break;
      }
    }
  } catch (error) {
    console.error('Run error:', error);

    // If the Claude CLI process crashed (exit code 1), the SDK session may be
    // corrupted (e.g. bad model stored in transcript). Clear sdk_session_id so
    // the next attempt creates a fresh session instead of resuming the broken one.
    const errMsg = error instanceof Error ? error.message : '';
    const formattedErrMsg = formatProviderErrorMessage(errMsg, activeRun.providerType);
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
      error: formattedErrMsg
    });
    activeRun.completed = true;
    broadcastHeartbeat();
    notificationService.notify({
      type: 'run_failed',
      title: 'Run failed',
      body: formattedErrMsg.slice(0, 200),
      priority: 'high',
      tags: ['x'],
    });
    // Notify background task failure
    if (sessionType === 'background') {
      sendMessage(client.ws, {
        type: 'background_task_update',
        sessionId: message.sessionId,
        status: 'failed',
        reason: formattedErrMsg,
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

    // Clear run status and update session updated_at
    db.prepare(`
      UPDATE sessions SET last_run_status = NULL, updated_at = ? WHERE id = ?
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
  feedback?: string;
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

      // Revert to running status after permission resolved
      run.db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
        .run('running', Date.now(), run.sessionId);

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
        message: message.allow
          ? undefined
          : (message.feedback?.trim() || 'User denied permission'),
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

      // Revert to running status after question answered
      run.db.prepare('UPDATE sessions SET last_run_status = ?, updated_at = ? WHERE id = ?')
        .run('running', Date.now(), run.sessionId);

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
