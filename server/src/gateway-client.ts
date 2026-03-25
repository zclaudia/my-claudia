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
} from '@my-claudia/shared';
import { hasForegroundActiveRunForSession } from './utils/run-state.js';

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

type Database = any;
type ActiveRunsMap = Map<string, any>;
type ChannelMessageHandler = (channelId: string, message: ClientMessage) => Promise<void> | void;
type ChannelClosedHandler = (channelId: string) => void;

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
    if (!this.ws || !this.isConnected) return;
    this.sendWs({ type: 'channel_server_message', channelId, message } satisfies ChannelServerMessage);
  }

  // ==========================================================================
  // Catalog
  // ==========================================================================

  publishCatalogSnapshot(): void {
    if (!this.ws || !this.isConnected || !this.epoch) return;
    if (!this.db || !this.activeRuns) return;
    try {
      const sessions = this.db.prepare(`
        SELECT s.id, s.name, s.created_at as createdAt, s.updated_at as updatedAt,
               (SELECT MAX(offset) FROM messages WHERE session_id = s.id) as lastMessageOffset
        FROM sessions s ORDER BY s.updated_at DESC
      `).all();
      const items: SessionCatalogItem[] = sessions.map((s: any) => ({
        sessionId: s.id, title: s.name || undefined, createdAt: s.createdAt, updatedAt: s.updatedAt,
        lastMessageAt: s.updatedAt,
        activeRunStatus: hasForegroundActiveRunForSession(this.activeRuns!, s.id) ? 'running' as const : 'idle' as const,
      }));
      this.catalogRevision++;
      const msg: CatalogSnapshotMessage = { type: 'catalog_snapshot', epoch: this.epoch, revision: this.catalogRevision, items };
      this.sendWs(msg);
      console.log(`[Gateway] Published catalog snapshot: ${items.length} sessions, revision=${this.catalogRevision}`);
    } catch (error) {
      console.error('[Gateway] Failed to publish catalog snapshot:', error);
    }
  }

  publishCatalogEvent(eventType: 'upsert' | 'remove', session: any): void {
    if (!this.ws || !this.isConnected || !this.epoch) return;
    this.catalogRevision++;
    if (eventType === 'upsert') {
      const item: SessionCatalogItem = {
        sessionId: session.id, title: session.name || undefined,
        createdAt: session.createdAt ?? session.created_at,
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
  broadcastSessionEvent(eventType: 'created' | 'updated' | 'deleted', session: any): void {
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

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'peer_ready': this.handlePeerReady(message); break;
      case 'registry_snapshot': this.handleRegistrySnapshot(message); break;
      case 'registry_delta': this.handleRegistryDelta(message); break;
      case 'registry_event': this.handleRegistryEvent(message); break;
      case 'heartbeat_ack': this.handleHeartbeatAck(message); break;
      case 'stream_demand': this.handleStreamDemand(message); break;
      case 'channel_client_message': void this.handleChannelClientMessage(message); break;
      case 'backend_channel_closed': this.handleBackendChannelClosed(message); break;
      case 'catch_up_session_content': this.handleCatchUpRequest(message); break;
      case 'http_proxy_request': this.handleHttpProxyRequest(message); break;
      case 'gateway_error': console.error(`[Gateway] Error: ${message.code} — ${message.message}`); break;
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
    } else {
      for (const event of sync.events) this.applyRegistryEventItem(event);
      this.registryRevision = sync.toRevision;
    }
  }

  private handleRegistrySnapshot(msg: RegistrySnapshotMessage): void {
    this.registryItems.clear();
    for (const item of msg.items) this.registryItems.set(item.backendId, item);
    this.registryRevision = msg.revision;
  }

  private handleRegistryDelta(msg: RegistryDeltaMessage): void {
    for (const event of msg.events) this.applyRegistryEventItem(event);
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
  }

  private applyRegistryEventItem(event: RegistryEvent): void {
    if (event.op === 'upsert') this.registryItems.set(event.item.backendId, event.item);
    else this.registryItems.delete(event.backendId);
  }

  // ==========================================================================
  // Internal — Content Catch-Up
  // ==========================================================================

  private async handleCatchUpRequest(msg: any): Promise<void> {
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

  private handleBackendChannelClosed(msg: { channelId: string }): void {
    this.onChannelClosedHandler?.(msg.channelId);
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
          ? GatewayClient.normalizeProxyRequestBody(msg.body)
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

  private sendWs(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }

  private cleanup(): void {
    this.isConnected = false; this.backendId = null; this.epoch = null;
    this.peerSessionId = null; this.recoveryToken = null; this.streamDemandActive = false;
    this.stopHeartbeat();
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect || this.reconnectTimeout) return;
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectBaseInterval * Math.pow(2, this.reconnectAttempts - 1), this.reconnectMaxInterval);
    console.log(`[Gateway] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    this.reconnectTimeout = setTimeout(() => { this.reconnectTimeout = null; this.connect(); }, delay);
  }
}
