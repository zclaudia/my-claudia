import { createServer as createHttpServer, IncomingMessage, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import type {
  GatewayBackendInfo,
  GatewayConnectBackendMessage,
  GatewaySendToBackendMessage,
  GatewayUpdateSubscriptionsMessage,
  GatewayToPeerMessage,
  BackendToGatewayMessage,
  PeerHelloMessage,
  PeerHelloResultMessage,
  GatewayHttpProxyRequest,
  GatewayHttpProxyResponse,
  GatewayHttpProxyResponseStart,
  GatewayHttpProxyResponseChunk,
  GatewayHttpProxyResponseEnd,
  BackendRegistryEntry,
  BackendSessionEventMessage,
  GatewayRegistrySnapshotMessage,
  GatewayRegistryUpsertMessage,
  GatewayRegistryRemoveMessage,
} from '@my-claudia/shared';
import { GatewayStorage } from './storage.js';

interface GatewayConfig {
  gatewaySecret: string;
}

// Connected backend
interface ConnectedBackend {
  id: string;           // Internal connection ID
  backendId: string;    // Public backendId for routing
  deviceId: string;     // Device ID from registration
  instanceId: string;   // Instance ID (distinguishes prod/dev on same device)
  channel: string;      // 'prod' | 'dev' | string
  name: string;         // Display name
  ws: WebSocket;
  visible: boolean;     // Whether this backend appears in backends_list for others
  registeredAt: number; // Timestamp when first registered
}

// Connected client
interface ConnectedClient {
  id: string;           // clientId
  ws: WebSocket;
  authenticated: boolean;  // Gateway auth status
  backendAuths: Set<string>;  // backendIds this client is authenticated to
  explicitSubscriptions: Set<string> | null;  // null = subscribe to all, Set = explicit list
  peerId?: string;      // If this client belongs to a peer connection
}

// Connected peer (single connection with both client + backend capabilities)
interface ConnectedPeer {
  peerId: string;
  ws: WebSocket;
  isAlive: boolean;
  capabilities: {
    client: boolean;
    backend: boolean;
  };
  backendId?: string;   // Set if peer has backend capability
  clientId?: string;    // Set if peer has client capability
}

/** Timing-safe string comparison to prevent timing attacks */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time even on length mismatch
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createGatewayServer(config: GatewayConfig): Server {
  const storage = new GatewayStorage();
  const backends = new Map<string, ConnectedBackend>();  // backendId -> backend
  const clients = new Map<string, ConnectedClient>();    // clientId -> client
  const backendConnections = new Map<WebSocket, ConnectedBackend>();  // ws -> backend (for lookup)
  const backendSubscriptions = new Map<string, Set<string>>();  // backendId -> Set<clientId> (subscription tracking)
  const peers = new Map<string, ConnectedPeer>();  // peerId -> peer (Phase 3: single connection)

  // Pending HTTP proxy requests: requestId -> { resolve, reject, timeout, res }
  const pendingHttpRequests = new Map<string, {
    resolve: (response: GatewayHttpProxyResponse | null) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    res: Response;
  }>();

  // In-progress streaming proxy responses
  const pendingStreamingRequests = new Map<string, {
    res: Response;
    resolve: () => void;
    timeout: NodeJS.Timeout;
  }>();

  // Rate limiting: IP -> { attempts, resetAt }
  const authAttempts = new Map<string, { count: number; resetAt: number }>();
  const AUTH_RATE_LIMIT = 10;       // max attempts per window
  const AUTH_RATE_WINDOW = 60_000;  // 1 minute

  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = authAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      authAttempts.set(ip, { count: 1, resetAt: now + AUTH_RATE_WINDOW });
      return true;
    }
    entry.count++;
    return entry.count <= AUTH_RATE_LIMIT;
  }

  // Cleanup stale rate limit entries every 5 minutes
  const rateLimitCleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of authAttempts) {
      if (now > entry.resetAt) authAttempts.delete(ip);
    }
  }, 5 * 60_000);

  // Create Express app
  const app = express();
  app.disable('x-powered-by');

  // CORS — allow desktop/web clients from any origin.
  // Real security is enforced by gateway secret + per-backend API key, not origin.
  app.use((req: Request, res: Response, next: () => void) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '15mb' }));


  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', backends: backends.size, clients: clients.size });
  });

  /** Middleware: validate gateway secret from Authorization header.
   *  Accepts both "Bearer gatewaySecret" and "Bearer clientId:gatewaySecret" formats. */
  function requireGatewayAuth(req: Request, res: Response, next: () => void): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authorization required' } });
      return;
    }
    const token = authHeader.slice(7);
    // Support "clientId:gatewaySecret" format (desktop app sends this in gateway mode)
    const colonIndex = token.indexOf(':');
    const secret = colonIndex !== -1 ? token.slice(colonIndex + 1) : token;
    if (!safeCompare(secret, config.gatewaySecret)) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });
      return;
    }
    next();
  }

  // HTTP Proxy endpoint: forwards REST API requests to backends via WS
  // Auth format: Bearer gatewaySecret:apiKey
  app.all('/api/proxy/:backendId/*', async (req: Request, res: Response) => {
    try {
      const { backendId } = req.params;
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

      // Parse authorization header: Bearer gatewaySecret
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        checkRateLimit(clientIp);
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authorization required' }
        });
        return;
      }

      const token = authHeader.slice(7);
      // Support both "Bearer secret" and legacy "Bearer secret:apiKey" format
      const colonIndex = token.indexOf(':');
      const gatewaySecret = colonIndex !== -1 ? token.slice(0, colonIndex) : token;

      // Validate gateway secret (timing-safe)
      if (!safeCompare(gatewaySecret, config.gatewaySecret)) {
        // Rate limit only failed auth attempts to prevent brute-force
        if (!checkRateLimit(clientIp)) {
          res.status(429).json({
            success: false,
            error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' }
          });
          return;
        }
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' }
        });
        return;
      }

      // Find backend
      const backend = backends.get(backendId);
      if (!backend) {
        res.status(502).json({
          success: false,
          error: { code: 'BACKEND_OFFLINE', message: 'Backend not found or offline' }
        });
        return;
      }

      // Extract the path after /api/proxy/:backendId (including query string)
      const basePath = '/' + (req.params as any)[0];
      const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const targetPath = basePath + queryString;

      // Construct proxy request
      const requestId = uuidv4();
      const proxyRequest: GatewayHttpProxyRequest = {
        type: 'http_proxy_request',
        requestId,
        method: req.method,
        path: targetPath,
        headers: {
          'Content-Type': 'application/json'
        },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body)
      };

      // Send request to backend via WS and wait for response
      // resolve(null) means streaming handled the response directly
      const responsePromise = new Promise<GatewayHttpProxyResponse | null>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingHttpRequests.delete(requestId);
          reject(new Error('Backend request timed out'));
        }, 60000); // 60s initial timeout (backend needs time to fetch + start streaming)

        pendingHttpRequests.set(requestId, { resolve, reject, timeout, res });
      });

      // Forward to backend
      if (backend.ws.readyState === WebSocket.OPEN) {
        backend.ws.send(JSON.stringify(proxyRequest));
      } else {
        res.status(502).json({
          success: false,
          error: { code: 'BACKEND_OFFLINE', message: 'Backend connection lost' }
        });
        pendingHttpRequests.delete(requestId);
        return;
      }

      // Wait for response (or null if streaming handled it)
      const proxyResponse = await responsePromise;

      if (proxyResponse) {
        // Single-message response: forward headers + body
        res.status(proxyResponse.statusCode);
        for (const [key, value] of Object.entries(proxyResponse.headers)) {
          if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
            res.setHeader(key, value);
          }
        }
        res.send(proxyResponse.body);
      }
      // If null, streaming already handled the response via res.write()/res.end()

    } catch (error) {
      // Don't send error if headers already sent (streaming in progress)
      if (res.headersSent) {
        console.error('[Gateway] HTTP proxy error during streaming:', error);
        res.end();
        return;
      }
      if ((error as Error).message === 'Backend request timed out') {
        res.status(504).json({
          success: false,
          error: { code: 'TIMEOUT', message: 'Backend request timed out' }
        });
      } else {
        console.error('[Gateway] HTTP proxy error:', error);
        res.status(500).json({
          success: false,
          error: { code: 'PROXY_ERROR', message: 'Failed to proxy request' }
        });
      }
    }
  });

  // Catch-all 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  // Global error handler — prevents stack trace leakage
  app.use((err: Error, _req: Request, res: Response, _next: () => void) => {
    console.error('[Gateway] Unhandled error:', err);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  // Per-IP WebSocket connection tracking
  const wsConnectionsPerIp = new Map<string, number>();
  const MAX_WS_CONNECTIONS_PER_IP = 10;

  // Create HTTP server from Express app
  const httpServer = createHttpServer(app);

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 50 * 1024 * 1024 // 50MB max WebSocket message size (chunked proxy sends ~5.5MB per chunk)
  });

  // Ping interval for connection health
  const pingInterval = setInterval(() => {
    peers.forEach((peer, peerId) => {
      if (!peer.isAlive) {
        console.log(`Peer ${peerId} disconnected (ping timeout)`);
        handlePeerDisconnect(peerId);
        return;
      }
      peer.isAlive = false;
      peer.ws.ping();
    });
  }, 30000);

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Per-IP connection limit
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
      || req.socket.remoteAddress || 'unknown';
    const currentCount = wsConnectionsPerIp.get(ip) || 0;
    if (currentCount >= MAX_WS_CONNECTIONS_PER_IP) {
      ws.close(1008, 'Too many connections');
      return;
    }
    wsConnectionsPerIp.set(ip, currentCount + 1);

    // Wait for peer_hello to determine connection capabilities
    let connectionType: 'peer' | null = null;
    let connectionId: string | null = null;

    // Close unauthenticated connections after 10 seconds
    const authTimeout = setTimeout(() => {
      if (!connectionType) {
        ws.close(1008, 'Authentication timeout');
      }
    }, 10_000);

    ws.on('pong', () => {
      if (connectionType === 'peer' && connectionId) {
        const peer = peers.get(connectionId);
        if (peer) peer.isAlive = true;
      }
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // First message must be peer_hello
        if (!connectionType) {
          clearTimeout(authTimeout);
          if (message.type === 'peer_hello') {
            connectionType = 'peer';
            connectionId = handlePeerHello(ws, message as PeerHelloMessage);
          } else {
            sendToWs(ws, {
              type: 'gateway_error',
              code: 'INVALID_FIRST_MESSAGE',
              message: 'First message must be peer_hello'
            });
            ws.close();
          }
          return;
        }

        // Handle subsequent messages
        if (connectionType === 'peer' && connectionId) {
          handlePeerMessage(connectionId, message);
        }
      } catch (error) {
        console.error('Error handling message:', error);
        sendToWs(ws, {
          type: 'gateway_error',
          code: 'INVALID_MESSAGE',
          message: 'Invalid message format'
        });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      // Decrement per-IP connection count
      const count = wsConnectionsPerIp.get(ip) || 1;
      if (count <= 1) {
        wsConnectionsPerIp.delete(ip);
      } else {
        wsConnectionsPerIp.set(ip, count - 1);
      }

      if (connectionType === 'peer' && connectionId) {
        handlePeerDisconnect(connectionId);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  wss.on('close', () => {
    clearInterval(pingInterval);
    clearInterval(rateLimitCleanup);
    storage.close();
  });

  // --- Backend handlers ---

  function handleBackendMessage(backendId: string, message: BackendToGatewayMessage): void {
    const backend = backends.get(backendId);
    if (!backend) return;

    switch (message.type) {
      case 'client_auth_result': {
        // Forward auth result to client
        const client = clients.get(message.clientId);
        if (client) {
          if (message.success) {
            client.backendAuths.add(backendId);

            // Auto-subscribe if client has no explicit preferences or explicitly includes this backend
            const shouldSubscribe = client.explicitSubscriptions === null ||
              client.explicitSubscriptions.has(backendId);

            if (shouldSubscribe) {
              if (!backendSubscriptions.has(backendId)) {
                backendSubscriptions.set(backendId, new Set());
              }
              backendSubscriptions.get(backendId)!.add(message.clientId);
              console.log(`[Gateway] Client ${message.clientId} subscribed to backend ${backendId}`);

              // Notify backend about new subscriber
              sendToWs(backend.ws, {
                type: 'client_subscribed',
                clientId: message.clientId
              });
            } else {
              console.log(`[Gateway] Client ${message.clientId} authenticated to backend ${backendId} but not subscribed (explicit filter)`);
            }
          }
          sendToWs(client.ws, {
            type: 'backend_auth_result',
            backendId,
            success: message.success,
            error: message.error,
            features: message.features,
          });
        }
        break;
      }

      case 'backend_response': {
        // Forward response to client
        const client = clients.get(message.clientId);
        if (client) {
          sendToWs(client.ws, {
            type: 'backend_message',
            backendId,
            message: message.message
          });
        }
        break;
      }

      case 'http_proxy_response': {
        // Single-message response (small text/JSON payloads)
        const proxyMsg = message as GatewayHttpProxyResponse;
        const pending = pendingHttpRequests.get(proxyMsg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingHttpRequests.delete(proxyMsg.requestId);
          pending.resolve(proxyMsg);
        }
        break;
      }

      case 'http_proxy_response_start': {
        // Streaming response: set headers and transition to streaming state
        const startMsg = message as GatewayHttpProxyResponseStart;
        const pending = pendingHttpRequests.get(startMsg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingHttpRequests.delete(startMsg.requestId);

          // Set HTTP status + headers immediately
          pending.res.status(startMsg.statusCode);
          for (const [key, value] of Object.entries(startMsg.headers)) {
            if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
              pending.res.setHeader(key, value);
            }
          }

          // Move to streaming state with per-chunk timeout
          const chunkTimeout = setTimeout(() => {
            console.warn(`[Gateway] Streaming timeout for request ${startMsg.requestId}`);
            pendingStreamingRequests.delete(startMsg.requestId);
            pending.res.end();
            pending.resolve(null);
          }, 60000);

          pendingStreamingRequests.set(startMsg.requestId, {
            res: pending.res,
            resolve: () => pending.resolve(null),
            timeout: chunkTimeout,
          });
        }
        break;
      }

      case 'http_proxy_response_chunk': {
        // Streaming response: write decoded chunk to HTTP response
        const chunkMsg = message as GatewayHttpProxyResponseChunk;
        const streaming = pendingStreamingRequests.get(chunkMsg.requestId);
        if (streaming) {
          // Reset per-chunk timeout
          clearTimeout(streaming.timeout);
          streaming.timeout = setTimeout(() => {
            console.warn(`[Gateway] Streaming chunk timeout for request ${chunkMsg.requestId}`);
            pendingStreamingRequests.delete(chunkMsg.requestId);
            streaming.res.end();
            streaming.resolve();
          }, 60000);

          const buffer = Buffer.from(chunkMsg.data, 'base64');
          streaming.res.write(buffer);
        }
        break;
      }

      case 'http_proxy_response_end': {
        // Streaming response: finalize
        const endMsg = message as GatewayHttpProxyResponseEnd;
        const streaming = pendingStreamingRequests.get(endMsg.requestId);
        if (streaming) {
          clearTimeout(streaming.timeout);
          pendingStreamingRequests.delete(endMsg.requestId);
          streaming.res.end();
          streaming.resolve();
        }
        break;
      }

      case 'broadcast_session_event': {
        // Broadcast session event to all subscribed clients
        const subscribers = backendSubscriptions.get(backendId);
        if (!subscribers || subscribers.size === 0) {
          console.log(`[Gateway] No subscribers for backend ${backendId}`);
          break;
        }

        // Forward event to all subscribed clients
        const sessionEventMsg: BackendSessionEventMessage = {
          type: 'backend_session_event',
          backendId,
          eventType: message.eventType,
          session: message.session,
        };
        subscribers.forEach((clientId) => {
          const client = clients.get(clientId);
          if (client && client.ws.readyState === WebSocket.OPEN) {
            sendToWs(client.ws, {
              type: 'backend_message',
              backendId,
              message: sessionEventMsg
            });
          }
        });

        console.log(`[Gateway] Broadcasted ${message.eventType} event for session ${message.session.id} to ${subscribers.size} clients`);
        break;
      }

      case 'broadcast_to_subscribers': {
        // Broadcast message to all subscribed clients for this backend
        const subscribers = backendSubscriptions.get(backendId);
        if (!subscribers || subscribers.size === 0) break;

        for (const clientId of subscribers) {
          const client = clients.get(clientId);
          if (client?.ws.readyState === WebSocket.OPEN) {
            sendToWs(client.ws, {
              type: 'backend_message',
              backendId,
              message: message.message
            });
          }
        }
        break;
      }
    }
  }

  /**
   * Clean up backend state without terminating the WebSocket.
   * Returns the instanceId for registry broadcast, or null if backend not found.
   */
  function cleanupBackend(backendId: string): string | null {
    const backend = backends.get(backendId);
    if (!backend) return null;

    const { instanceId } = backend;
    console.log(`Backend disconnected: ${backendId} (instance=${instanceId})`);

    // Notify all clients that were connected to this backend
    clients.forEach((client) => {
      if (client.backendAuths.has(backendId)) {
        sendToWs(client.ws, {
          type: 'backend_disconnected',
          backendId
        });
        client.backendAuths.delete(backendId);
      }
    });

    backendConnections.delete(backend.ws);
    backends.delete(backendId);

    // Broadcast registry remove to all peers
    broadcastRegistryRemove(backendId, instanceId);

    return instanceId;
  }

  function handleBackendDisconnect(backendId: string): void {
    const backend = backends.get(backendId);
    if (!backend) return;
    cleanupBackend(backendId);
    backend.ws.terminate();
  }

  /** Build a GatewayBackendInfo from a ConnectedBackend (includes identity fields) */
  function buildBackendInfo(backend: ConnectedBackend): GatewayBackendInfo {
    return {
      backendId: backend.backendId,
      name: backend.name,
      online: true,
      instanceId: backend.instanceId,
      deviceId: backend.deviceId,
      channel: backend.channel,
    };
  }

  /** Build a BackendRegistryEntry from a ConnectedBackend */
  function buildRegistryEntry(backend: ConnectedBackend): BackendRegistryEntry {
    return {
      backendId: backend.backendId,
      instanceId: backend.instanceId,
      deviceId: backend.deviceId,
      channel: backend.channel,
      name: backend.name,
      visible: backend.visible,
      online: true,
      registeredAt: backend.registeredAt,
      updatedAt: Date.now(),
    };
  }

  /** Build full registry snapshot from all connected backends */
  function buildRegistrySnapshot(): BackendRegistryEntry[] {
    const entries: BackendRegistryEntry[] = [];
    backends.forEach((backend) => {
      entries.push(buildRegistryEntry(backend));
    });
    return entries;
  }

  /** Broadcast registry upsert to all authenticated peers */
  function broadcastRegistryUpsert(backend: ConnectedBackend): void {
    const msg: GatewayRegistryUpsertMessage = {
      type: 'registry_upsert',
      entry: buildRegistryEntry(backend),
    };
    backends.forEach((b) => sendToWs(b.ws, msg));
    clients.forEach((c) => {
      if (c.authenticated) sendToWs(c.ws, msg);
    });
  }

  /** Broadcast registry remove to all authenticated peers */
  function broadcastRegistryRemove(backendId: string, instanceId: string): void {
    const msg: GatewayRegistryRemoveMessage = {
      type: 'registry_remove',
      backendId,
      instanceId,
    };
    backends.forEach((b) => sendToWs(b.ws, msg));
    clients.forEach((c) => {
      if (c.authenticated) sendToWs(c.ws, msg);
    });
  }

  /** Send full registry snapshot to a specific WebSocket */
  function sendRegistrySnapshot(ws: WebSocket): void {
    const msg: GatewayRegistrySnapshotMessage = {
      type: 'registry_snapshot',
      registry: buildRegistrySnapshot(),
    };
    sendToWs(ws, msg);
  }

  // --- Client handlers ---

  function handleClientMessage(clientId: string, message: unknown): void {
    const client = clients.get(clientId);
    if (!client || !client.authenticated) return;

    const msg = message as { type: string };

    switch (msg.type) {
      case 'list_backends': {
        const backendList: GatewayBackendInfo[] = [];
        backends.forEach((backend) => {
          if (backend.visible) {
            backendList.push(buildBackendInfo(backend));
          }
        });
        sendToWs(client.ws, {
          type: 'backends_list',
          backends: backendList
        });
        break;
      }

      case 'connect_backend': {
        const connectMsg = message as GatewayConnectBackendMessage;
        const backend = backends.get(connectMsg.backendId);

        if (!backend) {
          sendToWs(client.ws, {
            type: 'backend_auth_result',
            backendId: connectMsg.backendId,
            success: false,
            error: 'Backend not found or offline'
          });
          return;
        }

        // Notify backend that a client wants to connect
        sendToWs(backend.ws, {
          type: 'client_connected',
          clientId
        });

        // Forward auth request to backend (no apiKey — backend trusts gateway)
        sendToWs(backend.ws, {
          type: 'client_auth',
          clientId
        });
        break;
      }

      case 'send_to_backend': {
        const sendMsg = message as GatewaySendToBackendMessage;

        // Check if client is authenticated to this backend
        if (!client.backendAuths.has(sendMsg.backendId)) {
          sendToWs(client.ws, {
            type: 'gateway_error',
            code: 'NOT_AUTHENTICATED',
            message: 'Not authenticated to this backend',
            backendId: sendMsg.backendId
          });
          return;
        }

        const backend = backends.get(sendMsg.backendId);
        if (!backend) {
          sendToWs(client.ws, {
            type: 'backend_disconnected',
            backendId: sendMsg.backendId
          });
          client.backendAuths.delete(sendMsg.backendId);
          return;
        }

        // Forward message to backend
        sendToWs(backend.ws, {
          type: 'forwarded',
          clientId,
          message: sendMsg.message
        });
        break;
      }

      case 'update_subscriptions': {
        const subMsg = message as GatewayUpdateSubscriptionsMessage;

        // Update explicit subscriptions
        if (subMsg.subscribeAll) {
          client.explicitSubscriptions = null;
        } else {
          client.explicitSubscriptions = new Set(subMsg.subscribedBackendIds);
        }

        // Reconcile backendSubscriptions map
        const subscribedSet = client.explicitSubscriptions;

        // For each backend the client is authenticated to, add/remove from subscription
        client.backendAuths.forEach((backendId) => {
          const shouldSubscribe = subscribedSet === null || subscribedSet.has(backendId);
          const subscribers = backendSubscriptions.get(backendId);
          const isCurrentlySubscribed = subscribers?.has(clientId) ?? false;

          if (shouldSubscribe && !isCurrentlySubscribed) {
            // New subscription
            if (!backendSubscriptions.has(backendId)) {
              backendSubscriptions.set(backendId, new Set());
            }
            backendSubscriptions.get(backendId)!.add(clientId);

            // Notify backend
            const backend = backends.get(backendId);
            if (backend) {
              sendToWs(backend.ws, {
                type: 'client_subscribed',
                clientId
              });
            }
            console.log(`[Gateway] Client ${clientId} subscribed to backend ${backendId}`);
          } else if (!shouldSubscribe && isCurrentlySubscribed) {
            // Unsubscribe
            subscribers?.delete(clientId);
            if (subscribers && subscribers.size === 0) {
              backendSubscriptions.delete(backendId);
            }
            console.log(`[Gateway] Client ${clientId} unsubscribed from backend ${backendId}`);
          }
        });

        // Send ack
        const ackIds = subscribedSet === null
          ? Array.from(client.backendAuths)
          : Array.from(subscribedSet);
        sendToWs(client.ws, {
          type: 'subscription_ack',
          subscribedBackendIds: ackIds
        });
        break;
      }

      default:
        sendToWs(client.ws, {
          type: 'gateway_error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: 'Unknown message type'
        });
    }
  }

  function handleClientDisconnect(clientId: string): void {
    const client = clients.get(clientId);
    if (!client) return;

    console.log(`Client disconnected: ${clientId}`);

    // Notify backends that this client disconnected
    client.backendAuths.forEach((backendId) => {
      const backend = backends.get(backendId);
      if (backend) {
        sendToWs(backend.ws, {
          type: 'client_disconnected',
          clientId
        });
      }
    });

    // Remove from all subscriptions
    backendSubscriptions.forEach((subscribers, backendId) => {
      if (subscribers.has(clientId)) {
        subscribers.delete(clientId);
        console.log(`[Gateway] Client ${clientId} unsubscribed from backend ${backendId}`);

        // Clean up empty subscription sets
        if (subscribers.size === 0) {
          backendSubscriptions.delete(backendId);
        }
      }
    });

    clients.delete(clientId);
  }

  // --- Peer capability helpers ---

  function registerBackendCapability(
    peerId: string,
    peer: ConnectedPeer,
    message: PeerHelloMessage,
    identity: PeerHelloMessage['identity'],
    channel: string,
    ws: WebSocket
  ): string {
    const visible = message.backend?.visible !== false;
    const instanceId = identity.instanceId;
    const backendId = storage.getOrCreateBackendIdByInstance(instanceId, identity.deviceId, channel, identity.name);

    // Check for existing backend with same backendId (e.g. legacy connection being replaced)
    const existingBackend = backends.get(backendId);
    if (existingBackend) {
      console.log(`Peer ${peerId} replacing existing backend ${backendId}`);
      const existingPeer = peers.get(existingBackend.id);
      if (existingPeer) {
        handlePeerDisconnect(existingPeer.peerId);
      } else {
        handleBackendDisconnect(backendId);
      }
    }

    const backend: ConnectedBackend = {
      id: peerId,
      backendId,
      deviceId: identity.deviceId,
      instanceId,
      channel,
      name: identity.name || `Backend ${backendId}`,
      ws,
      visible,
      registeredAt: Date.now(),
    };

    backends.set(backendId, backend);
    backendConnections.set(ws, backend);
    peer.backendId = backendId;

    console.log(`Peer ${peerId} registered as backend: ${backendId} (instance=${instanceId} channel=${channel}${visible ? '' : ' [hidden]'})`);

    // Broadcast registry upsert to all peers
    broadcastRegistryUpsert(backend);

    return backendId;
  }

  function registerClientCapability(
    peerId: string,
    peer: ConnectedPeer,
    ws: WebSocket
  ): string {
    const clientId = uuidv4();
    const client: ConnectedClient = {
      id: clientId,
      ws,
      authenticated: true,
      backendAuths: new Set(),
      explicitSubscriptions: null,
      peerId,
    };

    clients.set(clientId, client);
    peer.clientId = clientId;

    console.log(`Peer ${peerId} registered as client: ${clientId}`);

    return clientId;
  }

  // --- Peer handlers (Phase 3: Single Connection) ---

  function handlePeerHello(ws: WebSocket, message: PeerHelloMessage): string | null {
    // Validate gateway secret
    if (!safeCompare(message.gatewaySecret, config.gatewaySecret)) {
      sendToWs(ws, {
        type: 'peer_hello_result',
        success: false,
        peerId: '',
        clientConnected: false,
        backendRegistered: false,
        error: 'Invalid gateway secret'
      } satisfies PeerHelloResultMessage);
      ws.close();
      return null;
    }

    const peerId = message.peerId || uuidv4();
    const { capabilities, identity } = message;
    const channel = identity.channel || 'prod';

    const peer: ConnectedPeer = {
      peerId,
      ws,
      isAlive: true,
      capabilities,
    };

    // Handle existing peer reconnection
    const existingPeer = peers.get(peerId);
    if (existingPeer) {
      console.log(`Peer ${peerId} reconnecting, replacing old connection`);
      // Delete from peers FIRST to prevent the close event from triggering handlePeerDisconnect
      peers.delete(peerId);
      // Clean up old peer's backend/client entries (without terminating ws — we do it below)
      if (existingPeer.backendId) {
        cleanupBackend(existingPeer.backendId);
      }
      if (existingPeer.clientId) {
        handleClientDisconnect(existingPeer.clientId);
      }
      existingPeer.ws.terminate();
    }

    let backendId: string | undefined;
    let clientId: string | undefined;

    // Register backend capability
    if (capabilities.backend) {
      backendId = registerBackendCapability(peerId, peer, message, identity, channel, ws);
    }

    // Register client capability
    if (capabilities.client) {
      clientId = registerClientCapability(peerId, peer, ws);
    }

    peers.set(peerId, peer);

    // Build and send peer_hello_result
    const registrySnapshot = (capabilities.client || capabilities.backend) ? buildRegistrySnapshot() : undefined;

    sendToWs(ws, {
      type: 'peer_hello_result',
      success: true,
      peerId,
      clientConnected: capabilities.client,
      backendRegistered: capabilities.backend,
      backendId,
      registrySnapshot,
    } satisfies PeerHelloResultMessage);

    console.log(`Peer ${peerId} connected (client=${capabilities.client}, backend=${capabilities.backend})`);
    return peerId;
  }

  function handlePeerMessage(peerId: string, message: any): void {
    const peer = peers.get(peerId);
    if (!peer) return;

    // Route message based on type to appropriate handler
    switch (message.type) {
      // Backend capability messages
      case 'client_auth_result':
      case 'backend_response':
      case 'http_proxy_response':
      case 'http_proxy_response_start':
      case 'http_proxy_response_chunk':
      case 'http_proxy_response_end':
      case 'broadcast_session_event':
      case 'broadcast_to_subscribers':
        if (peer.backendId) {
          handleBackendMessage(peer.backendId, message as BackendToGatewayMessage);
        } else {
          sendToWs(peer.ws, {
            type: 'gateway_error',
            code: 'NO_BACKEND_CAPABILITY',
            message: `Message type '${message.type}' requires backend capability`
          });
        }
        break;

      // Client capability messages
      case 'list_backends':
      case 'connect_backend':
      case 'send_to_backend':
      case 'update_subscriptions':
        if (peer.clientId) {
          handleClientMessage(peer.clientId, message);
        } else {
          sendToWs(peer.ws, {
            type: 'gateway_error',
            code: 'NO_CLIENT_CAPABILITY',
            message: `Message type '${message.type}' requires client capability`
          });
        }
        break;

      default:
        sendToWs(peer.ws, {
          type: 'gateway_error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unknown message type: ${message.type}`
        });
    }
  }

  function handlePeerDisconnect(peerId: string): void {
    const peer = peers.get(peerId);
    if (!peer) return;

    console.log(`Peer ${peerId} disconnected`);

    // Clean up backend capability (without terminating ws — peer owns the lifecycle)
    if (peer.backendId) {
      const current = backends.get(peer.backendId);
      if (current && current.ws === peer.ws) {
        cleanupBackend(peer.backendId);
      }
    }

    // Clean up client capability
    if (peer.clientId) {
      handleClientDisconnect(peer.clientId);
    }

    peer.ws.terminate();
    peers.delete(peerId);
  }

  // --- Helpers ---

  function sendToWs(ws: WebSocket, message: GatewayToPeerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  return httpServer;
}
