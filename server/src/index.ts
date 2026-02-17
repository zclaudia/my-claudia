import * as os from 'os';
import { createServer, createVirtualClient, activeRuns, type ServerContext } from './server.js';
import { GatewayClient } from './gateway-client.js';
import { setGatewayClient } from './gateway-instance.js';
import type { ServerMessage } from '@my-claudia/shared';
import { initDatabase } from './storage/db.js';
import type { GatewayConfig } from './routes/gateway.js';
import { openCodeServerManager } from './providers/opencode-sdk.js';
import { checkVersionCompatibility } from './providers/claude-sdk.js';
import { detectCliProvidersSync } from './utils/cli-detect.js';

const PORT = parseInt(process.env.PORT || '3100', 10);
// Listen on 0.0.0.0 to allow connections from other devices on the network
const HOST = process.env.SERVER_HOST || '0.0.0.0';

// Gateway configuration from environment (legacy support)
const GATEWAY_URL = process.env.GATEWAY_URL;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const GATEWAY_NAME = process.env.GATEWAY_NAME || `Backend on ${os.hostname()}`;

let gatewayClient: GatewayClient | null = null;
let serverContext: ServerContext | null = null;

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
    gatewayClient.disconnect();
  }

  console.log(`\n🌐 Gateway connection configured:`);
  console.log(`   URL: ${config.gatewayUrl}`);
  console.log(`   Name: ${config.backendName || `Backend on ${os.hostname()}`}`);
  if (config.proxyUrl) {
    console.log(`   Proxy: ${config.proxyUrl}`);
  }

  const gatewayClientConfig: any = {
    gatewayUrl: config.gatewayUrl,
    gatewaySecret: config.gatewaySecret,
    name: config.backendName || `Backend on ${os.hostname()}`,
    serverPort: PORT,
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
          gatewayClient?.broadcast(msg);
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
    console.log(`[Gateway] Cleaned up virtual client: ${clientId}`);
  });

  // Broadcast state heartbeat when a client subscribes
  gatewayClient.onClientSubscribed(() => {
    const heartbeat = serverContext!.getStateHeartbeat();
    gatewayClient?.broadcast(heartbeat);
  });

  gatewayClient.connect();

  // Sync gateway status periodically (backendId + discoveredBackends)
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

async function main() {
  try {
    serverContext = await createServer();
    const { server, handleMessage, connectGateway, disconnectGateway } = serverContext;

    serverContext.setGatewayConnector(connectToGateway);
    serverContext.setGatewayDisconnector(disconnectFromGateway);

    checkVersionCompatibility().catch(() => {});
    
    autoDetectProviders();

    server.listen(PORT, HOST, async () => {
      console.log(`🚀 MyClaudia Server running at http://${HOST}:${PORT}`);
      console.log(`📡 WebSocket endpoint: ws://${HOST}:${PORT}/ws`);

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
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down server...');

      // Disconnect from Gateway
      if (gatewayClient) {
        gatewayClient.disconnect();
      }

      // Stop all managed OpenCode server processes
      await openCodeServerManager.stopAll();

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
