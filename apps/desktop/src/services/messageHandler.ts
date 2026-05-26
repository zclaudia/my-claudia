/**
 * Shared Message Handler
 *
 * Unified message processing for both direct and gateway connections.
 * All message types except `auth_result` (transport-specific) are handled here.
 *
 * Large handler groups are extracted into message-handlers/ sub-modules:
 *  - claudia-messages.ts — Claudia task & inline response lifecycle
 *  - heartbeat-reconciliation.ts — state_heartbeat reconciliation
 *  - terminal-messages.ts — terminal I/O lifecycle
 *  - plugin-messages.ts — plugin state, panels, permissions
 *  - notification-messages.ts — notification feed CRUD
 *  - permission-messages.ts — permission and AI review lifecycle
 *  - interaction-messages.ts — provider/native interaction prompts
 *  - background-task-messages.ts — SDK/background task status
 *  - session-messages.ts — session/project/system task updates
 *  - file-push-messages.ts — pushed file notifications
 *  - run-messages.ts — run/chat streaming lifecycle
 */

import type { ServerMessage, StateHeartbeatMessage } from '@my-claudia/shared';
import { useChatStore } from '../stores/chatStore';
import { dispatchFeatureMessage } from '../features/message-dispatcher';
import { recoverCurrentSessionTail } from './sessionSync';
import { handleClaudiaMessage } from './message-handlers/claudia-messages';
import { handleTerminalMessage } from './message-handlers/terminal-messages';
import { handlePluginMessage } from './message-handlers/plugin-messages';
import { handleNotificationMessage } from './message-handlers/notification-messages';
import { handleHeartbeat } from './message-handlers/heartbeat-reconciliation';
import { handlePermissionMessage } from './message-handlers/permission-messages';
import { handleInteractionMessage } from './message-handlers/interaction-messages';
import { handleBackgroundTaskMessage } from './message-handlers/background-task-messages';
import { handleSessionMessage } from './message-handlers/session-messages';
import { handleFilePushMessage } from './message-handlers/file-push-messages';
import { handleErrorMessage } from './message-handlers/error-messages';
import { handleRunMessage } from './message-handlers/run-messages';
import { createMessageDispatcher } from './message-handlers/dispatcher';
import type { HeartbeatState } from './message-handlers/heartbeat-reconciliation';
import type { MessageDispatchContext, MessageHandlerContext } from './message-handlers/types';

export type { MessageDispatchContext, MessageHandlerContext } from './message-handlers/types';

// ============================================
// Helpers & Module-Level State
// ============================================

// Throttled lastActivityAt updater — avoids re-renders on every delta message.
const lastActivityUpdate = new Map<string, number>();
function updateRunActivity(runId: string): void {
  const now = Date.now();
  const last = lastActivityUpdate.get(runId) || 0;
  if (now - last < 1000) return;
  lastActivityUpdate.set(runId, now);
  const chat = useChatStore.getState();
  const health = chat.runHealth[runId];
  if (health) {
    chat.updateRunHealth(runId, { ...health, lastActivityAt: now });
  }
}

function unwrapMessage(rawMessage: ServerMessage | any): ServerMessage {
  if ('payload' in rawMessage && 'metadata' in rawMessage) {
    return {
      type: rawMessage.type,
      ...rawMessage.payload,
    } as ServerMessage;
  }
  return rawMessage as ServerMessage;
}

// Run event dedup: track max seq per runId.
const maxSeqByRun = new Map<string, number>();
const terminalRunSeqByRun = new Map<string, { seq?: number; endedAt: number }>();
const TERMINAL_RUN_TOMBSTONE_MS = 60_000;

// Heartbeat state — shared with heartbeat-reconciliation handler
const entityVersions = new Map<string, { projects: number; plugins: number }>();
const projectFetchInFlight = new Map<string, { version: number; generation: number; promise: Promise<void> }>();
const serverSyncGenerations = new Map<string, number>();

const heartbeatState: HeartbeatState = {
  entityVersions,
  projectFetchInFlight,
  serverSyncGenerations,
  terminalRunSeqByRun,
  TERMINAL_RUN_TOMBSTONE_MS,
};

function isStaleRunEvent(runId: string, seq?: number): boolean {
  if (seq == null || seq < 1) return false;
  const maxSeq = maxSeqByRun.get(runId) ?? 0;
  if (seq <= maxSeq) return true;
  maxSeqByRun.set(runId, seq);
  return false;
}

function recordTerminalRun(runId: string, seq?: number): void {
  terminalRunSeqByRun.set(runId, { seq, endedAt: Date.now() });
}

function isRunEventGap(runId: string, seq?: number): boolean {
  if (seq == null || seq < 1) return false;
  const maxSeq = maxSeqByRun.get(runId) ?? 0;
  return maxSeq > 0 && seq > maxSeq + 1;
}

function recoverRunGap(
  ctx: MessageHandlerContext,
  runId: string,
  seq: number | undefined,
  sessionId?: string,
): void {
  const resolvedSessionId = sessionId || useChatStore.getState().activeRuns[runId];
  console.warn(
    `[${ctx.logTag}] Run event gap detected for ${runId}: expected ${((maxSeqByRun.get(runId) ?? 0) + 1)}, got ${seq ?? 'none'}`
  );
  if (resolvedSessionId) {
    void recoverCurrentSessionTail(ctx.serverId, resolvedSessionId);
  }
}

/**
 * Clean up per-server state caches when a server disconnects.
 */
export function cleanupServerSyncState(serverId: string): void {
  entityVersions.delete(serverId);
  projectFetchInFlight.delete(serverId);
  serverSyncGenerations.set(serverId, (serverSyncGenerations.get(serverId) ?? 0) + 1);
}

const messageDispatcher = createMessageDispatcher<ServerMessage, MessageDispatchContext>([
  {
    types: ['pong'],
    handle: () => true,
  },
  {
    types: [
      'delta',
      'run_started',
      'run_completed',
      'run_failed',
      'tool_use',
      'tool_result',
      'tool_activity',
      'mode_change',
      'system_info',
    ],
    handle: handleRunMessage,
  },
  {
    types: [
      'permission_request',
      'permission_resolved',
      'permission_auto_resolved',
      'ai_review_completed',
      'permission_workflow_progress',
    ],
    handle: handlePermissionMessage,
  },
  {
    types: [
      'interaction_prompt',
      'interaction_approval',
      'interaction_todo_update',
      'interaction_plan_review',
      'interaction_resolved',
      'process_cleanup_result',
    ],
    handle: handleInteractionMessage,
  },
  {
    types: [
      'background_task_update',
      'task_notification',
      'task_progress',
      'task_status_notification',
    ],
    handle: handleBackgroundTaskMessage,
  },
  {
    types: ['sessions_created', 'sessions_updated', 'system_task_update'],
    handle: (msg) => handleSessionMessage(msg),
  },
  {
    types: ['file_push'],
    handle: handleFilePushMessage,
  },
  {
    types: ['error'],
    handle: handleErrorMessage,
  },
  {
    types: [
      'claudia_task_created',
      'claudia_task_snapshot',
      'claudia_message_delta',
      'claudia_message_completed',
      'claudia_message_failed',
      'claudia_message_promoted',
      'claudia_task_delta',
      'claudia_task_update',
    ],
    handle: (msg, ctx) => handleClaudiaMessage(msg, ctx.serverId),
  },
  {
    types: ['notification_update', 'notification_list', 'notification_read'],
    handle: (msg, ctx) => handleNotificationMessage(msg, ctx.serverId, ctx.backendId),
  },
  {
    types: ['state_heartbeat'],
    handle: (msg, ctx) => handleHeartbeat(msg as StateHeartbeatMessage, ctx, heartbeatState),
  },
  {
    types: ['terminal_opened', 'terminal_attached', 'terminal_output', 'terminal_exited'],
    handle: (msg, ctx) => handleTerminalMessage(msg, ctx.logTag),
  },
  {
    types: [
      'plugin_state',
      'plugin_permission_request',
      'plugin_notification',
      'plugin_show_panel',
      'plugin_panel_registered',
      'plugin_panel_unregistered',
      'plugin_notch_tab_registered',
      'plugin_notch_tab_unregistered',
    ],
    handle: (msg, ctx) => handlePluginMessage(msg, ctx.serverId, ctx.backendId),
  },
  {
    types: [
      'supervision_task_update',
      'supervision_agent_update',
      'supervision_checkpoint',
      'local_pr_update',
      'local_pr_deleted',
      'workflow_update',
      'workflow_deleted',
      'workflow_run_update',
      'workflow_step_types_changed',
      'workflow_trigger_sources_changed',
      'bootstrap_event',
    ],
    handle: (msg) => dispatchFeatureMessage(msg),
  },
]);

// ============================================
// Main Handler
// ============================================

/**
 * Process a server message through the unified handler.
 * Handles all message types except `auth_result` (transport-specific).
 */
export function handleServerMessage(
  rawMessage: ServerMessage | any,
  ctx: MessageHandlerContext
): void {
  const msg = unwrapMessage(rawMessage);
  const { logTag } = ctx;

  // Update lastActivityAt for run activity messages (throttled)
  const runMsg = msg as { runId?: string; type: string };
  if (runMsg.runId && (msg.type === 'delta' || msg.type === 'tool_use' || msg.type === 'tool_result' || msg.type === 'tool_activity')) {
    updateRunActivity(runMsg.runId);
  }

  const dispatchCtx: MessageDispatchContext = {
    ...ctx,
    isStaleRunEvent,
    isRunEventGap,
    recoverRunGap: (runId, seq, sessionId) => recoverRunGap(ctx, runId, seq, sessionId),
    recordTerminalRun,
    clearRunActivity: (runId) => lastActivityUpdate.delete(runId),
    clearRunSeq: (runId) => maxSeqByRun.delete(runId),
    clearTerminalRunSeq: (runId) => terminalRunSeqByRun.delete(runId),
  };
  if (messageDispatcher.dispatch(msg, dispatchCtx)) return;

  console.warn(`[${logTag}] Unknown message type:`, (msg as any).type);
}
