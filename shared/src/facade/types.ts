/**
 * BackendFacade Type Definitions
 *
 * UI-facing types for the unified backend capability surface.
 * See docs/design/backend-facade.md for full specification.
 */

import type {
  BackendPresence,
  SessionItem,
  ProjectItem,
  BackendDataEventMessage,
  SessionMessage,
} from '../protocol/gateway.js';
import type { ClientMessage, ServerMessage } from '../protocol/messages.js';

// ============================================================================
// State Enums
// ============================================================================

export type BackendFacadeMode = 'embedded' | 'direct';

/** Facade main connection state (transport to gateway or embedded server). */
export type BackendConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

/**
 * Backend runtime state as seen by the facade.
 *
 * Derived from registry presence + subscription + catalog initialization.
 */
export type BackendRuntimeState =
  | 'offline'
  | 'visible'
  | 'subscribing'
  | 'ready'
  | 'error';

/** Backend subscription lifecycle state. */
export type BackendOpenState =
  | 'unsubscribed'
  | 'subscribing'
  | 'subscribed'
  | 'error';

/** Session stream lifecycle state. */
export type SessionStreamState =
  | 'closed'
  | 'opening'
  | 'open'
  | 'closing'
  | 'error';

// ============================================================================
// Snapshots (UI-facing read models)
// ============================================================================

export interface BackendHandle {
  id: string;
}

export interface BackendSnapshot {
  backendId: string;
  name: string;
  online: boolean;
  runtimeState: BackendRuntimeState;
  openState: BackendOpenState;
  instanceId: string;
  deviceId: string;
  channel: string;
  isThisInstance: boolean;
  isThisDevice: boolean;
  capabilities: string[];
  lastError?: string;
}

export interface SessionStreamSnapshot {
  streamKey: string;
  backendId: string;
  sessionId: string;
  state: SessionStreamState;
  lastError?: string;
  latestOffset?: number;
  updatedAt: number;
}

export interface BackendFacadeSnapshot {
  snapshotVersion: number;
  capturedAt: number;
  mode: BackendFacadeMode;
  connectionState: BackendConnectionState;
  localBackendId: string | null;
  currentInstanceId: string | null;
  currentDeviceId: string | null;
  backends: BackendSnapshot[];
  sessionStreams: Record<string, SessionStreamSnapshot>;
}

// ============================================================================
// Internal Runtime Records
// ============================================================================

/**
 * Internal record maintained by FacadeRegistryStore.
 *
 * Tracks the full lifecycle state of a single backend, derived from
 * registry presence, channel, catalog, and epoch alignment.
 *
 * @internal Not exported from the public facade API.
 */
export interface BackendRuntimeRecord {
  backendId: string;

  /** Raw presence from gateway registry. null if removed. */
  presence: BackendPresence | null;
  currentEpoch: number | null;

  /** Whether this client is subscribed to this backend. */
  subscribed: boolean;

  /** Backend data initialization tracking (sessions + projects). */
  dataInitialized: boolean;

  lastError?: string;
  lastClosureReason?: string;

  /** Derived states. */
  runtimeState: BackendRuntimeState;
  openState: BackendOpenState;

  /** Capabilities reported at channel open. */
  capabilities: string[];
}

/**
 * Diff produced by FacadeRegistryStore on state transitions.
 * Used by runtime to emit facade events.
 */
export interface BackendStateDiff {
  backendId: string;
  previousRuntimeState?: BackendRuntimeState;
  nextRuntimeState: BackendRuntimeState;
  previousOpenState?: BackendOpenState;
  nextOpenState: BackendOpenState;
  reason?: string;
}

// ============================================================================
// Session Stream Internal Models
// ============================================================================

/** Business intent: should this stream be open? @internal */
export interface DesiredSessionStream {
  streamKey: string;
  backendId: string;
  sessionId: string;
  shouldBeOpen: boolean;
  autoResume: boolean;
  openedAt: number;
  updatedAt: number;
}

/** Current runtime state of a session stream. @internal */
export interface SessionStreamRuntime {
  streamKey: string;
  backendId: string;
  sessionId: string;

  state: SessionStreamState;

  latestOffset?: number;
  lastError?: string;
  lastCloseReason?: string;

  source: 'desired' | 'ephemeral';
  lastActivityAt: number;

  openedAt?: number;
  closedAt?: number;
  updatedAt: number;
}

// ============================================================================
// Stream Manager Result Types
// ============================================================================

/** Commands that StreamManager returns for runtime to execute via adapter. */
export type StreamCommand =
  | { type: 'open_session_stream'; backendId: string; sessionId: string }
  | { type: 'close_session_stream'; backendId: string; sessionId: string }
  | { type: 'catch_up_content'; backendId: string; sessionId: string; afterOffset: number };

/** Events that StreamManager returns for runtime to broadcast. */
export type StreamEvent =
  | { type: 'session_stream_state_changed'; stream: SessionStreamSnapshot }
  | { type: 'content_patch'; backendId: string; sessionId: string; messages: SessionMessage[]; latestOffset: number }
  | { type: 'content_patch_failed'; backendId: string; sessionId: string; afterOffset: number; error: string }
  | { type: 'run_event'; backendId: string; sessionId: string; event: ServerMessage };

/** Composite result from StreamManager operations. */
export interface StreamManagerResult {
  commands: StreamCommand[];
  events: StreamEvent[];
}

// ============================================================================
// Facade Events (UI-facing semantic events)
// ============================================================================

export type BackendFacadeEvent =
  | { type: 'connection_state_changed'; state: BackendConnectionState; error?: string }
  | { type: 'snapshot_updated'; snapshot: BackendFacadeSnapshot }
  | { type: 'backend_state_changed'; backendId: string; state: BackendRuntimeState; error?: string }
  | { type: 'backend_data_snapshot'; backendId: string; sessions: SessionItem[]; projects: ProjectItem[] }
  | { type: 'backend_data_event'; backendId: string; event: BackendDataEventMessage }
  | { type: 'session_stream_state_changed'; stream: SessionStreamSnapshot }
  | { type: 'run_event'; backendId: string; sessionId: string; event: ServerMessage }
  | { type: 'content_patch_failed'; backendId: string; sessionId: string; afterOffset: number; error: string }
  | { type: 'content_patch'; backendId: string; sessionId: string; messages: SessionMessage[]; latestOffset: number };

// ============================================================================
// BackendFacade Interface (UI-facing contract)
// ============================================================================

export interface BackendFacade {
  connect(): void;
  disconnect(): void;

  getSnapshot(): BackendFacadeSnapshot;
  subscribe(listener: (snapshot: BackendFacadeSnapshot) => void): () => void;
  onEvent(listener: (event: BackendFacadeEvent) => void): () => void;

  openBackend(backendId: string): void;
  closeBackend(backendId: string): void;

  sendToBackend(backendId: string, message: ClientMessage): void;

  openSessionStream(backendId: string, sessionId: string): void;
  closeSessionStream(backendId: string, sessionId: string): void;

  catchUpContent(backendId: string, sessionId: string, afterOffset: number): void;

  getHttpBaseUrl(backendId: string): string | null;
  getHttpHeaders(): Record<string, string>;

  /** Force an immediate reconnect if the transport is disconnected or stale. */
  forceReconnect?(): void;
  /** Send a health probe to detect half-dead connections (direct gateway mode only). */
  probeHealth?(): void;
}
