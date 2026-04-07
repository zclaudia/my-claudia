/**
 * StandaloneFacadeAdapter
 *
 * Implements FacadeRuntimeGatewayAdapter without a GatewayClient.
 * Used when no gateway is configured. Injects the local server as a
 * backend in the registry and routes all messages through LocalBackendHandler.
 *
 * When gateway connects later, this adapter is replaced by EmbeddedGatewayAdapter.
 */

import type {
  FacadeAdapterBootstrapState,
  FacadeAdapterCommands,
  FacadeAdapterConnectionState,
  FacadeAdapterEvent,
  FacadeAdapterEventBus,
  FacadeAdapterQueries,
  FacadeRuntimeGatewayAdapter,
} from '@my-claudia/shared/facade/index';
import type { BackendPresence } from '@my-claudia/shared/protocol/gateway';
import type { ClientMessage, ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { LocalBackendHandler } from './embedded-adapter.js';

export class StandaloneFacadeAdapter implements FacadeRuntimeGatewayAdapter {
  private listeners: Array<(event: FacadeAdapterEvent) => void> = [];
  private readonly serverPort: number;
  private readonly instanceId: string;
  private readonly deviceId: string;
  private readonly backendId: string;
  private readonly localHandler: LocalBackendHandler | null;
  private localSubscribed = false;

  constructor(options: {
    serverPort: number;
    instanceId: string;
    deviceId: string;
    localHandler: LocalBackendHandler | null;
  }) {
    this.serverPort = options.serverPort;
    this.instanceId = options.instanceId;
    this.deviceId = options.deviceId;
    this.backendId = `local-${options.instanceId}`;
    this.localHandler = options.localHandler;
    this.wireLocalHandlerEvents();
  }

  /** The backendId assigned to the local server. */
  getLocalBackendId(): string {
    return this.backendId;
  }

  private buildLocalPresence(): BackendPresence {
    return {
      backendId: this.backendId,
      instanceId: this.instanceId,
      deviceId: this.deviceId,
      name: 'Local Server',
      channel: 'local',
      visible: true,
      capabilities: this.localHandler?.getCapabilities() ?? [],
      epoch: 1,
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
    };
  }

  // --------------------------------------------------------------------------
  // Commands — local backend short-circuit
  // --------------------------------------------------------------------------

  readonly commands: FacadeAdapterCommands = {
    connection: {
      connect: () => {
        this.emit({ type: 'connection_state_changed', state: 'connected' });
      },
      disconnect: () => {
        this.emit({ type: 'connection_state_changed', state: 'disconnected' });
      },
    },
    backend: {
      subscribe: (backendId) => {
        if (backendId === this.backendId) {
          this.localSubscribed = true;
          this.emit({
            type: 'backend_subscribed',
            backendId,
            epoch: 1,
            capabilities: this.localHandler?.getCapabilities() ?? [],
          });
          // Immediately push backend data snapshot
          if (this.localHandler) {
            this.emit({
              type: 'backend_data_snapshot_received',
              backendId,
              sessions: this.localHandler.getSessionItems(),
              projects: this.localHandler.getProjectItems(),
            });
          }
        }
      },
      unsubscribe: (backendId) => {
        if (backendId === this.backendId) {
          this.localSubscribed = false;
          this.emit({
            type: 'backend_unsubscribed',
            backendId,
            reason: 'client_unsubscribed',
          });
        }
      },
      sendToBackend: (_backendId, message) => {
        void this.localHandler?.onMessage(message);
      },
    },
    stream: {
      catchUp: (backendId, sessionId, afterOffset) => {
        void this.handleLocalCatchUp(backendId, sessionId, afterOffset);
      },
    },
  };

  // --------------------------------------------------------------------------
  // Queries — local backend in registry
  // --------------------------------------------------------------------------

  readonly queries: FacadeAdapterQueries = {
    bootstrap: {
      getInitialState: (): FacadeAdapterBootstrapState => ({
        capturedAt: Date.now(),
        connection: { state: 'connected' },
        identity: {
          instanceId: this.instanceId,
          deviceId: this.deviceId,
        },
        registry: {
          items: [this.buildLocalPresence()],
        },
        subscriptions: { backendIds: [] },
      }),
    },
    connection: {
      getState: () => 'connected' as FacadeAdapterConnectionState,
    },
    identity: {
      getInstanceId: () => this.instanceId,
      getDeviceId: () => this.deviceId,
    },
    registry: {
      getSnapshot: () => {
        const map = new Map<string, BackendPresence>();
        map.set(this.backendId, this.buildLocalPresence());
        return map;
      },
    },
    backend: {
      isSubscribed: (backendId) => backendId === this.backendId && this.localSubscribed,
    },
    http: {
      getBaseUrl: () => `http://localhost:${this.serverPort}`,
      getHeaders: () => ({}),
    },
  };

  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------

  readonly events: FacadeAdapterEventBus = {
    subscribe: (listener) => {
      this.listeners.push(listener);
      return () => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) this.listeners.splice(idx, 1);
      };
    },
  };

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private emit(event: FacadeAdapterEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  private async handleLocalCatchUp(backendId: string, sessionId: string, afterOffset: number): Promise<void> {
    if (!this.localHandler) return;
    try {
      const messages = await this.localHandler.onCatchUp(sessionId, afterOffset);
      const maxOffset = messages.length > 0
        ? Math.max(...messages.map(m => m.offset))
        : afterOffset;
      this.emit({
        type: 'content_patch_received',
        backendId,
        sessionId,
        messages,
        latestOffset: maxOffset,
      });
    } catch (error) {
      console.error('[StandaloneAdapter] Local catch-up error:', error);
      this.emit({
        type: 'content_patch_failed',
        backendId,
        sessionId,
        afterOffset,
        error: error instanceof Error ? error.message : 'Catch-up failed',
      });
    }
  }

  private wireLocalHandlerEvents(): void {
    if (!this.localHandler) return;
    this.localHandler.onServerEvent((message) => {
      const sessionId = this.getSessionId(message);
      if (sessionId) {
        this.emit({
          type: 'run_event_received',
          backendId: this.backendId,
          sessionId,
          event: message,
        });
      } else {
        // Non-session messages (terminal output, heartbeats, etc.)
        this.emit({
          type: 'backend_message_received',
          backendId: this.backendId,
          message,
        });
      }
    });
  }

  private getSessionId(message: ServerMessage): string | null {
    const candidate = (message as { sessionId?: unknown }).sessionId;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  }
}
