import { WebSocket } from 'ws';
import type { ToolCall, ContentBlock, AgentPermissionPolicy, ServerMessage, PCPEffectiveProfile } from '@my-claudia/shared';
import type { PermissionDecision, SystemInfo } from '../../../providers/claude-sdk.js';
import type { initDatabase } from '../../../storage/db.js';
import type { ProcessMonitor } from '../../../utils/process-monitor.js';
import type { NotificationService } from '../../notification-feed/notification-service.js';

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
      questions?: any[];
      aiInitiated?: boolean;
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
}

// Message sender interface for abstraction
export interface MessageSender {
  send: (message: ServerMessage) => void;
}

// Default permission policy base (used when only project override exists, no global policy)
export const DEFAULT_PERMISSION_POLICY: AgentPermissionPolicy = {
  enabled: false,
  trustLevel: 'conservative',
  customRules: [],
  escalateAlways: ['AskUserQuestion', 'ExitPlanMode'],
};

// Permission timeout policies: keyed by tool name, applied when the request times out.
export const PERMISSION_TIMEOUT_POLICIES: Map<string, {
  behavior: 'approve' | 'deny';
  /** Override timeoutSeconds when the request has no timeout (0). */
  timeoutSeconds?: number;
  condition?: (run: { aiInitiatedPlanMode?: boolean }) => boolean;
}> = new Map([
  ['ExitPlanMode', {
    behavior: 'approve',
    timeoutSeconds: 120, // 2 minutes
    condition: (run) => !!run.aiInitiatedPlanMode,
  }],
]);

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
