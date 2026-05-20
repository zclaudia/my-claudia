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
  RegistrySnapshotMessage,
  BackendHeartbeatMessage,
  HeartbeatAckMessage,
  StreamDemandMessage,
  BackendDataSnapshotMessage,
  BackendDataEventMessage,
  RequestBackendDataSnapshotMessage,
  SessionItem,
  ProjectItem,
  BackendRunStreamEvent,
  RunStreamEventType,
  SessionMessage,
  SessionContentPatchMessage,
  SessionContentPatchErrorMessage,
  BackendClientMessage,
  BackendServerMessage,
  GatewayHttpProxyRequest,
  GatewayHttpProxyResponse,
  GatewayHttpProxyResponseStart,
  GatewayHttpProxyResponseChunk,
  GatewayHttpProxyResponseEnd,
  SubscribeBackendMessage,
  BackendSubscribedMessage,
  UnsubscribeBackendMessage,
  BackendUnsubscribedMessage,
  RunStreamEvent,
  CatchUpSessionContentMessage,
} from '@my-claudia/shared/protocol/gateway';
import type { GatewayBackendInfo } from '@my-claudia/shared/core/server';
import type { ClientMessage, ServerMessage } from '@my-claudia/shared/protocol/messages';
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
  getStateHeartbeat?: () => ServerMessage;
}

import type { Database as BetterDatabase } from 'better-sqlite3';
type Database = BetterDatabase;
import type { ActiveRun } from '../../application/conversation/transport/types.js';
type ActiveRunsMap = Map<string, ActiveRun>;
type BackendMessageHandler = (backendId: string, message: ClientMessage) => Promise<void> | void;
type BackendClosedHandler = (backendId: string) => void;
type GenericEventHandler = (...args: unknown[]) => void;

// ============================================================================
// Outgoing Subscription Types (facade client role)
// ============================================================================

/** Event callbacks for outgoing (facade client) operations. */
export interface GatewayClientOutgoingEvents {
  onOutgoingBackendSubscribed?: (backendId: string, epoch: number, capabilities: string[]) => void;
  onOutgoingBackendUnsubscribed?: (backendId: string, reason: string) => void;
  onOutgoingBackendDataSnapshot?: (backendId: string, sessions: SessionItem[], projects: ProjectItem[]) => void;
  onOutgoingBackendDataEvent?: (event: BackendDataEventMessage) => void;
  onOutgoingRunEvent?: (backendId: string, sessionId: string, event: ServerMessage) => void;
  /** Generic backend message (no sessionId) — terminal output, heartbeats, etc. */
  onOutgoingBackendMessage?: (backendId: string, message: ServerMessage) => void;
  onOutgoingContentPatch?: (backendId: string, sessionId: string, messages: SessionMessage[], latestOffset: number) => void;
  onOutgoingContentPatchError?: (backendId: string, sessionId: string, afterOffset: number, error: string) => void;
  onRegistrySnapshotChanged?: (items: BackendPresence[]) => void;
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
    /** Send a message to a specific client (channelId = peerSessionId). */
    sendToIncoming(channelId: string, message: ServerMessage): void;
    /** Register handler for incoming channel messages. */
    onIncomingMessage(handler: BackendMessageHandler): void;
    /** Register handler for incoming channel closures. */
    onIncomingClosed(handler: BackendClosedHandler): void;
    /** Register handler for content catch-up requests. */
    onCatchUp(handler: (sessionId: string, afterOffset: number) => Promise<SessionMessage[]>): void;
  };
  backend: {
    /** Subscribe to a remote backend (facade client role). */
    subscribe(targetBackendId: string): void;
    /** Unsubscribe from a remote backend. */
    unsubscribe(targetBackendId: string): void;
    /** Send a message to a subscribed backend. */
    sendToBackend(targetBackendId: string, message: ClientMessage): void;
  };
  backendData: {
    /** Publish a full backend data snapshot (sessions + projects). */
    publishSnapshot(): void;
    /** Publish a backend data event. */
    publishEvent(eventType: 'upsert' | 'remove', session: { id: string; name?: string; projectId?: string; createdAt?: number; created_at?: number; updatedAt?: number; updated_at?: number }): void;
    /** Compatibility alias for publishEvent. */
    broadcastSessionEvent(eventType: 'created' | 'updated' | 'deleted', session: { id: string; name?: string; projectId?: string; createdAt?: number; created_at?: number; updatedAt?: number; updated_at?: number }): void;
    /** Publish an incremental project event. */
    broadcastProjectEvent(eventType: 'created' | 'updated' | 'deleted', project: { id: string; name?: string; createdAt?: number; created_at?: number; updatedAt?: number; updated_at?: number }): void;
  };
  stream: {
    /** Emit a run stream event (backend-peer role). */
    emitRunEvent(sessionId: string, runId: string, eventType: RunStreamEventType, seq: number, payload: unknown): void;
    /** Request content catch-up on a subscribed backend stream (facade client role). */
    catchUpOutgoing(backendId: string, sessionId: string, afterOffset: number): void;
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
    getDiscoveredBackends(): GatewayBackendInfo[];
  };
  backend: {
    isSubscribed(backendId: string): boolean;
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
  private connectTimeout: NodeJS.Timeout | null = null;
  private connectTimeoutMs = 15000;

  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = 10_000;

  private streamDemandActive = false;

  private registryItems = new Map<string, BackendPresence>();

  private backendDataPushInterval: NodeJS.Timeout | null = null;

  private db: Database | null = null;
  private activeRuns: ActiveRunsMap | null = null;

  private onCatchUpHandler: ((sessionId: string, afterOffset: number) => Promise<SessionMessage[]>) | null = null;
  private onBackendMessageHandler: BackendMessageHandler | null = null;
  private onBackendClosedHandler: BackendClosedHandler | null = null;

  // Outgoing subscriptions (facade client role)
  private subscribedBackends = new Set<string>();
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
      },
      backend: {
        subscribe: (bid) => this.subscribeBackend(bid),
        unsubscribe: (bid) => this.unsubscribeBackend(bid),
        sendToBackend: (bid, msg) => this.sendToBackend(bid, msg),
      },
      backendData: {
        publishSnapshot: () => this.publishBackendDataSnapshot(),
        publishEvent: (t, s) => this.publishBackendDataEvent(t, s),
        broadcastSessionEvent: (t, s) => this.broadcastSessionEvent(t, s),
        broadcastProjectEvent: (t, p) => this.broadcastProjectEvent(t, p),
      },
      stream: {
        emitRunEvent: (sid, rid, et, seq, p) => this.emitRunStreamEvent(sid, rid, et, seq, p),
        catchUpOutgoing: (bid, sid, off) => this.catchUpOutgoingStream(bid, sid, off),
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
        getDiscoveredBackends: () => this.getDiscoveredBackends(),
      },
      backend: {
        isSubscribed: (bid) => this.isBackendSubscribed(bid),
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
    this.clearConnectTimeout();
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

    this.connectTimeout = setTimeout(() => {
      if (this.ws !== currentWs || this.isConnected) return;
      console.warn(`[Gateway] Connection attempt timed out after ${this.connectTimeoutMs / 1000}s`);
      currentWs.removeAllListeners();
      currentWs.close();
      if (this.ws === currentWs) this.ws = null;
      this.cleanup();
      this.scheduleReconnect();
    }, this.connectTimeoutMs);

    this.ws.on('open', () => { if (this.ws !== currentWs) return; this.sendPeerHello(); });
    this.ws.on('message', (data: Buffer) => {
      if (this.ws !== currentWs) return;
      try { this.handleMessage(JSON.parse(data.toString())); }
      catch (error) { console.error('[Gateway] Failed to parse message:', error); }
    });
    this.ws.on('close', (code: number) => {
      if (this.ws !== currentWs) return;
      this.clearConnectTimeout();
      console.log(`[Gateway] Disconnected (code: ${code})`);
      this.cleanup();
      if (code !== 4000) this.scheduleReconnect();
    });
    this.ws.on('error', (error) => {
      if (this.ws !== currentWs) return;
      this.clearConnectTimeout();
      console.error('[Gateway] Connection error:', error);
      this.cleanup();
      this.scheduleReconnect();
    });
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
    this.clearConnectTimeout();
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

  onChannelMessage(handler: BackendMessageHandler): void {
    this.onBackendMessageHandler = handler;
  }

  onChannelClosed(handler: BackendClosedHandler): void {
    this.onBackendClosedHandler = handler;
  }

  /** Send a message to a subscribing client via backend_server_message. */
  sendToChannel(targetPeerSessionId: string, message: ServerMessage): void {
    const backendId = this.backendId || targetPeerSessionId;
    this.sendWs({ type: 'backend_server_message', backendId, targetPeerSessionId, message } satisfies BackendServerMessage, true);
  }

  // ==========================================================================
  // Outgoing Backend Subscription API (facade client role)
  // ==========================================================================

  setOutgoingEvents(events: GatewayClientOutgoingEvents): void {
    // Compose handlers: for keys that already have a handler, chain the new
    // handler after the existing one so multiple consumers (manager + adapter)
    // both receive callbacks without overwriting each other.
    const prev = { ...this.outgoingEvents };
    const merged: GatewayClientOutgoingEvents = { ...prev, ...events };
    const mergedHandlers = merged as unknown as Partial<Record<keyof GatewayClientOutgoingEvents, GenericEventHandler>>;
    for (const key of Object.keys(events) as Array<keyof GatewayClientOutgoingEvents>) {
      const prevHandler = prev[key] as GenericEventHandler | undefined;
      const nextHandler = events[key] as GenericEventHandler | undefined;
      if (prevHandler && nextHandler && prevHandler !== nextHandler) {
        mergedHandlers[key] = (...args: unknown[]) => {
          prevHandler(...args);
          nextHandler(...args);
        };
      }
    }
    this.outgoingEvents = merged;
  }

  getRegistryItems(): Map<string, BackendPresence> { return this.registryItems; }

  subscribeBackend(targetBackendId: string): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'subscribe_backend',
      backendId: targetBackendId,
    } satisfies SubscribeBackendMessage);
  }

  unsubscribeBackend(targetBackendId: string): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'unsubscribe_backend',
      backendId: targetBackendId,
    } satisfies UnsubscribeBackendMessage);
    this.subscribedBackends.delete(targetBackendId);
  }

  sendToBackend(targetBackendId: string, message: ClientMessage): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'backend_client_message',
      backendId: targetBackendId,
      message,
    } satisfies BackendClientMessage);
  }

  isBackendSubscribed(backendId: string): boolean {
    return this.subscribedBackends.has(backendId);
  }

  catchUpOutgoingStream(backendId: string, sessionId: string, afterOffset: number): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({
      type: 'catch_up_session_content',
      backendId,
      sessionId,
      afterOffset,
    } satisfies CatchUpSessionContentMessage);
  }

  // ==========================================================================
  // Backend Data (sessions + projects publishing)
  // ==========================================================================

  publishBackendDataSnapshot(targetPeerSessionId?: string): void {
    if (!this.ws || !this.isConnected || !this.epoch) return;
    if (!this.db || !this.activeRuns) return;
    const activeRuns = this.activeRuns;
    try {
      const sessions = this.db.prepare(`
        SELECT s.id, s.name, s.project_id as projectId,
               s.created_at as createdAt, s.updated_at as updatedAt,
               s.archived_at as archivedAt
        FROM sessions s
        LEFT JOIN projects p ON s.project_id = p.id
        WHERE s.archived_at IS NULL
          AND (p.is_internal IS NULL OR p.is_internal = 0)
        ORDER BY s.updated_at DESC
      `).all() as Array<Record<string, unknown>>;
      const sessionItems: SessionItem[] = sessions.map((s) => ({
        sessionId: s.id as string,
        projectId: (s.projectId as string) || undefined,
        title: (s.name as string) || undefined,
        createdAt: s.createdAt as number,
        updatedAt: s.updatedAt as number,
        lastMessageAt: s.updatedAt as number,
        runStatus: hasForegroundActiveRunForSession(activeRuns, s.id as string) ? 'running' as const : 'idle' as const,
      }));

      // Query projects
      let projectItems: ProjectItem[] = [];
      try {
        const projects = this.db.prepare(`
          SELECT id, name, created_at as createdAt, updated_at as updatedAt
          FROM projects
          WHERE is_internal = 0
          ORDER BY updated_at DESC
        `).all() as Array<Record<string, unknown>>;
        projectItems = projects.map((p) => ({
          projectId: p.id as string,
          name: (p.name as string) || '',
          createdAt: p.createdAt as number,
          updatedAt: p.updatedAt as number,
        }));
      } catch {
        // projects table may not exist yet
      }

      const msg: BackendDataSnapshotMessage = {
        type: 'backend_data_snapshot',
        sessions: sessionItems,
        projects: projectItems,
      };
      this.sendWs(msg);
      console.log(`[Gateway] Published backend data snapshot: ${sessionItems.length} sessions, ${projectItems.length} projects`);

      if (targetPeerSessionId && this.config.getStateHeartbeat) {
        this.sendToChannel(targetPeerSessionId, this.config.getStateHeartbeat());
      }
    } catch (error) {
      console.error('[Gateway] Failed to publish backend data snapshot:', error);
    }
  }

  publishBackendDataEvent(
    eventType: 'upsert' | 'remove',
    session: {
      id: string;
      name?: string;
      projectId?: string;
      createdAt?: number;
      created_at?: number;
      updatedAt?: number;
      updated_at?: number;
      archivedAt?: number | null;
      archived_at?: number | null;
    }
  ): void {
    if (!this.ws || !this.isConnected || !this.epoch) return;
    const isArchived = session.archivedAt != null || session.archived_at != null;
    if (eventType === 'upsert' && !isArchived) {
      const item: SessionItem = {
        sessionId: session.id,
        projectId: session.projectId || undefined,
        title: session.name || undefined,
        createdAt: session.createdAt ?? session.created_at ?? Date.now(),
        updatedAt: session.updatedAt ?? session.updated_at ?? Date.now(),
        lastMessageAt: session.updatedAt ?? session.updated_at ?? Date.now(),
        runStatus: this.activeRuns && hasForegroundActiveRunForSession(this.activeRuns, session.id) ? 'running' : 'idle',
      };
      const msg: BackendDataEventMessage = { type: 'backend_data_event', op: 'session_upsert', item };
      this.sendWs(msg);
    } else {
      const msg: BackendDataEventMessage = { type: 'backend_data_event', op: 'session_remove', sessionId: session.id };
      this.sendWs(msg);
    }
  }

  // ==========================================================================
  // Stream Events
  // ==========================================================================

  /** Compatibility alias for publishBackendDataEvent — used by sessions routes and run handler. */
  broadcastSessionEvent(
    eventType: 'created' | 'updated' | 'deleted',
    session: {
      id: string;
      name?: string;
      projectId?: string;
      createdAt?: number;
      created_at?: number;
      updatedAt?: number;
      updated_at?: number;
      archivedAt?: number | null;
      archived_at?: number | null;
    }
  ): void {
    this.publishBackendDataEvent(eventType === 'deleted' ? 'remove' : 'upsert', session);
  }

  broadcastProjectEvent(
    eventType: 'created' | 'updated' | 'deleted',
    project: {
      id: string;
      name?: string;
      createdAt?: number;
      created_at?: number;
      updatedAt?: number;
      updated_at?: number;
    }
  ): void {
    if (!this.ws || !this.isConnected || !this.epoch) return;
    if (eventType === 'deleted') {
      const msg: BackendDataEventMessage = {
        type: 'backend_data_event',
        op: 'project_remove',
        projectId: project.id,
      };
      this.sendWs(msg);
      return;
    }

    const item: ProjectItem = {
      projectId: project.id,
      name: project.name || '',
      createdAt: project.createdAt ?? project.created_at ?? Date.now(),
      updatedAt: project.updatedAt ?? project.updated_at ?? Date.now(),
    };
    const msg: BackendDataEventMessage = { type: 'backend_data_event', op: 'project_upsert', item };
    this.sendWs(msg);
  }

  emitRunStreamEvent(sessionId: string, runId: string, eventType: RunStreamEventType, seq: number, payload: unknown): void {
    if (!this.ws || !this.isConnected || !this.streamDemandActive) return;
    const msg: BackendRunStreamEvent = { type: 'run_stream_event', eventType, sessionId, runId, seq, payload };
    this.sendWs(msg);
  }

  sendPushNotificationRequest(event: {
    type: string; title: string; body: string;
    priority?: string; tags?: string[]; clickUrl?: string;
  }): void {
    if (!this.ws || !this.isConnected) return;
    this.sendWs({ type: 'push_notification_request', event });
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
    };
    this.ws.send(JSON.stringify(msg));
  }

  // ==========================================================================
  // Internal — Message Router
  // ==========================================================================

  private handleMessage(message: Record<string, unknown>): void {
    const msg = message as Record<string, unknown> & { type: string };
    switch (msg.type) {
      case 'peer_ready': this.handlePeerReady(msg as unknown as PeerReadyMessage); break;
      case 'registry_snapshot': this.handleRegistrySnapshot(msg as unknown as RegistrySnapshotMessage); break;
      case 'heartbeat_ack': this.handleHeartbeatAck(msg as unknown as HeartbeatAckMessage); break;
      case 'stream_demand': this.handleStreamDemand(msg as unknown as StreamDemandMessage); break;
      // Incoming messages (backend-peer role)
      case 'backend_client_message': void this.handleBackendClientMsg(msg as unknown as BackendClientMessage); break;
      case 'subscriber_disconnected': this.handleSubscriberDisconnected(msg as unknown as { peerSessionId: string }); break;
      case 'catch_up_session_content': this.handleCatchUpRequest(msg as unknown as CatchUpSessionContentMessage); break;
      case 'http_proxy_request': this.handleHttpProxyRequest(msg as unknown as GatewayHttpProxyRequest); break;
      // Backend subscription events (facade client role)
      case 'backend_subscribed': this.handleBackendSubscribed(msg as unknown as BackendSubscribedMessage); break;
      case 'backend_unsubscribed': this.handleBackendUnsubscribed(msg as unknown as BackendUnsubscribedMessage); break;
      // Backend data (subscribed to remote backend)
      case 'backend_data_snapshot': this.handleOutgoingBackendDataSnapshot(msg as unknown as BackendDataSnapshotMessage); break;
      case 'backend_data_event': this.handleOutgoingBackendDataEvent(msg as unknown as BackendDataEventMessage); break;
      // Handle request_backend_data_snapshot from gateway (backend-peer role)
      case 'request_backend_data_snapshot': {
        const request = msg as unknown as RequestBackendDataSnapshotMessage;
        this.publishBackendDataSnapshot(request.targetPeerSessionId);
        break;
      }
      // Outgoing stream events (from subscribed backends)
      case 'backend_server_message': this.handleOutgoingBackendServerMessage(msg as unknown as BackendServerMessage); break;
      case 'run_stream_event': this.handleOutgoingRunStreamEvent(msg as unknown as RunStreamEvent); break;
      case 'session_content_patch': this.handleOutgoingContentPatch(msg as unknown as SessionContentPatchMessage); break;
      case 'session_content_patch_error': this.handleOutgoingContentPatchError(msg as unknown as SessionContentPatchErrorMessage); break;
      case 'gateway_error': console.error(`[Gateway] Error: ${msg.code} — ${msg.message}`); break;
    }
  }

  private handlePeerReady(msg: PeerReadyMessage): void {
    this.clearConnectTimeout();
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
    this.publishBackendDataSnapshot();
    this.startBackendDataPush();
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
  // Internal — Periodic Backend Data Push
  // ==========================================================================

  private startBackendDataPush(): void {
    this.stopBackendDataPush();
    this.backendDataPushInterval = setInterval(() => {
      if (this.streamDemandActive) {
        this.publishBackendDataSnapshot();
      }
    }, 30_000);
  }

  private stopBackendDataPush(): void {
    if (this.backendDataPushInterval) {
      clearInterval(this.backendDataPushInterval);
      this.backendDataPushInterval = null;
    }
  }

  // ==========================================================================
  // Internal — Registry
  // ==========================================================================

  private applyRegistrySync(sync: RegistrySyncPayload): void {
    this.registryItems.clear();
    for (const item of sync.items) this.registryItems.set(item.backendId, item);
    this.outgoingEvents.onRegistrySnapshotChanged?.(sync.items);
  }

  private handleRegistrySnapshot(msg: RegistrySnapshotMessage): void {
    this.registryItems.clear();
    for (const item of msg.items) this.registryItems.set(item.backendId, item);
    this.outgoingEvents.onRegistrySnapshotChanged?.(msg.items);
  }

  // ==========================================================================
  // Internal — Content Catch-Up
  // ==========================================================================

  private async handleCatchUpRequest(msg: CatchUpSessionContentMessage): Promise<void> {
    if (!this.onCatchUpHandler) return;
    try {
      const messages = await this.onCatchUpHandler(msg.sessionId, msg.afterOffset);
      const maxOffset = messages.length > 0 ? Math.max(...messages.map(m => m.offset)) : msg.afterOffset;
      const patch: SessionContentPatchMessage = { type: 'session_content_patch', backendId: msg.backendId, sessionId: msg.sessionId, messages, latestOffset: maxOffset };
      this.sendWs(patch);
    } catch (error) {
      console.error('[Gateway] Catch-up error:', error);
      this.sendWs({
        type: 'session_content_patch_error',
        backendId: msg.backendId,
        sessionId: msg.sessionId,
        afterOffset: msg.afterOffset,
        message: error instanceof Error ? error.message : 'Catch-up failed',
      } satisfies SessionContentPatchErrorMessage);
    }
  }

  private async handleBackendClientMsg(msg: BackendClientMessage): Promise<void> {
    if (!this.onBackendMessageHandler) return;
    try {
      // Use sourcePeerSessionId (set by gateway) as client identity for virtualClient keying
      const clientId = msg.sourcePeerSessionId || msg.backendId;
      await this.onBackendMessageHandler(clientId, msg.message);
    } catch (error) {
      console.error('[Gateway] Backend client message handler error:', error);
    }
  }

  private handleSubscriberDisconnected(msg: { peerSessionId: string }): void {
    if (!this.onBackendClosedHandler) return;
    this.onBackendClosedHandler(msg.peerSessionId);
  }

  // ==========================================================================
  // Internal — Outgoing Backend Subscription Routing
  // ==========================================================================

  private handleBackendSubscribed(msg: BackendSubscribedMessage): void {
    this.subscribedBackends.add(msg.backendId);
    this.outgoingEvents.onOutgoingBackendSubscribed?.(msg.backendId, msg.epoch, msg.capabilities);
  }

  private handleBackendUnsubscribed(msg: BackendUnsubscribedMessage): void {
    this.subscribedBackends.delete(msg.backendId);
    this.outgoingEvents.onOutgoingBackendUnsubscribed?.(msg.backendId, msg.reason);
  }

  private handleOutgoingBackendDataSnapshot(msg: BackendDataSnapshotMessage): void {
    const backendId = msg.backendId;
    if (!backendId) {
      console.warn('[Gateway] Received backend_data_snapshot without backendId, ignoring');
      return;
    }
    this.outgoingEvents.onOutgoingBackendDataSnapshot?.(backendId, msg.sessions, msg.projects);
  }

  private handleOutgoingBackendDataEvent(msg: BackendDataEventMessage): void {
    this.outgoingEvents.onOutgoingBackendDataEvent?.(msg);
  }

  private handleOutgoingBackendServerMessage(msg: BackendServerMessage): void {
    const payload = msg.message as unknown as Record<string, unknown>;
    const sessionId = (payload?.sessionId as string) ?? '';
    if (sessionId) {
      // Session-specific message — route as run event
      this.outgoingEvents.onOutgoingRunEvent?.(msg.backendId, sessionId, msg.message as unknown as ServerMessage);
    } else {
      // Non-session message (terminal output, heartbeats, etc.) — emit as
      // generic backend message so the adapter can forward it to the UI.
      this.outgoingEvents.onOutgoingBackendMessage?.(msg.backendId, msg.message as unknown as ServerMessage);
    }
  }

  private handleOutgoingRunStreamEvent(msg: RunStreamEvent): void {
    this.outgoingEvents.onOutgoingRunEvent?.(
      msg.backendId,
      msg.sessionId,
      { type: msg.type, eventType: msg.eventType, runId: msg.runId, seq: msg.seq, payload: msg.payload } as unknown as ServerMessage,
    );
  }

  private handleOutgoingContentPatch(msg: SessionContentPatchMessage): void {
    this.outgoingEvents.onOutgoingContentPatch?.(
      msg.backendId,
      msg.sessionId,
      msg.messages,
      msg.latestOffset,
    );
  }

  private handleOutgoingContentPatchError(msg: SessionContentPatchErrorMessage): void {
    this.outgoingEvents.onOutgoingContentPatchError?.(
      msg.backendId,
      msg.sessionId,
      msg.afterOffset,
      msg.message,
    );
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
    // Fire unsubscribed events before clearing, so adapter can update state
    for (const backendId of this.subscribedBackends) {
      this.outgoingEvents.onOutgoingBackendUnsubscribed?.(backendId, 'peer_disconnected');
    }
    this.subscribedBackends.clear();
    this.stopHeartbeat();
    this.stopBackendDataPush();
    if (wasConnected) this.outgoingEvents.onConnectionStateChanged?.(false);
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect || this.reconnectTimeout) return;
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectBaseInterval * Math.pow(2, this.reconnectAttempts - 1), this.reconnectMaxInterval);
    console.log(`[Gateway] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    this.reconnectTimeout = setTimeout(() => { this.reconnectTimeout = null; this.connect(); }, delay);
  }
}
