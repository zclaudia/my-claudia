import * as os from 'os';
import { ALL_SERVER_FEATURES } from '@my-claudia/shared';
import type { ServerMessage } from '@my-claudia/shared';
import type { SessionItem, ProjectItem } from '@my-claudia/shared';
import { GatewayClient, type GatewayClientConfig } from './gateway-client.js';
import { setGatewayClient } from './gateway-instance.js';
import { handleChannelClosed } from './gateway-channel-cleanup.js';
import { EmbeddedBackendFacadeProvider } from './embedded-provider.js';
import { StandaloneBackendFacadeProvider } from './standalone-provider.js';
import type { LocalBackendHandler } from './embedded-adapter.js';
import type { FacadeWsHub } from './ws-hub.js';
import type Database from 'better-sqlite3';
import type { GatewayConfig } from '../../routes/gateway.js';
import type { ServerContext } from '../../server.js';
import { hasForegroundActiveRunForSession } from '../../utils/run-state.js';
import { parsePersistedMessageContent } from '../../utils/persisted-message.js';

type FacadeProvider = {
  connect(): void;
  disconnect(): void;
  getWsHub(): FacadeWsHub;
};

import type { ActiveRun, ConnectedClient as WsConnectedClient } from '../conversation/ws/types.js';

type ActiveRunsMap = Map<string, ActiveRun>;

/** DB row shape for session message catch-up queries. */
interface MessageCatchUpRow {
  messageId: string;
  sessionId: string;
  offset: number;
  role: string;
  createdAt: number;
  content: string | null;
}

/** DB row shape for session catalog queries. */
interface SessionCatalogRow {
  id: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface GatewayManagerDeps {
  db: Database.Database;
  serverContext: ServerContext;
  activeRuns: ActiveRunsMap;
  connectedClients: Map<string, WsConnectedClient>;
  createVirtualClient: (channelId: string, transport: { send: (msg: ServerMessage) => void }) => WsConnectedClient;
  cancelRun: (runId: string) => void;
  host: string;
}

export class GatewayManager {
  private gatewayClient: GatewayClient | null = null;
  private facadeProvider: FacadeProvider | null = null;
  private virtualClients = new Map<string, WsConnectedClient>();
  private actualPort = 0;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  private readonly db: Database.Database;
  private readonly serverContext: ServerContext;
  private readonly activeRuns: ActiveRunsMap;
  private readonly connectedClients: Map<string, WsConnectedClient>;
  private readonly createVirtualClient: GatewayManagerDeps['createVirtualClient'];
  private readonly cancelRun: GatewayManagerDeps['cancelRun'];
  private readonly host: string;

  constructor(deps: GatewayManagerDeps) {
    this.db = deps.db;
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

  private clearSyncInterval(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  private cleanupVirtualClients(): void {
    for (const channelId of this.virtualClients.keys()) {
      this.connectedClients.delete(channelId);
      this.serverContext.terminalManager.detachClient(channelId);
    }
    this.virtualClients.clear();
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
      const db = this.db;
      const row = db.prepare(`
        SELECT id, enabled, gateway_url, gateway_secret, backend_name, backend_id,
               register_as_backend,
               proxy_url, proxy_username, proxy_password,
               created_at, updated_at
        FROM gateway_config
        WHERE id = 1
      `).get() as Record<string, unknown> | undefined;

      if (!row) return null;

      return {
        id: row.id as number,
        enabled: row.enabled === 1,
        gatewayUrl: row.gateway_url as string,
        gatewaySecret: row.gateway_secret as string,
        backendName: row.backend_name as string,
        gatewayBackendId: row.backend_id as string,
        registerAsBackend: row.register_as_backend === 1,
        proxyUrl: row.proxy_url as string | undefined,
        proxyUsername: row.proxy_username as string | undefined,
        proxyPassword: row.proxy_password as string | undefined,
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number
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
      this.clearSyncInterval();
      this.cleanupVirtualClients();
      this.gatewayClient.commands.connection.disconnect();
    }

    console.log(`\n🌐 Gateway V2 connection configured:`);
    console.log(`   URL: ${config.gatewayUrl}`);
    console.log(`   Name: ${config.backendName || `Backend on ${os.hostname()}`}`);

    process.env.GATEWAY_URL = config.gatewayUrl;
    process.env.GATEWAY_SECRET = config.gatewaySecret;

    const serverContext = this.serverContext;

    const gatewayClientConfig: GatewayClientConfig = {
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
          this.cleanupVirtualClients();
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

        // Send initial state so a reconnected client learns about active runs
        // without guessing ownership of orphaned runs.
        const heartbeat = serverContext.getStateHeartbeat();
        this.gatewayClient?.commands.channel.sendToIncoming(channelId, heartbeat);
      }

      await serverContext.handleMessage(virtualClient, message);
    });

    this.gatewayClient.commands.channel.onIncomingClosed((channelId) => {
      handleChannelClosed(channelId, this.activeRuns);
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
        `).all(sessionId, afterOffset) as MessageCatchUpRow[];

        return rows.map((r) => ({
          messageId: r.messageId,
          sessionId: r.sessionId,
          offset: r.offset,
          role: r.role as 'user' | 'assistant' | 'system' | 'tool',
          createdAt: r.createdAt,
          content: parsePersistedMessageContent(r.content),
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

    this.syncInterval = syncGatewayStatus;
  }

  async disconnect(): Promise<void> {
    if (this.gatewayClient) {
      console.log('📡 Disconnecting from Gateway V2...');
      this.clearSyncInterval();
      this.gatewayClient.commands.connection.disconnect();
      setGatewayClient(null);
      this.gatewayClient = null;
      this.cleanupVirtualClients();
      this.serverContext.updateGatewayConnected(false);
      this.serverContext.updateGatewayBackendId(null);
      this.serverContext.updateDiscoveredBackends([]);
    }
    this.ensureStandaloneFacade();
  }

  shutdown(): void {
    this.clearSyncInterval();
    this.cleanupVirtualClients();
    if (this.gatewayClient) {
      this.gatewayClient.commands.connection.disconnect();
      setGatewayClient(null);
      this.gatewayClient = null;
    }
    this.facadeProvider?.disconnect();
    this.facadeProvider = null;
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
          `).all(sessionId, afterOffset) as MessageCatchUpRow[];
          return rows.map((r) => ({
            messageId: r.messageId,
            sessionId: r.sessionId,
            offset: r.offset,
            role: r.role as 'user' | 'assistant' | 'system' | 'tool',
            createdAt: r.createdAt,
            content: parsePersistedMessageContent(r.content),
          }));
        } catch (error) {
          console.error('[LocalHandler] Catch-up error:', error);
          throw error;
        }
      },
      onServerEvent: (listener) => {
        serverEventListeners.add(listener);
        return () => {
          serverEventListeners.delete(listener);
        };
      },
      getSessionItems: () => {
        try {
          const sessions = serverContext.db.prepare(`
            SELECT s.id, s.name, s.project_id as projectId,
                   s.created_at as createdAt, s.updated_at as updatedAt,
                   s.archived_at as archivedAt
            FROM sessions s
            LEFT JOIN projects p ON s.project_id = p.id
            WHERE s.archived_at IS NULL
              AND (p.is_internal IS NULL OR p.is_internal = 0)
            ORDER BY s.updated_at DESC
          `).all() as Array<Record<string, unknown>>;
          return sessions.map((s): SessionItem => ({
            sessionId: s.id as string,
            projectId: (s.projectId as string) || undefined,
            title: (s.name as string) || undefined,
            createdAt: s.createdAt as number,
            updatedAt: s.updatedAt as number,
            lastMessageAt: s.updatedAt as number,
            runStatus: hasForegroundActiveRunForSession(activeRuns, s.id as string) ? 'running' : 'idle',
          }));
        } catch {
          return [];
        }
      },
      getProjectItems: () => {
        try {
          const projects = serverContext.db.prepare(`
            SELECT id, name, created_at as createdAt, updated_at as updatedAt
            FROM projects
            WHERE is_internal = 0
            ORDER BY updated_at DESC
          `).all() as Array<Record<string, unknown>>;
          return projects.map((p): ProjectItem => ({
            projectId: p.id as string,
            name: (p.name as string) || '',
            createdAt: p.createdAt as number,
            updatedAt: p.updatedAt as number,
          }));
        } catch {
          return [];
        }
      },
      getCapabilities: () => [...ALL_SERVER_FEATURES],
    };
  }
}
