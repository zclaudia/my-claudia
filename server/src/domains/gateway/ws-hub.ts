/**
 * FacadeWsHub
 *
 * WebSocket distribution layer for the embedded facade runtime.
 * Manages /ws/backend-facade client connections, sends initial snapshot,
 * broadcasts facade events, and routes UI commands to the runtime core.
 *
 * See docs/design/backend-facade.md § "FacadeWsHub"
 */

import type { WebSocket } from 'ws';
import type {
  BackendFacadeEvent,
  BackendFacadeSnapshot,
  ClientMessage,
} from '@my-claudia/shared';
import type { BackendFacadeRuntimeCore } from '@my-claudia/shared';

// ============================================================================
// Types
// ============================================================================

interface FacadeClientSession {
  clientId: string;
  ws: WebSocket;
  subscribed: boolean;
  connectedAt: number;
}

/** Messages from UI → embedded facade WS. */
type UiToFacadeMessage =
  | { type: 'facade_subscribe' }
  | { type: 'open_backend'; backendId: string }
  | { type: 'close_backend'; backendId: string }
  | { type: 'send_to_backend'; backendId: string; message: unknown }
  | { type: 'open_session_stream'; backendId: string; sessionId: string }
  | { type: 'close_session_stream'; backendId: string; sessionId: string }
  | { type: 'catch_up_content'; backendId: string; sessionId: string; afterOffset: number };

/** Messages from embedded facade → UI WS. */
type FacadeToUiMessage =
  | { type: 'facade_snapshot'; snapshot: BackendFacadeSnapshot }
  | BackendFacadeEvent
  | { type: 'facade_error'; message: string };

// ============================================================================
// FacadeWsHub
// ============================================================================

export class FacadeWsHub {
  private clients = new Map<string, FacadeClientSession>();
  private clientIdCounter = 0;
  private unsubscribeEvent: (() => void) | null = null;
  constructor(private readonly core: BackendFacadeRuntimeCore) {}

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  start(): void {
    // Subscribe to facade events and broadcast to all clients
    this.unsubscribeEvent = this.core.onEvent(event => {
      this.broadcast(event);
    });
  }

  stop(): void {
    if (this.unsubscribeEvent) {
      this.unsubscribeEvent();
      this.unsubscribeEvent = null;
    }
    // Close all client connections
    for (const session of this.clients.values()) {
      try { session.ws.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }

  // --------------------------------------------------------------------------
  // Client Management
  // --------------------------------------------------------------------------

  attachClient(ws: WebSocket): void {
    const clientId = `fc-${++this.clientIdCounter}`;
    const session: FacadeClientSession = {
      clientId,
      ws,
      subscribed: false,
      connectedAt: Date.now(),
    };
    this.clients.set(clientId, session);

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as UiToFacadeMessage;
        this.handleClientMessage(session, msg);
      } catch {
        this.sendTo(ws, { type: 'facade_error', message: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
    });

    ws.on('error', () => {
      this.clients.delete(clientId);
    });

    // Send initial snapshot immediately
    const snapshot = this.core.getSnapshot();
    this.sendTo(ws, { type: 'facade_snapshot', snapshot });
    session.subscribed = true;
  }

  detachClient(ws: WebSocket): void {
    for (const [id, session] of this.clients) {
      if (session.ws === ws) {
        this.clients.delete(id);
        break;
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  // --------------------------------------------------------------------------
  // Message Handling
  // --------------------------------------------------------------------------

  private handleClientMessage(session: FacadeClientSession, msg: UiToFacadeMessage): void {
    switch (msg.type) {
      case 'facade_subscribe':
        if (!session.subscribed) {
          session.subscribed = true;
          const snapshot = this.core.getSnapshot();
          this.sendTo(session.ws, { type: 'facade_snapshot', snapshot });
        }
        break;

      case 'open_backend':
        this.core.openBackend(msg.backendId);
        break;

      case 'close_backend':
        this.core.closeBackend(msg.backendId);
        break;

      case 'send_to_backend':
        this.core.sendToBackend(msg.backendId, msg.message as ClientMessage);
        break;

      case 'open_session_stream':
        this.core.openSessionStream(msg.backendId, msg.sessionId);
        break;

      case 'close_session_stream':
        this.core.closeSessionStream(msg.backendId, msg.sessionId);
        break;

      case 'catch_up_content':
        this.core.catchUpContent(msg.backendId, msg.sessionId, msg.afterOffset);
        break;

      default:
        this.sendTo(session.ws, { type: 'facade_error', message: `Unknown message type` });
    }
  }

  // --------------------------------------------------------------------------
  // Broadcasting
  // --------------------------------------------------------------------------

  private broadcast(event: FacadeToUiMessage): void {
    const data = JSON.stringify(event);
    // Fix #10: collect IDs to remove after iteration to avoid Map mutation during iteration
    const toRemove: string[] = [];
    for (const session of this.clients.values()) {
      if (!session.subscribed) continue;
      try {
        if (session.ws.readyState === 1 /* WebSocket.OPEN */) {
          session.ws.send(data);
        } else {
          // Slow consumer — mark for removal
          toRemove.push(session.clientId);
          try { session.ws.close(); } catch { /* ignore */ }
        }
      } catch {
        toRemove.push(session.clientId);
      }
    }
    for (const id of toRemove) this.clients.delete(id);
  }

  private sendTo(ws: WebSocket, msg: FacadeToUiMessage): void {
    try {
      if (ws.readyState === 1 /* WebSocket.OPEN */) {
        ws.send(JSON.stringify(msg));
      }
    } catch { /* ignore send errors */ }
  }
}
