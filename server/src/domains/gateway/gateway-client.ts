/**
 * Gateway Client — Backend Peer
 *
 * Connects to a gateway as a client+backend peer.
 * Implements handshake, heartbeat, catalog, stream demand, and stream event protocols.
 */

import WebSocket from 'ws';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type {
  PeerHelloMessage,
  PeerReadyMessage,
  RegistrySyncPayload,
  BackendPresence,
  RegistryEvent,
  RegistrySnapshotMessage,
  RegistryDeltaMessage,
  RegistryEventMessage,
  ResyncRegistryMessage,
  BackendHeartbeatMessage,
  HeartbeatAckMessage,
  StreamDemandMessage,
  CatalogSnapshotMessage,
  CatalogEventMessage,
  SessionCatalogItem,
  BackendRunStreamEvent,
  RunStreamEventType,
  SessionMessage,
  SessionContentPatchMessage,
  GatewayBackendInfo,
  ChannelClientMessage,
  ChannelServerMessage,
  GatewayHttpProxyRequest,
  GatewayHttpProxyResponse,
  GatewayHttpProxyResponseStart,
  GatewayHttpProxyResponseChunk,
  GatewayHttpProxyResponseEnd,
  RegistryRevision,
  CatalogRevision,
  ClientMessage,
  ServerMessage,
  OpenBackendChannelMessage,
  CloseBackendChannelMessage,
  BackendChannelOpenedMessage,
  BackendChannelRejectedMessage,
  BackendChannelClosedMessage,
  SubscribeBackendCatalogMessage,
  UnsubscribeBackendCatalogMessage,
  BackendCatalogSnapshotMessage,
  BackendCatalogEventMessage,
  BackendCatalogResetMessage,
  OpenSessionStreamMessage,
  CloseSessionStreamMessage,
  SessionStreamClosedMessage,
  RunStreamEvent,
  CatchUpSessionContentMessage,
} from '@my-claudia/shared';
import { hasForegroundActiveRunForSession } from '../../utils/run-state.js';

// ============================================================================
// Config & Device ID
// ============================================================================

const CONFIG_DIR = process.env.MY_CLAUDIA_DATA_DIR
  ? path.resolve(process.env.MY_CLAUDIA_DATA_DIR)
  : path.join(os.homedir(), '.my-claudia');
const DEVICE_CONFIG_PATH = path.join(CONFIG_DIR, 'device.json');

interface DeviceConfig {
  deviceId: string;
  createdAt: number;
}

function getOrCreateDeviceId(): string {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (fs.existsSync(DEVICE_CONFIG_PATH)) {
    try {
      const config: DeviceConfig = JSON.parse(fs.readFileSync(DEVICE_CONFIG_PATH, 'utf-8'));
      return config.deviceId;
    } catch { /* fall through */ }
  }
  const deviceId = crypto.randomUUID();
  fs.writeFileSync(DEVICE_CONFIG_PATH, JSON.stringify({ deviceId, createdAt: Date.now() }, null, 2));
  console.log(`[Gateway] Generated new device ID: ${deviceId}`);
  return deviceId;
}

// ============================================================================
// Types
// ============================================================================

export interface GatewayClientConfig {
  gatewayUrl: string;
  gatewaySecret: string;
  name?: string;
  channel?: string;
  serverPort?: number;
  visible?: boolean;
  capabilities?: string[];
  proxyUrl?: string;
  proxyAuth?: { username: string; password: string };
}

import type { Database as BetterDatabase } from 'better-sqlite3';
type Database = BetterDatabase;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ActiveRun is defined in ws/types and varies across callers
type ActiveRunsMap = Map<string, any>;
type ChannelMessageHandler = (channelId: string, message: ClientMessage) => Promise<void> | void;
type ChannelClosedHandler = (channelId: string) => void;

// ============================================================================
// Outgoing Channel Types (facade client role)
// ============================================================================

export interface OutgoingChannel {
  backendId: string;
  channelId: string;
  epoch: number;
  capabilities: string[];
}

/** Event callbacks for outgoing (facade client) operations. */
export interface GatewayClientOutgoingEvents {
  onOutgoingChannelOpened?: (backendId: string, channelId: string, epoch: number, capabilities: string[]) => void;
  onOutgoingChannelClosed?: (backendId: string, channelId: string, reason: string) => void;
  onOutgoingChannelRejected?: (backendId: string, reason: string) => void;
  onOutgoingCatalogSnapshot?: (backendId: string, epoch: number, revision: number, items: SessionCatalogItem[]) => void;
  onOutgoingCatalogEvent?: (backendId: string, epoch: number, revision: number, op: 'upsert' | 'remove', item?: SessionCatalogItem, sessionId?: string) => void;
  onOutgoingCatalogReset?: (backendId: string, epoch: number) => void;
  onOutgoingSessionStreamClosed?: (backendId: string, channelId: string, sessionId: string, reason: string) => void;
  onOutgoingRunEvent?: (backendId: string, channelId: string, sessionId: string, event: ServerMessage) => void;
  onOutgoingContentPatch?: (backendId: string, channelId: string, sessionId: string, messages: SessionMessage[], latestOffset: number) => void;
  onRegistrySnapshotChanged?: (revision: number, items: BackendPresence[]) => void;
  onRegistryEventChanged?: (revision: number, op: 'upsert' | 'remove', item?: BackendPresence, backendId?: string) => void;
  onConnectionStateChanged?: (connected: boolean) => void;
}

// ============================================================================
// CQE Interfaces
// ============================================================================

export interface GatewayClientCommands {
  connection: {
    connect(): void;
    disconnect(): void;
  };
  channel: {
    /** Send a message through an incoming channel (backend-peer role). */
    sendToIncoming(channelId: string, message: ServerMessage): void;
    /** Register handler for incoming channel messages. */
    onIncomingMessage(handler: ChannelMessageHandler): void;
    /** Register handler for incoming channel closures. */
    onIncomingClosed(handler: ChannelClosedHandler): void;
    /** Register handler for content catch-up requests. */
    onCatchUp(handler: (sessionId: string, afterOffset: number) => Promise<SessionMessage[]>): void;
    /** Open an outgoing channel to another backend (facade client role). */
    openOutgoing(targetBackendId: string, epoch: number): void;
    /** Close an outgoing channel. */
    closeOutgoing(channelId: string): void;
    /** Send a message through an outgoing channel. */
    sendToOutgoing(channelId: string, message: ClientMessage): void;
  };
  catalog: {
    /** Publish a full catalog snapshot (backend-peer role). */
    publishSnapshot(): void;
    /** Publish a catalog event (backend-peer role). */
    publishEvent(eventType: 'upsert' | 'remove', session: { id: string; name?: string; createdAt?: number; created_at?: number; updatedAt?: number; updated_at?: number }): void;
    /** Compatibility alias for publishEvent. */
    broadcastSessionEvent(eventType: 'created' | 'updated' | 'deleted', session: { id: string; name?: string; createdAt?: number; created_at?: number; updatedAt?: number; updated_at?: number }): void;
    /** Subscribe to a remote backend's catalog (facade client role). */
    subscribeOutgoing(targetBackendId: string, epoch: number, lastRevision?: number): void;
    /** Unsubscribe from a remote backend's catalog. */
    unsubscribeOutgoing(targetBackendId: string, epoch: number): void;
  };
  stream: {
    /** Emit a run stream event (backend-peer role). */
    emitRunEvent(sessionId: string, runId: string, eventType: RunStreamEventType, seq: number, payload: unknown): void;
    /** Open an outgoing session stream (facade client role). */
    openOutgoing(channelId: string, sessionId: string): void;
    /** Close an outgoing session stream. */
    closeOutgoing(channelId: string, sessionId: string): void;
    /** Request content catch-up on an outgoing stream. */
    catchUpOutgoing(channelId: string, sessionId: string, afterOffset: number): void;
  };
}

export interface GatewayClientQueries {
  identity: {
    getInstanceId(): string;
    getDeviceId(): string;
    getBackendId(): string | null;
    getEpoch(): number | null;
  };
  connection: {
    isConnected(): boolean;
    getStreamDemandActive(): boolean;
    getGatewayUrl(): string;
    getGatewaySecret(): string;
    createHttpAgent(): SocksProxyAgent | undefined;
  };
  registry: {
    getItems(): Map<string, BackendPresence>;
    getRevision(): RegistryRevision;
    getDiscoveredBackends(): GatewayBackendInfo[];
  };
  channel: {
    getOutgoing(backendId: string): OutgoingChannel | undefined;
    getAllOutgoing(): Map<string, OutgoingChannel>;
  };
}

export interface GatewayClientEventBus {
  setOutgoingEvents(events: GatewayClientOutgoingEvents): void;
}

// ============================================================================
// GatewayClient
// ============================================================================

export class GatewayClient {
  private ws: WebSocket | null = null;
  private config: GatewayClientConfig;
  private deviceId: string;
  private instanceId: string;
  private channel: string;

  private peerSessionId: string | null = null;
  private recoveryToken: string | null = null;
  private backendId: string | null = null;
  private epoch: number | null = null;
  private isConnected = false;
  private intentionalDisconnect = false;

  private reconnectAttempts = 0;
  private reconnectBaseInterval = 5000;
  private reconnectMaxInterval = 60000;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = 10_000;

  private streamDemandActive = false;

  private registryRevision: RegistryRevision = 0;
  private registryItems = new Map<string, BackendPresence>();

  private catalogRevision: CatalogRevision = 0;

  private db: Database | null = null;
  private activeRuns: ActiveRunsMap | null = null;

  private onCatchUpHandler: ((sessionId: string, afterOffset: number) => Promise<SessionMessage[]>) | null = null;
  private onChannelMessageHandler: ChannelMessageHandler | null = null;
  private onChannelClosedHandler: ChannelClosedHandler | null = null;

  // Outgoing channels (facade client role)
  private outgoingChannels = new Map<string, OutgoingChannel>();
  private outgoingEvents: GatewayClientOutgoingEvents = {};

  // Message queue for channel messages during disconnection
  private static readonly MAX_PENDING_MESSAGES = 200;
  private pendingMessages: string[] = [];

  // ==========================================================================
  // CQE Interface
  // ==========================================================================

  readonly commands: GatewayClientCommands;
  readonly queries: GatewayClientQueries;
  readonly events: GatewayClientEventBus;

  constructor(config: GatewayClientConfig, db?: Database, activeRuns?: ActiveRunsMap) {
    this.config = config;
    this.deviceId = getOrCreateDeviceId();
    this.channel = config.channel || 'prod';
    this.instanceId = crypto.createHash('sha256')
      .update(this.deviceId + ':' + this.channel)
      .digest('hex')
      .slice(0, 16);
    this.db = db || null;
    this.activeRuns = activeRuns || null;
    console.log(`[Gateway] Instance ID: ${this.instanceId} (channel=${this.channel})`);

    // Wire CQE properties
    this.commands = {
      connection: {
        connect: () => this.connect(),
        disconnect: () => this.disconnect(),
      },
      channel: {
        sendToIncoming: (channelId, message) => this.sendToChannel(channelId, message),
        onIncomingMessage: (handler) => this.onChannelMessage(handler),
        onIncomingClosed: (handler) => this.onChannelClosed(handler),
        onCatchUp: (handler) => this.onCatchUp(handler),
        openOutgoing: (bid, epoch) => this.openOutgoingChannel(bid, epoch),
        closeOutgoing: (cid) => this.closeOutgoingChannel(cid),
        sendToOutgoing: (cid, msg) => this.sendToOutgoingChannel(cid, msg),
      },
      catalog: {
        publishSnapshot: () => this.publishCatalogSnapshot(),
        publishEvent: (t, s) => this.publishCatalogEvent(t, s),
        broadcastSessionEvent: (t, s) => this.broadcastSessionEvent(t, s),
        subscribeOutgoing: (bid, epoch, rev?) => this.subscribeOutgoingCatalog(bid, epoch, rev),
        unsubscribeOutgoing: (bid, epoch) => this.unsubscribeOutgoingCatalog(bid, epoch),
      },
      stream: {
        emitRunEvent: (sid, rid, et, seq, p) => this.emitRunStreamEvent(sid, rid, et, seq, p),
        openOutgoing: (cid, sid) => this.openOutgoingStream(cid, sid),
        closeOutgoing: (cid, sid) => this.closeOutgoingStream(cid, sid),
        catchUpOutgoing: (cid, sid, off) => this.catchUpOutgoingStream(cid, sid, off),
      },
    };

    this.queries = {
      identity: {
        getInstanceId: () => this.getInstanceId(),
        getDeviceId: () => this.getDeviceId(),
        getBackendId: () => this.getBackendId(),
        getEpoch: () => this.getEpoch(),
      },
      connection: {
        isConnected: () => this.isGatewayConnected(),
        getStreamDemandActive: () => this.getStreamDemandActive(),
        getGatewayUrl: () => this.getGatewayUrl(),
        getGatewaySecret: () => this.getGatewaySecret(),
        createHttpAgent: () => this.createHttpAgent(),
      },
      registry: {
        getItems: () => this.getRegistryItems(),
        getRevision: () => this.getRegistryRevision(),
        getDiscoveredBackends: () => this.getDiscoveredBackends(),
      },
      channel: {
        getOutgoing: (bid) => this.getOutgoingChannel(bid),
        getAllOutgoing: () => this.getAllOutgoingChannels(),
      },
    };

    this.events = {
      setOutgoingEvents: (e) => this.setOutgoingEvents(e),
    };
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  connect(): void {
    this.intentionalDisconnect = false;
    if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
    if (this.ws) { this.ws.removeAllListeners(); this.ws.close(); this.ws = null; }

    const wsUrl = this.config.gatewayUrl.replace(/^http/, 'ws');
    console.log(`[Gateway] Connecting to ${wsUrl}...`);

    const wsOptions: { agent?: SocksProxyAgent } = {};
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
      } catch (error) {
        console.error('[Gateway] Failed to configure proxy:', error);
      }
    }

    this.ws = new WebSocket(`${wsUrl}/ws`, wsOptions);
    const currentWs = this.ws;

    this.ws.on('open', () => { if (this.ws !== currentWs) return; this.sendPeerHello(); });
    this.ws.on('message', (data: Buffer) => {
      if (this.ws !== currentWs) return;
      try { this.handleMessage(JSON.parse(data.toString())); }
      catch (error) { console.error('[Gateway] Failed to parse message:', error); }
    });
    this.ws.on('close', (code: number) => {
      if (this.ws !== currentWs) return;
      console.log(`[Gateway] Disconnected (code: ${code})`);
      this.cleanup();
      if (code !== 4000) this.scheduleReconnect();
    });
    this.ws.on('error', (error) => { if (this.ws !== currentWs) return; console.error('[Gateway] Connection error:', error); });
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
    this.cleanup();
    if (this.ws) { this.ws.removeAllListeners(); this.ws.close(); this.ws = null; }
  }

  getBackendId(): string | null { return this.backendId; }
  getEpoch(): number | null { return this.epoch; }
  isGatewayConnected(): boolean { return this.isConnected; }
  getInstanceId(): string { return this.instanceId; }
  getDeviceId(): string { return this.deviceId; }
  getStreamDemandActive(): boolean { return this.streamDemandActive; }
  getGatewayUrl(): string { return this.config.gatewayUrl; }
  getGatewaySecret(): string { return this.config.gatewaySecret; }

  createHttpAgent(): SocksProxyAgent | undefined {
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
      console.error('[Gateway] Failed to configure HTTP proxy agent:', error);
      return undefined;
    }
  }

  getDiscoveredBackends(): GatewayBackendInfo[] {
    return Array.from(this.registryItems.values())
      .filter(entry => entry.visible)
      .map(entry => ({
        backendId: entry.backendId, name: entry.name, online: true,
        isThisInstance: entry.instanceId === this.instanceId,
        isThisDevice: entry.deviceId === this.deviceId,
        instanceId: entry.instanceId, deviceId: entry.deviceId, channel: entry.channel,
      }));
  }

  onCatchUp(handler: (sessionId: string, afterOffset: number) => Promise<SessionMessage[]>): void {
    this.onCatchUpHandler = handler;
  }

  onChannelMessage(handler: ChannelMessageHandler): void {
    this.onChannelMessageHandler = handler;
  }

  onChannelClosed(handler: ChannelClosedHandler): void {
    this.onChannelClosedHandler = handler;
  }

  sendToChannel(channelId: string, message: ServerMessage): void {
    this.sendWs({ type: 'channel_server_message', channelId, message } satisfies ChannelServerMessage, true);
  }

  // ==========================================================================
  // Outgoing Channel API (facade client role)
  // ==========================================================================

  setOutgoingEvents(events: GatewayClientOutgoingEvents): void {
    // Fix #14: merge with existing events instead of replacing, so multiple
    // consumers can register handlers without overwriting each other.
    this.outgoingEvents = { ...this.outgoingEvents, ...events };
  }

  getRegistryItems(): Map<string, BackendPresence> { return this.registryItems; }
  getRegistryRevision(): RegistryRevision { return this.registryRevision; }

  openOutgoingChannel(targetBackendId: string, epoch: number): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'open_backend_channel',
      backendId: targetBackendId,
      expectedEpoch: epoch,
    } satisfies OpenBackendChannelMessage);
  }

  closeOutgoingChannel(channelId: string): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'close_backend_channel',
      channelId,
    } satisfies CloseBackendChannelMessage);
    // Remove from local map — gateway will confirm with backend_channel_closed
    for (const [bid, ch] of this.outgoingChannels) {
      if (ch.channelId === channelId) {
        this.outgoingChannels.delete(bid);
        break;
      }
    }
  }

  sendToOutgoingChannel(channelId: string, message: ClientMessage): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'channel_client_message',
      channelId,
      message,
    } satisfies ChannelClientMessage);
  }

  subscribeOutgoingCatalog(targetBackendId: string, epoch: number, lastRevision?: number): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'subscribe_backend_catalog',
      backendId: targetBackendId,
      expectedEpoch: epoch,
      lastRevision,
    } satisfies SubscribeBackendCatalogMessage);
  }

  unsubscribeOutgoingCatalog(targetBackendId: string, epoch: number): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'unsubscribe_backend_catalog',
      backendId: targetBackendId,
      expectedEpoch: epoch,
    } satisfies UnsubscribeBackendCatalogMessage);
  }

  openOutgoingStream(channelId: string, sessionId: string): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'open_session_stream',
      channelId,
      sessionId,
    } satisfies OpenSessionStreamMessage);
  }

  closeOutgoingStream(channelId: string, sessionId: string): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'close_session_stream',
      channelId,
      sessionId,
    } satisfies CloseSessionStreamMessage);
  }

  catchUpOutgoingStream(channelId: string, sessionId: string, afterOffset: number): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'catch_up_session_content',
      channelId,
      sessionId,
      afterOffset,
    } satisfies CatchUpSessionContentMessage);
  }

  getOutgoingChannel(backendId: string): OutgoingChannel | undefined {
    return this.outgoingChannels.get(backendId);
  }

  getAllOutgoingChannels(): Map<string, OutgoingChannel> {
    return this.outgoingChannels;
  }

  // ==========================================================================
  // Catalog (backend-peer publishing)
  // ==========================================================================

  publishCatalogSnapshot(): void {
    if (!this.ws || !this.isConnected || !this.epoch) return;
    if (!this.db || !this.activeRuns) return;
    try {
      const sessions = this.db.prepare(`
        SELECT s.id, s.name, s.created_at as createdAt, s.updated_at as updatedAt,
               (SELECT MAX(offset) FROM messages WHERE session_id = s.id) as lastMessageOffset
        FROM sessions s ORDER BY s.updated_at DESC
      `).all() as Array<Record<string, unknown>>;
      const items: SessionCatalogItem[] = sessions.map((s) => ({
        sessionId: s.id as string, title: (s.name as string) || undefined, createdAt: s.createdAt as number, updatedAt: s.updatedAt as number,
        lastMessageAt: s.updatedAt as number,
        activeRunStatus: hasForegroundActiveRunForSession(this.activeRuns!, s.id as string) ? 'running' as const : 'idle' as const,
      }));
      this.catalogRevision++;
      const msg: CatalogSnapshotMessage = { type: 'catalog_snapshot', epoch: this.epoch, revision: this.catalogRevision, items };
      this.sendWs(msg);
      console.log(`[Gateway] Published catalog snapshot: ${items.length} sessions, revision=${this.catalogRevision}`);
    } catch (error) {
      console.error('[Gateway] Failed to publish catalog snapshot:', error);
    }
  }

  publishCatalogEvent(eventType: 'upsert' | 'remove', session: { id: string; name?: string; createdAt?: number; created_at?: number; updatedAt?: number; updated_at?: number }): void {
    if (!this.ws || !this.isConnected || !this.epoch) return;
    this.catalogRevision++;
    if (eventType === 'upsert') {
      const item: SessionCatalogItem = {
        sessionId: session.id, title: session.name || undefined,
        createdAt: session.createdAt ?? session.created_at ?? Date.now(),
        updatedAt: session.updatedAt ?? session.updated_at ?? Date.now(),
        lastMessageAt: session.updatedAt ?? session.updated_at ?? Date.now(),
        activeRunStatus: this.activeRuns && hasForegroundActiveRunForSession(this.activeRuns, session.id) ? 'running' : 'idle',
      };
      const msg: CatalogEventMessage = { type: 'catalog_event', epoch: this.epoch, revision: this.catalogRevision, op: 'upsert', item };
      this.sendWs(msg);
    } else {
      const msg: CatalogEventMessage = { type: 'catalog_event', epoch: this.epoch, revision: this.catalogRevision, op: 'remove', sessionId: session.id };
      this.sendWs(msg);
    }
  }

  // ==========================================================================
  // Stream Events
  // ==========================================================================

  /** Compatibility alias for publishCatalogEvent — used by sessions routes and run handler. */
  broadcastSessionEvent(eventType: 'created' | 'updated' | 'deleted', session: { id: string; name?: string; createdAt?: number; created_at?: number; updatedAt?: number; updated_at?: number }): void {
    this.publishCatalogEvent(eventType === 'deleted' ? 'remove' : 'upsert', session);
  }

  emitRunStreamEvent(sessionId: string, runId: string, eventType: RunStreamEventType, seq: number, payload: unknown): void {
    if (!this.ws || !this.isConnected || !this.streamDemandActive) return;
    const msg: BackendRunStreamEvent = { type: 'run_stream_event', eventType, sessionId, runId, seq, payload };
    this.sendWs(msg);
  }

  // ==========================================================================
  // Internal — Handshake
  // ==========================================================================

  private sendPeerHello(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: PeerHelloMessage = {
      type: 'peer_hello', protocolVersion: 2, peerType: 'client+backend',
      gatewaySecret: this.config.gatewaySecret,
      identity: { deviceId: this.deviceId, instanceId: this.instanceId, channel: this.channel, name: this.config.name },
      backend: { visible: this.config.visible !== false, capabilities: this.config.capabilities ?? [] },
      lastRegistryRevision: this.registryRevision > 0 ? this.registryRevision : undefined,
    };
    this.ws.send(JSON.stringify(msg));
  }

  // ==========================================================================
  // Internal — Message Router
  // ==========================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Message router dispatches to typed handlers via switch; each branch casts implicitly.
  private handleMessage(message: Record<string, unknown>): void {
    const msg = message as Record<string, unknown> & { type: string };
    switch (msg.type) {
      case 'peer_ready': this.handlePeerReady(msg as unknown as PeerReadyMessage); break;
      case 'registry_snapshot': this.handleRegistrySnapshot(msg as unknown as RegistrySnapshotMessage); break;
      case 'registry_delta': this.handleRegistryDelta(msg as unknown as RegistryDeltaMessage); break;
      case 'registry_event': this.handleRegistryEvent(msg as unknown as RegistryEventMessage); break;
      case 'heartbeat_ack': this.handleHeartbeatAck(msg as unknown as HeartbeatAckMessage); break;
      case 'stream_demand': this.handleStreamDemand(msg as unknown as StreamDemandMessage); break;
      // Incoming channels (backend-peer role)
      case 'channel_client_message': void this.handleChannelClientMessage(msg as unknown as ChannelClientMessage); break;
      case 'catch_up_session_content': this.handleCatchUpRequest(msg as unknown as CatchUpSessionContentMessage); break;
      case 'http_proxy_request': this.handleHttpProxyRequest(msg as unknown as GatewayHttpProxyRequest); break;
      // Channel open/close/reject — route by backendId (incoming vs outgoing)
      case 'backend_channel_opened': this.handleBackendChannelOpened(msg as unknown as BackendChannelOpenedMessage); break;
      case 'backend_channel_closed': this.handleBackendChannelClosedMsg(msg as unknown as BackendChannelClosedMessage); break;
      case 'backend_channel_rejected': this.handleBackendChannelRejected(msg as unknown as BackendChannelRejectedMessage); break;
      // Outgoing catalog (subscribed to remote backend)
      case 'backend_catalog_snapshot': this.handleOutgoingCatalogSnapshot(msg as unknown as BackendCatalogSnapshotMessage); break;
      case 'backend_catalog_event': this.handleOutgoingCatalogEvent(msg as unknown as BackendCatalogEventMessage); break;
      case 'backend_catalog_reset': this.handleOutgoingCatalogReset(msg as unknown as BackendCatalogResetMessage); break;
      // Outgoing stream events (from remote backend)
      case 'channel_server_message': this.handleOutgoingChannelServerMessage(msg as unknown as ChannelServerMessage); break;
      case 'session_stream_closed': this.handleOutgoingSessionStreamClosed(msg as unknown as SessionStreamClosedMessage); break;
      case 'run_stream_event': this.handleOutgoingRunStreamEvent(msg as unknown as RunStreamEvent); break;
      case 'session_content_patch': this.handleOutgoingContentPatch(msg as unknown as SessionContentPatchMessage); break;
      case 'gateway_error': console.error(`[Gateway] Error: ${msg.code} — ${msg.message}`); break;
    }
  }

  private handlePeerReady(msg: PeerReadyMessage): void {
    this.isConnected = true;
    this.peerSessionId = msg.peerSessionId;
    this.recoveryToken = msg.recoveryToken;
    this.reconnectAttempts = 0;
    if (msg.backend) {
      this.backendId = msg.backend.backendId;
      this.epoch = msg.backend.epoch;
      console.log(`[Gateway] Connected: peerSessionId=${this.peerSessionId} backendId=${this.backendId} epoch=${this.epoch}`);
    } else {
      console.log(`[Gateway] Connected: peerSessionId=${this.peerSessionId} (no backend)`);
    }
    this.applyRegistrySync(msg.registrySync);
    this.startHeartbeat();
    this.catalogRevision = 0;
    this.publishCatalogSnapshot();
    this.flushPendingMessages();
    this.outgoingEvents.onConnectionStateChanged?.(true);
  }

  // ==========================================================================
  // Internal — Heartbeat
  // ==========================================================================

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || !this.isConnected || !this.epoch) return;
      const msg: BackendHeartbeatMessage = { type: 'backend_heartbeat', epoch: this.epoch, observedAt: Date.now() };
      this.sendWs(msg);
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
  }

  private handleHeartbeatAck(msg: HeartbeatAckMessage): void {
    if (msg.epoch !== this.epoch) return;
    this.streamDemandActive = msg.streamDemand;
  }

  private handleStreamDemand(msg: StreamDemandMessage): void {
    const prev = this.streamDemandActive;
    this.streamDemandActive = msg.active;
    if (prev !== msg.active) console.log(`[Gateway] Stream demand: ${msg.active ? 'active' : 'inactive'}`);
  }

  // ==========================================================================
  // Internal — Registry
  // ==========================================================================

  private applyRegistrySync(sync: RegistrySyncPayload): void {
    if (sync.mode === 'snapshot') {
      this.registryItems.clear();
      for (const item of sync.items) this.registryItems.set(item.backendId, item);
      this.registryRevision = sync.revision;
      this.outgoingEvents.onRegistrySnapshotChanged?.(sync.revision, sync.items);
    } else {
      for (const event of sync.events) {
        this.applyRegistryEventItem(event);
        if (event.op === 'upsert') {
          this.outgoingEvents.onRegistryEventChanged?.(event.revision, 'upsert', event.item);
        } else {
          this.outgoingEvents.onRegistryEventChanged?.(event.revision, 'remove', undefined, event.backendId);
        }
      }
      this.registryRevision = sync.toRevision;
    }
  }

  private handleRegistrySnapshot(msg: RegistrySnapshotMessage): void {
    this.registryItems.clear();
    for (const item of msg.items) this.registryItems.set(item.backendId, item);
    this.registryRevision = msg.revision;
    this.outgoingEvents.onRegistrySnapshotChanged?.(msg.revision, msg.items);
  }

  private handleRegistryDelta(msg: RegistryDeltaMessage): void {
    for (const event of msg.events) {
      this.applyRegistryEventItem(event);
      if (event.op === 'upsert') {
        this.outgoingEvents.onRegistryEventChanged?.(event.revision, 'upsert', event.item);
      } else {
        this.outgoingEvents.onRegistryEventChanged?.(event.revision, 'remove', undefined, event.backendId);
      }
    }
    this.registryRevision = msg.toRevision;
  }

  private handleRegistryEvent(msg: RegistryEventMessage): void {
    const event = msg.event;
    if (event.revision !== this.registryRevision + 1) {
      console.warn(`[Gateway] Registry gap: expected ${this.registryRevision + 1}, got ${event.revision}. Requesting resync.`);
      this.sendWs({ type: 'resync_registry', lastRevision: this.registryRevision } satisfies ResyncRegistryMessage);
      return;
    }
    this.applyRegistryEventItem(event);
    this.registryRevision = event.revision;
    if (event.op === 'upsert') {
      this.outgoingEvents.onRegistryEventChanged?.(event.revision, 'upsert', event.item);
    } else {
      this.outgoingEvents.onRegistryEventChanged?.(event.revision, 'remove', undefined, event.backendId);
    }
  }

  private applyRegistryEventItem(event: RegistryEvent): void {
    if (event.op === 'upsert') this.registryItems.set(event.item.backendId, event.item);
    else this.registryItems.delete(event.backendId);
  }

  // ==========================================================================
  // Internal — Content Catch-Up
  // ==========================================================================

  private async handleCatchUpRequest(msg: CatchUpSessionContentMessage): Promise<void> {
    if (!this.onCatchUpHandler) return;
    try {
      const messages = await this.onCatchUpHandler(msg.sessionId, msg.afterOffset);
      const maxOffset = messages.length > 0 ? Math.max(...messages.map(m => m.offset)) : msg.afterOffset;
      const patch: SessionContentPatchMessage = { type: 'session_content_patch', channelId: msg.channelId, sessionId: msg.sessionId, messages, latestOffset: maxOffset };
      this.sendWs(patch);
    } catch (error) {
      console.error('[Gateway] Catch-up error:', error);
    }
  }

  private async handleChannelClientMessage(msg: ChannelClientMessage): Promise<void> {
    if (!this.onChannelMessageHandler) return;
    try {
      await this.onChannelMessageHandler(msg.channelId, msg.message);
    } catch (error) {
      console.error('[Gateway] Channel message handler error:', error);
    }
  }

  private handleIncomingChannelClosed(channelId: string): void {
    this.onChannelClosedHandler?.(channelId);
  }

  // ==========================================================================
  // Internal — Outgoing Channel Routing
  // ==========================================================================

  private isOutgoingChannel(backendId: string): boolean {
    return backendId !== this.backendId;
  }

  private handleBackendChannelOpened(msg: BackendChannelOpenedMessage): void {
    if (this.isOutgoingChannel(msg.backendId)) {
      // Outgoing: we opened a channel to another backend
      this.outgoingChannels.set(msg.backendId, {
        backendId: msg.backendId,
        channelId: msg.channelId,
        epoch: msg.epoch,
        capabilities: msg.capabilities,
      });
      this.outgoingEvents.onOutgoingChannelOpened?.(msg.backendId, msg.channelId, msg.epoch, msg.capabilities);
    }
    // Incoming channel_opened events for our own backendId are not sent by gateway
    // (gateway sends channel_client_message directly)
  }

  private handleBackendChannelClosedMsg(msg: BackendChannelClosedMessage): void {
    if (this.isOutgoingChannel(msg.backendId)) {
      this.outgoingChannels.delete(msg.backendId);
      this.outgoingEvents.onOutgoingChannelClosed?.(msg.backendId, msg.channelId, msg.reason);
    } else {
      // Incoming channel closed
      this.handleIncomingChannelClosed(msg.channelId);
    }
  }

  private handleBackendChannelRejected(msg: BackendChannelRejectedMessage): void {
    this.outgoingEvents.onOutgoingChannelRejected?.(msg.backendId, msg.reason);
  }

  private handleOutgoingCatalogSnapshot(msg: BackendCatalogSnapshotMessage): void {
    this.outgoingEvents.onOutgoingCatalogSnapshot?.(msg.backendId, msg.epoch, msg.revision, msg.items);
  }

  private handleOutgoingCatalogEvent(msg: BackendCatalogEventMessage): void {
    if (msg.op === 'upsert') {
      this.outgoingEvents.onOutgoingCatalogEvent?.(msg.backendId, msg.epoch, msg.revision, 'upsert', msg.item);
    } else {
      this.outgoingEvents.onOutgoingCatalogEvent?.(msg.backendId, msg.epoch, msg.revision, 'remove', undefined, msg.sessionId);
    }
  }

  private handleOutgoingCatalogReset(msg: BackendCatalogResetMessage): void {
    this.outgoingEvents.onOutgoingCatalogReset?.(msg.backendId, msg.epoch);
  }

  private handleOutgoingChannelServerMessage(msg: ChannelServerMessage): void {
    // Fix #5: Generic server messages lack sessionId — route as backend_message,
    // not run_event. Extract sessionId from payload if available.
    const backendId = this.findOutgoingBackendByChannel(msg.channelId) ?? '';
    const payload = msg.message as unknown as Record<string, unknown>;
    const sessionId = (payload?.sessionId as string) ?? '';
    if (sessionId) {
      // Session-specific message — route as run event
      this.outgoingEvents.onOutgoingRunEvent?.(backendId, msg.channelId, sessionId, msg.message as unknown as ServerMessage);
    }
    // Always emit as generic backend message for non-session consumers
    // (The adapter will decide how to handle it)
  }

  private handleOutgoingSessionStreamClosed(msg: SessionStreamClosedMessage): void {
    this.outgoingEvents.onOutgoingSessionStreamClosed?.(
      this.findOutgoingBackendByChannel(msg.channelId) ?? '',
      msg.channelId,
      msg.sessionId,
      msg.reason,
    );
  }

  private handleOutgoingRunStreamEvent(msg: RunStreamEvent): void {
    this.outgoingEvents.onOutgoingRunEvent?.(
      this.findOutgoingBackendByChannel(msg.channelId) ?? '',
      msg.channelId,
      msg.sessionId,
      { type: msg.type, eventType: msg.eventType, runId: msg.runId, seq: msg.seq, payload: msg.payload } as unknown as ServerMessage,
    );
  }

  private handleOutgoingContentPatch(msg: SessionContentPatchMessage): void {
    this.outgoingEvents.onOutgoingContentPatch?.(
      this.findOutgoingBackendByChannel(msg.channelId) ?? '',
      msg.channelId,
      msg.sessionId,
      msg.messages,
      msg.latestOffset,
    );
  }

  private findOutgoingBackendByChannel(channelId: string): string | undefined {
    for (const ch of this.outgoingChannels.values()) {
      if (ch.channelId === channelId) return ch.backendId;
    }
    return undefined;
  }

  // ==========================================================================
  // Internal — HTTP Proxy
  // ==========================================================================

  private static readonly STREAM_THRESHOLD = 1024 * 1024;

  private static shouldStream(headers: Record<string, string>): boolean {
    const contentLength = parseInt(headers['content-length'] || '0', 10);
    if (contentLength > GatewayClient.STREAM_THRESHOLD) return true;
    const rawCt = (headers['content-type'] || '').toLowerCase();
    const ct = rawCt.split(';')[0].trim();
    if (!ct) return false;
    if (ct.startsWith('text/') || ct === 'application/json' || ct.endsWith('+json')) return false;
    if (ct === 'application/xml' || ct === 'text/xml' || ct.endsWith('+xml')) return false;
    if (ct === 'application/javascript' || ct === 'text/javascript') return false;
    if (ct === 'application/x-www-form-urlencoded') return false;
    return true;
  }

  private static isUtf8Response(headers: Record<string, string>): boolean {
    const rawCt = (headers['content-type'] || '').toLowerCase();
    const ct = rawCt.split(';')[0].trim();
    if (!ct) return false;
    if (ct.startsWith('text/')) return true;
    if (ct === 'application/json' || ct.endsWith('+json')) return true;
    if (ct === 'application/xml' || ct === 'text/xml' || ct.endsWith('+xml')) return true;
    if (ct === 'application/javascript' || ct === 'text/javascript') return true;
    if (ct === 'application/x-www-form-urlencoded') return true;
    return false;
  }

  private static normalizeProxyRequestBody(body: unknown): string | Buffer | undefined {
    if (body == null) return undefined;
    if (typeof body === 'string' || Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    return JSON.stringify(body);
  }

  private async handleHttpProxyRequest(msg: GatewayHttpProxyRequest): Promise<void> {
    const port = this.config.serverPort || 3100;
    const url = `http://localhost:${port}${msg.path}`;
    try {
      const resp = await fetch(url, {
        method: msg.method, headers: msg.headers,
        body: !['GET', 'HEAD'].includes(msg.method)
          ? (msg.bodyEncoding === 'base64' && typeof msg.body === 'string'
            ? Buffer.from(msg.body, 'base64')
            : GatewayClient.normalizeProxyRequestBody(msg.body))
          : undefined,
      });
      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((value, key) => { responseHeaders[key] = value; });

      if (GatewayClient.shouldStream(responseHeaders) && resp.body) {
        this.sendWs({ type: 'http_proxy_response_start', requestId: msg.requestId, statusCode: resp.status, headers: responseHeaders } satisfies GatewayHttpProxyResponseStart);
        const reader = resp.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            this.sendWs({ type: 'http_proxy_response_chunk', requestId: msg.requestId, data: Buffer.from(value).toString('base64') } satisfies GatewayHttpProxyResponseChunk);
          }
        } finally { reader.releaseLock(); }
        this.sendWs({ type: 'http_proxy_response_end', requestId: msg.requestId } satisfies GatewayHttpProxyResponseEnd);
      } else {
        const bodyEncoding = GatewayClient.isUtf8Response(responseHeaders) ? 'utf8' as const : 'base64' as const;
        const body = bodyEncoding === 'utf8'
          ? await resp.text()
          : Buffer.from(await resp.arrayBuffer()).toString('base64');
        this.sendWs({ type: 'http_proxy_response', requestId: msg.requestId, statusCode: resp.status, headers: responseHeaders, bodyEncoding, body } satisfies GatewayHttpProxyResponse);
      }
    } catch (error) {
      console.error('[Gateway] HTTP proxy error:', error);
      this.sendWs({
        type: 'http_proxy_response',
        requestId: msg.requestId,
        statusCode: 502,
        headers: { 'content-type': 'application/json' },
        bodyEncoding: 'utf8',
        body: JSON.stringify({ success: false, error: { code: 'PROXY_ERROR', message: 'Failed to reach local server' } })
      } satisfies GatewayHttpProxyResponse);
    }
  }

  // ==========================================================================
  // Internal — Helpers
  // ==========================================================================

  private sendWs(data: unknown, queueIfOffline = false): void {
    const json = JSON.stringify(data);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(json);
    } else if (queueIfOffline) {
      if (this.pendingMessages.length >= GatewayClient.MAX_PENDING_MESSAGES) {
        this.pendingMessages.shift(); // drop oldest
      }
      this.pendingMessages.push(json);
    }
  }

  private flushPendingMessages(): void {
    if (this.pendingMessages.length === 0) return;
    const msgs = this.pendingMessages.splice(0);
    for (const json of msgs) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(json);
      }
    }
  }

  private cleanup(): void {
    const wasConnected = this.isConnected;
    this.isConnected = false; this.backendId = null; this.epoch = null;
    this.peerSessionId = null; this.recoveryToken = null; this.streamDemandActive = false;
    // Fix #20: fire channel closed events before clearing, so adapter can update state
    for (const ch of this.outgoingChannels.values()) {
      this.outgoingEvents.onOutgoingChannelClosed?.(ch.backendId, ch.channelId, 'peer_disconnected');
    }
    this.outgoingChannels.clear();
    this.stopHeartbeat();
    if (wasConnected) this.outgoingEvents.onConnectionStateChanged?.(false);
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect || this.reconnectTimeout) return;
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectBaseInterval * Math.pow(2, this.reconnectAttempts - 1), this.reconnectMaxInterval);
    console.log(`[Gateway] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    this.reconnectTimeout = setTimeout(() => { this.reconnectTimeout = null; this.connect(); }, delay);
  }
}
