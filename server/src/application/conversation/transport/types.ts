import { WebSocket } from 'ws';
import type { ToolCall, ContentBlock } from '@my-claudia/shared/core/message';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { PCPEffectiveProfile } from '@my-claudia/shared/core/pcp';
import type { AskUserQuestionItem } from '@my-claudia/shared/interaction/forms';
import type { PermissionDecision, SystemInfo } from '../../../infrastructure/providers/types.js';
import type { initDatabase } from '../../../infrastructure/storage/db.js';
import type { ProcessMonitor } from '../../../utils/process-monitor.js';
import type { NotificationSender } from '../../../infrastructure/push/notification-sender.js';

export interface ConnectedClient {
  id: string;
  ws: WebSocket;
  isAlive: boolean;
  isLocal: boolean;       // Whether this is a localhost connection
  authenticated: boolean; // Whether the client has been authenticated
}

// Track active runs and their permission callbacks
export interface ActiveRun {
  runId: string;
  clientId: string;
  client: ConnectedClient;      // Direct reference (works for both real WS and virtual gateway clients)
  abortController?: AbortController;
  providerType?: string;         // Provider type for this run (e.g. 'claude', 'opencode')
  providerSessionId?: string;    // Provider session ID (for abort support)
  providerCwd?: string;          // Provider cwd (for abort support)
  pendingPermissions: Map<string, {
    resolve: (decision: PermissionDecision) => void;
    timeout: NodeJS.Timeout | null;
    originalToolInput?: unknown;
    // Original request info for state heartbeat reconstruction
    originalRequest?: {
      toolName: string;
      detail: string;
      matchedRule?: string;
      timeoutSeconds: number;
      sessionId?: string;
      requiresCredential?: boolean;
      credentialHint?: string;
      questions?: AskUserQuestionItem[];
    };
  }>;
  // Streaming state for message persistence (allows cancelRun to save partial content)
  db: ReturnType<typeof initDatabase>;
  sessionId: string;
  projectId: string;
  assistantMessageId: string;
  fullContent: string;
  collectedToolCalls: (ToolCall & { toolUseId: string })[];
  contentBlocks: ContentBlock[];
  saveInterval?: NodeJS.Timeout;
  completed?: boolean;  // True after run_completed/run_failed sent; hides from heartbeat while for-await drains
  sessionType: 'regular' | 'background' | 'agent';  // Session type for this run
  workspaceRoot: string;
  /** Session-scoped remembered permission decisions, hydrated into each run from DB.
   *  Key: toolName for non-bash, `Bash:<normalized-command>` for bash commands/subcommands. */
  rememberedDecisions: Map<string, 'allow' | 'deny'>;
  /** Project-scoped allowlist for paths outside workspace that the user explicitly remembered. */
  allowedOutsideWorkspaceRoots: Set<string>;
  /** True when AI called EnterPlanMode during a non-plan-mode run (not user-initiated). */
  aiInitiatedPlanMode?: boolean;
  // Stuck/loop detection
  startedAt: number;
  lastActivityAt: number;
  recentToolCalls: string[];  // Last N tool names (sliding window for loop detection)
  loopHeartbeatStreak: number; // Consecutive heartbeats that detect a loop pattern
  latestSystemInfo?: SystemInfo; // Used for heartbeat reconciliation on late-joining clients
  eventSeq: number; // Monotonically increasing event sequence number (starts at 0, first event gets seq=1)
  /** PCP effective profile negotiated at run start */
  effectiveProfile?: PCPEffectiveProfile;
  /**
   * Broadcast a message to ALL connected clients (not just the run's originating client).
   * Set up in run-bootstrap.ts. Falls back to run.client.ws if not wired (e.g. supervision).
   */
  broadcast?: (message: ServerMessage) => void;
}

// Message sender interface for abstraction
export interface MessageSender {
  send: (message: ServerMessage) => void;
}

// DEFAULT_PERMISSION_POLICY removed — use DEFAULT_UNIFIED_POLICY from '@my-claudia/shared' instead.
// PERMISSION_TIMEOUT_POLICIES removed — timeout logic is now handled by the permission workflow template.

export const MAX_SESSION_RESET_RETRIES = 1;

export const PERIODIC_SAVE_INTERVAL_MS = 5000;

// Create a virtual client for Gateway-forwarded messages
export function createVirtualClient(
  clientId: string,
  sender: MessageSender
): ConnectedClient {
  return {
    id: clientId,
    ws: {
      readyState: 1, // WebSocket.OPEN
      send: (data: string) => {
        const message = JSON.parse(data);
        sender.send(message);
      }
    } as WebSocket,
    isAlive: true,
    isLocal: false,
    authenticated: true
  };
}
