/**
 * Gateway Sync Protocol
 *
 * See docs/design/gateway-sync-protocol-v2.md for full specification.
 *
 * Key features:
 * - Epoch-bound routing: all messages tied to backendId + epoch
 * - Snapshot-based registry sync: full snapshot on every change + periodic push
 * - Channel abstraction: client↔backend interaction via gateway-managed channelId
 * - Stream demand flow control: gateway controls when backend pushes stream events
 * - Heartbeat + lease: application-level liveness detection
 * - No three-way auth: gateway decides channel authorization, backend is unaware of clients
 */

import type { ClientMessage, ServerMessage } from './messages.js';

// ============================================================================
// Core Types
// ============================================================================

export type ProtocolVersion = number;
export type PeerSessionId = string;
export type RecoveryToken = string;
export type BackendId = string;
export type Epoch = number;
export type Offset = number;
export type Seq = number;

/** Current protocol version. */
export const GATEWAY_PROTOCOL_VERSION: ProtocolVersion = 2;

// ============================================================================
// Peer Handshake Protocol
// ============================================================================

export interface PeerHelloMessage {
  type: 'peer_hello';
  protocolVersion: ProtocolVersion;
  peerType: 'client-only' | 'client+backend';
  gatewaySecret: string;
  identity: {
    deviceId: string;
    instanceId: string;
    channel?: string;
    name?: string;
  };
  backend?: {
    visible: boolean;
    capabilities: string[];
  };
}

export interface PeerReadyMessage {
  type: 'peer_ready';
  protocolVersion: ProtocolVersion;
  peerSessionId: PeerSessionId;
  recoveryToken: RecoveryToken;
  backend?: {
    backendId: BackendId;
    epoch: Epoch;
    leaseTtlMs: number;
  };
  registrySync: RegistrySyncPayload;
}

export interface RegistrySyncPayload {
  items: BackendPresence[];
}

// ============================================================================
// Registry Protocol
// ============================================================================

export interface BackendPresence {
  backendId: BackendId;
  instanceId: string;
  deviceId: string;
  name: string;
  channel: string;
  visible: boolean;
  capabilities: string[];
  epoch: Epoch;
  connectedAt: number;
  lastSeenAt: number;
}

/** Client requests an immediate full registry snapshot (e.g. on mobile resume). */
export interface RequestRegistrySnapshotMessage {
  type: 'request_registry_snapshot';
}

export interface RegistrySnapshotMessage {
  type: 'registry_snapshot';
  items: BackendPresence[];
}

// ============================================================================
// Backend Lease and Heartbeat
// ============================================================================

export interface BackendHeartbeatMessage {
  type: 'backend_heartbeat';
  epoch: Epoch;
  observedAt: number;
}

export interface HeartbeatAckMessage {
  type: 'heartbeat_ack';
  epoch: Epoch;
  streamDemand: boolean;
}

// ============================================================================
// Backend Data Protocol (sessions + projects metadata)
// ============================================================================

export type RunStatus = 'idle' | 'running' | 'waiting' | 'failed' | 'completed';

export interface SessionItem {
  sessionId: string;
  projectId?: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number;
  lastMessagePreview?: string;
  runStatus: RunStatus;
  archived?: boolean;
}

export interface ProjectItem {
  projectId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** Backend → Gateway → Client: full data snapshot (sessions + projects). */
export interface BackendDataSnapshotMessage {
  type: 'backend_data_snapshot';
  /** Set by gateway when relaying to clients. Absent when backend sends to gateway. */
  backendId?: BackendId;
  sessions: SessionItem[];
  projects: ProjectItem[];
}

/** Backend → Gateway → Client: incremental data event. */
export type BackendDataEventMessage =
  | { type: 'backend_data_event'; backendId?: BackendId; op: 'session_upsert'; item: SessionItem }
  | { type: 'backend_data_event'; backendId?: BackendId; op: 'session_remove'; sessionId: string }
  | { type: 'backend_data_event'; backendId?: BackendId; op: 'project_upsert'; item: ProjectItem }
  | { type: 'backend_data_event'; backendId?: BackendId; op: 'project_remove'; projectId: string };

/** Client → Gateway → Backend: request immediate data snapshot. */
export interface RequestBackendDataSnapshotMessage {
  type: 'request_backend_data_snapshot';
  backendId: BackendId;
}

// ============================================================================
// Backend Subscription Protocol
// ============================================================================

export interface SubscribeBackendMessage {
  type: 'subscribe_backend';
  backendId: BackendId;
}

export interface BackendSubscribedMessage {
  type: 'backend_subscribed';
  backendId: BackendId;
  epoch: Epoch;
  capabilities: string[];
}

export interface UnsubscribeBackendMessage {
  type: 'unsubscribe_backend';
  backendId: BackendId;
}

export interface BackendUnsubscribedMessage {
  type: 'backend_unsubscribed';
  backendId: BackendId;
  reason: 'client_unsubscribed' | 'backend_offline' | 'epoch_changed' | 'peer_disconnected';
}

export interface BackendClientMessage {
  type: 'backend_client_message';
  backendId: BackendId;
  /** Gateway fills this with the sender's peerSessionId for server-side client identity. */
  sourcePeerSessionId?: PeerSessionId;
  message: ClientMessage;
}

export interface BackendServerMessage {
  type: 'backend_server_message';
  backendId: BackendId;
  /** If set, gateway routes to this specific client instead of broadcasting. */
  targetPeerSessionId?: PeerSessionId;
  message: ServerMessage;
}

/** Gateway → Backend: a subscriber disconnected, clean up its server-side state. */
export interface SubscriberDisconnectedMessage {
  type: 'subscriber_disconnected';
  backendId: BackendId;
  peerSessionId: PeerSessionId;
}

// ============================================================================
// Session Content Protocol
// ============================================================================

export interface SessionMessage {
  messageId: string;
  sessionId: string;
  offset: Offset;
  role: 'user' | 'assistant' | 'system' | 'tool';
  createdAt: number;
  content: unknown;
}

export interface StreamDemandMessage {
  type: 'stream_demand';
  active: boolean;
}

export type RunStreamEventType =
  | 'run_started'
  | 'run_delta'
  | 'tool_call_started'
  | 'tool_call_delta'
  | 'tool_call_completed'
  | 'run_completed'
  | 'run_failed';

/** Backend → Gateway: run stream event from backend (no backendId, gateway adds it). */
export interface BackendRunStreamEvent {
  type: 'run_stream_event';
  eventType: RunStreamEventType;
  sessionId: string;
  runId: string;
  seq: Seq;
  payload: unknown;
}

/** Gateway → Client: run stream event forwarded to subscribers. */
export interface RunStreamEvent {
  type: 'run_stream_event';
  eventType: RunStreamEventType;
  backendId: BackendId;
  sessionId: string;
  runId: string;
  seq: Seq;
  payload: unknown;
}

export interface CatchUpSessionContentMessage {
  type: 'catch_up_session_content';
  backendId: BackendId;
  sessionId: string;
  afterOffset: Offset;
}

export interface SessionContentPatchMessage {
  type: 'session_content_patch';
  backendId: BackendId;
  sessionId: string;
  messages: SessionMessage[];
  latestOffset: Offset;
  runStatus?: RunStatus;
}

export interface SessionContentPatchErrorMessage {
  type: 'session_content_patch_error';
  backendId: BackendId;
  sessionId: string;
  afterOffset: Offset;
  message: string;
}

// ============================================================================
// Error Model
// ============================================================================

export type GatewayErrorCode =
  | 'INVALID_MESSAGE'
  | 'PROTOCOL_VERSION_MISMATCH'
  | 'UNAUTHORIZED'
  | 'BACKEND_OFFLINE'
  | 'BACKEND_NOT_SUBSCRIBED'
  | 'SESSION_NOT_FOUND'
  | 'STREAM_GAP_DETECTED'
  | 'RATE_LIMITED';

export type GatewayErrorRecovery =
  | 'resubscribe'
  | 'catch_up_content'
  | 'reconnect';

export interface GatewayErrorMessage {
  type: 'gateway_error';
  code: GatewayErrorCode;
  message: string;
  recovery?: GatewayErrorRecovery;
}

// ============================================================================
// Union Types
// ============================================================================

export type PeerToGatewayMessage =
  | PeerHelloMessage
  | RequestRegistrySnapshotMessage
  | BackendHeartbeatMessage
  | BackendDataSnapshotMessage
  | BackendDataEventMessage
  | SubscribeBackendMessage
  | UnsubscribeBackendMessage
  | BackendClientMessage
  | BackendServerMessage
  | BackendRunStreamEvent
  | CatchUpSessionContentMessage;

export type GatewayToPeerMessage =
  | PeerReadyMessage
  | RegistrySnapshotMessage
  | HeartbeatAckMessage
  | StreamDemandMessage
  | BackendDataSnapshotMessage
  | BackendDataEventMessage
  | BackendSubscribedMessage
  | BackendUnsubscribedMessage
  | BackendServerMessage
  | RunStreamEvent
  | SessionContentPatchMessage
  | SessionContentPatchErrorMessage
  | GatewayErrorMessage;

export type BackendToGatewayMessage =
  | PeerHelloMessage
  | RequestRegistrySnapshotMessage
  | BackendHeartbeatMessage
  | BackendDataSnapshotMessage
  | BackendDataEventMessage
  | BackendServerMessage
  | BackendRunStreamEvent;

export type GatewayToBackendMessage =
  | PeerReadyMessage
  | RegistrySnapshotMessage
  | HeartbeatAckMessage
  | StreamDemandMessage
  | BackendClientMessage
  | RequestBackendDataSnapshotMessage
  | SubscriberDisconnectedMessage
  | GatewayErrorMessage;

export type ClientToGatewayMessage =
  | PeerHelloMessage
  | RequestRegistrySnapshotMessage
  | SubscribeBackendMessage
  | UnsubscribeBackendMessage
  | BackendClientMessage
  | RequestBackendDataSnapshotMessage
  | CatchUpSessionContentMessage;

export type GatewayToClientMessage =
  | PeerReadyMessage
  | RegistrySnapshotMessage
  | BackendDataSnapshotMessage
  | BackendDataEventMessage
  | BackendSubscribedMessage
  | BackendUnsubscribedMessage
  | BackendServerMessage
  | RunStreamEvent
  | SessionContentPatchMessage
  | SessionContentPatchErrorMessage
  | GatewayErrorMessage;

// ============================================================================
// Client State Model (for reference)
// ============================================================================

export interface ClientRegistryCache {
  items: Record<BackendId, BackendPresence>;
}

export interface BackendDataCache {
  backendId: BackendId;
  sessions: Record<string, SessionItem>;
  projects: Record<string, ProjectItem>;
}

export interface SessionContentCache {
  backendId: BackendId;
  epoch: Epoch;
  sessionId: string;
  maxOffset: Offset;
  messages: SessionMessage[];
}

// ============================================================================
// HTTP Proxy Protocol (shared between gateway server and backend)
// ============================================================================

export interface GatewayHttpProxyRequest {
  type: 'http_proxy_request';
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  bodyEncoding?: 'utf8' | 'base64';
  body?: unknown;
}

export interface GatewayHttpProxyResponse {
  type: 'http_proxy_response';
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
  bodyEncoding: 'utf8' | 'base64';
  body: string;
}

export interface GatewayHttpProxyResponseStart {
  type: 'http_proxy_response_start';
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
}

export interface GatewayHttpProxyResponseChunk {
  type: 'http_proxy_response_chunk';
  requestId: string;
  data: string;
}

export interface GatewayHttpProxyResponseEnd {
  type: 'http_proxy_response_end';
  requestId: string;
}
