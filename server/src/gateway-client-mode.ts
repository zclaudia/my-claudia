import WebSocket from 'ws';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type {
  ClientToGatewayMessage,
  GatewayToClientMessage,
  GatewayBackendInfo,
  GatewayAuthResultMessage,
  GatewayBackendAuthResultMessage,
  GatewayBackendsListMessage,
  GatewayBackendMessageMessage,
  GatewayBackendDisconnectedMessage,
  GatewayErrorMessage,
  ClientMessage,
  ServerMessage,
} from '@my-claudia/shared';

/**
 * Gateway connection in CLIENT role.
 *
 * The existing GatewayClient connects as a BACKEND (register message).
 * This class connects as a CLIENT (gateway_auth message) and relays
 * messages between the local desktop frontend and remote backends
 * through the gateway, using SOCKS5 proxy when configured.
 */

export interface GatewayClientModeConfig {
  gatewayUrl: string;
  gatewaySecret: string;
  proxyUrl?: string;
  proxyAuth?: {
    username: string;
    password: string;
  };
}

type BackendMessageHandler = (backendId: string, message: ServerMessage) => void;
type BackendDisconnectedHandler = (backendId: string) => void;

export class GatewayClientMode {
  private ws: WebSocket | null = null;
  private config: GatewayClientModeConfig;
  private authenticated = false;
  private authenticatedBackends = new Set<string>();
  private discoveredBackends: GatewayBackendInfo[] = [];

  // Reconnection
  private reconnectAttempts = 0;
  private reconnectBaseInterval = 5000;
  private reconnectMaxInterval = 60000;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private intentionalDisconnect = false;

  // Event listeners (multiple supported — one per relay connection)
  private backendMessageListeners = new Set<BackendMessageHandler>();
  private backendDisconnectedListeners = new Set<BackendDisconnectedHandler>();

  // Pending backend auth callbacks (connect_backend → backend_auth_result)
  private pendingBackendAuths = new Map<string, {
    resolve: (result: { success: boolean; error?: string; features?: any[] }) => void;
    timeout: NodeJS.Timeout;
  }>();

  // Pending list_backends callbacks
  private pendingListBackends: Array<{
    resolve: (backends: GatewayBackendInfo[]) => void;
    timeout: NodeJS.Timeout;
  }> = [];

  constructor(config: GatewayClientModeConfig) {
    this.config = config;
  }

  addBackendMessageListener(handler: BackendMessageHandler): void {
    this.backendMessageListeners.add(handler);
  }

  removeBackendMessageListener(handler: BackendMessageHandler): void {
    this.backendMessageListeners.delete(handler);
  }

  addBackendDisconnectedListener(handler: BackendDisconnectedHandler): void {
    this.backendDisconnectedListeners.add(handler);
  }

  removeBackendDisconnectedListener(handler: BackendDisconnectedHandler): void {
    this.backendDisconnectedListeners.delete(handler);
  }

  connect(): void {
    this.intentionalDisconnect = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    const wsUrl = this.config.gatewayUrl.replace(/^http/, 'ws');
    console.log(`[GatewayClientMode] Connecting to ${wsUrl} as client...`);

    // Configure WebSocket options with SOCKS5 proxy if available
    const wsOptions: any = {};
    if (this.config.proxyUrl) {
      try {
        let proxyUrl = this.config.proxyUrl;
        if (this.config.proxyAuth) {
          const url = new URL(proxyUrl);
          url.username = this.config.proxyAuth.username;
          url.password = this.config.proxyAuth.password;
          proxyUrl = url.toString();
        }
        wsOptions.agent = new SocksProxyAgent(proxyUrl);
        console.log(`[GatewayClientMode] Using SOCKS5 proxy: ${this.config.proxyUrl}`);
      } catch (error) {
        console.error('[GatewayClientMode] Failed to configure proxy:', error);
      }
    }

    this.ws = new WebSocket(`${wsUrl}/ws`, wsOptions);

    this.ws.on('open', () => {
      console.log('[GatewayClientMode] Connected, authenticating...');
      this.sendGatewayAuth();
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message: GatewayToClientMessage = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('[GatewayClientMode] Failed to parse message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('[GatewayClientMode] Disconnected');
      this.authenticated = false;
      this.authenticatedBackends.clear();
      this.discoveredBackends = [];
      this.rejectAllPending();
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      console.error('[GatewayClientMode] Connection error:', error);
    });
  }

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
    this.authenticated = false;
    this.authenticatedBackends.clear();
    this.discoveredBackends = [];
    this.rejectAllPending();
  }

  isConnected(): boolean {
    return this.authenticated;
  }

  isBackendAuthenticated(backendId: string): boolean {
    return this.authenticatedBackends.has(backendId);
  }

  getDiscoveredBackends(): GatewayBackendInfo[] {
    return this.discoveredBackends;
  }

  /**
   * Authenticate to a remote backend through the gateway.
   * Returns a promise that resolves when backend_auth_result is received.
   */
  async connectBackend(backendId: string): Promise<{ success: boolean; error?: string; features?: any[] }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      return { success: false, error: 'Not connected to gateway' };
    }

    if (this.authenticatedBackends.has(backendId)) {
      return { success: true };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingBackendAuths.delete(backendId);
        resolve({ success: false, error: 'Backend auth timeout' });
      }, 15000);

      this.pendingBackendAuths.set(backendId, { resolve, timeout });

      this.send({
        type: 'connect_backend',
        backendId,
      });
    });
  }

  /**
   * Send a message to a remote backend through the gateway.
   */
  sendToBackend(backendId: string, message: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      console.error('[GatewayClientMode] Cannot send: not connected');
      return false;
    }

    if (!this.authenticatedBackends.has(backendId)) {
      console.error(`[GatewayClientMode] Cannot send: not authenticated to backend ${backendId}`);
      return false;
    }

    this.send({
      type: 'send_to_backend',
      backendId,
      message,
    });
    return true;
  }

  /**
   * List available backends from the gateway.
   */
  async listBackends(): Promise<GatewayBackendInfo[]> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      return this.discoveredBackends;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Remove this specific pending request
        this.pendingListBackends = this.pendingListBackends.filter(p => p.timeout !== timeout);
        resolve(this.discoveredBackends);
      }, 10000);

      this.pendingListBackends.push({ resolve, timeout });

      this.send({ type: 'list_backends' });
    });
  }

  /**
   * Create a SOCKS5-aware HTTP agent for proxying HTTP requests.
   * Returns undefined if no proxy is configured.
   */
  createHttpAgent(): import('socks-proxy-agent').SocksProxyAgent | undefined {
    if (!this.config.proxyUrl) return undefined;

    try {
      let proxyUrl = this.config.proxyUrl;
      if (this.config.proxyAuth) {
        const url = new URL(proxyUrl);
        url.username = this.config.proxyAuth.username;
        url.password = this.config.proxyAuth.password;
        proxyUrl = url.toString();
      }
      return new SocksProxyAgent(proxyUrl);
    } catch (error) {
      console.error('[GatewayClientMode] Failed to create HTTP agent:', error);
      return undefined;
    }
  }

  get gatewayUrl(): string {
    return this.config.gatewayUrl;
  }

  get gatewaySecret(): string {
    return this.config.gatewaySecret;
  }

  // --- Private methods ---

  private sendGatewayAuth(): void {
    this.send({
      type: 'gateway_auth',
      gatewaySecret: this.config.gatewaySecret,
    });
  }

  private send(message: ClientToGatewayMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(message: GatewayToClientMessage): void {
    switch (message.type) {
      case 'gateway_auth_result':
        this.handleAuthResult(message as GatewayAuthResultMessage);
        break;

      case 'backends_list':
        this.handleBackendsList(message as GatewayBackendsListMessage);
        break;

      case 'backend_auth_result':
        this.handleBackendAuthResult(message as GatewayBackendAuthResultMessage);
        break;

      case 'backend_message':
        this.handleBackendMessage(message as GatewayBackendMessageMessage);
        break;

      case 'backend_disconnected':
        this.handleBackendDisconnected(message as GatewayBackendDisconnectedMessage);
        break;

      case 'gateway_error':
        this.handleGatewayError(message as GatewayErrorMessage);
        break;
    }
  }

  private handleAuthResult(message: GatewayAuthResultMessage): void {
    if (message.success) {
      this.authenticated = true;
      this.reconnectAttempts = 0;
      if (message.backends) {
        this.discoveredBackends = message.backends;
      }
      console.log(`[GatewayClientMode] Authenticated. ${this.discoveredBackends.length} backends discovered.`);
    } else {
      console.error(`[GatewayClientMode] Auth failed: ${message.error}`);
      this.ws?.close();
    }
  }

  private handleBackendsList(message: GatewayBackendsListMessage): void {
    this.discoveredBackends = message.backends;
    console.log(`[GatewayClientMode] Backends list updated: ${message.backends.length}`);

    // Resolve all pending listBackends calls
    const pending = this.pendingListBackends;
    this.pendingListBackends = [];
    for (const p of pending) {
      clearTimeout(p.timeout);
      p.resolve(message.backends);
    }
  }

  private handleBackendAuthResult(message: GatewayBackendAuthResultMessage): void {
    if (message.success) {
      this.authenticatedBackends.add(message.backendId);
    }

    // Resolve pending auth
    const pending = this.pendingBackendAuths.get(message.backendId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingBackendAuths.delete(message.backendId);
      pending.resolve({
        success: message.success,
        error: message.error,
        features: message.features,
      });
    }
  }

  private handleBackendMessage(message: GatewayBackendMessageMessage): void {
    for (const handler of this.backendMessageListeners) {
      try {
        handler(message.backendId, message.message as ServerMessage);
      } catch (err) {
        console.error('[GatewayClientMode] Error in backend message handler:', err);
      }
    }
  }

  private handleBackendDisconnected(message: GatewayBackendDisconnectedMessage): void {
    this.authenticatedBackends.delete(message.backendId);
    for (const handler of this.backendDisconnectedListeners) {
      try {
        handler(message.backendId);
      } catch (err) {
        console.error('[GatewayClientMode] Error in backend disconnected handler:', err);
      }
    }
  }

  private handleGatewayError(message: GatewayErrorMessage): void {
    console.error(`[GatewayClientMode] Gateway error: ${message.code} - ${message.message}`);
  }

  private rejectAllPending(): void {
    // Reject pending backend auths
    for (const [backendId, pending] of this.pendingBackendAuths) {
      clearTimeout(pending.timeout);
      pending.resolve({ success: false, error: 'Disconnected' });
    }
    this.pendingBackendAuths.clear();

    // Reject pending list requests
    for (const p of this.pendingListBackends) {
      clearTimeout(p.timeout);
      p.resolve([]);
    }
    this.pendingListBackends = [];
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectBaseInterval * Math.pow(2, this.reconnectAttempts - 1),
      this.reconnectMaxInterval,
    );
    console.log(`[GatewayClientMode] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
