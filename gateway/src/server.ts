import { createServer as createHttpServer, IncomingMessage, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import multer from 'multer';
import type {
  GatewayBackendInfo,
  GatewayRegisterMessage,
  GatewayAuthMessage,
  GatewayListBackendsMessage,
  GatewayConnectBackendMessage,
  GatewaySendToBackendMessage,
  GatewayUpdateSubscriptionsMessage,
  GatewayToBackendMessage,
  GatewayToClientMessage,
  BackendToGatewayMessage,
  GatewayHttpProxyRequest,
  GatewayHttpProxyResponse,
  ClientMessage,
  ServerMessage
} from '@my-claudia/shared';
import { GatewayStorage } from './storage.js';
import { fileStore } from './storage/fileStore.js';

interface GatewayConfig {
  gatewaySecret: string;
}

// Connected backend
interface ConnectedBackend {
  id: string;           // Internal connection ID
  backendId: string;    // Public backendId for routing
  deviceId: string;     // Device ID from registration
  name: string;         // Display name
  ws: WebSocket;
  isAlive: boolean;
  visible: boolean;     // Whether this backend appears in backends_list for others
}

// Connected client
interface ConnectedClient {
  id: string;           // clientId
  ws: WebSocket;
  isAlive: boolean;
  authenticated: boolean;  // Gateway auth status
  backendAuths: Set<string>;  // backendIds this client is authenticated to
  explicitSubscriptions: Set<string> | null;  // null = subscribe to all, Set = explicit list
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

  // Pending HTTP proxy requests: requestId -> { resolve, timeout }
  const pendingHttpRequests = new Map<string, {
    resolve: (response: GatewayHttpProxyResponse) => void;
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

  app.use(express.json({ limit: '1mb' }));

  // Configure multer for file upload
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB limit
    }
  });

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

  // POST /api/files/upload - Upload a file (requires gateway secret)
  app.post('/api/files/upload', requireGatewayAuth, upload.single('file'), (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: { code: 'NO_FILE', message: 'No file provided' }
        });
        return;
      }

      // Convert to base64
      const base64Data = req.file.buffer.toString('base64');

      // Store file
      const fileId = fileStore.storeFile(
        req.file.originalname,
        req.file.mimetype,
        base64Data
      );

      res.json({
        success: true,
        data: {
          fileId,
          name: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        }
      });
    } catch (error) {
      console.error('[Gateway] Error uploading file:', error);
      res.status(500).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: 'Failed to upload file' }
      });
    }
  });

  // GET /api/files/:fileId - Download a file (requires gateway secret)
  app.get('/api/files/:fileId', requireGatewayAuth, (req: Request, res: Response) => {
    try {
      const { fileId } = req.params;

      const file = fileStore.getFile(fileId);
      if (!file) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'File not found' }
        });
        return;
      }

      res.json({
        success: true,
        data: {
          fileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          data: file.data // base64
        }
      });
    } catch (error) {
      console.error('[Gateway] Error retrieving file:', error);
      res.status(500).json({
        success: false,
        error: { code: 'RETRIEVAL_ERROR', message: 'Failed to retrieve file' }
      });
    }
  });

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

      // Extract the path after /api/proxy/:backendId
      // req.params[0] contains the wildcard match (everything after *)
      const targetPath = '/' + (req.params as any)[0];

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
      const responsePromise = new Promise<GatewayHttpProxyResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingHttpRequests.delete(requestId);
          reject(new Error('Backend request timed out'));
        }, 30000);

        pendingHttpRequests.set(requestId, { resolve, timeout });
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

      // Wait for response
      const proxyResponse = await responsePromise;

      // Forward response to client
      res.status(proxyResponse.statusCode);
      for (const [key, value] of Object.entries(proxyResponse.headers)) {
        // Skip hop-by-hop headers
        if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      }
      res.send(proxyResponse.body);

    } catch (error) {
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
    maxPayload: 1 * 1024 * 1024 // 1MB max WebSocket message size
  });

  // Ping interval for connection health
  const pingInterval = setInterval(() => {
    backends.forEach((backend, backendId) => {
      if (!backend.isAlive) {
        console.log(`Backend ${backendId} disconnected (ping timeout)`);
        handleBackendDisconnect(backendId);
        return;
      }
      backend.isAlive = false;
      backend.ws.ping();
    });

    clients.forEach((client, clientId) => {
      if (!client.isAlive) {
        console.log(`Client ${clientId} disconnected (ping timeout)`);
        client.ws.terminate();
        clients.delete(clientId);
        return;
      }
      client.isAlive = false;
      client.ws.ping();
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

    // We don't know yet if this is a backend or client
    // Wait for the first message to determine
    let connectionType: 'backend' | 'client' | null = null;
    let connectionId: string | null = null;

    // Close unauthenticated connections after 10 seconds
    const authTimeout = setTimeout(() => {
      if (!connectionType) {
        ws.close(1008, 'Authentication timeout');
      }
    }, 10_000);

    ws.on('pong', () => {
      if (connectionType === 'backend' && connectionId) {
        const backend = backends.get(connectionId);
        if (backend) backend.isAlive = true;
      } else if (connectionType === 'client' && connectionId) {
        const client = clients.get(connectionId);
        if (client) client.isAlive = true;
      }
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // First message determines connection type
        if (!connectionType) {
          clearTimeout(authTimeout);
          if (message.type === 'register') {
            // This is a backend
            connectionType = 'backend';
            connectionId = handleBackendRegister(ws, message as GatewayRegisterMessage);
          } else if (message.type === 'gateway_auth') {
            // This is a client
            connectionType = 'client';
            connectionId = handleClientAuth(ws, message as GatewayAuthMessage);
          } else {
            // Unknown first message - reject
            sendToWs(ws, {
              type: 'gateway_error',
              code: 'INVALID_FIRST_MESSAGE',
              message: 'First message must be register (for backends) or gateway_auth (for clients)'
            });
            ws.close();
          }
          return;
        }

        // Handle subsequent messages based on connection type
        if (connectionType === 'backend' && connectionId) {
          handleBackendMessage(connectionId, message as BackendToGatewayMessage);
        } else if (connectionType === 'client' && connectionId) {
          handleClientMessage(connectionId, message);
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

      if (connectionType === 'backend' && connectionId) {
        handleBackendDisconnect(connectionId);
      } else if (connectionType === 'client' && connectionId) {
        handleClientDisconnect(connectionId);
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

  function handleBackendRegister(ws: WebSocket, message: GatewayRegisterMessage): string | null {
    // Validate gateway secret (timing-safe)
    if (!safeCompare(message.gatewaySecret, config.gatewaySecret)) {
      sendToWs(ws, {
        type: 'register_result',
        success: false,
        error: 'Invalid gateway secret'
      });
      ws.close();
      return null;
    }

    // Get or create backendId for this device
    const backendId = storage.getOrCreateBackendId(message.deviceId, message.name);
    const name = message.name || `Backend ${backendId}`;

    // Check if this backendId is already connected
    const existingBackend = backends.get(backendId);
    if (existingBackend) {
      console.log(`Backend ${backendId} reconnecting, closing old connection`);
      existingBackend.ws.close(4000, 'Replaced by new connection');
      backends.delete(backendId);
      backendConnections.delete(existingBackend.ws);
    }

    const visible = message.visible !== false; // Default true

    const backend: ConnectedBackend = {
      id: uuidv4(),
      backendId,
      deviceId: message.deviceId,
      name,
      ws,
      isAlive: true,
      visible
    };

    backends.set(backendId, backend);
    backendConnections.set(ws, backend);

    console.log(`Backend registered: ${backendId} (${name})${visible ? '' : ' [hidden]'}`);

    sendToWs(ws, {
      type: 'register_result',
      success: true,
      backendId
    });

    // Broadcast updated backends list to all connected backends
    broadcastBackendsListToBackends();

    return backendId;
  }

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
        // Resolve pending HTTP proxy request
        const proxyMsg = message as GatewayHttpProxyResponse;
        const pending = pendingHttpRequests.get(proxyMsg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingHttpRequests.delete(proxyMsg.requestId);
          pending.resolve(proxyMsg);
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
        const sessionEventMsg = {
          type: 'backend_session_event' as const,
          backendId,
          eventType: message.eventType,
          session: message.session
        };
        subscribers.forEach((clientId) => {
          const client = clients.get(clientId);
          if (client && client.ws.readyState === WebSocket.OPEN) {
            sendToWs(client.ws, {
              type: 'backend_message',
              backendId,
              message: sessionEventMsg
            } as any);
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

  function handleBackendDisconnect(backendId: string): void {
    const backend = backends.get(backendId);
    if (!backend) return;

    console.log(`Backend disconnected: ${backendId}`);

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
    backend.ws.terminate();

    // Broadcast updated backends list to remaining backends
    broadcastBackendsListToBackends();
  }

  /**
   * Broadcast current backends list to all connected backends.
   * Only visible backends are included in the list, but ALL backends receive it.
   */
  function broadcastBackendsListToBackends(): void {
    const backendList: GatewayBackendInfo[] = [];
    backends.forEach((backend) => {
      if (backend.visible) {
        backendList.push({
          backendId: backend.backendId,
          name: backend.name,
          online: true
        });
      }
    });
    backends.forEach((backend) => {
      sendToWs(backend.ws, { type: 'backends_list', backends: backendList });
    });
  }

  // --- Client handlers ---

  function handleClientAuth(ws: WebSocket, message: GatewayAuthMessage): string | null {
    const clientId = uuidv4();

    // Validate gateway secret (timing-safe)
    if (!safeCompare(message.gatewaySecret, config.gatewaySecret)) {
      sendToWs(ws, {
        type: 'gateway_auth_result',
        success: false,
        error: 'Invalid credentials'
      });
      ws.close();
      return null;
    }

    const client: ConnectedClient = {
      id: clientId,
      ws,
      isAlive: true,
      authenticated: true,
      backendAuths: new Set(),
      explicitSubscriptions: null  // null = subscribe to all backends
    };

    clients.set(clientId, client);

    console.log(`Client authenticated: ${clientId}`);

    // Build backends list to include in auth result
    const backendList: GatewayBackendInfo[] = [];
    backends.forEach((backend) => {
      if (backend.visible) {
        backendList.push({
          backendId: backend.backendId,
          name: backend.name,
          online: true
        });
      }
    });

    sendToWs(ws, {
      type: 'gateway_auth_result',
      success: true,
      backends: backendList
    });

    return clientId;
  }

  function handleClientMessage(clientId: string, message: unknown): void {
    const client = clients.get(clientId);
    if (!client || !client.authenticated) return;

    const msg = message as { type: string };

    switch (msg.type) {
      case 'list_backends': {
        const backendList: GatewayBackendInfo[] = [];
        backends.forEach((backend) => {
          if (backend.visible) {
            backendList.push({
              backendId: backend.backendId,
              name: backend.name,
              online: true
            });
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

  // --- Helpers ---

  function sendToWs(ws: WebSocket, message: GatewayToClientMessage | GatewayToBackendMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  return httpServer;
}
