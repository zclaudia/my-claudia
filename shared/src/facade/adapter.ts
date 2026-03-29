/**
 * FacadeRuntimeGatewayAdapter
 *
 * The unified CQE contract that BackendFacadeRuntimeCore depends on.
 * Embedded and Direct providers each implement this adapter, wrapping
 * their respective gateway protocol implementations.
 *
 * See docs/design/backend-facade.md § "FacadeRuntimeGatewayAdapter 统一契约"
 */

import type {
  BackendPresence,
  SessionCatalogItem,
  SessionMessage,
} from '../protocol/gateway.js';
import type { ClientMessage, ServerMessage } from '../protocol/messages.js';
import type { BackendFacadeMode } from './types.js';

// ============================================================================
// Adapter Connection State
// ============================================================================

export type FacadeAdapterConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

// ============================================================================
// Adapter Events
// ============================================================================

export type FacadeAdapterEvent =
  | { type: 'connection_state_changed'; state: FacadeAdapterConnectionState; error?: string }
  | { type: 'registry_snapshot_received'; revision: number; items: BackendPresence[] }
  | { type: 'registry_event_received'; revision: number; op: 'upsert' | 'remove'; item?: BackendPresence; backendId?: string }
  | { type: 'backend_channel_opened'; backendId: string; channelId: string; epoch: number; capabilities: string[] }
  | { type: 'backend_channel_closed'; backendId: string; channelId: string; reason: string }
  | { type: 'backend_channel_rejected'; backendId: string; reason: string }
  | { type: 'catalog_snapshot_received'; backendId: string; epoch: number; revision: number; items: SessionCatalogItem[] }
  | { type: 'catalog_event_received'; backendId: string; epoch: number; revision: number; op: 'upsert' | 'remove'; item?: SessionCatalogItem; sessionId?: string }
  | { type: 'catalog_reset_received'; backendId: string; epoch: number }
  | { type: 'session_stream_closed'; backendId: string; channelId: string; sessionId: string; reason: string }
  | { type: 'content_patch_received'; backendId: string; channelId: string; sessionId: string; messages: SessionMessage[]; latestOffset: number }
  | { type: 'content_patch_failed'; backendId: string; channelId: string; sessionId: string; afterOffset: number; error: string }
  | { type: 'run_event_received'; backendId: string; channelId: string; sessionId: string; event: ServerMessage }
  | { type: 'backend_message_received'; backendId: string; channelId: string; message: ServerMessage };

// ============================================================================
// Adapter Bootstrap State
// ============================================================================

export interface FacadeAdapterBootstrapState {
  capturedAt: number;

  connection: {
    state: FacadeAdapterConnectionState;
    lastError?: string;
  };

  identity: {
    instanceId: string;
    deviceId: string;
  };

  registry: {
    revision: number;
    items: BackendPresence[];
  };

  channels: {
    items: Array<{
      backendId: string;
      channelId: string;
      epoch: number;
    }>;
  };
}

// ============================================================================
// Adapter CQE Interface
// ============================================================================

export interface FacadeAdapterCommands {
  connection: {
    connect(): void;
    disconnect(): void;
  };

  channel: {
    openBackendChannel(backendId: string, epoch: number): void;
    closeBackendChannel(channelId: string): void;
    sendToBackend(channelId: string, message: ClientMessage): void;
  };

  catalog: {
    subscribe(backendId: string, epoch: number, lastRevision?: number): void;
    unsubscribe(backendId: string, epoch: number): void;
  };

  stream: {
    open(channelId: string, sessionId: string): void;
    close(channelId: string, sessionId: string): void;
    catchUp(channelId: string, sessionId: string, afterOffset: number): void;
  };
}

export interface FacadeAdapterQueries {
  bootstrap: {
    getInitialState(): FacadeAdapterBootstrapState;
  };

  connection: {
    getState(): FacadeAdapterConnectionState;
  };

  identity: {
    getInstanceId(): string;
    getDeviceId(): string;
  };

  registry: {
    getRevision(): number;
    getSnapshot(): Map<string, BackendPresence>;
  };

  channel: {
    get(backendId: string): { backendId: string; channelId: string; epoch: number } | undefined;
    getAll(): Map<string, { backendId: string; channelId: string; epoch: number }>;
  };

  http: {
    getBaseUrl(backendId: string): string | null;
    getHeaders(): Record<string, string>;
  };
}

export interface FacadeAdapterEventBus {
  subscribe(listener: (event: FacadeAdapterEvent) => void): () => void;
}

export interface FacadeRuntimeGatewayAdapter {
  readonly commands: FacadeAdapterCommands;
  readonly queries: FacadeAdapterQueries;
  readonly events: FacadeAdapterEventBus;
}

// ============================================================================
// RuntimeCore Options
// ============================================================================

export interface BackendFacadeRuntimeCoreOptions {
  adapter: FacadeRuntimeGatewayAdapter;
  mode: BackendFacadeMode;
  localBackendMatcher?: (
    presence: BackendPresence,
    identity: { instanceId: string; deviceId: string },
  ) => boolean;
  /** Called whenever the resolved localBackendId changes (e.g. after registry updates). */
  onLocalBackendIdChanged?: (backendId: string | null) => void;
}
