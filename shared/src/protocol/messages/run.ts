/**
 * Run lifecycle messages: start, cancel, deltas, tool use/result, mode changes,
 * completion/failure, background tasks, agent assistant, and process cleanup.
 */

import type { PermissionMode } from '../../core/provider.js';
import type { SessionType } from '../../core/session.js';
import type { UsageInfo } from '../../core/message.js';
import type { AgentPermissionPolicy } from '../../interaction/permissions.js';

export interface RunStartMessage {
  type: 'run_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  providerId?: string;
  permissionMode?: PermissionMode;  // Kept for backwards compat
  mode?: string;  // Generic mode/agent ID (new unified field)
  model?: string;  // Optional: override model (e.g. 'claude-sonnet-4-5-20250929')
  permissionOverride?: Partial<AgentPermissionPolicy>;  // Optional: session-level permission override
  systemContext?: string;  // Dynamic context prepended to system prompt (e.g. backend list for global agent)
  workingDirectory?: string;  // Optional: override working directory (e.g., for git worktree)
  resend?: boolean;  // True when resending the last user message — server skips inserting a duplicate user message
}

export interface RunCancelMessage {
  type: 'run_cancel';
  runId: string;
}

export interface RunStartedMessage {
  type: 'run_started';
  runId: string;
  sessionId: string;
  clientRequestId: string;
  /** Real DB message ID for the user message (for client-side dedup) */
  userMessageId?: string;
  /** Real DB message ID for the assistant message (for client-side dedup) */
  assistantMessageId?: string;
  /** Session type — background runs should not affect the session's loading state */
  sessionType?: SessionType;
  /** Monotonically increasing event sequence number within this run (starts at 1) */
  seq?: number;
  /** PCP effective provider profile for this run */
  effectiveProfile?: import('../../core/pcp.js').PCPEffectiveProfile;
}

export interface SessionCreatedMessage {
  type: 'session_created';
  sessionId: string;
  sdkSessionId?: string;
}

export interface DeltaMessage {
  type: 'delta';
  runId: string;
  sessionId: string;
  content: string;
  seq?: number;
}

export interface ToolUseMessage {
  type: 'tool_use';
  runId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  seq?: number;
}

export interface ToolResultMessage {
  type: 'tool_result';
  runId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
  seq?: number;
}

export interface ToolActivityMessage {
  type: 'tool_activity';
  runId: string;
  sessionId: string;
  toolUseId: string;
  content: string;
  seq?: number;
}

export interface ModeChangeMessage {
  type: 'mode_change';
  runId: string;
  sessionId: string;
  mode: string;
  seq?: number;
}

export interface RunCompletedMessage {
  type: 'run_completed';
  runId: string;
  sessionId: string;
  usage?: UsageInfo;
  seq?: number;
}

export interface RunFailedMessage {
  type: 'run_failed';
  runId: string;
  sessionId: string;
  error: string;
  seq?: number;
}

export interface KillLeakedProcessesMessage {
  type: 'kill_leaked_processes';
}

export interface ProcessCleanupResultMessage {
  type: 'process_cleanup_result';
  status: 'clean' | 'killed' | 'skipped_active_runs';
  leakedCount: number;
  killedCount: number;
  activeRunCount: number;
}

// Agent Assistant messages

export interface AgentStartMessage {
  type: 'agent_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  providerId?: string;
  model?: string;
  tools?: string[];
}

export interface AgentCancelMessage {
  type: 'agent_cancel';
  sessionId: string;
}

export interface StopBackgroundTaskMessage {
  type: 'stop_background_task';
  sessionId: string;
  taskId: string;
  cliPid?: number;
  taskRootPid?: number;
  taskCommand?: string;
}

// Background task status update (Server → Client)
export type BackgroundTaskStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface BackgroundTaskUpdateMessage {
  type: 'background_task_update';
  sessionId: string;
  parentSessionId?: string;
  status: BackgroundTaskStatus;
  name?: string;
  reason?: string;       // e.g. 'Permission escalated', 'Completed successfully'
}

// Background session has a pending permission that needs user attention (Server → Client)
export interface BackgroundPermissionPendingMessage {
  type: 'background_permission_pending';
  sessionId: string;     // The background session
  requestId: string;     // Permission request ID (use with permission_decision to resolve)
  toolName: string;
  detail: string;
  timeoutSeconds: number;
}

// SDK task notification (e.g. background Bash process exited) (Server → Client)
export interface TaskNotificationMessage {
  type: 'task_notification';
  runId: string;
  sessionId: string;
  taskId?: string;
  status?: string;
  message?: string;
  seq?: number;
  cliPid?: number;         // CLI subprocess PID (for process-tree based task killing)
  taskCommand?: string;    // Actual command being run (e.g. "npm test")
  taskRootPid?: number;    // Root PID of the task's process tree
}

// SDK background task progress update (Server → Client)
export interface TaskProgressMessage {
  type: 'task_progress';
  runId: string;
  sessionId: string;
  taskId: string;
  toolUseId?: string;
  description: string;
  usage: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
  lastToolName?: string;
}

// SDK background task status notification (Server → Client)
export interface TaskStatusNotificationMessage {
  type: 'task_status_notification';
  runId: string;
  sessionId: string;
  taskId: string;
  toolUseId?: string;
  status: 'completed' | 'failed' | 'stopped';
  outputFile: string;
  summary: string;
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
}
