import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createServer, createVirtualClient, activeRuns, connectedClients, cancelRun } from './server.js';
import { autoDetectProviders, checkProviderVersions, shutdownProviders } from './providers/initializer.js';
import { pluginLoader } from './plugins/loader.js';
import { registerBuiltinCommands } from './commands/init.js';
import { sanitizeInheritedProviderEnv } from './utils/startup-env.js';
import { isIgnorableProcessError } from './utils/process-error-filter.js';
import { GatewayManager } from './domains/gateway/manager.js';
import { stopFileStoreCleanup } from './storage/fileStore.js';
import { writeCrashReportSync } from './utils/crash-log.js';

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
  writeCrashReportSync({
    event: 'uncaughtException',
    error,
    context: {
      cwd: process.cwd(),
      argv: process.argv,
    },
  });
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
    const serverContext = await createServer();
    const { server, connectGateway, disconnectGateway } = serverContext;

    const gatewayManager = new GatewayManager({
      serverContext,
      activeRuns,
      connectedClients,
      createVirtualClient,
      cancelRun,
      host: HOST,
    });

    serverContext.setGatewayConnector((config) => gatewayManager.connect(config));
    serverContext.setGatewayDisconnector(() => gatewayManager.disconnect());

    checkProviderVersions();
    autoDetectProviders(serverContext.db);

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
      const actualPort = (server.address() as import('net').AddressInfo).port;
      serverContext.setServerPort(actualPort);
      gatewayManager.setPort(actualPort);
      // Machine-readable line for embedded server port discovery
      console.log(`SERVER_READY:${actualPort}`);
      console.log(`🚀 MyClaudia Server running at http://${HOST}:${actualPort}`);
      console.log(`📡 WebSocket endpoint: ws://${HOST}:${actualPort}/ws`);

      // Start standalone facade immediately (no gateway required).
      // This ensures /ws/backend-facade is available even without gateway.
      // Will be upgraded to EmbeddedBackendFacadeProvider after gateway handshake succeeds.
      gatewayManager.ensureStandaloneFacade();

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
        const dbConfig = gatewayManager.loadConfig();
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
      gatewayManager.shutdown();

      // Deactivate all plugins (cleanup schedulers, event listeners, etc.)
      await pluginLoader.deactivateAll();

      // Stop all managed provider sub-processes
      await shutdownProviders();

      stopFileStoreCleanup();

      // Destroy all terminal sessions
      serverContext.terminalManager.destroyAll();

      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    writeCrashReportSync({
      event: 'startup_failure',
      error,
      context: {
        cwd: process.cwd(),
        argv: process.argv,
      },
    });
    process.exit(1);
  }
}

main();
