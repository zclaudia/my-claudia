/**
 * Core protocol messages: authentication, ping/pong, errors, system info, and state heartbeat.
 */

import type { ServerFeature } from '../../core/server.js';
import type { SessionType } from '../../core/session.js';
import type { AskUserQuestionItem } from '../../interaction/forms.js';

// Authentication message (sent after WebSocket connection)
export interface AuthMessage {
  type: 'auth';
}

export interface PingMessage {
  type: 'ping';
}

export interface PongMessage {
  type: 'pong';
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

// Authentication result message
export interface AuthResultMessage {
  type: 'auth_result';
  success: boolean;
  error?: string;
  isLocalConnection?: boolean;  // Whether the connection is from localhost
  serverVersion?: string;       // Server version string
  features?: ServerFeature[];   // Server-advertised feature flags
  /** PEM-encoded RSA-OAEP public key for E2E credential encryption */
  publicKey?: string;
}

// Run health status for stuck/loop detection
export type RunHealthStatus = 'healthy' | 'idle' | 'loop';

// System info from Claude SDK init message
export interface SystemInfo {
  model?: string;
  claudeCodeVersion?: string;
  cwd?: string;
  permissionMode?: string;
  apiKeySource?: string;
  tools?: string[];
  mcpServers?: { name: string; status: string }[];
  slashCommands?: string[];
  agents?: string[];
}

export interface SystemInfoMessage {
  type: 'system_info';
  runId: string;
  systemInfo: SystemInfo;
  seq?: number;
}

// Server → Client: state heartbeat for reconciliation
export interface StateHeartbeatMessage {
  type: 'state_heartbeat';
  activeRuns: Array<{
    runId: string;
    sessionId: string;
    startedAt: number;
    lastActivityAt: number;
    health: RunHealthStatus;
    loopPattern?: string;
    /** Session type — background runs should not affect the session's loading state */
    sessionType?: SessionType;
    /** Latest init/system metadata for this run (if available). */
    systemInfo?: SystemInfo;
    /** Last event sequence number for this run (for gap detection). */
    lastSeq?: number;
  }>;
  pendingPermissions: Array<{
    requestId: string;
    sessionId: string;
    toolName: string;
    detail: string;
    matchedRule?: string;
    timeoutSeconds: number;
    requiresCredential?: boolean;
    credentialHint?: string;
    aiInitiated?: boolean;
  }>;
  pendingQuestions: Array<{
    requestId: string;
    sessionId: string;
    questions: AskUserQuestionItem[];
  }>;
  /** Unread Agent Feed item count — for badge display on reconnect */
  unreadFeedCount?: number;
  /** Version counters for stable application-layer entities.
   *  Client compares with its local cache and fetches via REST if stale. */
  versions?: {
    projects?: number;
    plugins?: number;
  };
}
