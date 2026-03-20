// Gateway Protocol Types

import type { GatewayBackendInfo, ServerFeature } from '../core/server.js';
import type { Session, SessionType } from '../core/session.js';
import type { ClientMessage, ServerMessage } from './messages.js';

// --- Gateway Messages (Backend → Gateway) ---

export interface GatewayRegisterMessage {
  type: 'register';
  gatewaySecret: string;
  deviceId: string;
  instanceId?: string;   // sha256(deviceId + ':' + channel).slice(0, 16) — distinguishes prod/dev on same device
  channel?: string;      // 'prod' | 'dev' | string — defaults to 'prod'
  name?: string;
  visible?: boolean;  // Default true. If false, connects to gateway but is not listed as available backend
}

export interface GatewayRegisterResultMessage {
  type: 'register_result';
  success: boolean;
  backendId?: string;
  instanceId?: string;   // Echo back the resolved instanceId
  error?: string;
}

// Client auth forwarded to backend
export interface GatewayClientAuthMessage {
  type: 'client_auth';
  clientId: string;
}

// Backend's response to client auth
export interface GatewayClientAuthResultMessage {
  type: 'client_auth_result';
  clientId: string;
  success: boolean;
  error?: string;
  features?: ServerFeature[];   // Backend-advertised feature flags
}

// Wrapper for forwarded messages from client to backend
export interface GatewayForwardedMessage {
  type: 'forwarded';
  clientId: string;
  message: ClientMessage;
}

// Wrapper for messages from backend to client
export interface GatewayBackendResponseMessage {
  type: 'backend_response';
  clientId: string;
  message: ServerMessage;
}

// Client connected/disconnected notifications to backend
export interface GatewayClientConnectedMessage {
  type: 'client_connected';
  clientId: string;
}

export interface GatewayClientDisconnectedMessage {
  type: 'client_disconnected';
  clientId: string;
}

// --- Gateway Messages (Client → Gateway) ---

export interface GatewayAuthMessage {
  type: 'gateway_auth';
  gatewaySecret: string;
}

export interface GatewayAuthResultMessage {
  type: 'gateway_auth_result';
  success: boolean;
  error?: string;
  backends?: GatewayBackendInfo[];  // Included on success for immediate discovery
}

export interface GatewayListBackendsMessage {
  type: 'list_backends';
}

export interface GatewayBackendsListMessage {
  type: 'backends_list';
  backends: GatewayBackendInfo[];
}

export interface GatewayConnectBackendMessage {
  type: 'connect_backend';
  backendId: string;
}

export interface GatewayBackendAuthResultMessage {
  type: 'backend_auth_result';
  backendId: string;
  success: boolean;
  error?: string;
  features?: ServerFeature[];   // Backend-advertised feature flags (passthrough)
}

export interface GatewayBackendDisconnectedMessage {
  type: 'backend_disconnected';
  backendId: string;
}

// Client sends messages to a specific backend
export interface GatewaySendToBackendMessage {
  type: 'send_to_backend';
  backendId: string;
  message: ClientMessage;
}

// Gateway forwards backend messages to client
export interface GatewayBackendMessageMessage {
  type: 'backend_message';
  backendId: string;
  message: ServerMessage | BackendSessionsListMessage | BackendSessionEventMessage;
}

export interface GatewayErrorMessage {
  type: 'gateway_error';
  code: string;
  message: string;
  backendId?: string;
}

// --- Session Sync Protocol (Backend → Client via Gateway) ---

// Backend sends full session list to a newly subscribed client
export interface BackendSessionsListMessage {
  type: 'backend_sessions_list';
  backendId: string;
  sessions: Array<{
    id: string;
    projectId: string;
    name?: string;
    providerId?: string;
    type?: SessionType;
    parentSessionId?: string;
    createdAt: number;
    updatedAt: number;
    isActive: boolean;  // Whether there's an active run for this session
    lastMessageOffset?: number;  // Max message offset in this session (for gap detection)
  }>;
}

// Backend broadcasts session event to all subscribed clients
export interface BackendSessionEventMessage {
  type: 'backend_session_event';
  backendId: string;
  eventType: 'created' | 'updated' | 'deleted';
  session: {
    id: string;
    projectId: string;
    name?: string;
    providerId?: string;
    type?: SessionType;
    parentSessionId?: string;
    createdAt: number;
    updatedAt: number;
    isActive?: boolean;
    lastMessageOffset?: number;
  };
}

// Backend → Gateway: request to broadcast session event to all subscribers
export interface GatewayBroadcastSessionEventMessage {
  type: 'broadcast_session_event';
  eventType: 'created' | 'updated' | 'deleted';
  session: Session;
}

// Gateway → Backend: notification that a client has subscribed
export interface GatewayClientSubscribedMessage {
  type: 'client_subscribed';
  clientId: string;
}

// Backend → Gateway: broadcast message to all subscribers
export interface GatewayBroadcastToSubscribersMessage {
  type: 'broadcast_to_subscribers';
  message: ServerMessage | BackendSessionsListMessage | BackendSessionEventMessage;
}

// Client → Gateway: update subscription preferences
export interface GatewayUpdateSubscriptionsMessage {
  type: 'update_subscriptions';
  subscribedBackendIds: string[];
  subscribeAll?: boolean;
}

// Gateway → Client: confirm subscription state
export interface GatewaySubscriptionAckMessage {
  type: 'subscription_ack';
  subscribedBackendIds: string[];
}

// --- Backend Registry (Phase 2: Registry Unification) ---

export interface BackendRegistryEntry {
  backendId: string;
  instanceId: string;
  deviceId: string;
  channel: string;
  name: string;
  visible: boolean;
  online: boolean;
  registeredAt: number;
  updatedAt: number;
}

export interface GatewayRegistrySnapshotMessage {
  type: 'registry_snapshot';
  registry: BackendRegistryEntry[];
}

export interface GatewayRegistryUpsertMessage {
  type: 'registry_upsert';
  entry: BackendRegistryEntry;
}

export interface GatewayRegistryRemoveMessage {
  type: 'registry_remove';
  backendId: string;
  instanceId: string;
}

// --- Gateway HTTP Proxy Protocol ---
// Used when clients connect through Gateway and need to make REST API calls
// to a backend that may be behind NAT.
// Flow: Client → HTTP → Gateway → WS → Backend → WS → Gateway → HTTP → Client

export interface GatewayHttpProxyRequest {
  type: 'http_proxy_request';
  requestId: string;
  method: string;        // GET, POST, PUT, DELETE
  path: string;          // /api/projects, /api/sessions/xxx/messages
  headers: Record<string, string>;
  body?: string;         // JSON string
}

export interface GatewayHttpProxyResponse {
  type: 'http_proxy_response';
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;          // JSON string
}

// Streaming HTTP proxy response (for large/binary payloads)
// Flow: response_start → N × response_chunk → response_end

export interface GatewayHttpProxyResponseStart {
  type: 'http_proxy_response_start';
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
}

export interface GatewayHttpProxyResponseChunk {
  type: 'http_proxy_response_chunk';
  requestId: string;
  data: string;          // base64-encoded binary chunk
}

export interface GatewayHttpProxyResponseEnd {
  type: 'http_proxy_response_end';
  requestId: string;
}

// Union types for Gateway messages
export type GatewayToBackendMessage =
  | GatewayRegisterResultMessage
  | GatewayBackendsListMessage
  | GatewayClientAuthMessage
  | GatewayForwardedMessage
  | GatewayClientConnectedMessage
  | GatewayClientDisconnectedMessage
  | GatewayClientSubscribedMessage
  | GatewayHttpProxyRequest
  | GatewayRegistrySnapshotMessage
  | GatewayRegistryUpsertMessage
  | GatewayRegistryRemoveMessage;

export type BackendToGatewayMessage =
  | GatewayRegisterMessage
  | GatewayClientAuthResultMessage
  | GatewayBackendResponseMessage
  | GatewayBroadcastSessionEventMessage
  | GatewayBroadcastToSubscribersMessage
  | GatewayHttpProxyResponse
  | GatewayHttpProxyResponseStart
  | GatewayHttpProxyResponseChunk
  | GatewayHttpProxyResponseEnd;

export type ClientToGatewayMessage =
  | GatewayAuthMessage
  | GatewayListBackendsMessage
  | GatewayConnectBackendMessage
  | GatewaySendToBackendMessage
  | GatewayUpdateSubscriptionsMessage;

export type GatewayToClientMessage =
  | GatewayAuthResultMessage
  | GatewayBackendsListMessage
  | GatewayBackendAuthResultMessage
  | GatewayBackendDisconnectedMessage
  | GatewayBackendMessageMessage
  | GatewayErrorMessage
  | GatewaySubscriptionAckMessage
  | GatewayRegistrySnapshotMessage
  | GatewayRegistryUpsertMessage
  | GatewayRegistryRemoveMessage;
