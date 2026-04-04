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
  SessionItem,
  ProjectItem,
  BackendDataEventMessage,
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
  | { type: 'registry_snapshot_received'; items: BackendPresence[] }
  | { type: 'backend_subscribed'; backendId: string; epoch: number; capabilities: string[] }
  | { type: 'backend_unsubscribed'; backendId: string; reason: string }
  | { type: 'backend_data_snapshot_received'; backendId: string; sessions: SessionItem[]; projects: ProjectItem[] }
  | { type: 'backend_data_event_received'; backendId: string; event: BackendDataEventMessage }
  | { type: 'session_stream_closed'; backendId: string; sessionId: string; reason: string }
  | { type: 'content_patch_received'; backendId: string; sessionId: string; messages: SessionMessage[]; latestOffset: number }
  | { type: 'content_patch_failed'; backendId: string; sessionId: string; afterOffset: number; error: string }
  | { type: 'run_event_received'; backendId: string; sessionId: string; event: ServerMessage }
  | { type: 'backend_message_received'; backendId: string; message: ServerMessage };

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
    items: BackendPresence[];
  };

  subscriptions: {
    backendIds: string[];
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

  backend: {
    subscribe(backendId: string): void;
    unsubscribe(backendId: string): void;
    sendToBackend(backendId: string, message: ClientMessage): void;
  };

  stream: {
    catchUp(backendId: string, sessionId: string, afterOffset: number): void;
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
    getSnapshot(): Map<string, BackendPresence>;
  };

  backend: {
    isSubscribed(backendId: string): boolean;
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
