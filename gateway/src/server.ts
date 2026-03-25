/**
 * Gateway Sync Protocol — Server Implementation
 *
 * See docs/design/gateway-sync-protocol-v2.md for full specification.
 */

import { createServer as createHttpServer, IncomingMessage, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import type {
  PeerHelloMessage,
  PeerReadyMessage,
  RegistrySyncPayload,
  BackendPresence,
  RegistryEvent,
  RegistrySnapshotMessage,
  RegistryDeltaMessage,
  RegistryEventMessage,
  RegistrySyncResponse,
  ResyncRegistryMessage,
  BackendHeartbeatMessage,
  HeartbeatAckMessage,
  CatalogSnapshotMessage,
  CatalogEventMessage,
  SubscribeBackendCatalogMessage,
  UnsubscribeBackendCatalogMessage,
  BackendCatalogSnapshotMessage,
  BackendCatalogDeltaMessage,
  BackendCatalogEventMessage,
  BackendCatalogResetMessage,
  BackendCatalogSyncResponse,
  OpenBackendChannelMessage,
  BackendChannelOpenedMessage,
  BackendChannelRejectedMessage,
  CloseBackendChannelMessage,
  BackendChannelClosedMessage,
  StreamDemandMessage,
  OpenSessionStreamMessage,
  CloseSessionStreamMessage,
  SessionStreamClosedMessage,
  BackendRunStreamEvent,
  RunStreamEvent,
  CatchUpSessionContentMessage,
  SessionContentPatchMessage,
  GatewayErrorMessage,
  GatewayHttpProxyRequest,
  GatewayHttpProxyResponse,
  GatewayHttpProxyResponseStart,
  GatewayHttpProxyResponseChunk,
  GatewayHttpProxyResponseEnd,
} from '@my-claudia/shared';
import { GatewayStorage } from './storage.js';
import { GatewayState, type PeerSession, type ChannelState } from './state.js';

// ============================================================================
// Config & Helpers
// ============================================================================

interface GatewayConfig {
  gatewaySecret: string;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function sendToWs(ws: WebSocket, message: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ============================================================================
// Server Factory
// ============================================================================

export function createGatewayServer(config: GatewayConfig): Server {
  const storage = new GatewayStorage();
  const state = new GatewayState();

  const app = express();

  // --- Rate limiting ---
  const authAttempts = new Map<string, { count: number; resetAt: number }>();
  const AUTH_RATE_LIMIT = 10;
  const AUTH_RATE_WINDOW = 60_000;

  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = authAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      authAttempts.set(ip, { count: 1, resetAt: now + AUTH_RATE_WINDOW });
      return true;
    }
    if (++entry.count > AUTH_RATE_LIMIT) return false;
    return true;
  }

  const rateLimitCleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of authAttempts) {
      if (now > entry.resetAt) authAttempts.delete(ip);
    }
  }, 5 * 60_000);

  // --- CORS ---
  app.use((req: Request, res: Response, next: () => void) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '15mb' }));

  // ========================================================================
  // HTTP Endpoints
  // ========================================================================

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      backends: state.registry.items.size,
      peers: state.peers.size,
    });
  });

  function requireGatewayAuth(req: Request, res: Response, next: () => void): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authorization required' } });
      return;
    }
    const token = authHeader.slice(7);
    const colonIndex = token.indexOf(':');
    const secret = colonIndex !== -1 ? token.slice(colonIndex + 1) : token;
    if (!safeCompare(secret, config.gatewaySecret)) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });
      return;
    }
    next();
  }

  function requireRecoveryToken(req: Request, res: Response, next: () => void): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authorization required' } });
      return;
    }
    const token = authHeader.slice(7);
    if (!safeCompare(token, config.gatewaySecret)) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid recovery token' } });
      return;
    }
    next();
  }

  // --- Poll Recovery: Registry ---
  app.get('/sync/registry', requireRecoveryToken, (_req: Request, res: Response) => {
    const sinceRevision = parseInt(_req.query.sinceRevision as string) || 0;
    const delta = state.getRegistryDelta(sinceRevision);
    if (delta && delta.length > 0) {
      const response: RegistrySyncResponse = {
        mode: 'delta',
        fromRevision: sinceRevision,
        toRevision: state.registry.revision,
        events: delta,
      };
      res.json(response);
    } else {
      const response: RegistrySyncResponse = {
        mode: 'snapshot',
        revision: state.registry.revision,
        items: Array.from(state.registry.items.values()),
      };
      res.json(response);
    }
  });

  // --- Poll Recovery: Catalog ---
  app.get('/sync/backend-catalog/:backendId', requireRecoveryToken, (req: Request, res: Response) => {
    const { backendId } = req.params;
    const epoch = parseInt(req.query.epoch as string) || 0;
    const sinceRevision = parseInt(req.query.sinceRevision as string) || 0;
    const catalog = state.catalogs.get(backendId);
    if (!catalog || catalog.epoch !== epoch) {
      res.status(404).json({ success: false, error: { code: 'BACKEND_OFFLINE', message: 'Backend catalog not found or epoch mismatch' } });
      return;
    }
    const delta = state.getCatalogDelta(backendId, sinceRevision);
    if (delta && delta.length > 0) {
      const response: BackendCatalogSyncResponse = {
        mode: 'delta', backendId, epoch: catalog.epoch,
        fromRevision: sinceRevision, toRevision: catalog.revision, events: delta,
      };
      res.json(response);
    } else {
      const response: BackendCatalogSyncResponse = {
        mode: 'snapshot', backendId, epoch: catalog.epoch,
        revision: catalog.revision, items: Array.from(catalog.items.values()),
      };
      res.json(response);
    }
  });

  // --- HTTP Proxy ---
  const pendingHttpRequests = new Map<string, {
    resolve: (response: GatewayHttpProxyResponse | null) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    res?: Response;
  }>();
  const pendingStreamingRequests = new Map<string, {
    res: Response; resolve: () => void; timeout: NodeJS.Timeout;
  }>();

  app.all('/api/proxy/:backendId/*', async (req: Request, res: Response) => {
    try {
      const { backendId } = req.params;
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        checkRateLimit(clientIp);
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authorization required' } });
        return;
      }
      const token = authHeader.slice(7);
      const colonIndex = token.indexOf(':');
      const gwSecret = colonIndex !== -1 ? token.slice(0, colonIndex) : token;
      if (!safeCompare(gwSecret, config.gatewaySecret)) {
        if (!checkRateLimit(clientIp)) {
          res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
          return;
        }
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });
        return;
      }
      const lease = state.leases.get(backendId);
      if (!lease) {
        res.status(502).json({ success: false, error: { code: 'BACKEND_OFFLINE', message: 'Backend not found or offline' } });
        return;
      }
      const backendPeer = state.peers.get(lease.peerSessionId);
      if (!backendPeer) {
        res.status(502).json({ success: false, error: { code: 'BACKEND_OFFLINE', message: 'Backend peer not found' } });
        return;
      }
      const fullPath = req.params[0] || '';
      const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const targetPath = fullPath + queryString;
      const requestId = uuidv4();
      const proxyRequest: GatewayHttpProxyRequest = {
        type: 'http_proxy_request', requestId, method: req.method,
        path: targetPath, headers: { 'content-type': req.headers['content-type'] || 'application/json' }, body: req.body,
      };
      const clientRequestId = req.headers['x-request-id'];
      if (clientRequestId) proxyRequest.headers['x-request-id'] = clientRequestId as string;

      const response = await new Promise<GatewayHttpProxyResponse | null>((resolve, reject) => {
        const timeout = setTimeout(() => { pendingHttpRequests.delete(requestId); reject(new Error('Proxy request timeout')); }, 30_000);
        pendingHttpRequests.set(requestId, { resolve, reject, timeout, res });
        sendToWs(backendPeer.ws, proxyRequest);
      });
      if (!response) { if (!res.headersSent) res.status(502).json({ success: false, error: { code: 'PROXY_ERROR', message: 'No response' } }); return; }
      if (response.headers) { for (const [key, value] of Object.entries(response.headers)) res.setHeader(key, value); }
      if (clientRequestId) res.setHeader('x-request-id', clientRequestId);
      res.status(response.statusCode).json(response.body);
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ success: false, error: { code: 'PROXY_ERROR', message: 'Failed to proxy request' } });
    }
  });

  app.use((_req: Request, res: Response) => { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } }); });
  app.use((err: Error, _req: Request, res: Response, _next: () => void) => { console.error('[Gateway] Unhandled error:', err); res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }); });

  // ========================================================================
  // WebSocket Layer
  // ========================================================================

  const httpServer = createHttpServer(app);
  const wsConnectionsPerIp = new Map<string, number>();
  const MAX_WS_CONNECTIONS_PER_IP = 10;
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 50 * 1024 * 1024 });

  const pingInterval = setInterval(() => {
    state.peers.forEach((peer, peerSessionId) => {
      if (!peer.isAlive) { console.log(`[Gateway] Peer ${peerSessionId} ping timeout`); handlePeerDisconnect(peerSessionId); return; }
      peer.isAlive = false; peer.ws.ping();
    });
  }, 30_000);

  const leaseCheckInterval = setInterval(() => {
    const now = Date.now();
    for (const [backendId, lease] of state.leases) {
      if (now - lease.lastHeartbeatAt > lease.leaseTtlMs) { console.log(`[Gateway] Backend ${backendId} lease expired`); handleBackendLeaseExpired(backendId); }
    }
  }, 5_000);

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const currentCount = wsConnectionsPerIp.get(ip) || 0;
    if (currentCount >= MAX_WS_CONNECTIONS_PER_IP) { ws.close(1008, 'Too many connections'); return; }
    wsConnectionsPerIp.set(ip, currentCount + 1);
    let peerSessionId: string | null = null;
    const authTimeout = setTimeout(() => { if (!peerSessionId) ws.close(1008, 'Authentication timeout'); }, 10_000);

    ws.on('pong', () => { if (peerSessionId) { const peer = state.peers.get(peerSessionId); if (peer) peer.isAlive = true; } });
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (!peerSessionId) {
          clearTimeout(authTimeout);
          if (message.type === 'peer_hello') { peerSessionId = handlePeerHello(ws, message as PeerHelloMessage); }
          else { sendToWs(ws, { type: 'gateway_error', code: 'INVALID_MESSAGE', message: 'First message must be peer_hello' } satisfies GatewayErrorMessage); ws.close(); }
          return;
        }
        handlePeerMessage(peerSessionId, message);
      } catch (error) {
        console.error('[Gateway] Message parse error:', error);
        sendToWs(ws, { type: 'gateway_error', code: 'INVALID_MESSAGE', message: 'Invalid message format' } satisfies GatewayErrorMessage);
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimeout);
      const count = wsConnectionsPerIp.get(ip) || 1;
      if (count <= 1) wsConnectionsPerIp.delete(ip); else wsConnectionsPerIp.set(ip, count - 1);
      if (peerSessionId) handlePeerDisconnect(peerSessionId);
    });
    ws.on('error', (error) => { console.error('[Gateway] WebSocket error:', error); });
  });

  wss.on('close', () => { clearInterval(pingInterval); clearInterval(leaseCheckInterval); clearInterval(rateLimitCleanup); state.destroy(); storage.close(); });

  // ========================================================================
  // Peer Hello
  // ========================================================================

  function handlePeerHello(ws: WebSocket, message: PeerHelloMessage): string | null {
    if (!safeCompare(message.gatewaySecret, config.gatewaySecret)) {
      sendToWs(ws, { type: 'gateway_error', code: 'UNAUTHORIZED', message: 'Invalid gateway secret' } satisfies GatewayErrorMessage); ws.close(); return null;
    }
    if (message.protocolVersion !== 2) {
      sendToWs(ws, { type: 'gateway_error', code: 'PROTOCOL_VERSION_MISMATCH', message: `Expected protocol version 2, got ${message.protocolVersion}` } satisfies GatewayErrorMessage); ws.close(); return null;
    }
    const peerSessionId = uuidv4();
    const { identity, peerType } = message;
    const channel = identity.channel || 'prod';
    const peer: PeerSession = { peerSessionId, ws, peerType, deviceId: identity.deviceId, instanceId: identity.instanceId, channel, name: identity.name || '', isAlive: true, catalogSubscriptions: new Set(), channels: new Set() };

    let backendInfo: PeerReadyMessage['backend'] | undefined;
    if (peerType === 'client+backend' && message.backend) {
      const backendId = storage.getOrCreateBackendIdByInstance(identity.instanceId, identity.deviceId, channel, identity.name);
      const epoch = storage.allocateEpoch();
      peer.backendId = backendId; peer.epoch = epoch;
      state.addLease({ backendId, epoch, peerSessionId, leaseTtlMs: state.config.defaultLeaseTtlMs, lastHeartbeatAt: Date.now(), leaseTimer: null });
      const presence: BackendPresence = { backendId, instanceId: identity.instanceId, deviceId: identity.deviceId, name: identity.name || '', channel, visible: message.backend.visible, capabilities: message.backend.capabilities, epoch, connectedAt: Date.now(), lastSeenAt: Date.now() };
      state.registryUpsert(presence);
      state.streamDemand.set(backendId, { channelCount: 0, active: false });
      backendInfo = { backendId, epoch, leaseTtlMs: state.config.defaultLeaseTtlMs };
    }

    state.addPeer(peer);
    const registrySync = buildRegistrySyncPayload(message.lastRegistryRevision);
    const ready: PeerReadyMessage = { type: 'peer_ready', protocolVersion: 2, peerSessionId, recoveryToken: config.gatewaySecret, backend: backendInfo, registrySync };
    sendToWs(ws, ready);

    if (peer.backendId) {
      broadcastRegistryEvent({ revision: state.registry.revision, op: 'upsert', item: state.registry.items.get(peer.backendId)! }, peerSessionId);
    }
    console.log(`[Gateway] Peer ${peerSessionId} connected (${peerType}, backend=${peer.backendId || 'none'})`);
    return peerSessionId;
  }

  // ========================================================================
  // Message Router
  // ========================================================================

  function handlePeerMessage(peerSessionId: string, message: any): void {
    const peer = state.peers.get(peerSessionId);
    if (!peer) return;
    switch (message.type) {
      case 'backend_heartbeat': handleBackendHeartbeat(peer, message); break;
      case 'catalog_snapshot': handleCatalogSnapshot(peer, message); break;
      case 'catalog_event': handleCatalogEvent(peer, message); break;
      case 'run_stream_event': handleBackendRunStreamEvent(peer, message); break;
      case 'resync_registry': handleResyncRegistry(peer, message); break;
      case 'subscribe_backend_catalog': handleSubscribeBackendCatalog(peer, message); break;
      case 'unsubscribe_backend_catalog': handleUnsubscribeBackendCatalog(peer, message); break;
      case 'open_backend_channel': handleOpenBackendChannel(peer, message); break;
      case 'close_backend_channel': handleCloseBackendChannel(peer, message); break;
      case 'open_session_stream': handleOpenSessionStream(peer, message); break;
      case 'close_session_stream': handleCloseSessionStream(peer, message); break;
      case 'catch_up_session_content': handleCatchUpSessionContent(peer, message); break;
      case 'http_proxy_response': handleHttpProxyResponse(message); break;
      case 'http_proxy_response_start': handleHttpProxyResponseStart(message); break;
      case 'http_proxy_response_chunk': handleHttpProxyResponseChunk(message); break;
      case 'http_proxy_response_end': handleHttpProxyResponseEnd(message); break;
      default: sendToWs(peer.ws, { type: 'gateway_error', code: 'INVALID_MESSAGE', message: `Unknown message type: ${message.type}` } satisfies GatewayErrorMessage);
    }
  }

  // ========================================================================
  // Backend Message Handlers
  // ========================================================================

  function handleBackendHeartbeat(peer: PeerSession, msg: BackendHeartbeatMessage): void {
    if (!peer.backendId || peer.epoch !== msg.epoch) return;
    const lease = state.leases.get(peer.backendId);
    if (!lease || lease.epoch !== msg.epoch) return;
    lease.lastHeartbeatAt = Date.now();
    const presence = state.registry.items.get(peer.backendId);
    if (presence) presence.lastSeenAt = Date.now();
    sendToWs(peer.ws, { type: 'heartbeat_ack', epoch: msg.epoch, streamDemand: state.getStreamDemand(peer.backendId) } satisfies HeartbeatAckMessage);
  }

  function handleCatalogSnapshot(peer: PeerSession, msg: CatalogSnapshotMessage): void {
    if (!peer.backendId || peer.epoch !== msg.epoch) return;
    state.setCatalogSnapshot(peer.backendId, msg.epoch, msg.revision, msg.items);
    const catalog = state.catalogs.get(peer.backendId);
    if (!catalog) return;
    const snapshot: BackendCatalogSnapshotMessage = { type: 'backend_catalog_snapshot', backendId: peer.backendId, epoch: msg.epoch, revision: msg.revision, items: msg.items };
    for (const sub of catalog.subscribers) { const p = state.peers.get(sub); if (p) sendToWs(p.ws, snapshot); }
  }

  function handleCatalogEvent(peer: PeerSession, msg: CatalogEventMessage): void {
    if (!peer.backendId || peer.epoch !== msg.epoch) return;
    let catalog: ReturnType<typeof state.catalogUpsert>;
    if (msg.op === 'upsert') catalog = state.catalogUpsert(peer.backendId, msg.epoch, msg.revision, msg.item);
    else catalog = state.catalogRemove(peer.backendId, msg.epoch, msg.revision, msg.sessionId);
    if (!catalog) return;
    const event: BackendCatalogEventMessage = msg.op === 'upsert'
      ? { type: 'backend_catalog_event', backendId: peer.backendId, epoch: msg.epoch, revision: msg.revision, op: 'upsert', item: msg.item }
      : { type: 'backend_catalog_event', backendId: peer.backendId, epoch: msg.epoch, revision: msg.revision, op: 'remove', sessionId: msg.sessionId };
    for (const sub of catalog.subscribers) { const p = state.peers.get(sub); if (p) sendToWs(p.ws, event); }
  }

  function handleBackendRunStreamEvent(peer: PeerSession, msg: BackendRunStreamEvent): void {
    if (!peer.backendId) return;
    for (const channel of state.channels.values()) {
      if (channel.backendId === peer.backendId && channel.openStreams.has(msg.sessionId)) {
        const clientEvent: RunStreamEvent = { type: 'run_stream_event', eventType: msg.eventType, channelId: channel.channelId, sessionId: msg.sessionId, runId: msg.runId, seq: msg.seq, payload: msg.payload };
        const clientPeer = state.peers.get(channel.peerSessionId);
        if (clientPeer) sendToWs(clientPeer.ws, clientEvent);
      }
    }
  }

  // ========================================================================
  // Client Message Handlers
  // ========================================================================

  function handleResyncRegistry(peer: PeerSession, msg: ResyncRegistryMessage): void {
    const sync = buildRegistrySyncPayload(msg.lastRevision);
    if (sync.mode === 'snapshot') sendToWs(peer.ws, { type: 'registry_snapshot', revision: sync.revision, items: sync.items } satisfies RegistrySnapshotMessage);
    else sendToWs(peer.ws, { type: 'registry_delta', fromRevision: sync.fromRevision, toRevision: sync.toRevision, events: sync.events } satisfies RegistryDeltaMessage);
  }

  function handleSubscribeBackendCatalog(peer: PeerSession, msg: SubscribeBackendCatalogMessage): void {
    const catalog = state.catalogs.get(msg.backendId);
    if (!catalog || catalog.epoch !== msg.expectedEpoch) {
      sendToWs(peer.ws, { type: 'gateway_error', code: 'BACKEND_EPOCH_MISMATCH', message: `Backend ${msg.backendId} not found or epoch mismatch`, recovery: 'resync_registry' } satisfies GatewayErrorMessage);
      return;
    }
    state.addCatalogSubscriber(msg.backendId, peer.peerSessionId);
    peer.catalogSubscriptions.add(msg.backendId);
    if (msg.lastRevision !== undefined) {
      const delta = state.getCatalogDelta(msg.backendId, msg.lastRevision);
      if (delta && delta.length > 0) {
        sendToWs(peer.ws, { type: 'backend_catalog_delta', backendId: msg.backendId, epoch: catalog.epoch, fromRevision: msg.lastRevision, toRevision: catalog.revision, events: delta } satisfies BackendCatalogDeltaMessage);
        return;
      }
    }
    sendToWs(peer.ws, { type: 'backend_catalog_snapshot', backendId: msg.backendId, epoch: catalog.epoch, revision: catalog.revision, items: Array.from(catalog.items.values()) } satisfies BackendCatalogSnapshotMessage);
  }

  function handleUnsubscribeBackendCatalog(peer: PeerSession, msg: UnsubscribeBackendCatalogMessage): void {
    const catalog = state.catalogs.get(msg.backendId);
    if (catalog && catalog.epoch === msg.expectedEpoch) state.removeCatalogSubscriber(msg.backendId, peer.peerSessionId);
    peer.catalogSubscriptions.delete(msg.backendId);
  }

  function handleOpenBackendChannel(peer: PeerSession, msg: OpenBackendChannelMessage): void {
    const existing = state.findChannel(peer.peerSessionId, msg.backendId);
    if (existing) {
      const lease = state.leases.get(msg.backendId);
      sendToWs(peer.ws, { type: 'backend_channel_opened', backendId: msg.backendId, epoch: lease?.epoch ?? 0, channelId: existing.channelId, capabilities: [] } satisfies BackendChannelOpenedMessage);
      return;
    }
    const lease = state.leases.get(msg.backendId);
    if (!lease) { sendToWs(peer.ws, { type: 'backend_channel_rejected', backendId: msg.backendId, reason: 'offline' } satisfies BackendChannelRejectedMessage); return; }
    if (lease.epoch !== msg.expectedEpoch) { sendToWs(peer.ws, { type: 'backend_channel_rejected', backendId: msg.backendId, reason: 'epoch_mismatch' } satisfies BackendChannelRejectedMessage); return; }
    const channelId = uuidv4();
    const channel: ChannelState = { channelId, backendId: msg.backendId, epoch: lease.epoch, peerSessionId: peer.peerSessionId, openStreams: new Set() };
    state.addChannel(channel);
    if (state.getStreamDemand(msg.backendId)) {
      const bp = findBackendPeer(msg.backendId);
      if (bp) sendToWs(bp.ws, { type: 'stream_demand', active: true } satisfies StreamDemandMessage);
    }
    sendToWs(peer.ws, { type: 'backend_channel_opened', backendId: msg.backendId, epoch: lease.epoch, channelId, capabilities: state.registry.items.get(msg.backendId)?.capabilities ?? [] } satisfies BackendChannelOpenedMessage);
  }

  function handleCloseBackendChannel(peer: PeerSession, msg: CloseBackendChannelMessage): void {
    const channel = state.channels.get(msg.channelId);
    if (!channel || channel.peerSessionId !== peer.peerSessionId) return;
    const backendId = channel.backendId;
    state.removeChannel(msg.channelId);
    sendToWs(peer.ws, { type: 'backend_channel_closed', channelId: msg.channelId, backendId, reason: 'client_closed' } satisfies BackendChannelClosedMessage);
    if (!state.getStreamDemand(backendId)) {
      const bp = findBackendPeer(backendId);
      if (bp) sendToWs(bp.ws, { type: 'stream_demand', active: false } satisfies StreamDemandMessage);
    }
  }

  function handleOpenSessionStream(peer: PeerSession, msg: OpenSessionStreamMessage): void {
    const channel = state.channels.get(msg.channelId);
    if (!channel || channel.peerSessionId !== peer.peerSessionId) {
      sendToWs(peer.ws, { type: 'gateway_error', code: 'BACKEND_CHANNEL_NOT_FOUND', message: 'Channel not found', recovery: 'reopen_channel' } satisfies GatewayErrorMessage); return;
    }
    channel.openStreams.add(msg.sessionId);
  }

  function handleCloseSessionStream(peer: PeerSession, msg: CloseSessionStreamMessage): void {
    const channel = state.channels.get(msg.channelId);
    if (!channel || channel.peerSessionId !== peer.peerSessionId) return;
    channel.openStreams.delete(msg.sessionId);
    sendToWs(peer.ws, { type: 'session_stream_closed', channelId: msg.channelId, sessionId: msg.sessionId, reason: 'client_closed' } satisfies SessionStreamClosedMessage);
  }

  function handleCatchUpSessionContent(peer: PeerSession, msg: CatchUpSessionContentMessage): void {
    const channel = state.channels.get(msg.channelId);
    if (!channel || channel.peerSessionId !== peer.peerSessionId) {
      sendToWs(peer.ws, { type: 'gateway_error', code: 'BACKEND_CHANNEL_NOT_FOUND', message: 'Channel not found', recovery: 'reopen_channel' } satisfies GatewayErrorMessage); return;
    }
    const bp = findBackendPeer(channel.backendId);
    if (!bp) { sendToWs(peer.ws, { type: 'gateway_error', code: 'BACKEND_OFFLINE', message: 'Backend offline', recovery: 'reconnect' } satisfies GatewayErrorMessage); return; }
    sendToWs(bp.ws, { type: 'catch_up_session_content', channelId: msg.channelId, sessionId: msg.sessionId, afterOffset: msg.afterOffset });
  }

  // ========================================================================
  // HTTP Proxy Response Handlers
  // ========================================================================

  function handleHttpProxyResponse(msg: GatewayHttpProxyResponse): void {
    const pending = pendingHttpRequests.get(msg.requestId);
    if (pending) { clearTimeout(pending.timeout); pendingHttpRequests.delete(msg.requestId); pending.resolve(msg); }
  }
  function handleHttpProxyResponseStart(msg: GatewayHttpProxyResponseStart): void {
    const pending = pendingHttpRequests.get(msg.requestId);
    if (!pending?.res) return;
    clearTimeout(pending.timeout); pendingHttpRequests.delete(msg.requestId);
    const res = pending.res;
    if (msg.headers) { for (const [key, value] of Object.entries(msg.headers)) res.setHeader(key, value); }
    res.status(msg.statusCode);
    const streamTimeout = setTimeout(() => { pendingStreamingRequests.delete(msg.requestId); if (!res.writableEnded) res.end(); }, 60_000);
    pendingStreamingRequests.set(msg.requestId, { res, resolve: pending.resolve as unknown as () => void, timeout: streamTimeout });
    pending.resolve(null);
  }
  function handleHttpProxyResponseChunk(msg: GatewayHttpProxyResponseChunk): void {
    const streaming = pendingStreamingRequests.get(msg.requestId);
    if (!streaming) return;
    clearTimeout(streaming.timeout);
    streaming.timeout = setTimeout(() => { pendingStreamingRequests.delete(msg.requestId); if (!streaming.res.writableEnded) streaming.res.end(); }, 60_000);
    streaming.res.write(Buffer.from(msg.data, 'base64'));
  }
  function handleHttpProxyResponseEnd(msg: GatewayHttpProxyResponseEnd): void {
    const streaming = pendingStreamingRequests.get(msg.requestId);
    if (!streaming) return;
    clearTimeout(streaming.timeout); pendingStreamingRequests.delete(msg.requestId);
    if (!streaming.res.writableEnded) streaming.res.end(); streaming.resolve();
  }

  // ========================================================================
  // Lease & Cleanup
  // ========================================================================

  function handleBackendLeaseExpired(backendId: string): void {
    const lease = state.leases.get(backendId);
    if (!lease) return;
    const peer = state.peers.get(lease.peerSessionId);
    notifyChannelsClosed(backendId, 'backend_offline');
    state.registryRemove(backendId);
    broadcastRegistryEvent({ revision: state.registry.revision, op: 'remove', backendId });
    const catalog = state.catalogs.get(backendId);
    if (catalog) { for (const sub of catalog.subscribers) { const p = state.peers.get(sub); if (p) sendToWs(p.ws, { type: 'backend_catalog_reset', backendId, epoch: lease.epoch } satisfies BackendCatalogResetMessage); } }
    state.removeBackend(backendId);
    if (peer) { peer.backendId = undefined; peer.epoch = undefined; peer.ws.terminate(); state.removePeer(peer.peerSessionId); }
  }

  function handlePeerDisconnect(peerSessionId: string): void {
    const peer = state.peers.get(peerSessionId);
    if (!peer) return;
    console.log(`[Gateway] Peer ${peerSessionId} disconnected`);
    if (peer.backendId) {
      notifyChannelsClosed(peer.backendId, 'backend_offline');
      state.registryRemove(peer.backendId);
      broadcastRegistryEvent({ revision: state.registry.revision, op: 'remove', backendId: peer.backendId });
      const catalog = state.catalogs.get(peer.backendId);
      if (catalog) { for (const sub of catalog.subscribers) { if (sub === peerSessionId) continue; const p = state.peers.get(sub); if (p) sendToWs(p.ws, { type: 'backend_catalog_reset', backendId: peer.backendId, epoch: peer.epoch! } satisfies BackendCatalogResetMessage); } }
    }
    for (const channelId of peer.channels) {
      const channel = state.channels.get(channelId);
      if (channel) {
        state.removeChannel(channelId);
        if (!state.getStreamDemand(channel.backendId)) { const bp = findBackendPeer(channel.backendId); if (bp) sendToWs(bp.ws, { type: 'stream_demand', active: false } satisfies StreamDemandMessage); }
      }
    }
    peer.ws.terminate();
    state.removePeer(peerSessionId);
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  function buildRegistrySyncPayload(lastRevision?: number): RegistrySyncPayload {
    if (lastRevision !== undefined && lastRevision > 0) {
      const delta = state.getRegistryDelta(lastRevision);
      if (delta && delta.length > 0) return { mode: 'delta', fromRevision: lastRevision, toRevision: state.registry.revision, events: delta };
    }
    return { mode: 'snapshot', revision: state.registry.revision, items: Array.from(state.registry.items.values()) };
  }

  function broadcastRegistryEvent(event: RegistryEvent, excludePeerSessionId?: string): void {
    const msg: RegistryEventMessage = { type: 'registry_event', event };
    for (const peer of state.peers.values()) { if (peer.peerSessionId !== excludePeerSessionId) sendToWs(peer.ws, msg); }
  }

  function notifyChannelsClosed(backendId: string, reason: BackendChannelClosedMessage['reason']): void {
    for (const [channelId, channel] of state.channels) {
      if (channel.backendId === backendId) {
        const clientPeer = state.peers.get(channel.peerSessionId);
        if (clientPeer) {
          for (const sessionId of channel.openStreams) sendToWs(clientPeer.ws, { type: 'session_stream_closed', channelId, sessionId, reason: reason === 'backend_offline' ? 'backend_offline' : 'channel_closed' } satisfies SessionStreamClosedMessage);
          sendToWs(clientPeer.ws, { type: 'backend_channel_closed', channelId, backendId, reason } satisfies BackendChannelClosedMessage);
        }
        state.removeChannel(channelId);
      }
    }
  }

  function findBackendPeer(backendId: string): PeerSession | undefined {
    const lease = state.leases.get(backendId);
    if (!lease) return undefined;
    return state.peers.get(lease.peerSessionId);
  }

  return httpServer;
}
