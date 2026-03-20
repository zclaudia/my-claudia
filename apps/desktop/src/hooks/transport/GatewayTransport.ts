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
  ServerFeature,
  GatewayBackendInfo,
  BackendRegistryEntry,
  ClientToGatewayMessage,
  GatewayToPeerMessage,
  PeerHelloMessage,
  PeerHelloResultMessage,
  GatewayRegistrySnapshotMessage,
  GatewayRegistryUpsertMessage,
  GatewayRegistryRemoveMessage,
  BackendSessionsListMessage,
  BackendSessionEventMessage,
  GatewayUpdateSubscriptionsMessage
} from '@my-claudia/shared';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useServerStore } from '../../stores/serverStore';
import { eagerSyncSessionUpdate, startSessionSync, stopSessionSync } from '../../services/sessionSync';

export interface GatewayTransportConfig {
  url: string;
  gatewaySecret: string;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (error: Event | string) => void;
  onBackendsUpdated: (backends: GatewayBackendInfo[]) => void;
  onBackendAuthResult: (backendId: string, success: boolean, error?: string, features?: ServerFeature[]) => void;
  onBackendMessage: (backendId: string, message: ServerMessage) => void;
  onBackendDisconnected: (backendId: string) => void;
  onSubscriptionAck?: (subscribedBackendIds: string[]) => void;
  // Registry callbacks (Phase 2)
  onRegistrySnapshot?: (entries: BackendRegistryEntry[]) => void;
  onRegistryUpsert?: (entry: BackendRegistryEntry) => void;
  onRegistryRemove?: (backendId: string, instanceId: string) => void;
}

export class GatewayTransport {
  private ws: WebSocket | null = null;
  private config: GatewayTransportConfig;
  private gatewayAuthenticated = false;
  private authenticatedBackends = new Set<string>();
  private pendingBackendAuths = new Set<string>();

  constructor(config: GatewayTransportConfig) {
    this.config = config;
  }

  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    this.gatewayAuthenticated = false;
    this.authenticatedBackends.clear();
    this.pendingBackendAuths.clear();

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
    this.pendingBackendAuths.clear();
    // Intentional disconnect: stop syncs and clear sessions
    stopSessionSync();
    useSessionsStore.getState().clearAllSessions();
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

    if (this.authenticatedBackends.has(backendId) || this.pendingBackendAuths.has(backendId)) {
      console.log('[GatewayTransport] Skipping duplicate backend auth request:', backendId);
      return;
    }

    this.pendingBackendAuths.add(backendId);

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

  /**
   * Update subscription preferences at the gateway
   */
  updateSubscriptions(subscribedBackendIds: string[], subscribeAll?: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.gatewayAuthenticated) {
      return;
    }

    const msg: GatewayUpdateSubscriptionsMessage = {
      type: 'update_subscriptions',
      subscribedBackendIds,
      subscribeAll
    };
    this.ws.send(JSON.stringify(msg));
  }

  private setupWebSocket(ws: WebSocket): void {
    ws.onopen = () => {
      console.log('[GatewayTransport] Connected to Gateway, sending peer_hello...');

      // Send peer_hello with client-only capability
      const peerHello: PeerHelloMessage = {
        type: 'peer_hello',
        gatewaySecret: this.config.gatewaySecret,
        capabilities: {
          client: true,
          backend: false,
        },
        identity: {
          deviceId: `client-${crypto.randomUUID().slice(0, 8)}`,
          instanceId: `client-${crypto.randomUUID().slice(0, 8)}`,
        },
      };
      ws.send(JSON.stringify(peerHello));
    };

    ws.onclose = () => {
      // Guard: ignore stale WebSocket close events during reconnection
      if (this.ws !== null && this.ws !== ws) return;

      console.log('[GatewayTransport] Disconnected from Gateway');
      this.ws = null;
      this.gatewayAuthenticated = false;
      this.authenticatedBackends.clear();
      this.pendingBackendAuths.clear();
      // Don't stop sync timers or clear sessions here —
      // session data survives temporary disconnects (mobile background).
      // Sync HTTP requests will fail silently until reconnected.
      // Cleanup only happens on intentional disconnect() or max reconnect failure.
      this.config.onDisconnected();
    };

    ws.onerror = (error) => {
      console.error('[GatewayTransport] WebSocket error:', error);
      this.config.onError(error);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const message: GatewayToPeerMessage = JSON.parse(event.data);
        this.handleGatewayMessage(message);
      } catch (error) {
        console.error('[GatewayTransport] Failed to parse message:', error);
      }
    };
  }

  private handleGatewayMessage(message: GatewayToPeerMessage): void {
    switch (message.type) {
      case 'peer_hello_result': {
        const result = message as PeerHelloResultMessage;
        if (result.success) {
          console.log('[GatewayTransport] Peer hello successful, peerId:', result.peerId);
          this.gatewayAuthenticated = true;
          this.config.onConnected();
          // Process registry snapshot from peer_hello_result
          if (result.registrySnapshot) {
            console.log('[GatewayTransport] Registry from peer_hello:', result.registrySnapshot.length, 'entries');
            this.config.onRegistrySnapshot?.(result.registrySnapshot);
            // Derive backends list for legacy consumers
            const backends: GatewayBackendInfo[] = result.registrySnapshot
              .filter(e => e.visible)
              .map(e => ({
                backendId: e.backendId,
                name: e.name,
                online: e.online,
                instanceId: e.instanceId,
                deviceId: e.deviceId,
                channel: e.channel,
              }));
            this.config.onBackendsUpdated(backends);
          } else {
            this.requestBackendsList();
          }
        } else {
          console.error('[GatewayTransport] Peer hello failed:', result.error);
          this.config.onError(result.error || 'Peer hello failed');
        }
        break;
      }

      case 'backends_list':
        console.log('[GatewayTransport] Backends discovered:', message.backends.length);
        this.config.onBackendsUpdated(message.backends);
        break;

      case 'backend_auth_result':
        this.pendingBackendAuths.delete(message.backendId);
        if (message.success) {
          console.log('[GatewayTransport] Backend authenticated:', message.backendId);
          this.authenticatedBackends.add(message.backendId);
          // Start periodic sync for every backend (including local backend via gateway),
          // so ActiveSessionsPanel has a consistent cross-backend session snapshot.
          startSessionSync(message.backendId, {
            skipInitialFullSync:
              useServerStore.getState().activeServerId === `gw:${message.backendId}`,
          });
        } else {
          console.error('[GatewayTransport] Backend auth failed:', message.backendId, message.error);
          this.authenticatedBackends.delete(message.backendId);
        }
        this.config.onBackendAuthResult(message.backendId, message.success, message.error, (message as any).features);
        break;

      case 'backend_message':
        // Unwrap and forward the backend message
        if (message.message && message.backendId) {
          // Check if it's a session-related message
          const innerMessage = message.message as any;
          if (innerMessage.type === 'backend_sessions_list') {
            this.handleSessionsList(innerMessage as BackendSessionsListMessage);
          } else if (innerMessage.type === 'backend_session_event') {
            this.handleSessionEvent(innerMessage as BackendSessionEventMessage);
          } else {
            // For non-session traffic, skip messages from our own local backend
            // to avoid duplicate chat/message streams with the direct local connection.
            const { localBackendId: msgLocalId } = useGatewayStore.getState();
            if (msgLocalId && message.backendId === msgLocalId) {
              break;
            }
            this.config.onBackendMessage(message.backendId, message.message as ServerMessage);
          }
        }
        break;

      case 'backend_disconnected':
        console.log('[GatewayTransport] Backend disconnected:', message.backendId);
        this.authenticatedBackends.delete(message.backendId);
        this.pendingBackendAuths.delete(message.backendId);
        // Stop periodic sync for this backend
        stopSessionSync(message.backendId);
        // Clear sessions for this backend
        useSessionsStore.getState().clearBackendSessions(message.backendId);
        this.config.onBackendDisconnected(message.backendId);
        break;

      case 'subscription_ack':
        console.log('[GatewayTransport] Subscription ack:', message.subscribedBackendIds);
        this.config.onSubscriptionAck?.(message.subscribedBackendIds);
        break;

      case 'gateway_error':
        console.error('[GatewayTransport] Gateway error:', message.message);
        this.config.onError(message.message);
        break;

      // Registry messages (Phase 2)
      case 'registry_snapshot': {
        const snapshotMsg = message as GatewayRegistrySnapshotMessage;
        console.log(`[GatewayTransport] Registry snapshot: ${snapshotMsg.registry.length} entries`);
        this.config.onRegistrySnapshot?.(snapshotMsg.registry);
        break;
      }

      case 'registry_upsert': {
        const upsertMsg = message as GatewayRegistryUpsertMessage;
        console.log(`[GatewayTransport] Registry upsert: ${upsertMsg.entry.backendId} (${upsertMsg.entry.name})`);
        this.config.onRegistryUpsert?.(upsertMsg.entry);
        break;
      }

      case 'registry_remove': {
        const removeMsg = message as GatewayRegistryRemoveMessage;
        console.log(`[GatewayTransport] Registry remove: ${removeMsg.backendId}`);
        this.config.onRegistryRemove?.(removeMsg.backendId, removeMsg.instanceId);
        break;
      }

      default:
        console.warn('[GatewayTransport] Unknown message type:', (message as any).type);
    }
  }

  private handleSessionsList(message: BackendSessionsListMessage): void {
    console.log(`[GatewayTransport] Received ${message.sessions.length} sessions from backend ${message.backendId}`);
    useSessionsStore.getState().setRemoteSessions(message.backendId, message.sessions.map(s => ({
      ...s,
      type: s.type || 'regular',
    })));
  }

  private handleSessionEvent(message: BackendSessionEventMessage): void {
    console.log(`[GatewayTransport] Session ${message.eventType}: ${message.session.id} on backend ${message.backendId}`);
    useSessionsStore.getState().handleSessionEvent(
      message.backendId,
      message.eventType,
      message.session as any
    );
    if (message.eventType !== 'deleted') {
      void eagerSyncSessionUpdate(message.session as any);
    }
  }
}
