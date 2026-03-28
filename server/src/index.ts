import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { ALL_SERVER_FEATURES } from '@my-claudia/shared';
import { createServer, createVirtualClient, activeRuns, connectedClients, cancelRun, type ServerContext } from './server.js';
import { GatewayClient } from './gateway-client.js';
import { setGatewayClient } from './gateway-instance.js';
import type { ServerMessage } from '@my-claudia/shared';
import { initDatabase } from './storage/db.js';
import type { GatewayConfig } from './routes/gateway.js';
import { openCodeServerManager } from './providers/opencode-sdk.js';
import { destroyAllAppServerClients } from './providers/codex-app-server.js';
import { checkVersionCompatibility } from './providers/claude-sdk.js';
import { checkSdkVersions } from './utils/sdk-version-check.js';
import { detectCliProvidersSync } from './utils/cli-detect.js';
import { pluginLoader } from './plugins/loader.js';
import { registerBuiltinCommands } from './commands/init.js';
import { sanitizeInheritedProviderEnv } from './utils/startup-env.js';
import { isIgnorableProcessError } from './utils/process-error-filter.js';
import { cancelRunsForClosedChannel } from './gateway-channel-cleanup.js';
import { EmbeddedBackendFacadeProvider } from './facade/embedded-provider.js';
import { StandaloneBackendFacadeProvider } from './facade/standalone-provider.js';
import type { LocalBackendHandler } from './facade/embedded-adapter.js';
import type { SessionCatalogItem } from '@my-claudia/shared';
import { hasForegroundActiveRunForSession } from './utils/run-state.js';
import type { FacadeWsHub } from './facade/ws-hub.js';

const sanitizedEnv = sanitizeInheritedProviderEnv();
if (sanitizedEnv.removedKeys.length > 0) {
  console.log(`[Startup] Removed inherited provider model env: ${sanitizedEnv.removedKeys.join(', ')}`);
}

process.on('uncaughtException', (error) => {
  if (isIgnorableProcessError(error)) {
    console.warn(`[Process] Ignored non-fatal uncaught exception: ${(error as NodeJS.ErrnoException).code || error.message}`);
    return;
  }
  console.error('[Process] Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  if (isIgnorableProcessError(reason)) {
    const code = typeof reason === 'object' && reason && 'code' in reason ? String((reason as { code?: unknown }).code) : 'unknown';
    console.warn(`[Process] Ignored non-fatal unhandled rejection: ${code}`);
    return;
  }
  // Log but do NOT exit — an unhandled rejection from a single session/provider
  // should not take down the entire server. The process state is still consistent
  // (unlike uncaughtException), so it's safe to continue.
  console.error('[Process] Unhandled rejection (non-fatal):', reason);
});

const PORT = parseInt(process.env.PORT || '3100', 10);
// Listen on 0.0.0.0 to allow connections from other devices on the network
const HOST = process.env.SERVER_HOST || '0.0.0.0';

// Gateway configuration from environment (legacy support)
const GATEWAY_URL = process.env.GATEWAY_URL;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const GATEWAY_NAME = process.env.GATEWAY_NAME || `Backend on ${os.hostname()}`;

let gatewayClient: GatewayClient | null = null;
let serverContext: ServerContext | null = null;
type FacadeProvider = {
  connect(): void;
  disconnect(): void;
  getWsHub(): FacadeWsHub;
};

let facadeProvider: FacadeProvider | null = null;
// Actual port the server is listening on (resolved after server.listen)
let actualPort = PORT;
const virtualClients = new Map<string, ReturnType<typeof createVirtualClient>>();

function attachFacadeProvider(nextProvider: FacadeProvider): void {
  if (facadeProvider === nextProvider) return;
  facadeProvider?.disconnect();
  facadeProvider = nextProvider;
  facadeProvider.connect();
  serverContext?.setFacadeHub(facadeProvider.getWsHub());
}

function ensureStandaloneFacade(): void {
  const standaloneFacade = new StandaloneBackendFacadeProvider({
    serverPort: actualPort,
    instanceId: 'standalone',
    deviceId: 'standalone',
    localHandler: createLocalBackendHandler(),
  });
  attachFacadeProvider(standaloneFacade);
  console.log(`📡 Facade WS endpoint: ws://${HOST}:${actualPort}/ws/backend-facade (standalone)`);
}

function ensureEmbeddedGatewayFacade(): void {
  if (!gatewayClient) return;
  const embeddedFacade = new EmbeddedBackendFacadeProvider(
    gatewayClient,
    createLocalBackendHandler(),
    actualPort,
  );
  attachFacadeProvider(embeddedFacade);
  console.log(`📡 Facade WS endpoint: ws://${HOST}:${actualPort}/ws/backend-facade`);
}


// Load Gateway configuration from database
function loadGatewayConfig(): GatewayConfig | null {
  try {
    const db = initDatabase();
    const row = db.prepare(`
      SELECT id, enabled, gateway_url, gateway_secret, backend_name, backend_id,
             register_as_backend,
             proxy_url, proxy_username, proxy_password,
             created_at, updated_at
      FROM gateway_config
      WHERE id = 1
    `).get() as any;

    if (!row) return null;

    return {
      id: row.id,
      enabled: row.enabled === 1,
      gatewayUrl: row.gateway_url,
      gatewaySecret: row.gateway_secret,
      backendName: row.backend_name,
      gatewayBackendId: row.backend_id,
      registerAsBackend: row.register_as_backend === 1,
      proxyUrl: row.proxy_url,
      proxyUsername: row.proxy_username,
      proxyPassword: row.proxy_password,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } catch (error) {
    console.error('Failed to load gateway config:', error);
    return null;
  }
}

// ============================================================================
// Gateway Connection
// ============================================================================

async function connectToGateway(config: GatewayConfig): Promise<void> {
  if (!config.gatewayUrl || !config.gatewaySecret) {
    console.error('[Gateway] URL or Secret not configured');
    return;
  }

  if (gatewayClient) {
    const syncInterval = (gatewayClient as any)._syncInterval;
    if (syncInterval) clearInterval(syncInterval);
    gatewayClient.commands.connection.disconnect();
  }

  console.log(`\n🌐 Gateway V2 connection configured:`);
  console.log(`   URL: ${config.gatewayUrl}`);
  console.log(`   Name: ${config.backendName || `Backend on ${os.hostname()}`}`);

  process.env.GATEWAY_URL = config.gatewayUrl;
  process.env.GATEWAY_SECRET = config.gatewaySecret;

  if (!serverContext) return;

  const gatewayClientConfig: any = {
    gatewayUrl: config.gatewayUrl,
    gatewaySecret: config.gatewaySecret,
    name: config.backendName || `Backend on ${os.hostname()}`,
    channel: process.env.MY_CLAUDIA_CHANNEL || 'prod',
    serverPort: actualPort,
    visible: config.registerAsBackend !== false,
    capabilities: ALL_SERVER_FEATURES,
  };

  if (config.proxyUrl) {
    gatewayClientConfig.proxyUrl = config.proxyUrl;
    if (config.proxyUsername || config.proxyPassword) {
      gatewayClientConfig.proxyAuth = {
        username: config.proxyUsername || '',
        password: config.proxyPassword || '',
      };
    }
  }

  gatewayClient = new GatewayClient(gatewayClientConfig, serverContext.db, activeRuns);
  setGatewayClient(gatewayClient);

  gatewayClient.events.setOutgoingEvents({
    onConnectionStateChanged: (connected) => {
      if (connected) {
        ensureEmbeddedGatewayFacade();
      } else {
        ensureStandaloneFacade();
      }
    },
  });

  gatewayClient.commands.channel.onIncomingMessage(async (channelId, message) => {
    if (!serverContext) return;

    let virtualClient = virtualClients.get(channelId);
    if (!virtualClient) {
      virtualClient = createVirtualClient(channelId, {
        send: (msg: ServerMessage) => {
          gatewayClient?.commands.channel.sendToIncoming(channelId, msg);
        }
      });
      virtualClients.set(channelId, virtualClient);
    }

    await serverContext.handleMessage(virtualClient, message);
  });

  gatewayClient.commands.channel.onIncomingClosed((channelId) => {
    cancelRunsForClosedChannel(channelId, activeRuns, cancelRun);
    virtualClients.delete(channelId);
    connectedClients.delete(channelId);
    serverContext?.terminalManager.detachClient(channelId);
  });

  // Set up catch-up handler for content recovery
  gatewayClient.commands.channel.onCatchUp(async (sessionId, afterOffset) => {
    if (!serverContext) return [];
    try {
      const rows = serverContext.db.prepare(`
        SELECT id as messageId, session_id as sessionId, offset, role, created_at as createdAt, content
        FROM messages
        WHERE session_id = ? AND offset > ?
        ORDER BY offset ASC
      `).all(sessionId, afterOffset) as any[];

      return rows.map((r: any) => ({
        messageId: r.messageId,
        sessionId: r.sessionId,
        offset: r.offset,
        role: r.role,
        createdAt: r.createdAt,
        content: r.content ? JSON.parse(r.content) : null,
      }));
    } catch (error) {
      console.error('[Gateway] Catch-up query error:', error);
      return [];
    }
  });

  gatewayClient.commands.connection.connect();

  // Set identity immediately
  serverContext.updateGatewayIdentity(gatewayClient.queries.identity.getInstanceId(), gatewayClient.queries.identity.getDeviceId());

  // Sync gateway status periodically
  const syncGatewayStatus = setInterval(() => {
    if (gatewayClient && serverContext) {
      serverContext.updateGatewayConnected(gatewayClient.queries.connection.isConnected());
      const backendId = gatewayClient.queries.identity.getBackendId();
      if (backendId) {
        serverContext.updateGatewayBackendId(backendId);
      }
      serverContext.updateDiscoveredBackends(gatewayClient.queries.registry.getDiscoveredBackends());
    }
  }, 2000);

  (gatewayClient as any)._syncInterval = syncGatewayStatus;
}

async function disconnectFromGateway(): Promise<void> {
  if (gatewayClient) {
    console.log('📡 Disconnecting from Gateway V2...');
    const syncInterval = (gatewayClient as any)._syncInterval;
    if (syncInterval) clearInterval(syncInterval);
    gatewayClient.commands.connection.disconnect();
    setGatewayClient(null);
    gatewayClient = null;
    for (const channelId of virtualClients.keys()) {
      connectedClients.delete(channelId);
      serverContext?.terminalManager.detachClient(channelId);
    }
    virtualClients.clear();
    if (serverContext) {
      serverContext.updateGatewayConnected(false);
      serverContext.updateGatewayBackendId(null);
      serverContext.updateDiscoveredBackends([]);
    }
  }
  ensureStandaloneFacade();
}

function autoDetectProviders(): void {
  if (!serverContext) return;
  
  const db = serverContext.db;
  
  const existingProviders = db.prepare('SELECT id FROM providers LIMIT 1').get() as { id: string } | undefined;
  
  if (existingProviders) {
    return;
  }
  
  console.log('\n🔍 No providers found, auto-detecting CLI...');
  
  const detectedClis = detectCliProvidersSync();
  
  if (detectedClis.length === 0) {
    console.log('   No CLI detected. Install claude or opencode to get started.');
    return;
  }
  
  const now = Date.now();
  let claudeId: string | null = null;
  
  for (const cli of detectedClis) {
    const id = crypto.randomUUID();
    
    const isDefault = cli.type === 'claude';
    
    db.prepare(`
      INSERT INTO providers (id, name, type, cli_path, env, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(id, cli.name, cli.type, cli.cliPath, isDefault ? 1 : 0, now, now);
    
    console.log(`   ✅ Added provider: ${cli.name} (${cli.cliPath})`);
    
    if (cli.type === 'claude') {
      claudeId = id;
    }
  }
  
  if (claudeId) {
    console.log(`   🌟 Default provider set to: Claude Code`);
  } else if (detectedClis.length > 0) {
    console.log(`   🌟 Default provider set to: ${detectedClis[0].name}`);
  }
}

/**
 * On macOS, probe TCC-protected folders so the OS attributes the permission
 * to this node process's signing identity. The Tauri (Rust) side does its
 * own probe, but macOS checks TCC per code-signing identity — the embedded
 * node binary has a different ad-hoc signature, so it needs a separate probe.
 *
 * This prevents TCC consent dialogs from appearing later during remote
 * terminal sessions when nobody is at the Mac to approve them.
 */
function probeMacOSFolderPermissions(): void {
  if (process.platform !== 'darwin') return;

  const home = os.homedir();
  for (const folder of ['Desktop', 'Documents', 'Downloads']) {
    const dir = path.join(home, folder);
    try {
      fs.readdirSync(dir);
    } catch {
      // Permission denied or folder doesn't exist — either way, the TCC
      // dialog has been triggered (or will be on next attempt).
    }
  }
}

/**
 * Create a LocalBackendHandler that routes facade messages to the server's
 * internal message handler, providing in-process short-circuit for the
 * local embedded backend.
 */
function createLocalBackendHandler(): LocalBackendHandler {
  // Virtual client for facade-routed messages (shares lifecycle with facade)
  let facadeVirtualClient: ReturnType<typeof createVirtualClient> | null = null;
  const serverEventListeners = new Set<(message: ServerMessage) => void>();

  return {
    onMessage: async (message) => {
      if (!serverContext) return;
      if (!facadeVirtualClient) {
        facadeVirtualClient = createVirtualClient('facade-local', {
          send: (msg: ServerMessage) => {
            for (const listener of serverEventListeners) {
              try {
                listener(msg);
              } catch {
                // Ignore subscriber errors; facade runtime remains source of truth.
              }
            }
          },
        });
      }
      await serverContext.handleMessage(facadeVirtualClient, message);
    },
    onStreamOpen: (_sessionId) => {
      // Stream open is handled at the facade level — no server-side action needed
    },
    onStreamClose: (_sessionId) => {
      // Stream close is handled at the facade level
    },
    onCatchUp: async (sessionId, afterOffset) => {
      if (!serverContext) return [];
      try {
        const rows = serverContext.db.prepare(`
          SELECT id as messageId, session_id as sessionId, offset, role, created_at as createdAt, content
          FROM messages
          WHERE session_id = ? AND offset > ?
          ORDER BY offset ASC
        `).all(sessionId, afterOffset) as any[];
        return rows.map((r: any) => ({
          messageId: r.messageId,
          sessionId: r.sessionId,
          offset: r.offset,
          role: r.role,
          createdAt: r.createdAt,
          content: r.content ? JSON.parse(r.content) : null,
        }));
      } catch (error) {
        console.error('[LocalHandler] Catch-up error:', error);
        return [];
      }
    },
    onServerEvent: (listener) => {
      serverEventListeners.add(listener);
      return () => {
        serverEventListeners.delete(listener);
      };
    },
    getCatalogItems: () => {
      if (!serverContext) return [];
      try {
        const sessions = serverContext.db.prepare(`
          SELECT s.id, s.name, s.created_at as createdAt, s.updated_at as updatedAt
          FROM sessions s ORDER BY s.updated_at DESC
        `).all() as any[];
        return sessions.map((s: any): SessionCatalogItem => ({
          sessionId: s.id,
          title: s.name || undefined,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          lastMessageAt: s.updatedAt,
          activeRunStatus: hasForegroundActiveRunForSession(activeRuns, s.id) ? 'running' : 'idle',
        }));
      } catch {
        return [];
      }
    },
    getCapabilities: () => [...ALL_SERVER_FEATURES],
  };
}

async function main() {
  try {
    serverContext = await createServer();
    const { server, handleMessage, connectGateway, disconnectGateway } = serverContext;

    serverContext.setGatewayConnector(connectToGateway);
    serverContext.setGatewayDisconnector(disconnectFromGateway);

    checkVersionCompatibility().catch(() => {});
    checkSdkVersions().then(report => {
      for (const sdk of report.sdks) {
        if (sdk.outdated) {
          console.warn(`⚠️  [SDK Update] ${sdk.name}: ${sdk.current} → ${sdk.latest}`);
        } else {
          console.log(`[SDK Check] ${sdk.name}: ${sdk.current} (up to date)`);
        }
      }
    }).catch(() => {});

    autoDetectProviders();

    // Initialize plugin system (discover only — activation deferred until server is listening)
    console.log('\n🔌 Initializing plugin system...');
    registerBuiltinCommands();
    // Pass database to plugin loader for Provider API support
    pluginLoader.setDatabase(serverContext.db);
    const discoveredPlugins = await pluginLoader.discover();
    if (discoveredPlugins.length > 0) {
      console.log(`   Found ${discoveredPlugins.length} plugin(s)`);
    } else {
      console.log('   No plugins found');
    }

    // Register workspace + external skills as MCP bridge tools
    const { setDatabase: setSkillDb, registerSkillTools } = await import('./plugins/skill-tools.js');
    setSkillDb(serverContext.db);
    const skillCount = await registerSkillTools();
    if (skillCount > 0) {
      console.log(`   Registered ${skillCount} skill tool(s)`);
    }

    server.listen(PORT, HOST, async () => {
      actualPort = (server.address() as import('net').AddressInfo).port;
      serverContext!.setServerPort(actualPort);
      // Machine-readable line for embedded server port discovery
      console.log(`SERVER_READY:${actualPort}`);
      console.log(`🚀 MyClaudia Server running at http://${HOST}:${actualPort}`);
      console.log(`📡 WebSocket endpoint: ws://${HOST}:${actualPort}/ws`);

      // Start standalone facade immediately (no gateway required).
      // This ensures /ws/backend-facade is available even without gateway.
      // Will be upgraded to EmbeddedBackendFacadeProvider after gateway handshake succeeds.
      ensureStandaloneFacade();

      // Probe TCC-protected folders so macOS consent dialogs appear now
      // (while user is at the keyboard) rather than during remote sessions.
      probeMacOSFolderPermissions();

      // Priority 1: Environment variables (for backward compatibility)
      if (GATEWAY_URL && GATEWAY_SECRET) {
        console.log(`\n🌐 Gateway connection from environment variables`);
        await connectGateway({
          id: 1,
          enabled: true,
          gatewayUrl: GATEWAY_URL,
          gatewaySecret: GATEWAY_SECRET,
          backendName: GATEWAY_NAME,
          gatewayBackendId: null,
          registerAsBackend: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
      // Priority 2: Database configuration
      else {
        const dbConfig = loadGatewayConfig();
        if (dbConfig && dbConfig.enabled && dbConfig.gatewayUrl && dbConfig.gatewaySecret) {
          console.log(`\n🌐 Gateway connection from database configuration`);
          await connectGateway(dbConfig);
        }
      }

      // Activate onStartup plugins after server is listening
      // (UI can now handle permission prompts via WebSocket)
      for (const manifest of discoveredPlugins) {
        const activationEvents = manifest.activationEvents || [];
        if (activationEvents.includes('onStartup')) {
          pluginLoader.activate(manifest.id).catch(error => {
            console.error(`   Failed to activate ${manifest.id}:`, error);
          });
        }
      }
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down server...');

      // Disconnect from Gateway
      if (gatewayClient) {
        gatewayClient.commands.connection.disconnect();
      }
      // Deactivate all plugins (cleanup schedulers, event listeners, etc.)
      await pluginLoader.deactivateAll();

      // Stop all managed OpenCode server processes
      await openCodeServerManager.stopAll();

      // Destroy all Codex app-server processes
      destroyAllAppServerClients();

      // Destroy all terminal sessions
      serverContext?.terminalManager.destroyAll();

      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

main();
