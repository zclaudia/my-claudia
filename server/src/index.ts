import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createServer, createVirtualClient, activeRuns, connectedClients, type ServerContext } from './server.js';
import { GatewayClient } from './gateway-client.js';
import { GatewayClientMode } from './gateway-client-mode.js';
import { setGatewayClient, setGatewayClientMode } from './gateway-instance.js';
import type { ServerMessage } from '@my-claudia/shared';
import { initDatabase } from './storage/db.js';
import type { GatewayConfig } from './routes/gateway.js';
import { openCodeServerManager } from './providers/opencode-sdk.js';
import { checkVersionCompatibility } from './providers/claude-sdk.js';
import { checkSdkVersions } from './utils/sdk-version-check.js';
import { detectCliProvidersSync } from './utils/cli-detect.js';
import { pluginLoader } from './plugins/loader.js';
import { registerBuiltinCommands } from './commands/init.js';
import { sanitizeInheritedProviderEnv } from './utils/startup-env.js';

const sanitizedEnv = sanitizeInheritedProviderEnv();
if (sanitizedEnv.removedKeys.length > 0) {
  console.log(`[Startup] Removed inherited provider model env: ${sanitizedEnv.removedKeys.join(', ')}`);
}

const PORT = parseInt(process.env.PORT || '3100', 10);
// Listen on 0.0.0.0 to allow connections from other devices on the network
const HOST = process.env.SERVER_HOST || '0.0.0.0';

// Gateway configuration from environment (legacy support)
const GATEWAY_URL = process.env.GATEWAY_URL;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const GATEWAY_NAME = process.env.GATEWAY_NAME || `Backend on ${os.hostname()}`;

let gatewayClient: GatewayClient | null = null;
let gatewayClientMode: GatewayClientMode | null = null;
let serverContext: ServerContext | null = null;
// Actual port the server is listening on (resolved after server.listen)
let actualPort = PORT;

// Track virtual clients for Gateway connections
const virtualClients = new Map<string, ReturnType<typeof createVirtualClient>>();

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
      backendId: row.backend_id,
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

// Connect to Gateway with config
async function connectToGateway(config: GatewayConfig): Promise<void> {
  if (!config.gatewayUrl || !config.gatewaySecret) {
    console.error('[Gateway] URL or Secret not configured');
    return;
  }

  if (gatewayClient) {
    // Clear sync interval before disconnect
    const syncInterval = (gatewayClient as any)._syncInterval;
    if (syncInterval) clearInterval(syncInterval);
    gatewayClient.disconnect();
  }

  console.log(`\n🌐 Gateway connection configured:`);
  console.log(`   URL: ${config.gatewayUrl}`);
  console.log(`   Name: ${config.backendName || `Backend on ${os.hostname()}`}`);
  if (config.proxyUrl) {
    console.log(`   Proxy: ${config.proxyUrl}`);
  }

  // Expose gateway config to providers (e.g. claude-sdk getFileData) via env vars
  process.env.GATEWAY_URL = config.gatewayUrl;
  process.env.GATEWAY_SECRET = config.gatewaySecret;

  const gatewayClientConfig: any = {
    gatewayUrl: config.gatewayUrl,
    gatewaySecret: config.gatewaySecret,
    name: config.backendName || `Backend on ${os.hostname()}`,
    serverPort: actualPort,
    visible: config.registerAsBackend !== false
  };

  // Add proxy configuration if provided
  if (config.proxyUrl) {
    gatewayClientConfig.proxyUrl = config.proxyUrl;
    if (config.proxyUsername || config.proxyPassword) {
      gatewayClientConfig.proxyAuth = {
        username: config.proxyUsername || '',
        password: config.proxyPassword || ''
      };
    }
  }

  if (!serverContext) return;

  // Create GatewayClient with db and activeRuns dependencies
  gatewayClient = new GatewayClient(gatewayClientConfig, serverContext.db, activeRuns);

  // Set global instance for access from routes
  setGatewayClient(gatewayClient);

  // Set up message handler - integrate with server's message handling
  gatewayClient.onMessage(async (clientId, message) => {
    console.log(`[Gateway] Message from ${clientId}:`, message.type);

    // Get or create virtual client for this Gateway client
    let virtualClient = virtualClients.get(clientId);
    if (!virtualClient) {
      virtualClient = createVirtualClient(clientId, {
        send: (msg: ServerMessage) => {
          // Terminal messages target the specific client, not broadcast
          if (msg.type === 'terminal_output' || msg.type === 'terminal_opened' || msg.type === 'terminal_exited') {
            gatewayClient?.sendToClient(clientId, msg);
          } else {
            gatewayClient?.broadcast(msg);
          }
        }
      });
      virtualClients.set(clientId, virtualClient);
    }

    // Handle the message using the server's message handler
    await serverContext!.handleMessage(virtualClient, message);

    // Return null since we send responses through the virtual client
    return null;
  });

  // Clean up virtual client on disconnect
  gatewayClient.onClientDisconnected((clientId) => {
    virtualClients.delete(clientId);
    connectedClients.delete(clientId);
    serverContext!.terminalManager.destroyForClient(clientId);
    console.log(`[Gateway] Cleaned up virtual client: ${clientId}`);
  });

  // Always send state heartbeat to newly subscribed client so it can
  // restore active runs AND clean up stale runs that completed while disconnected
  gatewayClient.onClientSubscribed((clientId) => {
    const heartbeat = serverContext!.getStateHeartbeat();
    gatewayClient?.sendToClient(clientId, heartbeat);
  });

  gatewayClient.connect();

  // Also start a client-role connection for relaying desktop frontend traffic
  // through the gateway to remote backends (with SOCKS5 support)
  if (gatewayClientMode) {
    gatewayClientMode.disconnect();
  }

  const clientModeConfig: any = {
    gatewayUrl: config.gatewayUrl,
    gatewaySecret: config.gatewaySecret,
  };
  if (config.proxyUrl) {
    clientModeConfig.proxyUrl = config.proxyUrl;
    if (config.proxyUsername || config.proxyPassword) {
      clientModeConfig.proxyAuth = {
        username: config.proxyUsername || '',
        password: config.proxyPassword || '',
      };
    }
  }

  gatewayClientMode = new GatewayClientMode(clientModeConfig);
  setGatewayClientMode(gatewayClientMode);
  gatewayClientMode.connect();

  // Sync gateway status periodically as fallback (backendId + discoveredBackends)
  const syncGatewayStatus = setInterval(() => {
    if (gatewayClient && serverContext) {
      const backendId = gatewayClient.getBackendId();
      if (backendId) {
        serverContext.updateGatewayBackendId(backendId);
      }
      serverContext.updateDiscoveredBackends(gatewayClient.getDiscoveredBackends());
    }
  }, 2000);

  // Store interval reference for cleanup on disconnect
  (gatewayClient as any)._syncInterval = syncGatewayStatus;
}

async function disconnectFromGateway(): Promise<void> {
  if (gatewayClient) {
    console.log('📡 Disconnecting from Gateway...');
    const syncInterval = (gatewayClient as any)._syncInterval;
    if (syncInterval) {
      clearInterval(syncInterval);
    }
    gatewayClient.disconnect();
    gatewayClient = null;
    setGatewayClient(null);
    virtualClients.clear();
    if (serverContext) {
      serverContext.updateGatewayBackendId(null);
      serverContext.updateDiscoveredBackends([]);
    }
  }
  if (gatewayClientMode) {
    gatewayClientMode.disconnect();
    gatewayClientMode = null;
    setGatewayClientMode(null);
  }
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

    server.listen(PORT, HOST, async () => {
      actualPort = (server.address() as import('net').AddressInfo).port;
      serverContext!.setServerPort(actualPort);
      // Machine-readable line for embedded server port discovery
      console.log(`SERVER_READY:${actualPort}`);
      console.log(`🚀 MyClaudia Server running at http://${HOST}:${actualPort}`);
      console.log(`📡 WebSocket endpoint: ws://${HOST}:${actualPort}/ws`);

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
          backendId: null,
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
        gatewayClient.disconnect();
      }
      if (gatewayClientMode) {
        gatewayClientMode.disconnect();
      }

      // Stop all managed OpenCode server processes
      await openCodeServerManager.stopAll();

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
