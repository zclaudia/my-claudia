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
  BackendPresence,
} from '@my-claudia/shared';
import type { ClientMessage, ServerMessage } from '@my-claudia/shared';
import type { LocalBackendHandler } from './embedded-adapter.js';
import { parseLocalChannelId } from './channel-id.js';

export class StandaloneFacadeAdapter implements FacadeRuntimeGatewayAdapter {
  private listeners: Array<(event: FacadeAdapterEvent) => void> = [];
  private readonly serverPort: number;
  private readonly instanceId: string;
  private readonly deviceId: string;
  private readonly backendId: string;
  private readonly localHandler: LocalBackendHandler | null;
  private localChannelId: string | null = null;

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

  private isLocalChannel(channelId: string): boolean {
    return channelId.startsWith('local:');
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
    channel: {
      openBackendChannel: (backendId, epoch) => {
        if (backendId === this.backendId) {
          // Local backend — synthesize channel open
          const virtualChannelId = `local:${backendId}:${epoch}`;
          this.localChannelId = virtualChannelId;
          this.emit({
            type: 'backend_channel_opened',
            backendId,
            channelId: virtualChannelId,
            epoch,
            capabilities: this.localHandler?.getCapabilities() ?? [],
          });
        }
      },
      closeBackendChannel: (channelId) => {
        if (this.isLocalChannel(channelId)) {
          const parsed = parseLocalChannelId(channelId);
          if (parsed) {
            if (parsed.backendId === this.backendId && this.localChannelId === channelId) {
              this.localChannelId = null;
            }
            this.emit({
              type: 'backend_channel_closed',
              backendId: parsed.backendId,
              channelId,
              reason: 'client_closed',
            });
          }
        }
      },
      sendToBackend: (_channelId, message) => {
        void this.localHandler?.onMessage(message);
      },
    },
    catalog: {
      subscribe: (backendId, epoch) => {
        if (backendId === this.backendId && this.localHandler) {
          const items = this.localHandler.getCatalogItems();
          this.emit({
            type: 'catalog_snapshot_received',
            backendId,
            epoch,
            revision: 1,
            items,
          });
        }
      },
      unsubscribe: () => {},
    },
    stream: {
      open: (_channelId, sessionId) => {
        this.localHandler?.onStreamOpen(sessionId);
      },
      close: (_channelId, sessionId) => {
        this.localHandler?.onStreamClose(sessionId);
      },
      catchUp: (channelId, sessionId, afterOffset) => {
        void this.handleLocalCatchUp(channelId, sessionId, afterOffset);
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
          revision: 1,
          items: [this.buildLocalPresence()],
        },
        channels: { items: [] },
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
      getRevision: () => 1,
      getSnapshot: () => {
        const map = new Map<string, BackendPresence>();
        map.set(this.backendId, this.buildLocalPresence());
        return map;
      },
    },
    channel: {
      get: () => undefined,
      getAll: () => new Map(),
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

  private async handleLocalCatchUp(channelId: string, sessionId: string, afterOffset: number): Promise<void> {
    if (!this.localHandler) return;
    try {
      const messages = await this.localHandler.onCatchUp(sessionId, afterOffset);
      const maxOffset = messages.length > 0
        ? Math.max(...messages.map(m => m.offset))
        : afterOffset;
      const backendId = parseLocalChannelId(channelId)?.backendId ?? this.backendId;
      this.emit({
        type: 'content_patch_received',
        backendId,
        channelId,
        sessionId,
        messages,
        latestOffset: maxOffset,
      });
    } catch (error) {
      const backendId = parseLocalChannelId(channelId)?.backendId ?? this.backendId;
      console.error('[StandaloneAdapter] Local catch-up error:', error);
      this.emit({
        type: 'content_patch_failed',
        backendId,
        channelId,
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
      if (!sessionId) return;
      const channelId = this.localChannelId ?? `local:${this.backendId}:0`;
      this.emit({
        type: 'run_event_received',
        backendId: this.backendId,
        channelId,
        sessionId,
        event: message,
      });
    });
  }

  private getSessionId(message: ServerMessage): string | null {
    const candidate = (message as { sessionId?: unknown }).sessionId;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  }
}
