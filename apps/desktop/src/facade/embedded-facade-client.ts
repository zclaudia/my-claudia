/**
 * EmbeddedFacadeClient
 *
 * WebSocket client that implements BackendFacade by communicating with
 * the embedded server's /ws/backend-facade endpoint.
 *
 * Used in desktop embedded mode where the runtime core runs on the server side.
 */

import type {
  BackendFacade,
  BackendFacadeEvent,
  BackendFacadeSnapshot,
  ClientMessage,
} from '@my-claudia/shared';

// ============================================================================
// EmbeddedFacadeClient
// ============================================================================

export class EmbeddedFacadeClient implements BackendFacade {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private snapshotListeners: Array<(snapshot: BackendFacadeSnapshot) => void> = [];
  private eventListeners: Array<(event: BackendFacadeEvent) => void> = [];
  private latestSnapshot: BackendFacadeSnapshot | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(serverPort: number) {
    this.url = `ws://localhost:${serverPort}/ws/backend-facade`;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  connect(): void {
    this.intentionalClose = false;
    this.doConnect();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.pendingMessages = [];
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private doConnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const ws = new WebSocket(this.url);

    ws.onopen = () => {
      this.ws = ws;
      // Server sends facade_snapshot on connect automatically
      this.flushPendingMessages();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalClose) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose) this.doConnect();
    }, 2000);
  }

  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'facade_snapshot':
        this.latestSnapshot = msg.snapshot;
        for (const listener of this.snapshotListeners) {
          try { listener(msg.snapshot); } catch { /* ignore */ }
        }
        // Also emit as event
        for (const listener of this.eventListeners) {
          try { listener({ type: 'snapshot_updated', snapshot: msg.snapshot }); } catch { /* ignore */ }
        }
        break;

      case 'facade_error':
        // Server-side error, log but don't crash
        console.warn('[EmbeddedFacadeClient] Server error:', msg.message);
        break;

      case 'snapshot_updated':
        this.latestSnapshot = msg.snapshot;
        for (const listener of this.eventListeners) {
          try { listener(msg as BackendFacadeEvent); } catch { /* ignore */ }
        }
        break;

      default:
        // All other messages are BackendFacadeEvent
        for (const listener of this.eventListeners) {
          try { listener(msg as BackendFacadeEvent); } catch { /* ignore */ }
        }
        break;
    }
  }

  // --------------------------------------------------------------------------
  // BackendFacade — Snapshot & Subscription
  // --------------------------------------------------------------------------

  getSnapshot(): BackendFacadeSnapshot {
    return this.latestSnapshot ?? {
      snapshotVersion: 0,
      capturedAt: Date.now(),
      mode: 'embedded',
      connectionState: 'idle',
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      backends: [],
      sessionStreams: {},
    };
  }

  subscribe(listener: (snapshot: BackendFacadeSnapshot) => void): () => void {
    this.snapshotListeners.push(listener);
    return () => {
      const idx = this.snapshotListeners.indexOf(listener);
      if (idx >= 0) this.snapshotListeners.splice(idx, 1);
    };
  }

  onEvent(listener: (event: BackendFacadeEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const idx = this.eventListeners.indexOf(listener);
      if (idx >= 0) this.eventListeners.splice(idx, 1);
    };
  }

  // --------------------------------------------------------------------------
  // BackendFacade — Commands (send via WS)
  // --------------------------------------------------------------------------

  openBackend(backendId: string): void {
    this.send({ type: 'open_backend', backendId });
  }

  closeBackend(backendId: string): void {
    this.send({ type: 'close_backend', backendId });
  }

  sendToBackend(backendId: string, message: ClientMessage): void {
    this.send({ type: 'send_to_backend', backendId, message });
  }

  openSessionStream(backendId: string, sessionId: string): void {
    this.send({ type: 'open_session_stream', backendId, sessionId });
  }

  closeSessionStream(backendId: string, sessionId: string): void {
    this.send({ type: 'close_session_stream', backendId, sessionId });
  }

  catchUpContent(backendId: string, sessionId: string, afterOffset: number): void {
    this.send({ type: 'catch_up_content', backendId, sessionId, afterOffset });
  }

  // --------------------------------------------------------------------------
  // BackendFacade — HTTP (proxied through embedded server)
  // --------------------------------------------------------------------------

  getHttpBaseUrl(backendId: string): string | null {
    const port = this.url.match(/:(\d+)\//)?.[1];
    if (!port) return null;
    return `http://localhost:${port}/api/backend-facade/proxy/${backendId}`;
  }

  getHttpHeaders(): Record<string, string> {
    return {};
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  // Fix #22: queue messages while WS is connecting, flush on open
  private pendingMessages: unknown[] = [];

  private send(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      // Queue for later — will be flushed when connection opens
      this.pendingMessages.push(msg);
    }
  }

  private flushPendingMessages(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const msg of this.pendingMessages) {
      this.ws.send(JSON.stringify(msg));
    }
    this.pendingMessages = [];
  }
}
