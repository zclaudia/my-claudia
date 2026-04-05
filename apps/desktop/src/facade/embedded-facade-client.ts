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
  private expectedCloseWs: WebSocket | null = null;
  private readonly url: string;
  private snapshotListeners: Array<(snapshot: BackendFacadeSnapshot) => void> = [];
  private eventListeners: Array<(event: BackendFacadeEvent) => void> = [];
  private latestSnapshot: BackendFacadeSnapshot | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private desiredOpenBackends = new Set<string>();
  private desiredSessionStreams = new Map<string, { backendId: string; sessionId: string }>();

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
      this.expectedCloseWs = this.ws;
      this.ws.close();
      this.ws = null;
    }
  }

  private doConnect(): void {
    if (this.ws) {
      this.expectedCloseWs = this.ws;
      this.ws.close();
      this.ws = null;
    }

    const ws = new WebSocket(this.url);

    ws.onopen = () => {
      this.ws = ws;
      this.emitEvent({ type: 'connection_state_changed', state: 'connected' });
      // Server sends facade_snapshot on connect automatically
      this.replayDesiredState();
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
      const expectedClose = this.expectedCloseWs === ws;
      if (expectedClose) {
        this.expectedCloseWs = null;
      }
      if (this.ws === ws) this.ws = null;
      if (expectedClose && !this.intentionalClose) {
        return;
      }
      if (!this.intentionalClose) {
        this.emitEvent({ type: 'connection_state_changed', state: 'reconnecting' });
        this.scheduleReconnect();
      } else {
        this.emitEvent({ type: 'connection_state_changed', state: 'disconnected' });
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
    // Diagnostic: log state-changing events in dev to debug periodic connecting/connected flapping.
    if (
      import.meta.env.DEV &&
      (msg.type === 'backend_state_changed' || msg.type === 'connection_state_changed')
    ) {
      console.log(`[EmbeddedFacadeClient] ${msg.type}:`, msg.type === 'backend_state_changed' ? `backend=${msg.backendId} state=${msg.state} error=${msg.error}` : `state=${msg.state}`);
    }
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

      case 'connection_state_changed':
        // Server-relayed gateway state change. In embedded mode, transport
        // state is managed by the client WS lifecycle (onopen/onclose).
        // Don't forward — gateway status is tracked via snapshot_updated.
        if (this.latestSnapshot) {
          this.latestSnapshot = { ...this.latestSnapshot, connectionState: msg.state };
        }
        break;

      case 'backend_state_changed':
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
    this.desiredOpenBackends.add(backendId);
    this.send({ type: 'open_backend', backendId });
  }

  closeBackend(backendId: string): void {
    this.desiredOpenBackends.delete(backendId);
    this.send({ type: 'close_backend', backendId });
  }

  sendToBackend(backendId: string, message: ClientMessage): void {
    this.send({ type: 'send_to_backend', backendId, message });
  }

  openSessionStream(backendId: string, sessionId: string): void {
    this.desiredSessionStreams.set(`${backendId}:${sessionId}`, { backendId, sessionId });
    this.send({ type: 'open_session_stream', backendId, sessionId });
  }

  closeSessionStream(backendId: string, sessionId: string): void {
    this.desiredSessionStreams.delete(`${backendId}:${sessionId}`);
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

  /** Force an immediate reconnect if disconnected (bypasses 2s delay). */
  forceReconnect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    console.log('[EmbeddedFacadeClient] Force reconnect requested');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.intentionalClose = false;
    this.doConnect();
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

  private replayDesiredState(): void {
    for (const backendId of this.desiredOpenBackends) {
      this.send({ type: 'open_backend', backendId });
    }
    for (const { backendId, sessionId } of this.desiredSessionStreams.values()) {
      this.send({ type: 'open_session_stream', backendId, sessionId });
    }
  }

  private emitEvent(event: BackendFacadeEvent): void {
    for (const listener of this.eventListeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }
}
