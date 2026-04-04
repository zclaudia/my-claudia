/**
 * Gateway WebSocket Transport (Client-Only Peer)
 *
 * Implements the gateway sync protocol for desktop/mobile client.
 * Features:
 * - Epoch-bound routing
 * - Snapshot-based registry sync
 * - Backend subscription model for backend interaction
 * - Content catch-up for disconnect recovery
 */

import type {
  ClientMessage,
  ServerMessage,
  BackendPresence,
  RegistrySyncPayload,
  RegistrySnapshotMessage,
  PeerHelloMessage,
  PeerReadyMessage,
  BackendDataSnapshotMessage,
  BackendDataEventMessage,
  RequestBackendDataSnapshotMessage,
  SessionItem,
  ProjectItem,
  SubscribeBackendMessage,
  BackendSubscribedMessage,
  UnsubscribeBackendMessage,
  BackendUnsubscribedMessage,
  BackendClientMessage,
  BackendServerMessage,
  RunStreamEvent,
  CatchUpSessionContentMessage,
  SessionContentPatchMessage,
  SessionContentPatchErrorMessage,
  SessionMessage,
  GatewayErrorMessage,
} from '@my-claudia/shared';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useOwnershipStore } from '../../stores/ownershipStore';

// ============================================================================
// Config & Callbacks
// ============================================================================

export interface GatewayTransportConfig {
  url: string;
  gatewaySecret: string;
  deviceId: string;
  instanceId: string;

  onConnected: (peerSessionId: string, recoveryToken: string) => void;
  onDisconnected: () => void;
  onError: (error: Event | string) => void;
  onRegistryChanged: (items: BackendPresence[]) => void;
  onBackendDataSnapshot: (backendId: string, sessions: SessionItem[], projects: ProjectItem[]) => void;
  onBackendDataEvent: (backendId: string, event: BackendDataEventMessage) => void;
  onBackendSubscribed: (backendId: string, epoch: number, capabilities: string[]) => void;
  onBackendUnsubscribed: (backendId: string, reason: string) => void;
  onBackendServerMessage: (backendId: string, message: ServerMessage) => void;
  onRunStreamEvent: (backendId: string, sessionId: string, event: RunStreamEvent) => void;
  onContentPatch: (backendId: string, sessionId: string, messages: SessionMessage[], latestOffset: number) => void;
  onContentPatchError: (backendId: string, sessionId: string, afterOffset: number, error: string) => void;
}

// ============================================================================
// Transport
// ============================================================================

export class GatewayTransport {
  private ws: WebSocket | null = null;
  private config: GatewayTransportConfig;
  private expectedCloseWs: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private healthProbeTimeout: ReturnType<typeof setTimeout> | null = null;

  private peerSessionId: string | null = null;
  private recoveryToken: string | null = null;
  private authenticated = false;

  private registryItems = new Map<string, BackendPresence>();

  private resolvedUrl: string | null = null;

  /** Set of backendIds we are currently subscribed to. */
  subscribedBackends = new Set<string>();

  constructor(config: GatewayTransportConfig) {
    this.config = config;
  }

  connect(): void {
    this.intentionalClose = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.expectedCloseWs = this.ws;
      this.ws.close();
    }
    this.authenticated = false;
    this.subscribedBackends.clear();
    // Normalize URL: ensure ws:// or wss:// protocol for WebSocket
    let wsUrl = this.config.url;
    if (wsUrl.startsWith('https://')) {
      wsUrl = 'wss://' + wsUrl.slice(8);
    } else if (wsUrl.startsWith('http://')) {
      wsUrl = 'ws://' + wsUrl.slice(7);
    } else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      wsUrl = 'ws://' + wsUrl;
    }
    // Append /ws path if not already present
    if (!wsUrl.endsWith('/ws') && !wsUrl.includes('/ws?')) {
      wsUrl = wsUrl.replace(/\/?$/, '/ws');
    }
    this.resolvedUrl = wsUrl;
    console.log(`[GatewayTransport] Connecting to: ${wsUrl} (original: ${this.config.url})`);
    this.ws = new WebSocket(wsUrl);
    this.setupWebSocket(this.ws);
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.expectedCloseWs = this.ws;
      this.ws.close();
      this.ws = null;
    }
    this.cleanup();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.authenticated;
  }

  // --- Backend Data ---
  requestBackendDataSnapshot(backendId: string): void {
    this.send({ type: 'request_backend_data_snapshot', backendId } satisfies RequestBackendDataSnapshotMessage);
  }

  // --- Backend Subscription ---
  subscribe(backendId: string): void {
    if (this.subscribedBackends.has(backendId)) return;
    this.send({ type: 'subscribe_backend', backendId } satisfies SubscribeBackendMessage);
  }

  unsubscribe(backendId: string): void {
    this.send({ type: 'unsubscribe_backend', backendId } satisfies UnsubscribeBackendMessage);
  }

  sendToBackend(backendId: string, message: ClientMessage): void {
    if (!this.subscribedBackends.has(backendId)) {
      console.error('[GatewayTransport] Cannot send: not subscribed to backend', backendId);
      return;
    }
    this.send({ type: 'backend_client_message', backendId, message } satisfies BackendClientMessage);
  }

  isBackendSubscribed(backendId: string): boolean {
    return this.subscribedBackends.has(backendId);
  }

  // --- Content ---
  catchUpContent(backendId: string, sessionId: string, afterOffset: number): void {
    this.send({ type: 'catch_up_session_content', backendId, sessionId, afterOffset } satisfies CatchUpSessionContentMessage);
  }

  // --- Reconnect & Health ---

  /** Force an immediate reconnect, bypassing exponential backoff. */
  forceReconnect(): void {
    console.log('[GatewayTransport] Force reconnect requested');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHealthProbe();
    this.reconnectAttempt = 0;
    this.intentionalClose = false;
    this.connect();
  }

  /** Send an application-level ping to detect half-dead connections. */
  probeHealth(): void {
    if (!this.isConnected()) return;
    if (this.healthProbeTimeout) return; // Probe already in-flight
    this.send({ type: 'ping', ts: Date.now() });
    this.healthProbeTimeout = setTimeout(() => {
      this.healthProbeTimeout = null;
      console.warn('[GatewayTransport] Health probe timeout — closing stale connection');
      this.ws?.close(4000, 'health probe timeout');
    }, 10_000);
  }

  private clearHealthProbe(): void {
    if (this.healthProbeTimeout) {
      clearTimeout(this.healthProbeTimeout);
      this.healthProbeTimeout = null;
    }
  }

  // --- Accessors ---
  getRegistryItems(): Map<string, BackendPresence> { return this.registryItems; }
  getPeerSessionId(): string | null { return this.peerSessionId; }
  getRecoveryToken(): string | null { return this.recoveryToken; }
  /** The actual WebSocket URL used in the last connect() call (after normalization). */
  getResolvedUrl(): string | null { return this.resolvedUrl; }

  /** Request an immediate full registry snapshot from the gateway (e.g. on mobile resume). */
  requestRegistrySnapshot(): void {
    this.send({ type: 'request_registry_snapshot' });
  }

  // ==========================================================================
  // Internal — WebSocket Setup
  // ==========================================================================

  private setupWebSocket(ws: WebSocket): void {
    const currentWs = ws;
    ws.onopen = () => { console.log('[GatewayTransport] WebSocket opened'); if (this.ws !== currentWs) return; this.sendPeerHello(); };
    ws.onclose = (event) => { console.log(`[GatewayTransport] WebSocket closed: code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`);
      this.clearHealthProbe();
      const expectedClose = this.expectedCloseWs === currentWs;
      if (expectedClose) {
        this.expectedCloseWs = null;
      }
      if (this.ws !== null && this.ws !== currentWs) return;
      this.ws = null; this.authenticated = false;
      if (!expectedClose) {
        this.config.onDisconnected();
        this.subscribedBackends.clear();
        this.scheduleReconnect();
      } else {
        this.subscribedBackends.clear();
      }
    };
    ws.onerror = (error) => { console.error('[GatewayTransport] WebSocket error:', error); this.config.onError(error); };
    ws.onmessage = (event: MessageEvent) => {
      try { this.handleMessage(JSON.parse(event.data)); }
      catch (error) { console.error('[GatewayTransport] Failed to parse message:', error); }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalClose) return;
    const base = 1000;
    const max = 30_000;
    const delay = Math.min(base * Math.pow(2, this.reconnectAttempt), max);
    // Add jitter: ±25% to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    const finalDelay = Math.max(500, delay + jitter);
    this.reconnectAttempt++;
    console.log(`[GatewayTransport] Reconnecting in ${Math.round(finalDelay)}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose && !this.ws) {
        this.connect();
      }
    }, finalDelay);
  }

  private sendPeerHello(): void {
    const msg: PeerHelloMessage = {
      type: 'peer_hello', protocolVersion: 2, peerType: 'client-only', gatewaySecret: this.config.gatewaySecret,
      identity: { deviceId: this.config.deviceId, instanceId: this.config.instanceId },
    };
    this.ws?.send(JSON.stringify(msg));
  }

  // ==========================================================================
  // Internal — Message Router
  // ==========================================================================

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'peer_ready': this.handlePeerReady(message); break;
      case 'registry_snapshot': this.handleRegistrySnapshot(message); break;
      case 'backend_data_snapshot': this.handleBackendDataSnapshot(message); break;
      case 'backend_data_event': this.handleBackendDataEvent(message); break;
      case 'backend_subscribed': this.handleBackendSubscribed(message); break;
      case 'backend_unsubscribed': this.handleBackendUnsubscribed(message); break;
      case 'backend_server_message': this.handleBackendServerMessage(message); break;
      case 'run_stream_event': this.handleRunStreamEvent(message); break;
      case 'session_content_patch': this.handleContentPatch(message); break;
      case 'session_content_patch_error': this.handleContentPatchError(message); break;
      case 'pong': this.handlePong(message); break;
      case 'gateway_error': this.handleGatewayError(message); break;
      default: console.warn('[GatewayTransport] Unknown message type:', message.type);
    }
  }

  // --- Handshake ---
  private handlePeerReady(msg: PeerReadyMessage): void {
    this.reconnectAttempt = 0;
    this.authenticated = true; this.peerSessionId = msg.peerSessionId; this.recoveryToken = msg.recoveryToken;
    this.applyRegistrySync(msg.registrySync);
    this.config.onConnected(msg.peerSessionId, msg.recoveryToken);
  }

  // --- Registry ---
  private applyRegistrySync(sync: RegistrySyncPayload): void {
    this.applyRegistryItems(sync.items);
  }

  private handleRegistrySnapshot(msg: RegistrySnapshotMessage): void {
    this.applyRegistryItems(msg.items);
  }

  private applyRegistryItems(items: BackendPresence[]): void {
    // Detect removed backends and clean up related state
    const newIds = new Set(items.map(i => i.backendId));
    for (const [backendId] of this.registryItems) {
      if (!newIds.has(backendId)) {
        this.subscribedBackends.delete(backendId);
        useSessionsStore.getState().clearBackendSessions(backendId);
        useProjectStore.getState().replaceProjectsForBackend(backendId, []);
        useOwnershipStore.getState().removeProjectOwnersByBackend(backendId);
      }
    }
    this.registryItems.clear();
    for (const item of items) this.registryItems.set(item.backendId, item);
    this.config.onRegistryChanged(Array.from(this.registryItems.values()));
  }

  // --- Backend Data ---
  private handleBackendDataSnapshot(msg: BackendDataSnapshotMessage & { backendId?: string }): void {
    const backendId = msg.backendId;
    if (!backendId) {
      console.warn('[GatewayTransport] Received backend_data_snapshot without backendId, ignoring');
      return;
    }
    this.config.onBackendDataSnapshot(backendId, msg.sessions, msg.projects);
  }

  private handleBackendDataEvent(msg: BackendDataEventMessage & { backendId?: string }): void {
    const backendId = msg.backendId;
    if (!backendId) {
      console.warn('[GatewayTransport] Received backend_data_event without backendId, ignoring');
      return;
    }
    this.config.onBackendDataEvent(backendId, msg);
  }

  // --- Backend Subscription ---
  private handleBackendSubscribed(msg: BackendSubscribedMessage): void {
    this.subscribedBackends.add(msg.backendId);
    this.config.onBackendSubscribed(msg.backendId, msg.epoch, msg.capabilities);
  }

  private handleBackendUnsubscribed(msg: BackendUnsubscribedMessage): void {
    this.subscribedBackends.delete(msg.backendId);
    this.config.onBackendUnsubscribed(msg.backendId, msg.reason);
  }

  private handleBackendServerMessage(msg: BackendServerMessage): void {
    if (!this.subscribedBackends.has(msg.backendId)) return;
    this.config.onBackendServerMessage(msg.backendId, msg.message);
  }

  // --- Stream ---
  private handleRunStreamEvent(msg: RunStreamEvent): void {
    if (!this.subscribedBackends.has(msg.backendId)) return;
    this.config.onRunStreamEvent(msg.backendId, msg.sessionId, msg);
  }

  // --- Content ---
  private handleContentPatch(msg: SessionContentPatchMessage): void {
    if (!this.subscribedBackends.has(msg.backendId)) return;
    this.config.onContentPatch(msg.backendId, msg.sessionId, msg.messages, msg.latestOffset);
  }
  private handleContentPatchError(msg: SessionContentPatchErrorMessage): void {
    if (!this.subscribedBackends.has(msg.backendId)) return;
    this.config.onContentPatchError(msg.backendId, msg.sessionId, msg.afterOffset, msg.message);
  }

  // --- Pong ---
  private handlePong(_msg: { ts: number }): void {
    this.clearHealthProbe();
  }

  // --- Error ---
  private handleGatewayError(msg: GatewayErrorMessage): void {
    console.error(`[GatewayTransport] Error: ${msg.code} — ${msg.message}`);
    if (msg.recovery) {
      switch (msg.recovery) {
        case 'resubscribe': {
          const staleBackends = [...this.subscribedBackends];
          this.subscribedBackends.clear();
          for (const backendId of staleBackends) {
            this.subscribe(backendId);
          }
          break;
        }
        case 'reconnect': this.ws?.close(); break;
      }
      // Recovery action was taken — don't escalate to a connection-level error.
      // Only log it for diagnostics.
      return;
    }
    this.config.onError(`${msg.code}: ${msg.message}`);
  }

  // --- Helpers ---
  private send(msg: unknown): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
  private cleanup(): void { this.authenticated = false; this.peerSessionId = null; this.recoveryToken = null; this.subscribedBackends.clear(); this.clearHealthProbe(); }
}
