/**
 * DirectGatewayAdapter
 *
 * Wraps GatewayTransport (client-only peer) to implement FacadeRuntimeGatewayAdapter.
 * Used for mobile / Windows pure UI where there's no embedded server.
 *
 * See docs/design/backend-facade.md § "Direct adapter 实现要点"
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
import type { ServerMessage } from '@my-claudia/shared';
import { GatewayTransport } from '../hooks/transport/GatewayTransport';
import type { GatewayTransportConfig } from '../hooks/transport/GatewayTransport';

// ============================================================================
// DirectGatewayAdapter
// ============================================================================

export class DirectGatewayAdapter implements FacadeRuntimeGatewayAdapter {
  private listeners: Array<(event: FacadeAdapterEvent) => void> = [];
  private transport: GatewayTransport | null = null;
  private transportConfig: Omit<GatewayTransportConfig, 'onConnected' | 'onDisconnected' | 'onError' | 'onRegistryChanged' | 'onCatalogSnapshot' | 'onCatalogEvent' | 'onCatalogReset' | 'onChannelOpened' | 'onChannelRejected' | 'onChannelClosed' | 'onChannelMessage' | 'onRunStreamEvent' | 'onSessionStreamClosed' | 'onContentPatch'>;
  private gatewayHttpUrl: string;
  private gatewaySecret: string;

  constructor(config: {
    url: string;
    gatewaySecret: string;
    deviceId: string;
    instanceId: string;
  }) {
    this.transportConfig = config;
    this.gatewayHttpUrl = config.url.replace(/^ws/, 'http');
    this.gatewaySecret = config.gatewaySecret;
  }

  // --------------------------------------------------------------------------
  // CQE Interface
  // --------------------------------------------------------------------------

  readonly commands: FacadeAdapterCommands = {
    connection: {
      connect: () => {
        if (this.transport) return;
        this.transport = new GatewayTransport({
          ...this.transportConfig,
          onConnected: (_peerSessionId, _recoveryToken) => {
            this.emit({ type: 'connection_state_changed', state: 'connected' });
          },
          onDisconnected: () => {
            this.emit({ type: 'connection_state_changed', state: 'reconnecting' });
          },
          onError: (error) => {
            this.emit({
              type: 'connection_state_changed',
              state: 'error',
              error: typeof error === 'string' ? error : 'connection_error',
            });
          },
          onRegistryChanged: (items) => {
            this.emit({
              type: 'registry_snapshot_received',
              revision: this.transport?.getRegistryRevision() ?? 0,
              items,
            });
          },
          onCatalogSnapshot: (backendId, epoch, items) => {
            this.emit({ type: 'catalog_snapshot_received', backendId, epoch, revision: 0, items });
          },
          onCatalogEvent: (backendId, epoch, op, item, sessionId) => {
            this.emit({ type: 'catalog_event_received', backendId, epoch, revision: 0, op, item, sessionId });
          },
          onCatalogReset: (backendId, epoch) => {
            this.emit({ type: 'catalog_reset_received', backendId, epoch });
          },
          onChannelOpened: (backendId, channelId, epoch, capabilities) => {
            this.emit({ type: 'backend_channel_opened', backendId, channelId, epoch, capabilities });
          },
          onChannelRejected: (backendId, reason) => {
            this.emit({ type: 'backend_channel_rejected', backendId, reason });
          },
          onChannelClosed: (channelId, backendId, reason) => {
            this.emit({ type: 'backend_channel_closed', backendId, channelId, reason });
          },
          onChannelMessage: (backendId, message) => {
            // Find channelId for this backend
            const channelId = this.transport?.channels.get(backendId)
              ? Array.from(this.transport.channels.entries()).find(([, v]) => v.backendId === backendId)?.[0] ?? ''
              : '';
            this.emit({ type: 'backend_message_received', backendId, channelId, message });
          },
          onRunStreamEvent: (channelId, sessionId, event) => {
            const backendId = this.findBackendByChannel(channelId);
            this.emit({
              type: 'run_event_received',
              backendId,
              channelId,
              sessionId,
              event: event as unknown as ServerMessage,
            });
          },
          onSessionStreamClosed: (channelId, sessionId, reason) => {
            const backendId = this.findBackendByChannel(channelId);
            this.emit({ type: 'session_stream_closed', backendId, channelId, sessionId, reason });
          },
          onContentPatch: (channelId, sessionId, messages, latestOffset) => {
            const backendId = this.findBackendByChannel(channelId);
            this.emit({ type: 'content_patch_received', backendId, channelId, sessionId, messages, latestOffset });
          },
        });
        this.transport.connect();
      },
      disconnect: () => {
        if (this.transport) {
          this.transport.disconnect();
          this.transport = null;
          this.emit({ type: 'connection_state_changed', state: 'disconnected' });
        }
      },
    },
    channel: {
      openBackendChannel: (backendId, epoch) => {
        this.transport?.openChannel(backendId, epoch);
      },
      closeBackendChannel: (channelId) => {
        this.transport?.closeChannel(channelId);
      },
      sendToBackend: (channelId, message) => {
        // GatewayTransport.sendToBackend expects backendId, find it
        const entry = this.transport?.channels.get(channelId);
        if (entry) {
          this.transport?.sendToBackend(entry.backendId, message);
        }
      },
    },
    catalog: {
      subscribe: (backendId, epoch, lastRevision?) => {
        this.transport?.subscribeCatalog(backendId, epoch, lastRevision);
      },
      unsubscribe: (backendId, epoch) => {
        this.transport?.unsubscribeCatalog(backendId, epoch);
      },
    },
    stream: {
      open: (channelId, sessionId) => {
        this.transport?.openSessionStream(channelId, sessionId);
      },
      close: (channelId, sessionId) => {
        this.transport?.closeSessionStream(channelId, sessionId);
      },
      catchUp: (channelId, sessionId, afterOffset) => {
        this.transport?.catchUpContent(channelId, sessionId, afterOffset);
      },
    },
  };

  readonly queries: FacadeAdapterQueries = {
    bootstrap: {
      getInitialState: (): FacadeAdapterBootstrapState => {
        const items = this.transport
          ? Array.from(this.transport.getRegistryItems().values())
          : [];
        const channels: Array<{ backendId: string; channelId: string; epoch: number }> = [];
        if (this.transport) {
          for (const [channelId, info] of this.transport.channels) {
            channels.push({ backendId: info.backendId, channelId, epoch: info.epoch });
          }
        }
        return {
          capturedAt: Date.now(),
          connection: {
            state: (this.transport?.isConnected() ? 'connected' : 'idle') as FacadeAdapterConnectionState,
          },
          identity: {
            instanceId: this.transportConfig.instanceId,
            deviceId: this.transportConfig.deviceId,
          },
          registry: {
            revision: this.transport?.getRegistryRevision() ?? 0,
            items,
          },
          channels: { items: channels },
        };
      },
    },
    connection: {
      getState: () => (this.transport?.isConnected() ? 'connected' : 'disconnected') as FacadeAdapterConnectionState,
    },
    identity: {
      getInstanceId: () => this.transportConfig.instanceId,
      getDeviceId: () => this.transportConfig.deviceId,
    },
    registry: {
      getRevision: () => this.transport?.getRegistryRevision() ?? 0,
      getSnapshot: () => this.transport?.getRegistryItems() ?? new Map(),
    },
    channel: {
      get: (backendId) => {
        if (!this.transport) return undefined;
        for (const [channelId, info] of this.transport.channels) {
          if (info.backendId === backendId) {
            return { backendId, channelId, epoch: info.epoch };
          }
        }
        return undefined;
      },
      getAll: () => {
        const result = new Map<string, { backendId: string; channelId: string; epoch: number }>();
        if (this.transport) {
          for (const [channelId, info] of this.transport.channels) {
            result.set(info.backendId, { backendId: info.backendId, channelId, epoch: info.epoch });
          }
        }
        return result;
      },
    },
    http: {
      getBaseUrl: (backendId) => {
        return `${this.gatewayHttpUrl}/api/proxy/${backendId}`;
      },
      getHeaders: () => ({
        'x-gateway-secret': this.gatewaySecret,
        'x-peer-session-id': this.transport?.getPeerSessionId() ?? '',
      }),
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
  // Helpers
  // --------------------------------------------------------------------------

  private findBackendByChannel(channelId: string): string {
    if (!this.transport) return '';
    const entry = this.transport.channels.get(channelId);
    return entry?.backendId ?? '';
  }

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
