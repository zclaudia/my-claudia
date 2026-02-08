/**
 * Gateway WebSocket Transport (Multi-Backend)
 *
 * Maintains a single WebSocket connection to a Gateway.
 * Supports discovering and communicating with multiple backends
 * through the Gateway's protocol.
 */

import type {
  ClientMessage,
  ServerMessage,
  GatewayBackendInfo,
  ClientToGatewayMessage,
  GatewayToClientMessage
} from '@my-claudia/shared';

export interface GatewayTransportConfig {
  url: string;
  gatewaySecret: string;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (error: Event | string) => void;
  onBackendsUpdated: (backends: GatewayBackendInfo[]) => void;
  onBackendAuthResult: (backendId: string, success: boolean, error?: string) => void;
  onBackendMessage: (backendId: string, message: ServerMessage) => void;
  onBackendDisconnected: (backendId: string) => void;
}

export class GatewayTransport {
  private ws: WebSocket | null = null;
  private config: GatewayTransportConfig;
  private gatewayAuthenticated = false;
  private authenticatedBackends = new Set<string>();

  constructor(config: GatewayTransportConfig) {
    this.config = config;
  }

  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    this.gatewayAuthenticated = false;
    this.authenticatedBackends.clear();

    this.ws = new WebSocket(this.config.url);
    this.setupWebSocket(this.ws);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.gatewayAuthenticated = false;
    this.authenticatedBackends.clear();
  }

  isConnected(): boolean {
    return this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN &&
      this.gatewayAuthenticated;
  }

  isBackendAuthenticated(backendId: string): boolean {
    return this.authenticatedBackends.has(backendId);
  }

  /**
   * Authenticate to a specific backend through the gateway
   */
  authenticateBackend(backendId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.gatewayAuthenticated) {
      console.error('[GatewayTransport] Cannot authenticate backend: not connected to gateway');
      this.config.onBackendAuthResult(backendId, false, 'Not connected to gateway');
      return;
    }

    const msg: ClientToGatewayMessage = {
      type: 'connect_backend',
      backendId
    };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Send a message to a specific backend through the gateway
   */
  sendToBackend(backendId: string, message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[GatewayTransport] Cannot send: not connected');
      return;
    }

    if (!this.authenticatedBackends.has(backendId)) {
      console.error('[GatewayTransport] Cannot send: not authenticated to backend', backendId);
      return;
    }

    const msg: ClientToGatewayMessage = {
      type: 'send_to_backend',
      backendId,
      message
    };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Request the list of available backends from the gateway
   */
  requestBackendsList(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.gatewayAuthenticated) {
      return;
    }

    const msg: ClientToGatewayMessage = {
      type: 'list_backends'
    };
    this.ws.send(JSON.stringify(msg));
  }

  private setupWebSocket(ws: WebSocket): void {
    ws.onopen = () => {
      console.log('[GatewayTransport] Connected to Gateway, authenticating...');

      // Authenticate with Gateway
      const authMsg: ClientToGatewayMessage = {
        type: 'gateway_auth',
        gatewaySecret: this.config.gatewaySecret
      };
      ws.send(JSON.stringify(authMsg));
    };

    ws.onclose = () => {
      console.log('[GatewayTransport] Disconnected from Gateway');
      this.ws = null;
      this.gatewayAuthenticated = false;
      this.authenticatedBackends.clear();
      this.config.onDisconnected();
    };

    ws.onerror = (error) => {
      console.error('[GatewayTransport] WebSocket error:', error);
      this.config.onError(error);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const message: GatewayToClientMessage = JSON.parse(event.data);
        this.handleGatewayMessage(message);
      } catch (error) {
        console.error('[GatewayTransport] Failed to parse message:', error);
      }
    };
  }

  private handleGatewayMessage(message: GatewayToClientMessage): void {
    switch (message.type) {
      case 'gateway_auth_result':
        if (message.success) {
          console.log('[GatewayTransport] Gateway authentication successful');
          this.gatewayAuthenticated = true;
          this.config.onConnected();
          // Auto-request backends list after auth
          this.requestBackendsList();
        } else {
          console.error('[GatewayTransport] Gateway auth failed:', message.error);
          this.config.onError(message.error || 'Gateway authentication failed');
        }
        break;

      case 'backends_list':
        console.log('[GatewayTransport] Backends discovered:', message.backends.length);
        this.config.onBackendsUpdated(message.backends);
        break;

      case 'backend_auth_result':
        if (message.success) {
          console.log('[GatewayTransport] Backend authenticated:', message.backendId);
          this.authenticatedBackends.add(message.backendId);
        } else {
          console.error('[GatewayTransport] Backend auth failed:', message.backendId, message.error);
          this.authenticatedBackends.delete(message.backendId);
        }
        this.config.onBackendAuthResult(message.backendId, message.success, message.error);
        break;

      case 'backend_message':
        // Unwrap and forward the backend message
        if (message.message && message.backendId) {
          this.config.onBackendMessage(message.backendId, message.message);
        }
        break;

      case 'backend_disconnected':
        console.log('[GatewayTransport] Backend disconnected:', message.backendId);
        this.authenticatedBackends.delete(message.backendId);
        this.config.onBackendDisconnected(message.backendId);
        break;

      case 'gateway_error':
        console.error('[GatewayTransport] Gateway error:', message.message);
        this.config.onError(message.message);
        break;

      default:
        console.warn('[GatewayTransport] Unknown message type:', (message as any).type);
    }
  }
}
