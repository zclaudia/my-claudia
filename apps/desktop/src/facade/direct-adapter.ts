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
  private transportConfig: Omit<GatewayTransportConfig, 'onConnected' | 'onDisconnected' | 'onError' | 'onRegistryChanged' | 'onBackendDataSnapshot' | 'onBackendDataEvent' | 'onBackendSubscribed' | 'onBackendUnsubscribed' | 'onBackendServerMessage' | 'onRunStreamEvent' | 'onContentPatch' | 'onContentPatchError'>;
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
            // Emit unsubscribed for all subscribed backends
            if (this.transport) {
              for (const backendId of this.transport.subscribedBackends) {
                this.emit({
                  type: 'backend_unsubscribed',
                  backendId,
                  reason: 'transport_disconnected',
                });
              }
            }
            this.emit({ type: 'connection_state_changed', state: 'reconnecting' });
          },
          onError: (error) => {
            const resolvedUrl = this.transport?.getResolvedUrl() ?? this.transportConfig.url;
            const errorMsg = typeof error === 'string' ? error : 'connection_error';
            this.emit({
              type: 'connection_state_changed',
              state: 'error',
              error: `${errorMsg} (url: ${resolvedUrl})`,
            });
          },
          onRegistryChanged: (items) => {
            this.emit({
              type: 'registry_snapshot_received',
              items,
            });
          },
          onBackendDataSnapshot: (backendId, sessions, projects) => {
            this.emit({ type: 'backend_data_snapshot_received', backendId, sessions, projects });
          },
          onBackendDataEvent: (backendId, event) => {
            this.emit({ type: 'backend_data_event_received', backendId, event });
          },
          onBackendSubscribed: (backendId, epoch, capabilities) => {
            this.emit({ type: 'backend_subscribed', backendId, epoch, capabilities });
          },
          onBackendUnsubscribed: (backendId, reason) => {
            this.emit({ type: 'backend_unsubscribed', backendId, reason });
          },
          onBackendServerMessage: (backendId, message) => {
            const payload = message as unknown as Record<string, unknown>;
            const sessionId = (payload?.sessionId as string) ?? '';
            if (sessionId) {
              this.emit({ type: 'run_event_received', backendId, sessionId, event: message });
            } else {
              this.emit({ type: 'backend_message_received', backendId, message });
            }
          },
          onRunStreamEvent: (backendId, sessionId, event) => {
            this.emit({
              type: 'run_event_received',
              backendId,
              sessionId,
              event: event as unknown as ServerMessage,
            });
          },
          onContentPatch: (backendId, sessionId, messages, latestOffset) => {
            this.emit({ type: 'content_patch_received', backendId, sessionId, messages, latestOffset });
          },
          onContentPatchError: (backendId, sessionId, afterOffset, error) => {
            this.emit({ type: 'content_patch_failed', backendId, sessionId, afterOffset, error });
          },
        });
        this.transport.connect();
      },
      disconnect: () => {
        if (this.transport) {
          this.transport.disconnect();
          this.transport = null;
          this.emit({ type: 'connection_state_changed', state: 'disconnected' });
          // Fix #13: clear listeners to prevent stale callbacks on reuse
          this.listeners = [];
        }
      },
    },
    backend: {
      subscribe: (backendId) => {
        this.transport?.subscribe(backendId);
      },
      unsubscribe: (backendId) => {
        this.transport?.unsubscribe(backendId);
      },
      sendToBackend: (backendId, message) => {
        this.transport?.sendToBackend(backendId, message);
      },
    },
    stream: {
      catchUp: (backendId, sessionId, afterOffset) => {
        this.transport?.catchUpContent(backendId, sessionId, afterOffset);
      },
    },
  };

  readonly queries: FacadeAdapterQueries = {
    bootstrap: {
      getInitialState: (): FacadeAdapterBootstrapState => {
        const items = this.transport
          ? Array.from(this.transport.getRegistryItems().values())
          : [];
        const backendIds = this.transport
          ? Array.from(this.transport.subscribedBackends)
          : [];
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
            items,
          },
          subscriptions: { backendIds },
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
      getSnapshot: () => this.transport?.getRegistryItems() ?? new Map(),
    },
    backend: {
      isSubscribed: (backendId) => this.transport?.isBackendSubscribed(backendId) ?? false,
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
  // Reconnect & Health
  // --------------------------------------------------------------------------

  forceReconnect(): void {
    // transport.connect() marks the old WS as expectedClose, so onDisconnected
    // never fires. Emit unsubscribed events + reconnecting state explicitly to keep
    // RuntimeCore and UI in sync.
    if (this.transport) {
      for (const backendId of this.transport.subscribedBackends) {
        this.emit({
          type: 'backend_unsubscribed',
          backendId,
          reason: 'transport_disconnected',
        });
      }
    }
    this.emit({ type: 'connection_state_changed', state: 'reconnecting' });
    this.transport?.forceReconnect();
  }

  probeHealth(): void {
    this.transport?.probeHealth();
  }

  // --------------------------------------------------------------------------
  // Helpers
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
