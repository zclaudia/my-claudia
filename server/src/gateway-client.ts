import WebSocket from 'ws';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type {
  GatewayRegisterMessage,
  GatewayToBackendMessage,
  BackendToGatewayMessage,
  GatewayClientAuthMessage,
  GatewayForwardedMessage,
  GatewayClientConnectedMessage,
  GatewayClientDisconnectedMessage,
  GatewayHttpProxyRequest,
  GatewayHttpProxyResponse,
  GatewayBackendsListMessage,
  GatewayBackendInfo,
  ClientMessage,
  ServerMessage,
} from '@my-claudia/shared';
import { ALL_SERVER_FEATURES } from '@my-claudia/shared';

// Config storage path
const CONFIG_DIR = process.env.MY_CLAUDIA_DATA_DIR
  ? path.resolve(process.env.MY_CLAUDIA_DATA_DIR)
  : path.join(os.homedir(), '.my-claudia');
const DEVICE_CONFIG_PATH = path.join(CONFIG_DIR, 'device.json');

interface DeviceConfig {
  deviceId: string;
  createdAt: number;
}

interface GatewayClientConfig {
  gatewayUrl: string;
  gatewaySecret: string;
  name?: string;
  serverPort?: number;  // Local server port for HTTP proxy requests
  visible?: boolean;    // Whether to register as visible backend (default true)
  proxyUrl?: string;
  proxyAuth?: {
    username: string;
    password: string;
  };
}

type MessageHandler = (clientId: string, message: ClientMessage) => Promise<ServerMessage | null>;
type ClientEventHandler = (clientId: string) => void;

// Database and ActiveRun types (to be injected)
type Database = any;  // Will be the better-sqlite3 database instance
type ActiveRunsMap = Map<string, any>;  // sessionId -> ActiveRun

/**
 * Get or create a stable device ID for this backend
 */
function getOrCreateDeviceId(): string {
  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Try to load existing device ID
  if (fs.existsSync(DEVICE_CONFIG_PATH)) {
    try {
      const config: DeviceConfig = JSON.parse(fs.readFileSync(DEVICE_CONFIG_PATH, 'utf-8'));
      return config.deviceId;
    } catch {
      // Fall through to create new ID
    }
  }

  // Generate a new device ID
  const deviceId = crypto.randomUUID();
  const config: DeviceConfig = {
    deviceId,
    createdAt: Date.now()
  };
  fs.writeFileSync(DEVICE_CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`[Gateway] Generated new device ID: ${deviceId}`);

  return deviceId;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private config: GatewayClientConfig;
  private deviceId: string;
  private backendId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectInterval = 5000;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected = false;
  private messageHandler: MessageHandler | null = null;
  private clientConnectedHandler: ClientEventHandler | null = null;
  private clientDisconnectedHandler: ClientEventHandler | null = null;
  private clientSubscribedHandler: ClientEventHandler | null = null;

  // Track authenticated clients (client auth is verified by backend)
  private authenticatedClients = new Set<string>();
  // Discovered backends from gateway
  private discoveredBackends: GatewayBackendInfo[] = [];
  // Flag to prevent reconnection after intentional disconnect
  private intentionalDisconnect = false;

  // Dependencies for session broadcasting
  private db: Database | null = null;
  private activeRuns: ActiveRunsMap | null = null;

  constructor(config: GatewayClientConfig, db?: Database, activeRuns?: ActiveRunsMap) {
    this.config = config;
    this.deviceId = getOrCreateDeviceId();
    this.db = db || null;
    this.activeRuns = activeRuns || null;
  }

  /**
   * Set the handler for client messages
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Set the handler for client connect events
   */
  onClientConnected(handler: ClientEventHandler): void {
    this.clientConnectedHandler = handler;
  }

  /**
   * Set the handler for client disconnect events
   */
  onClientDisconnected(handler: ClientEventHandler): void {
    this.clientDisconnectedHandler = handler;
  }

  /**
   * Set the handler for client subscribed events
   */
  onClientSubscribed(handler: ClientEventHandler): void {
    this.clientSubscribedHandler = handler;
  }

  /**
   * Connect to the Gateway
   */
  connect(): void {
    this.intentionalDisconnect = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    const wsUrl = this.config.gatewayUrl.replace(/^http/, 'ws');
    console.log(`[Gateway] Connecting to ${wsUrl}...`);

    // Configure WebSocket options
    const wsOptions: any = {};

    // Add SOCKS5 proxy agent if configured
    if (this.config.proxyUrl) {
      try {
        let proxyUrl = this.config.proxyUrl;

        // Add authentication to proxy URL if provided
        if (this.config.proxyAuth) {
          const url = new URL(proxyUrl);
          url.username = this.config.proxyAuth.username;
          url.password = this.config.proxyAuth.password;
          proxyUrl = url.toString();
        }

        wsOptions.agent = new SocksProxyAgent(proxyUrl);
        console.log(`[Gateway] Using SOCKS5 proxy: ${this.config.proxyUrl}`);
      } catch (error) {
        console.error('[Gateway] Failed to configure proxy:', error);
      }
    }

    this.ws = new WebSocket(`${wsUrl}/ws`, wsOptions);

    this.ws.on('open', () => {
      console.log('[Gateway] Connected, registering...');
      this.register();
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message: GatewayToBackendMessage = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('[Gateway] Failed to parse message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('[Gateway] Disconnected');
      this.isConnected = false;
      this.backendId = null;
      this.discoveredBackends = [];
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      console.error('[Gateway] Connection error:', error);
    });
  }

  /**
   * Disconnect from the Gateway
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.backendId = null;
    this.discoveredBackends = [];
  }

  /**
   * Send a response to a specific client via Gateway (for request-response routing)
   */
  sendToClient(clientId: string, message: ServerMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[Gateway] Cannot send message: not connected');
      return;
    }

    const response: BackendToGatewayMessage = {
      type: 'backend_response',
      clientId,
      message
    };

    this.ws.send(JSON.stringify(response));
  }

  /**
   * Broadcast a message to all subscribers via Gateway
   */
  broadcast(message: ServerMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[Gateway] Cannot broadcast: not connected');
      return;
    }

    const msg: BackendToGatewayMessage = {
      type: 'broadcast_to_subscribers',
      message
    };

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Get the current backend ID (assigned by Gateway)
   */
  getBackendId(): string | null {
    return this.backendId;
  }

  /**
   * Get discovered backends from gateway
   */
  getDiscoveredBackends(): GatewayBackendInfo[] {
    return this.discoveredBackends;
  }

  /**
   * Check if connected to Gateway
   */
  isGatewayConnected(): boolean {
    return this.isConnected;
  }

  private register(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const registerMessage: GatewayRegisterMessage = {
      type: 'register',
      gatewaySecret: this.config.gatewaySecret,
      deviceId: this.deviceId,
      name: this.config.name,
      visible: this.config.visible !== false
    };

    this.ws.send(JSON.stringify(registerMessage));
  }

  private handleMessage(message: GatewayToBackendMessage): void {
    switch (message.type) {
      case 'register_result':
        if (message.success && message.backendId) {
          this.isConnected = true;
          this.backendId = message.backendId;
          this.reconnectAttempts = 0;
          console.log(`[Gateway] Registered as backend: ${this.backendId}`);
        } else {
          console.error('[Gateway] Registration failed:', message.error);
          this.ws?.close();
        }
        break;

      case 'backends_list': {
        const backendsMsg = message as GatewayBackendsListMessage;
        this.discoveredBackends = backendsMsg.backends.map(b => ({
          ...b,
          isLocal: b.backendId === this.backendId
        }));
        console.log(`[Gateway] Discovered backends: ${backendsMsg.backends.length}`);
        break;
      }

      case 'client_connected':
        this.handleClientConnected(message as GatewayClientConnectedMessage);
        break;

      case 'client_auth':
        this.handleClientAuth(message as GatewayClientAuthMessage);
        break;

      case 'forwarded':
        this.handleForwardedMessage(message as GatewayForwardedMessage);
        break;

      case 'client_disconnected':
        this.handleClientDisconnected(message as GatewayClientDisconnectedMessage);
        break;

      case 'http_proxy_request':
        this.handleHttpProxyRequest(message as GatewayHttpProxyRequest);
        break;

      case 'client_subscribed': {
        const { clientId } = message as any;
        console.log(`[GatewayClient] Client ${clientId} subscribed to this backend`);
        this.broadcastSessionsList();
        this.clientSubscribedHandler?.(clientId);
        break;
      }
    }
  }

  private async handleHttpProxyRequest(msg: GatewayHttpProxyRequest): Promise<void> {
    const port = this.config.serverPort || 3100;
    const url = `http://localhost:${port}${msg.path}`;

    try {
      console.log(`[Gateway] HTTP proxy: ${msg.method} ${msg.path}`);
      const resp = await fetch(url, {
        method: msg.method,
        headers: msg.headers,
        body: !['GET', 'HEAD'].includes(msg.method) ? msg.body : undefined
      });

      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const response: GatewayHttpProxyResponse = {
        type: 'http_proxy_response',
        requestId: msg.requestId,
        statusCode: resp.status,
        headers: responseHeaders,
        body: await resp.text()
      };

      this.ws?.send(JSON.stringify(response));
    } catch (error) {
      console.error('[Gateway] HTTP proxy error:', error);
      const response: GatewayHttpProxyResponse = {
        type: 'http_proxy_response',
        requestId: msg.requestId,
        statusCode: 502,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'PROXY_ERROR', message: 'Failed to reach local server' }
        })
      };
      this.ws?.send(JSON.stringify(response));
    }
  }

  private handleClientConnected(message: GatewayClientConnectedMessage): void {
    console.log(`[Gateway] Client connected: ${message.clientId}`);
    this.clientConnectedHandler?.(message.clientId);
  }

  private handleClientAuth(message: GatewayClientAuthMessage): void {
    console.log(`[Gateway] Client auth request: ${message.clientId}`);

    // Trust clients from gateway — no per-backend API key validation
    this.authenticatedClients.add(message.clientId);
    console.log(`[Gateway] Client ${message.clientId} authenticated (trusted via gateway)`);

    const response: BackendToGatewayMessage = {
      type: 'client_auth_result',
      clientId: message.clientId,
      success: true,
      features: ALL_SERVER_FEATURES,
    };

    this.ws?.send(JSON.stringify(response));
  }

  private async handleForwardedMessage(message: GatewayForwardedMessage): Promise<void> {
    const { clientId, message: clientMessage } = message;

    // Check if client is authenticated
    if (!this.authenticatedClients.has(clientId)) {
      console.log(`[Gateway] Rejecting message from unauthenticated client: ${clientId}`);
      this.sendToClient(clientId, {
        type: 'error',
        code: 'UNAUTHORIZED',
        message: 'Not authenticated'
      });
      return;
    }

    // Forward to message handler
    if (this.messageHandler) {
      try {
        const response = await this.messageHandler(clientId, clientMessage);
        if (response) {
          this.sendToClient(clientId, response);
        }
      } catch (error) {
        console.error('[Gateway] Error handling message:', error);
        this.sendToClient(clientId, {
          type: 'error',
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Internal error'
        });
      }
    }
  }

  private handleClientDisconnected(message: GatewayClientDisconnectedMessage): void {
    console.log(`[Gateway] Client disconnected: ${message.clientId}`);
    this.authenticatedClients.delete(message.clientId);
    this.clientDisconnectedHandler?.(message.clientId);
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect) {
      console.log('[Gateway] Skipping reconnect (intentional disconnect)');
      return;
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[Gateway] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[Gateway] Reconnecting in ${this.reconnectInterval}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, this.reconnectInterval);
  }

  /**
   * Broadcast current sessions list to all subscribers
   */
  private broadcastSessionsList(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[GatewayClient] Cannot broadcast sessions list: not connected');
      return;
    }

    if (!this.db || !this.activeRuns) {
      console.warn('[GatewayClient] Cannot broadcast sessions list: db or activeRuns not available');
      return;
    }

    try {
      // Get all sessions from database
      const sessions = this.db.prepare(`
        SELECT id, project_id as projectId, name, provider_id as providerId,
               created_at as createdAt, updated_at as updatedAt
        FROM sessions
        ORDER BY updated_at DESC
      `).all();

      // Add isActive status based on activeRuns
      const sessionsWithStatus = sessions.map((session: any) => ({
        id: session.id,
        projectId: session.projectId,
        name: session.name,
        providerId: session.providerId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        isActive: [...this.activeRuns!.values()].some((run: any) => run.sessionId === session.id)
      }));

      // Broadcast via broadcast_to_subscribers
      this.broadcast({
        type: 'backend_sessions_list',
        backendId: this.backendId || '',
        sessions: sessionsWithStatus
      } as any);

      console.log(`[GatewayClient] Broadcast ${sessions.length} sessions to all subscribers`);
    } catch (error) {
      console.error('[GatewayClient] Failed to broadcast sessions list:', error);
    }
  }

  /**
   * Broadcast a session event to all subscribed clients
   */
  public broadcastSessionEvent(
    eventType: 'created' | 'updated' | 'deleted',
    session: any
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[GatewayClient] Cannot broadcast session event: not connected');
      return;
    }

    const message: BackendToGatewayMessage = {
      type: 'broadcast_session_event',
      eventType,
      session
    };

    this.ws.send(JSON.stringify(message));
    console.log(`[GatewayClient] Broadcasted session ${eventType}: ${session.id}`);
  }
}
