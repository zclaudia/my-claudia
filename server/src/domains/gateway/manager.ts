import * as os from 'os';
import { ALL_SERVER_FEATURES } from '@my-claudia/shared';
import type { ServerMessage } from '@my-claudia/shared';
import type { SessionCatalogItem } from '@my-claudia/shared';
import { GatewayClient } from './gateway-client.js';
import { setGatewayClient } from './gateway-instance.js';
import { cancelRunsForClosedChannel } from './gateway-channel-cleanup.js';
import { EmbeddedBackendFacadeProvider } from './embedded-provider.js';
import { StandaloneBackendFacadeProvider } from './standalone-provider.js';
import type { LocalBackendHandler } from './embedded-adapter.js';
import type { FacadeWsHub } from './ws-hub.js';
import { initDatabase } from '../../storage/db.js';
import type { GatewayConfig } from '../../routes/gateway.js';
import type { ServerContext } from '../../server.js';
import { hasForegroundActiveRunForSession } from '../../utils/run-state.js';

type FacadeProvider = {
  connect(): void;
  disconnect(): void;
  getWsHub(): FacadeWsHub;
};

type ActiveRunsMap = Map<string, any>;

export interface GatewayManagerDeps {
  serverContext: ServerContext;
  activeRuns: ActiveRunsMap;
  connectedClients: Map<string, any>;
  createVirtualClient: (channelId: string, transport: { send: (msg: ServerMessage) => void }) => any;
  cancelRun: (runId: string) => void;
  host: string;
}

export class GatewayManager {
  private gatewayClient: GatewayClient | null = null;
  private facadeProvider: FacadeProvider | null = null;
  private virtualClients = new Map<string, any>();
  private actualPort = 0;

  private readonly serverContext: ServerContext;
  private readonly activeRuns: ActiveRunsMap;
  private readonly connectedClients: Map<string, any>;
  private readonly createVirtualClient: GatewayManagerDeps['createVirtualClient'];
  private readonly cancelRun: GatewayManagerDeps['cancelRun'];
  private readonly host: string;

  constructor(deps: GatewayManagerDeps) {
    this.serverContext = deps.serverContext;
    this.activeRuns = deps.activeRuns;
    this.connectedClients = deps.connectedClients;
    this.createVirtualClient = deps.createVirtualClient;
    this.cancelRun = deps.cancelRun;
    this.host = deps.host;
  }

  setPort(port: number): void {
    this.actualPort = port;
  }

  getClient(): GatewayClient | null {
    return this.gatewayClient;
  }

  private attachFacadeProvider(nextProvider: FacadeProvider): void {
    if (this.facadeProvider === nextProvider) return;
    this.facadeProvider?.disconnect();
    this.facadeProvider = nextProvider;
    this.facadeProvider.connect();
    this.serverContext.setFacadeHub(this.facadeProvider.getWsHub());
  }

  ensureStandaloneFacade(): void {
    const standaloneFacade = new StandaloneBackendFacadeProvider({
      serverPort: this.actualPort,
      instanceId: 'standalone',
      deviceId: 'standalone',
      localHandler: this.createLocalBackendHandler(),
    });
    this.attachFacadeProvider(standaloneFacade);
    console.log(`📡 Facade WS endpoint: ws://${this.host}:${this.actualPort}/ws/backend-facade (standalone)`);
  }

  private ensureEmbeddedGatewayFacade(): void {
    if (!this.gatewayClient) return;
    const embeddedFacade = new EmbeddedBackendFacadeProvider(
      this.gatewayClient,
      this.createLocalBackendHandler(),
      this.actualPort,
    );
    this.attachFacadeProvider(embeddedFacade);
    console.log(`📡 Facade WS endpoint: ws://${this.host}:${this.actualPort}/ws/backend-facade`);
  }

  loadConfig(): GatewayConfig | null {
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

  async connect(config: GatewayConfig): Promise<void> {
    if (!config.gatewayUrl || !config.gatewaySecret) {
      console.error('[Gateway] URL or Secret not configured');
      return;
    }

    if (this.gatewayClient) {
      const syncInterval = (this.gatewayClient as any)._syncInterval;
      if (syncInterval) clearInterval(syncInterval);
      this.gatewayClient.commands.connection.disconnect();
    }

    console.log(`\n🌐 Gateway V2 connection configured:`);
    console.log(`   URL: ${config.gatewayUrl}`);
    console.log(`   Name: ${config.backendName || `Backend on ${os.hostname()}`}`);

    process.env.GATEWAY_URL = config.gatewayUrl;
    process.env.GATEWAY_SECRET = config.gatewaySecret;

    const serverContext = this.serverContext;

    const gatewayClientConfig: any = {
      gatewayUrl: config.gatewayUrl,
      gatewaySecret: config.gatewaySecret,
      name: config.backendName || `Backend on ${os.hostname()}`,
      channel: process.env.MY_CLAUDIA_CHANNEL || 'prod',
      serverPort: this.actualPort,
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

    this.gatewayClient = new GatewayClient(gatewayClientConfig, serverContext.db, this.activeRuns);
    setGatewayClient(this.gatewayClient);

    this.gatewayClient.events.setOutgoingEvents({
      onConnectionStateChanged: (connected) => {
        if (connected) {
          this.ensureEmbeddedGatewayFacade();
        } else {
          this.ensureStandaloneFacade();
        }
      },
    });

    this.gatewayClient.commands.channel.onIncomingMessage(async (channelId, message) => {
      let virtualClient = this.virtualClients.get(channelId);
      if (!virtualClient) {
        virtualClient = this.createVirtualClient(channelId, {
          send: (msg: ServerMessage) => {
            this.gatewayClient?.commands.channel.sendToIncoming(channelId, msg);
          }
        });
        this.virtualClients.set(channelId, virtualClient);
      }

      await serverContext.handleMessage(virtualClient, message);
    });

    this.gatewayClient.commands.channel.onIncomingClosed((channelId) => {
      cancelRunsForClosedChannel(channelId, this.activeRuns, this.cancelRun);
      this.virtualClients.delete(channelId);
      this.connectedClients.delete(channelId);
      serverContext.terminalManager.detachClient(channelId);
    });

    // Set up catch-up handler for content recovery
    this.gatewayClient.commands.channel.onCatchUp(async (sessionId, afterOffset) => {
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

    this.gatewayClient.commands.connection.connect();

    // Set identity immediately
    serverContext.updateGatewayIdentity(this.gatewayClient.queries.identity.getInstanceId(), this.gatewayClient.queries.identity.getDeviceId());

    // Sync gateway status periodically
    const syncGatewayStatus = setInterval(() => {
      if (this.gatewayClient) {
        serverContext.updateGatewayConnected(this.gatewayClient.queries.connection.isConnected());
        const backendId = this.gatewayClient.queries.identity.getBackendId();
        if (backendId) {
          serverContext.updateGatewayBackendId(backendId);
        }
        serverContext.updateDiscoveredBackends(this.gatewayClient.queries.registry.getDiscoveredBackends());
      }
    }, 2000);

    (this.gatewayClient as any)._syncInterval = syncGatewayStatus;
  }

  async disconnect(): Promise<void> {
    if (this.gatewayClient) {
      console.log('📡 Disconnecting from Gateway V2...');
      const syncInterval = (this.gatewayClient as any)._syncInterval;
      if (syncInterval) clearInterval(syncInterval);
      this.gatewayClient.commands.connection.disconnect();
      setGatewayClient(null);
      this.gatewayClient = null;
      for (const channelId of this.virtualClients.keys()) {
        this.connectedClients.delete(channelId);
        this.serverContext.terminalManager.detachClient(channelId);
      }
      this.virtualClients.clear();
      this.serverContext.updateGatewayConnected(false);
      this.serverContext.updateGatewayBackendId(null);
      this.serverContext.updateDiscoveredBackends([]);
    }
    this.ensureStandaloneFacade();
  }

  shutdown(): void {
    if (this.gatewayClient) {
      this.gatewayClient.commands.connection.disconnect();
    }
  }

  /**
   * Create a LocalBackendHandler that routes facade messages to the server's
   * internal message handler, providing in-process short-circuit for the
   * local embedded backend.
   */
  private createLocalBackendHandler(): LocalBackendHandler {
    const serverContext = this.serverContext;
    const activeRuns = this.activeRuns;
    const createVirtualClient = this.createVirtualClient;

    // Virtual client for facade-routed messages (shares lifecycle with facade)
    let facadeVirtualClient: ReturnType<typeof createVirtualClient> | null = null;
    const serverEventListeners = new Set<(message: ServerMessage) => void>();

    return {
      onMessage: async (message) => {
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
}
