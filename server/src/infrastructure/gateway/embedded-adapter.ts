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
} from '@my-claudia/shared/facade/index';
import type { BackendPresence, SessionItem, ProjectItem, SessionMessage } from '@my-claudia/shared/protocol/gateway';
import type { ClientMessage, ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { GatewayClient } from './gateway-client.js';

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
  onServerEvent(listener: (message: ServerMessage) => void): () => void;
  getSessionItems(): SessionItem[];
  getProjectItems(): ProjectItem[];
  getCapabilities(): string[];
}

// ============================================================================
// EmbeddedGatewayAdapter
// ============================================================================

export class EmbeddedGatewayAdapter implements FacadeRuntimeGatewayAdapter {
  private listeners: Array<(event: FacadeAdapterEvent) => void> = [];
  private localBackendId: string | null = null;
  private serverPort: number;
  private localSubscribed = false;

  constructor(
    private readonly gatewayClient: GatewayClient,
    private readonly localHandler: LocalBackendHandler | null,
    serverPort: number,
  ) {
    this.serverPort = serverPort;
    this.wireGatewayEvents();
    this.wireLocalHandlerEvents();
  }

  // --------------------------------------------------------------------------
  // CQE Interface
  // --------------------------------------------------------------------------

  readonly commands: FacadeAdapterCommands = {
    connection: {
      connect: () => this.gatewayClient.commands.connection.connect(),
      disconnect: () => this.gatewayClient.commands.connection.disconnect(),
    },
    backend: {
      subscribe: (backendId) => {
        if (this.isLocalBackend(backendId)) {
          this.handleLocalSubscribe(backendId);
        } else {
          this.gatewayClient.commands.backend.subscribe(backendId);
        }
      },
      unsubscribe: (backendId) => {
        if (this.isLocalBackend(backendId)) {
          this.handleLocalUnsubscribe(backendId);
        } else {
          this.gatewayClient.commands.backend.unsubscribe(backendId);
        }
      },
      sendToBackend: (backendId, message) => {
        if (this.isLocalBackend(backendId)) {
          this.handleLocalMessage(message);
        } else {
          this.gatewayClient.commands.backend.sendToBackend(backendId, message);
        }
      },
    },
    stream: {
      catchUp: (backendId, sessionId, afterOffset) => {
        if (this.isLocalBackend(backendId)) {
          this.handleLocalCatchUp(backendId, sessionId, afterOffset);
        } else {
          this.gatewayClient.commands.stream.catchUpOutgoing(backendId, sessionId, afterOffset);
        }
      },
    },
  };

  readonly queries: FacadeAdapterQueries = {
    bootstrap: {
      getInitialState: (): FacadeAdapterBootstrapState => {
        const remoteItems = Array.from(this.gatewayClient.queries.registry.getItems().values());
        const registryItems = this.localBackendId
          ? [this.buildLocalPresence(), ...remoteItems]
          : remoteItems;
        const backendIds: string[] = [];
        // Add local backend if subscribed
        if (this.localBackendId && this.localSubscribed) {
          backendIds.push(this.localBackendId);
        }
        // Note: remote subscribed backends are tracked by the gateway client
        return {
          capturedAt: Date.now(),
          connection: {
            state: this.gatewayClient.queries.connection.isConnected() ? 'connected' : 'idle',
          },
          identity: {
            instanceId: this.gatewayClient.queries.identity.getInstanceId(),
            deviceId: this.gatewayClient.queries.identity.getDeviceId(),
          },
          registry: {
            items: registryItems,
          },
          subscriptions: { backendIds },
        };
      },
    },
    connection: {
      getState: () => (this.gatewayClient.queries.connection.isConnected() ? 'connected' : 'disconnected') as FacadeAdapterConnectionState,
    },
    identity: {
      getInstanceId: () => this.gatewayClient.queries.identity.getInstanceId(),
      getDeviceId: () => this.gatewayClient.queries.identity.getDeviceId(),
    },
    registry: {
      getSnapshot: () => this.gatewayClient.queries.registry.getItems(),
    },
    backend: {
      isSubscribed: (backendId) => {
        if (this.isLocalBackend(backendId)) return this.localSubscribed;
        return this.gatewayClient.queries.backend.isSubscribed(backendId);
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

  private buildLocalPresence(): BackendPresence {
    return {
      backendId: this.localBackendId!,
      instanceId: this.gatewayClient.queries.identity.getInstanceId(),
      deviceId: this.gatewayClient.queries.identity.getDeviceId(),
      name: 'Local Server',
      channel: 'local',
      visible: true,
      capabilities: this.localHandler?.getCapabilities() ?? [],
      epoch: this.gatewayClient.queries.identity.getEpoch() ?? 1,
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
    };
  }

  // --------------------------------------------------------------------------
  // Local Backend Short-Circuit Handlers
  // --------------------------------------------------------------------------

  private handleLocalSubscribe(backendId: string): void {
    this.localSubscribed = true;
    this.emit({
      type: 'backend_subscribed',
      backendId,
      epoch: this.gatewayClient.queries.identity.getEpoch() ?? 1,
      capabilities: this.localHandler?.getCapabilities() ?? [],
    });
    // Immediately push backend data snapshot for local backend
    if (this.localHandler) {
      this.emit({
        type: 'backend_data_snapshot_received',
        backendId,
        sessions: this.localHandler.getSessionItems(),
        projects: this.localHandler.getProjectItems(),
      });
    }
  }

  private handleLocalUnsubscribe(backendId: string): void {
    this.localSubscribed = false;
    this.emit({
      type: 'backend_unsubscribed',
      backendId,
      reason: 'client_unsubscribed',
    });
  }

  private handleLocalMessage(message: ClientMessage): void {
    void this.localHandler?.onMessage(message);
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
      console.error('[EmbeddedAdapter] Local catch-up error:', error);
      this.emit({
        type: 'content_patch_failed',
        backendId,
        sessionId,
        afterOffset,
        error: error instanceof Error ? error.message : 'Catch-up failed',
      });
    }
  }

  // --------------------------------------------------------------------------
  // Wire GatewayClient Events → Adapter Events
  // --------------------------------------------------------------------------

  private wireGatewayEvents(): void {
    this.gatewayClient.events.setOutgoingEvents({
      onConnectionStateChanged: (connected) => {
        this.emit({
          type: 'connection_state_changed',
          state: connected ? 'connected' : 'reconnecting',
        });
      },

      onRegistrySnapshotChanged: (items) => {
        // Include local backend in registry snapshot so runtime-core doesn't
        // mark it as removed on every 30s gateway registry push.
        const allItems = this.localBackendId
          ? [this.buildLocalPresence(), ...items]
          : items;
        this.emit({ type: 'registry_snapshot_received', items: allItems });
      },

      onOutgoingBackendSubscribed: (backendId, epoch, capabilities) => {
        this.emit({ type: 'backend_subscribed', backendId, epoch, capabilities });
      },

      onOutgoingBackendUnsubscribed: (backendId, reason) => {
        this.emit({ type: 'backend_unsubscribed', backendId, reason });
      },

      onOutgoingBackendDataSnapshot: (backendId, sessions, projects) => {
        this.emit({ type: 'backend_data_snapshot_received', backendId, sessions, projects });
      },

      onOutgoingBackendDataEvent: (event) => {
        const backendId = (event as Record<string, unknown>).backendId as string ?? '';
        this.emit({ type: 'backend_data_event_received', backendId, event });
      },

      onOutgoingRunEvent: (backendId, sessionId, event) => {
        this.emit({ type: 'run_event_received', backendId, sessionId, event });
      },

      onOutgoingContentPatch: (backendId, sessionId, messages, latestOffset) => {
        this.emit({ type: 'content_patch_received', backendId, sessionId, messages, latestOffset });
      },
      onOutgoingContentPatchError: (backendId, sessionId, afterOffset, error) => {
        this.emit({ type: 'content_patch_failed', backendId, sessionId, afterOffset, error });
      },

      onOutgoingBackendMessage: (backendId, message) => {
        // Non-session messages (terminal output, heartbeats, etc.) from remote
        // backends — emit as backend_message_received so the runtime core
        // forwards them to the UI via run_event.
        this.emit({ type: 'backend_message_received', backendId, message });
      },
    });
  }

  private wireLocalHandlerEvents(): void {
    if (!this.localHandler) return;
    this.localHandler.onServerEvent((message) => {
      if (!this.localBackendId) return;
      const sessionId = this.getSessionId(message) ?? '';
      this.emit({
        type: 'run_event_received',
        backendId: this.localBackendId,
        sessionId,
        event: message,
      });
    });
  }

  private getSessionId(message: ServerMessage): string | null {
    const candidate = (message as { sessionId?: unknown }).sessionId;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
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
