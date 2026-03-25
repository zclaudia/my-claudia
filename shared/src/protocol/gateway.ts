/**
 * Gateway Sync Protocol
 *
 * See docs/design/gateway-sync-protocol-v2.md for full specification.
 *
 * Key features:
 * - Epoch-bound routing: all messages tied to backendId + epoch
 * - Revision-based sync: registry and catalog use monotonic revisions with gap detection
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
export type RegistryRevision = number;
export type CatalogRevision = number;
export type ChannelId = string;
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
  lastRegistryRevision?: RegistryRevision;
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

export type RegistrySyncPayload =
  | {
      mode: 'snapshot';
      revision: RegistryRevision;
      items: BackendPresence[];
    }
  | {
      mode: 'delta';
      fromRevision: RegistryRevision;
      toRevision: RegistryRevision;
      events: RegistryEvent[];
    };

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

export type RegistryEvent =
  | {
      revision: RegistryRevision;
      op: 'upsert';
      item: BackendPresence;
    }
  | {
      revision: RegistryRevision;
      op: 'remove';
      backendId: BackendId;
    };

export interface ResyncRegistryMessage {
  type: 'resync_registry';
  lastRevision?: RegistryRevision;
}

export interface RegistrySnapshotMessage {
  type: 'registry_snapshot';
  revision: RegistryRevision;
  items: BackendPresence[];
}

export interface RegistryDeltaMessage {
  type: 'registry_delta';
  fromRevision: RegistryRevision;
  toRevision: RegistryRevision;
  events: RegistryEvent[];
}

export interface RegistryEventMessage {
  type: 'registry_event';
  event: RegistryEvent;
}

export type RegistrySyncResponse =
  | {
      mode: 'snapshot';
      revision: RegistryRevision;
      items: BackendPresence[];
    }
  | {
      mode: 'delta';
      fromRevision: RegistryRevision;
      toRevision: RegistryRevision;
      events: RegistryEvent[];
    };

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
// Backend Catalog Protocol
// ============================================================================

export interface SessionCatalogItem {
  sessionId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number;
  lastMessagePreview?: string;
  activeRunStatus?: 'idle' | 'running';
  archived?: boolean;
}

export interface CatalogSnapshotMessage {
  type: 'catalog_snapshot';
  epoch: Epoch;
  revision: CatalogRevision;
  items: SessionCatalogItem[];
}

export type CatalogEventMessage =
  | {
      type: 'catalog_event';
      epoch: Epoch;
      revision: CatalogRevision;
      op: 'upsert';
      item: SessionCatalogItem;
    }
  | {
      type: 'catalog_event';
      epoch: Epoch;
      revision: CatalogRevision;
      op: 'remove';
      sessionId: string;
    };

export interface SubscribeBackendCatalogMessage {
  type: 'subscribe_backend_catalog';
  backendId: BackendId;
  expectedEpoch: Epoch;
  lastRevision?: CatalogRevision;
}

export interface UnsubscribeBackendCatalogMessage {
  type: 'unsubscribe_backend_catalog';
  backendId: BackendId;
  expectedEpoch: Epoch;
}

export interface BackendCatalogSnapshotMessage {
  type: 'backend_catalog_snapshot';
  backendId: BackendId;
  epoch: Epoch;
  revision: CatalogRevision;
  items: SessionCatalogItem[];
}

export interface BackendCatalogDeltaMessage {
  type: 'backend_catalog_delta';
  backendId: BackendId;
  epoch: Epoch;
  fromRevision: CatalogRevision;
  toRevision: CatalogRevision;
  events: CatalogDeltaEvent[];
}

export type CatalogDeltaEvent =
  | {
      revision: CatalogRevision;
      op: 'upsert';
      item: SessionCatalogItem;
    }
  | {
      revision: CatalogRevision;
      op: 'remove';
      sessionId: string;
    };

export type BackendCatalogEventMessage =
  | {
      type: 'backend_catalog_event';
      backendId: BackendId;
      epoch: Epoch;
      revision: CatalogRevision;
      op: 'upsert';
      item: SessionCatalogItem;
    }
  | {
      type: 'backend_catalog_event';
      backendId: BackendId;
      epoch: Epoch;
      revision: CatalogRevision;
      op: 'remove';
      sessionId: string;
    };

export interface BackendCatalogResetMessage {
  type: 'backend_catalog_reset';
  backendId: BackendId;
  epoch: Epoch;
}

export type BackendCatalogSyncResponse =
  | {
      mode: 'snapshot';
      backendId: BackendId;
      epoch: Epoch;
      revision: CatalogRevision;
      items: SessionCatalogItem[];
    }
  | {
      mode: 'delta';
      backendId: BackendId;
      epoch: Epoch;
      fromRevision: CatalogRevision;
      toRevision: CatalogRevision;
      events: CatalogDeltaEvent[];
    };

// ============================================================================
// Backend Channel Protocol
// ============================================================================

export interface OpenBackendChannelMessage {
  type: 'open_backend_channel';
  backendId: BackendId;
  expectedEpoch: Epoch;
}

export interface BackendChannelOpenedMessage {
  type: 'backend_channel_opened';
  backendId: BackendId;
  epoch: Epoch;
  channelId: ChannelId;
  capabilities: string[];
}

export interface BackendChannelRejectedMessage {
  type: 'backend_channel_rejected';
  backendId: BackendId;
  reason: 'offline' | 'epoch_mismatch' | 'max_channels_exceeded';
}

export interface CloseBackendChannelMessage {
  type: 'close_backend_channel';
  channelId: ChannelId;
}

export interface BackendChannelClosedMessage {
  type: 'backend_channel_closed';
  channelId: ChannelId;
  backendId: BackendId;
  reason: 'client_closed' | 'backend_offline' | 'epoch_changed' | 'peer_disconnected';
}

export interface ChannelClientMessage {
  type: 'channel_client_message';
  channelId: ChannelId;
  message: ClientMessage;
}

export interface ChannelServerMessage {
  type: 'channel_server_message';
  channelId: ChannelId;
  message: ServerMessage;
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

export interface OpenSessionStreamMessage {
  type: 'open_session_stream';
  channelId: ChannelId;
  sessionId: string;
}

export interface CloseSessionStreamMessage {
  type: 'close_session_stream';
  channelId: ChannelId;
  sessionId: string;
}

export interface SessionStreamClosedMessage {
  type: 'session_stream_closed';
  channelId: ChannelId;
  sessionId: string;
  reason: 'client_closed' | 'channel_closed' | 'backend_offline' | 'epoch_changed';
}

export type RunStreamEventType =
  | 'run_started'
  | 'run_delta'
  | 'tool_call_started'
  | 'tool_call_delta'
  | 'tool_call_completed'
  | 'run_completed'
  | 'run_failed';

export interface BackendRunStreamEvent {
  type: 'run_stream_event';
  eventType: RunStreamEventType;
  sessionId: string;
  runId: string;
  seq: Seq;
  payload: unknown;
}

export interface RunStreamEvent {
  type: 'run_stream_event';
  eventType: RunStreamEventType;
  channelId: ChannelId;
  sessionId: string;
  runId: string;
  seq: Seq;
  payload: unknown;
}

export interface CatchUpSessionContentMessage {
  type: 'catch_up_session_content';
  channelId: ChannelId;
  sessionId: string;
  afterOffset: Offset;
}

export interface SessionContentPatchMessage {
  type: 'session_content_patch';
  channelId: ChannelId;
  sessionId: string;
  messages: SessionMessage[];
  latestOffset: Offset;
}

// ============================================================================
// Error Model
// ============================================================================

export type GatewayErrorCode =
  | 'INVALID_MESSAGE'
  | 'PROTOCOL_VERSION_MISMATCH'
  | 'UNAUTHORIZED'
  | 'REGISTRY_REVISION_GAP'
  | 'CATALOG_REVISION_GAP'
  | 'BACKEND_OFFLINE'
  | 'BACKEND_EPOCH_MISMATCH'
  | 'BACKEND_CHANNEL_NOT_FOUND'
  | 'BACKEND_CHANNEL_CLOSED'
  | 'MAX_CHANNELS_EXCEEDED'
  | 'SESSION_NOT_FOUND'
  | 'STREAM_GAP_DETECTED'
  | 'RATE_LIMITED';

export type GatewayErrorRecovery =
  | 'resync_registry'
  | 'resync_catalog'
  | 'reopen_channel'
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
  | ResyncRegistryMessage
  | BackendHeartbeatMessage
  | CatalogSnapshotMessage
  | CatalogEventMessage
  | SubscribeBackendCatalogMessage
  | UnsubscribeBackendCatalogMessage
  | OpenBackendChannelMessage
  | CloseBackendChannelMessage
  | ChannelClientMessage
  | ChannelServerMessage
  | OpenSessionStreamMessage
  | CloseSessionStreamMessage
  | BackendRunStreamEvent
  | CatchUpSessionContentMessage;

export type GatewayToPeerMessage =
  | PeerReadyMessage
  | RegistrySnapshotMessage
  | RegistryDeltaMessage
  | RegistryEventMessage
  | HeartbeatAckMessage
  | StreamDemandMessage
  | BackendCatalogSnapshotMessage
  | BackendCatalogDeltaMessage
  | BackendCatalogEventMessage
  | BackendCatalogResetMessage
  | BackendChannelOpenedMessage
  | BackendChannelRejectedMessage
  | BackendChannelClosedMessage
  | ChannelServerMessage
  | RunStreamEvent
  | SessionStreamClosedMessage
  | SessionContentPatchMessage
  | GatewayErrorMessage;

export type BackendToGatewayMessage =
  | PeerHelloMessage
  | ResyncRegistryMessage
  | BackendHeartbeatMessage
  | CatalogSnapshotMessage
  | CatalogEventMessage
  | ChannelServerMessage
  | BackendRunStreamEvent;

export type GatewayToBackendMessage =
  | PeerReadyMessage
  | RegistrySnapshotMessage
  | RegistryDeltaMessage
  | RegistryEventMessage
  | HeartbeatAckMessage
  | StreamDemandMessage
  | ChannelClientMessage
  | GatewayErrorMessage;

export type ClientToGatewayMessage =
  | PeerHelloMessage
  | ResyncRegistryMessage
  | SubscribeBackendCatalogMessage
  | UnsubscribeBackendCatalogMessage
  | OpenBackendChannelMessage
  | CloseBackendChannelMessage
  | ChannelClientMessage
  | OpenSessionStreamMessage
  | CloseSessionStreamMessage
  | CatchUpSessionContentMessage;

export type GatewayToClientMessage =
  | PeerReadyMessage
  | RegistrySnapshotMessage
  | RegistryDeltaMessage
  | RegistryEventMessage
  | BackendCatalogSnapshotMessage
  | BackendCatalogDeltaMessage
  | BackendCatalogEventMessage
  | BackendCatalogResetMessage
  | BackendChannelOpenedMessage
  | BackendChannelRejectedMessage
  | BackendChannelClosedMessage
  | ChannelServerMessage
  | RunStreamEvent
  | SessionStreamClosedMessage
  | SessionContentPatchMessage
  | GatewayErrorMessage;

// ============================================================================
// Client State Model (for reference)
// ============================================================================

export interface ClientRegistryCache {
  revision: RegistryRevision;
  items: Record<BackendId, BackendPresence>;
}

export interface BackendCatalogCache {
  backendId: BackendId;
  epoch: Epoch;
  revision: CatalogRevision;
  items: Record<string, SessionCatalogItem>;
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
