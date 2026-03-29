/**
 * Gateway WebSocket Transport (Client-Only Peer)
 *
 * Implements the gateway sync protocol for desktop/mobile client.
 * Features:
 * - Epoch-bound routing
 * - Revision-based registry/catalog sync with gap detection
 * - Channel abstraction for backend interaction
 * - Session stream lifecycle
 * - Content catch-up for disconnect recovery
 */

import type {
  ClientMessage,
  ServerMessage,
  BackendPresence,
  RegistrySyncPayload,
  RegistryEvent,
  RegistrySnapshotMessage,
  RegistryDeltaMessage,
  RegistryEventMessage,
  ResyncRegistryMessage,
  PeerHelloMessage,
  PeerReadyMessage,
  SubscribeBackendCatalogMessage,
  UnsubscribeBackendCatalogMessage,
  BackendCatalogSnapshotMessage,
  BackendCatalogDeltaMessage,
  BackendCatalogEventMessage,
  BackendCatalogResetMessage,
  OpenBackendChannelMessage,
  BackendChannelOpenedMessage,
  BackendChannelRejectedMessage,
  CloseBackendChannelMessage,
  BackendChannelClosedMessage,
  ChannelClientMessage,
  ChannelServerMessage,
  OpenSessionStreamMessage,
  CloseSessionStreamMessage,
  SessionStreamClosedMessage,
  RunStreamEvent,
  CatchUpSessionContentMessage,
  SessionContentPatchMessage,
  SessionContentPatchErrorMessage,
  SessionCatalogItem,
  SessionMessage,
  GatewayErrorMessage,
} from '@my-claudia/shared';
import { useSessionsStore } from '../../stores/sessionsStore';

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
  onCatalogSnapshot: (backendId: string, epoch: number, items: SessionCatalogItem[]) => void;
  onCatalogEvent: (backendId: string, epoch: number, op: 'upsert' | 'remove', item?: SessionCatalogItem, sessionId?: string) => void;
  onCatalogReset: (backendId: string, epoch: number) => void;
  onChannelOpened: (backendId: string, channelId: string, epoch: number, capabilities: string[]) => void;
  onChannelRejected: (backendId: string, reason: string) => void;
  onChannelClosed: (channelId: string, backendId: string, reason: string) => void;
  onChannelMessage: (backendId: string, message: ServerMessage) => void;
  onRunStreamEvent: (channelId: string, sessionId: string, event: RunStreamEvent) => void;
  onSessionStreamClosed: (channelId: string, sessionId: string, reason: string) => void;
  onContentPatch: (channelId: string, sessionId: string, messages: SessionMessage[], latestOffset: number) => void;
  onContentPatchError: (channelId: string, sessionId: string, afterOffset: number, error: string) => void;
}

// ============================================================================
// Transport
// ============================================================================

export class GatewayTransport {
  private ws: WebSocket | null = null;
  private config: GatewayTransportConfig;
  private expectedCloseWs: WebSocket | null = null;

  private peerSessionId: string | null = null;
  private recoveryToken: string | null = null;
  private authenticated = false;

  private registryRevision: number = 0;
  private registryItems = new Map<string, BackendPresence>();

  private resolvedUrl: string | null = null;
  private catalogRevisions = new Map<string, number>();
  private catalogEpochs = new Map<string, number>();

  channels = new Map<string, { backendId: string; epoch: number }>();
  private backendToChannel = new Map<string, string>();

  constructor(config: GatewayTransportConfig) {
    this.config = config;
  }

  connect(): void {
    if (this.ws) {
      this.expectedCloseWs = this.ws;
      this.ws.close();
    }
    this.authenticated = false;
    this.channels.clear();
    this.backendToChannel.clear();
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

  // --- Catalog ---
  subscribeCatalog(backendId: string, epoch: number, lastRevision?: number): void {
    this.send({ type: 'subscribe_backend_catalog', backendId, expectedEpoch: epoch, lastRevision } satisfies SubscribeBackendCatalogMessage);
  }

  unsubscribeCatalog(backendId: string, epoch: number): void {
    this.send({ type: 'unsubscribe_backend_catalog', backendId, expectedEpoch: epoch } satisfies UnsubscribeBackendCatalogMessage);
  }

  // --- Channel ---
  openChannel(backendId: string, epoch: number): void {
    if (this.backendToChannel.has(backendId)) return;
    this.send({ type: 'open_backend_channel', backendId, expectedEpoch: epoch } satisfies OpenBackendChannelMessage);
  }

  closeChannel(channelId: string): void {
    this.send({ type: 'close_backend_channel', channelId } satisfies CloseBackendChannelMessage);
  }

  sendToBackend(backendId: string, message: ClientMessage): void {
    const channelId = this.backendToChannel.get(backendId);
    if (!channelId) {
      console.error('[GatewayTransport] Cannot send: channel not open for backend', backendId);
      return;
    }
    this.send({ type: 'channel_client_message', channelId, message } satisfies ChannelClientMessage);
  }

  getChannelId(backendId: string): string | undefined {
    return this.backendToChannel.get(backendId);
  }

  isBackendAuthenticated(backendId: string): boolean {
    return this.backendToChannel.has(backendId);
  }

  // --- Stream ---
  openSessionStream(channelId: string, sessionId: string): void {
    this.send({ type: 'open_session_stream', channelId, sessionId } satisfies OpenSessionStreamMessage);
  }

  closeSessionStream(channelId: string, sessionId: string): void {
    this.send({ type: 'close_session_stream', channelId, sessionId } satisfies CloseSessionStreamMessage);
  }

  // --- Content ---
  catchUpContent(channelId: string, sessionId: string, afterOffset: number): void {
    this.send({ type: 'catch_up_session_content', channelId, sessionId, afterOffset } satisfies CatchUpSessionContentMessage);
  }

  // --- Accessors ---
  getRegistryRevision(): number { return this.registryRevision; }
  getRegistryItems(): Map<string, BackendPresence> { return this.registryItems; }
  getPeerSessionId(): string | null { return this.peerSessionId; }
  getRecoveryToken(): string | null { return this.recoveryToken; }
  /** The actual WebSocket URL used in the last connect() call (after normalization). */
  getResolvedUrl(): string | null { return this.resolvedUrl; }

  // ==========================================================================
  // Internal — WebSocket Setup
  // ==========================================================================

  private setupWebSocket(ws: WebSocket): void {
    const currentWs = ws;
    ws.onopen = () => { console.log('[GatewayTransport] WebSocket opened'); if (this.ws !== currentWs) return; this.sendPeerHello(); };
    ws.onclose = (event) => { console.log(`[GatewayTransport] WebSocket closed: code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`);
      const expectedClose = this.expectedCloseWs === currentWs;
      if (expectedClose) {
        this.expectedCloseWs = null;
      }
      if (this.ws !== null && this.ws !== currentWs) return;
      this.ws = null; this.authenticated = false; this.channels.clear(); this.backendToChannel.clear();
      if (!expectedClose) {
        this.config.onDisconnected();
      }
    };
    ws.onerror = (error) => { console.error('[GatewayTransport] WebSocket error:', error); this.config.onError(error); };
    ws.onmessage = (event: MessageEvent) => {
      try { this.handleMessage(JSON.parse(event.data)); }
      catch (error) { console.error('[GatewayTransport] Failed to parse message:', error); }
    };
  }

  private sendPeerHello(): void {
    const msg: PeerHelloMessage = {
      type: 'peer_hello', protocolVersion: 2, peerType: 'client-only', gatewaySecret: this.config.gatewaySecret,
      identity: { deviceId: this.config.deviceId, instanceId: this.config.instanceId },
      lastRegistryRevision: this.registryRevision > 0 ? this.registryRevision : undefined,
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
      case 'registry_delta': this.handleRegistryDelta(message); break;
      case 'registry_event': this.handleRegistryEvent(message); break;
      case 'backend_catalog_snapshot': this.handleCatalogSnapshot(message); break;
      case 'backend_catalog_delta': this.handleCatalogDelta(message); break;
      case 'backend_catalog_event': this.handleCatalogEvent(message); break;
      case 'backend_catalog_reset': this.handleCatalogReset(message); break;
      case 'backend_channel_opened': this.handleChannelOpened(message); break;
      case 'backend_channel_rejected': this.handleChannelRejected(message); break;
      case 'backend_channel_closed': this.handleChannelClosed(message); break;
      case 'channel_server_message': this.handleChannelMessage(message); break;
      case 'run_stream_event': this.handleRunStreamEvent(message); break;
      case 'session_stream_closed': this.handleSessionStreamClosed(message); break;
      case 'session_content_patch': this.handleContentPatch(message); break;
      case 'session_content_patch_error': this.handleContentPatchError(message); break;
      case 'gateway_error': this.handleGatewayError(message); break;
      default: console.warn('[GatewayTransport] Unknown message type:', message.type);
    }
  }

  // --- Handshake ---
  private handlePeerReady(msg: PeerReadyMessage): void {
    this.authenticated = true; this.peerSessionId = msg.peerSessionId; this.recoveryToken = msg.recoveryToken;
    this.applyRegistrySync(msg.registrySync);
    this.config.onConnected(msg.peerSessionId, msg.recoveryToken);
  }

  // --- Registry ---
  private applyRegistrySync(sync: RegistrySyncPayload): void {
    if (sync.mode === 'snapshot') {
      this.registryItems.clear();
      for (const item of sync.items) this.registryItems.set(item.backendId, item);
      this.registryRevision = sync.revision;
    } else {
      for (const event of sync.events) this.applyRegistryEventItem(event);
      this.registryRevision = sync.toRevision;
    }
    this.notifyRegistryChanged();
  }

  private handleRegistrySnapshot(msg: RegistrySnapshotMessage): void {
    this.registryItems.clear();
    for (const item of msg.items) this.registryItems.set(item.backendId, item);
    this.registryRevision = msg.revision;
    this.notifyRegistryChanged();
  }

  private handleRegistryDelta(msg: RegistryDeltaMessage): void {
    for (const event of msg.events) this.applyRegistryEventItem(event);
    this.registryRevision = msg.toRevision;
    this.notifyRegistryChanged();
  }

  private handleRegistryEvent(msg: RegistryEventMessage): void {
    if (msg.event.revision !== this.registryRevision + 1) {
      console.warn(`[GatewayTransport] Registry gap: expected ${this.registryRevision + 1}, got ${msg.event.revision}`);
      this.send({ type: 'resync_registry', lastRevision: this.registryRevision } satisfies ResyncRegistryMessage);
      return;
    }
    this.applyRegistryEventItem(msg.event);
    this.registryRevision = msg.event.revision;
    this.notifyRegistryChanged();
  }

  private applyRegistryEventItem(event: RegistryEvent): void {
    if (event.op === 'upsert') { this.registryItems.set(event.item.backendId, event.item); }
    else {
      this.registryItems.delete(event.backendId);
      this.catalogRevisions.delete(event.backendId);
      this.catalogEpochs.delete(event.backendId);
      const channelId = this.backendToChannel.get(event.backendId);
      if (channelId) { this.channels.delete(channelId); this.backendToChannel.delete(event.backendId); }
      useSessionsStore.getState().clearBackendSessions(event.backendId);
    }
  }

  private notifyRegistryChanged(): void { this.config.onRegistryChanged(Array.from(this.registryItems.values())); }

  // --- Catalog ---
  private handleCatalogSnapshot(msg: BackendCatalogSnapshotMessage): void {
    this.catalogRevisions.set(msg.backendId, msg.revision);
    this.catalogEpochs.set(msg.backendId, msg.epoch);
    this.config.onCatalogSnapshot(msg.backendId, msg.epoch, msg.items);
  }

  private handleCatalogDelta(msg: BackendCatalogDeltaMessage): void {
    this.catalogRevisions.set(msg.backendId, msg.toRevision);
    for (const event of msg.events) {
      if (event.op === 'upsert') this.config.onCatalogEvent(msg.backendId, msg.epoch, 'upsert', event.item, undefined);
      else this.config.onCatalogEvent(msg.backendId, msg.epoch, 'remove', undefined, event.sessionId);
    }
  }

  private handleCatalogEvent(msg: BackendCatalogEventMessage): void {
    const currentRevision = this.catalogRevisions.get(msg.backendId) ?? 0;
    if (msg.revision !== currentRevision + 1) {
      console.warn(`[GatewayTransport] Catalog gap for ${msg.backendId}: expected ${currentRevision + 1}, got ${msg.revision}`);
      this.subscribeCatalog(msg.backendId, msg.epoch);
      return;
    }
    this.catalogRevisions.set(msg.backendId, msg.revision);
    if (msg.op === 'upsert') this.config.onCatalogEvent(msg.backendId, msg.epoch, 'upsert', msg.item, undefined);
    else this.config.onCatalogEvent(msg.backendId, msg.epoch, 'remove', undefined, msg.sessionId);
  }

  private handleCatalogReset(msg: BackendCatalogResetMessage): void {
    this.catalogRevisions.delete(msg.backendId);
    this.catalogEpochs.delete(msg.backendId);
    this.config.onCatalogReset(msg.backendId, msg.epoch);
  }

  // --- Channel ---
  private handleChannelOpened(msg: BackendChannelOpenedMessage): void {
    this.channels.set(msg.channelId, { backendId: msg.backendId, epoch: msg.epoch });
    this.backendToChannel.set(msg.backendId, msg.channelId);
    this.config.onChannelOpened(msg.backendId, msg.channelId, msg.epoch, msg.capabilities);
  }
  private handleChannelRejected(msg: BackendChannelRejectedMessage): void { this.config.onChannelRejected(msg.backendId, msg.reason); }
  private handleChannelClosed(msg: BackendChannelClosedMessage): void {
    const channel = this.channels.get(msg.channelId);
    if (channel) this.backendToChannel.delete(channel.backendId);
    this.channels.delete(msg.channelId);
    this.config.onChannelClosed(msg.channelId, msg.backendId, msg.reason);
  }
  private handleChannelMessage(msg: ChannelServerMessage): void {
    const channel = this.channels.get(msg.channelId);
    if (!channel) return;
    this.config.onChannelMessage(channel.backendId, msg.message);
  }

  // --- Stream ---
  private handleRunStreamEvent(msg: RunStreamEvent): void { this.config.onRunStreamEvent(msg.channelId, msg.sessionId, msg); }
  private handleSessionStreamClosed(msg: SessionStreamClosedMessage): void { this.config.onSessionStreamClosed(msg.channelId, msg.sessionId, msg.reason); }

  // --- Content ---
  private handleContentPatch(msg: SessionContentPatchMessage): void { this.config.onContentPatch(msg.channelId, msg.sessionId, msg.messages, msg.latestOffset); }
  private handleContentPatchError(msg: SessionContentPatchErrorMessage): void {
    this.config.onContentPatchError(msg.channelId, msg.sessionId, msg.afterOffset, msg.message);
  }

  // --- Error ---
  private handleGatewayError(msg: GatewayErrorMessage): void {
    console.error(`[GatewayTransport] Error: ${msg.code} — ${msg.message}`);
    if (msg.recovery) {
      switch (msg.recovery) {
        case 'resync_registry': this.send({ type: 'resync_registry', lastRevision: this.registryRevision } satisfies ResyncRegistryMessage); break;
        case 'resync_catalog': for (const [backendId, epoch] of this.catalogEpochs) this.subscribeCatalog(backendId, epoch); break;
        case 'reopen_channel':
          for (const [backendId, presence] of this.registryItems) {
            if (this.backendToChannel.has(backendId)) { this.backendToChannel.delete(backendId); this.openChannel(backendId, presence.epoch); }
          }
          break;
        case 'reconnect': this.ws?.close(); break;
      }
    }
    this.config.onError(`${msg.code}: ${msg.message}`);
  }

  // --- Helpers ---
  private send(msg: unknown): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
  private cleanup(): void { this.authenticated = false; this.peerSessionId = null; this.recoveryToken = null; this.channels.clear(); this.backendToChannel.clear(); }
}
