/**
 * EmbeddedGatewayAdapter
 *
 * Wraps GatewayClient to implement FacadeRuntimeGatewayAdapter.
 * Handles local backend short-circuit: local backend operations
 * bypass the gateway protocol entirely.
 *
 * See docs/design/backend-facade.md § "Embedded adapter 实现要点"
 */

import type {
  FacadeAdapterBootstrapState,
  FacadeAdapterCommands,
  FacadeAdapterConnectionState,
  FacadeAdapterEvent,
  FacadeAdapterEventBus,
  FacadeAdapterQueries,
  FacadeRuntimeGatewayAdapter,
} from '@my-claudia/shared';
import type { BackendPresence, ClientMessage, SessionCatalogItem, SessionMessage, ServerMessage } from '@my-claudia/shared';
import type { GatewayClient } from '../gateway-client.js';

// ============================================================================
// Local Backend Handler Interface
// ============================================================================

/**
 * Interface for handling local backend operations (in-process short-circuit).
 * Provided by the server to handle messages directed at the local backend.
 */
export interface LocalBackendHandler {
  onMessage(message: ClientMessage): Promise<void> | void;
  onStreamOpen(sessionId: string): void;
  onStreamClose(sessionId: string): void;
  onCatchUp(sessionId: string, afterOffset: number): Promise<SessionMessage[]>;
  getCatalogItems(): SessionCatalogItem[];
  getCapabilities(): string[];
}

// ============================================================================
// EmbeddedGatewayAdapter
// ============================================================================

export class EmbeddedGatewayAdapter implements FacadeRuntimeGatewayAdapter {
  private listeners: Array<(event: FacadeAdapterEvent) => void> = [];
  private localBackendId: string | null = null;
  private serverPort: number;

  constructor(
    private readonly gatewayClient: GatewayClient,
    private readonly localHandler: LocalBackendHandler | null,
    serverPort: number,
  ) {
    this.serverPort = serverPort;
    this.wireGatewayEvents();
  }

  // --------------------------------------------------------------------------
  // CQE Interface
  // --------------------------------------------------------------------------

  readonly commands: FacadeAdapterCommands = {
    connection: {
      connect: () => this.gatewayClient.connect(),
      disconnect: () => this.gatewayClient.disconnect(),
    },
    channel: {
      openBackendChannel: (backendId, epoch) => {
        if (this.isLocalBackend(backendId)) {
          this.handleLocalChannelOpen(backendId, epoch);
        } else {
          this.gatewayClient.openOutgoingChannel(backendId, epoch);
        }
      },
      closeBackendChannel: (channelId) => {
        if (this.isLocalChannel(channelId)) {
          this.handleLocalChannelClose(channelId);
        } else {
          this.gatewayClient.closeOutgoingChannel(channelId);
        }
      },
      sendToBackend: (channelId, message) => {
        if (this.isLocalChannel(channelId)) {
          this.handleLocalMessage(channelId, message);
        } else {
          this.gatewayClient.sendToOutgoingChannel(channelId, message);
        }
      },
    },
    catalog: {
      subscribe: (backendId, epoch, lastRevision?) => {
        if (this.isLocalBackend(backendId)) {
          this.handleLocalCatalogSubscribe(backendId, epoch);
        } else {
          this.gatewayClient.subscribeOutgoingCatalog(backendId, epoch, lastRevision);
        }
      },
      unsubscribe: (backendId, epoch) => {
        if (!this.isLocalBackend(backendId)) {
          this.gatewayClient.unsubscribeOutgoingCatalog(backendId, epoch);
        }
      },
    },
    stream: {
      open: (channelId, sessionId) => {
        if (this.isLocalChannel(channelId)) {
          this.localHandler?.onStreamOpen(sessionId);
        } else {
          this.gatewayClient.openOutgoingStream(channelId, sessionId);
        }
      },
      close: (channelId, sessionId) => {
        if (this.isLocalChannel(channelId)) {
          this.localHandler?.onStreamClose(sessionId);
        } else {
          this.gatewayClient.closeOutgoingStream(channelId, sessionId);
        }
      },
      catchUp: (channelId, sessionId, afterOffset) => {
        if (this.isLocalChannel(channelId)) {
          this.handleLocalCatchUp(channelId, sessionId, afterOffset);
        } else {
          this.gatewayClient.catchUpOutgoingStream(channelId, sessionId, afterOffset);
        }
      },
    },
  };

  readonly queries: FacadeAdapterQueries = {
    bootstrap: {
      getInitialState: (): FacadeAdapterBootstrapState => {
        const registryItems = Array.from(this.gatewayClient.getRegistryItems().values());
        const channels: Array<{ backendId: string; channelId: string; epoch: number }> = [];
        for (const [, ch] of this.gatewayClient.getAllOutgoingChannels()) {
          channels.push({ backendId: ch.backendId, channelId: ch.channelId, epoch: ch.epoch });
        }
        return {
          capturedAt: Date.now(),
          connection: {
            state: this.gatewayClient.isGatewayConnected() ? 'connected' : 'idle',
          },
          identity: {
            instanceId: this.gatewayClient.getInstanceId(),
            deviceId: this.gatewayClient.getDeviceId(),
          },
          registry: {
            revision: this.gatewayClient.getRegistryRevision(),
            items: registryItems,
          },
          channels: { items: channels },
        };
      },
    },
    connection: {
      getState: () => (this.gatewayClient.isGatewayConnected() ? 'connected' : 'disconnected') as FacadeAdapterConnectionState,
    },
    identity: {
      getInstanceId: () => this.gatewayClient.getInstanceId(),
      getDeviceId: () => this.gatewayClient.getDeviceId(),
    },
    registry: {
      getRevision: () => this.gatewayClient.getRegistryRevision(),
      getSnapshot: () => this.gatewayClient.getRegistryItems(),
    },
    channel: {
      get: (backendId) => {
        const ch = this.gatewayClient.getOutgoingChannel(backendId);
        return ch ? { backendId: ch.backendId, channelId: ch.channelId, epoch: ch.epoch } : undefined;
      },
      getAll: () => {
        const result = new Map<string, { backendId: string; channelId: string; epoch: number }>();
        for (const [bid, ch] of this.gatewayClient.getAllOutgoingChannels()) {
          result.set(bid, { backendId: ch.backendId, channelId: ch.channelId, epoch: ch.epoch });
        }
        return result;
      },
    },
    http: {
      getBaseUrl: (backendId) => {
        if (this.isLocalBackend(backendId)) {
          return `http://localhost:${this.serverPort}`;
        }
        // Remote backends go through embedded server proxy
        return `http://localhost:${this.serverPort}/api/backend-facade/proxy/${backendId}`;
      },
      getHeaders: () => ({}),
    },
  };

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
  // Local Backend Identity
  // --------------------------------------------------------------------------

  setLocalBackendId(backendId: string | null): void {
    this.localBackendId = backendId;
  }

  private isLocalBackend(backendId: string): boolean {
    return this.localBackendId !== null && backendId === this.localBackendId;
  }

  private isLocalChannel(channelId: string): boolean {
    return channelId.startsWith('local:');
  }

  // --------------------------------------------------------------------------
  // Local Backend Short-Circuit Handlers
  // --------------------------------------------------------------------------

  private handleLocalChannelOpen(backendId: string, epoch: number): void {
    const virtualChannelId = `local:${backendId}:${epoch}`;
    this.emit({
      type: 'backend_channel_opened',
      backendId,
      channelId: virtualChannelId,
      epoch,
      capabilities: this.localHandler?.getCapabilities() ?? [],
    });
  }

  private handleLocalChannelClose(channelId: string): void {
    // Parse backendId from local:backendId:epoch
    const parts = channelId.split(':');
    if (parts.length >= 2) {
      this.emit({
        type: 'backend_channel_closed',
        backendId: parts[1],
        channelId,
        reason: 'client_closed',
      });
    }
  }

  private handleLocalMessage(channelId: string, message: ClientMessage): void {
    void this.localHandler?.onMessage(message);
  }

  private handleLocalCatalogSubscribe(backendId: string, epoch: number): void {
    if (!this.localHandler) return;
    const items = this.localHandler.getCatalogItems();
    this.emit({
      type: 'catalog_snapshot_received',
      backendId,
      epoch,
      revision: 1,
      items,
    });
  }

  private async handleLocalCatchUp(channelId: string, sessionId: string, afterOffset: number): Promise<void> {
    if (!this.localHandler) return;
    try {
      const messages = await this.localHandler.onCatchUp(sessionId, afterOffset);
      const maxOffset = messages.length > 0
        ? Math.max(...messages.map(m => m.offset))
        : afterOffset;
      // Parse backendId from channelId
      const parts = channelId.split(':');
      const backendId = parts.length >= 2 ? parts[1] : '';
      this.emit({
        type: 'content_patch_received',
        backendId,
        channelId,
        sessionId,
        messages,
        latestOffset: maxOffset,
      });
    } catch (error) {
      console.error('[EmbeddedAdapter] Local catch-up error:', error);
    }
  }

  // --------------------------------------------------------------------------
  // Wire GatewayClient Events → Adapter Events
  // --------------------------------------------------------------------------

  private wireGatewayEvents(): void {
    this.gatewayClient.setOutgoingEvents({
      onConnectionStateChanged: (connected) => {
        this.emit({
          type: 'connection_state_changed',
          state: connected ? 'connected' : 'reconnecting',
        });
      },

      onRegistrySnapshotChanged: (revision, items) => {
        this.emit({ type: 'registry_snapshot_received', revision, items });
      },

      onRegistryEventChanged: (revision, op, item, backendId) => {
        this.emit({ type: 'registry_event_received', revision, op, item, backendId });
      },

      onOutgoingChannelOpened: (backendId, channelId, epoch, capabilities) => {
        this.emit({ type: 'backend_channel_opened', backendId, channelId, epoch, capabilities });
      },

      onOutgoingChannelClosed: (backendId, channelId, reason) => {
        this.emit({ type: 'backend_channel_closed', backendId, channelId, reason });
      },

      onOutgoingChannelRejected: (backendId, reason) => {
        this.emit({ type: 'backend_channel_rejected', backendId, reason });
      },

      onOutgoingCatalogSnapshot: (backendId, epoch, revision, items) => {
        this.emit({ type: 'catalog_snapshot_received', backendId, epoch, revision, items });
      },

      onOutgoingCatalogEvent: (backendId, epoch, revision, op, item, sessionId) => {
        this.emit({ type: 'catalog_event_received', backendId, epoch, revision, op, item, sessionId });
      },

      onOutgoingCatalogReset: (backendId, epoch) => {
        this.emit({ type: 'catalog_reset_received', backendId, epoch });
      },

      onOutgoingSessionStreamClosed: (backendId, channelId, sessionId, reason) => {
        this.emit({ type: 'session_stream_closed', backendId, channelId, sessionId, reason });
      },

      onOutgoingRunEvent: (backendId, channelId, sessionId, event) => {
        this.emit({ type: 'run_event_received', backendId, channelId, sessionId, event });
      },

      onOutgoingContentPatch: (backendId, channelId, sessionId, messages, latestOffset) => {
        this.emit({ type: 'content_patch_received', backendId, channelId, sessionId, messages, latestOffset });
      },
    });
  }

  // --------------------------------------------------------------------------
  // Event Emission
  // --------------------------------------------------------------------------

  private emit(event: FacadeAdapterEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors must not break event dispatch
      }
    }
  }
}
