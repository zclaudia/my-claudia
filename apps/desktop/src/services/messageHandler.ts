/**
 * Shared Message Handler
 *
 * Unified message processing for both direct and gateway connections.
 * All message types except `auth_result` (transport-specific) are handled here.
 *
 * Accesses stores via getState() to avoid stale closures and eliminate
 * useCallback dependency tracking in the calling hooks.
 */

import type { ServerMessage, StateHeartbeatMessage } from '@my-claudia/shared';
import { useChatStore } from '../stores/chatStore';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { usePermissionStore } from '../stores/permissionStore';
import { usePromptRequestStore } from '../stores/promptRequestStore';
import { handleLocalPRMessage } from '../features/local-pr/handlers';
import { handleWorkflowMessage } from '../features/workflows/handlers';
import { handleScheduledTaskMessage } from '../features/scheduled-tasks/handlers';
import { handleSupervisionMessage } from '../features/supervision/handlers';
import { useSystemTaskStore } from '../stores/systemTaskStore';
import { useInteractionStore } from '../stores/interactionStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { getSessionBucketKeyForBackend } from '../stores/sessionsStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { usePluginStore } from '../stores/pluginStore';
import { useFilePushStore } from '../stores/filePushStore';
import { useBackgroundTaskStore } from '../stores/backgroundTaskStore';
import { useProcessMonitorStore } from '../stores/processMonitorStore';
import { useClaudiaStore } from '../stores/claudiaStore';
import { useToastStore } from '../stores/toastStore';
import { downloadPushedFile } from './fileDownload';
import { eagerSyncCurrentSession, recoverCurrentSessionTail } from './sessionSync';
import { xtermRegistry } from '../utils/xtermRegistry';
import { parseBackendId } from '../stores/gatewayStore';
import { resolveCanonicalBackendId, resolveLocalBackendId } from '../utils/controlPlane';

// Throttled lastActivityAt updater — avoids re-renders on every delta message.
// Updates at most once per second per runId.
const lastActivityUpdate = new Map<string, number>();
function updateRunActivity(runId: string): void {
  const now = Date.now();
  const last = lastActivityUpdate.get(runId) || 0;
  if (now - last < 1000) return; // throttle: 1 update per second
  lastActivityUpdate.set(runId, now);
  const chat = useChatStore.getState();
  const health = chat.runHealth[runId];
  if (health) {
    chat.updateRunHealth(runId, { ...health, lastActivityAt: now });
  }
}

export interface MessageHandlerContext {
  /** Virtual server ID (direct server ID or gateway-prefixed ID) */
  serverId: string;
  /** Actual backend ID for gateway connections; null for direct */
  backendId: string | null;
  /** Map of serverId -> active runId set (for heartbeat reconciliation) */
  serverRunsRef: Map<string, Set<string>>;
  /** Resolve the human-readable backend/server name for UI display */
  resolveBackendName: () => string | undefined;
  /** Log prefix, e.g. "Socket:srv1" or "GatewayConn:backend1" */
  logTag: string;
}

/**
 * Unwrap correlation envelope format if present.
 */
function unwrapMessage(rawMessage: ServerMessage | any): ServerMessage {
  if ('payload' in rawMessage && 'metadata' in rawMessage) {
    return {
      type: rawMessage.type,
      ...rawMessage.payload,
    } as ServerMessage;
  }
  return rawMessage as ServerMessage;
}

function isCompletedBackgroundStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}

/**
 * Run event dedup: track max seq per runId.
 * Events with seq <= maxSeq are stale (duplicate or out-of-order).
 * Events without seq (old servers) always pass through.
 */
const maxSeqByRun = new Map<string, number>();
const terminalRunSeqByRun = new Map<string, { seq?: number; endedAt: number }>();
const TERMINAL_RUN_TOMBSTONE_MS = 60_000;

function resolveOwnerBackendId(backendId: string | null, serverId: string): string {
  const rawBackendId = backendId || parseBackendId(serverId) || serverId;
  return resolveCanonicalBackendId(rawBackendId, resolveLocalBackendId() ?? rawBackendId) ?? rawBackendId;
}

function isStaleRunEvent(runId: string, seq?: number): boolean {
  if (seq == null || seq < 1) return false; // Old server without seq — pass through
  const maxSeq = maxSeqByRun.get(runId) ?? 0;
  if (seq <= maxSeq) return true; // Duplicate or stale
  maxSeqByRun.set(runId, seq);
  return false;
}

function recordTerminalRun(runId: string, seq?: number): void {
  terminalRunSeqByRun.set(runId, { seq, endedAt: Date.now() });
}

function clearExpiredTerminalRuns(now = Date.now()): void {
  for (const [runId, tombstone] of terminalRunSeqByRun) {
    if (now - tombstone.endedAt > TERMINAL_RUN_TOMBSTONE_MS) {
      terminalRunSeqByRun.delete(runId);
    }
  }
}

function shouldIgnoreHeartbeatRun(runId: string, lastSeq?: number): boolean {
  const tombstone = terminalRunSeqByRun.get(runId);
  if (!tombstone) return false;
  if (Date.now() - tombstone.endedAt > TERMINAL_RUN_TOMBSTONE_MS) {
    terminalRunSeqByRun.delete(runId);
    return false;
  }
  if (tombstone.seq == null || lastSeq == null) return true;
  return lastSeq <= tombstone.seq;
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

function upsertBackgroundTask(taskId: string, task: import('../stores/backgroundTaskStore').BackgroundTask): void {
  const backgroundTaskStore = useBackgroundTaskStore.getState();
  const existingTask = backgroundTaskStore.tasks[taskId];

  if (existingTask) {
    const nextDescription = !task.description || task.description === 'Background Task'
      ? existingTask.description
      : task.description;
    backgroundTaskStore.updateTask(taskId, {
      ...task,
      startedAt: existingTask.startedAt,
      description: nextDescription,
      toolUseId: task.toolUseId || existingTask.toolUseId,
      cliPid: task.cliPid ?? existingTask.cliPid,
      taskCommand: task.taskCommand ?? existingTask.taskCommand,
      taskRootPid: task.taskRootPid ?? existingTask.taskRootPid,
    });
    return;
  }

  backgroundTaskStore.addTask(task);
}

function reconcileStaleBackgroundRunTasks(
  serverId: string,
  activeBackgroundSessionIds: Set<string>,
): void {
  const backgroundTaskStore = useBackgroundTaskStore.getState();
  const now = Date.now();

  for (const task of Object.values(backgroundTaskStore.tasks)) {
    if (task.source !== 'background_run') continue;
    // Skip tasks belonging to a different server; include tasks with no serverId (legacy)
    if (task.serverId && task.serverId !== serverId) continue;
    if (task.status !== 'started' && task.status !== 'in_progress' && task.status !== 'paused') continue;
    if (!task.id.startsWith('background:')) continue;

    const backgroundSessionId = task.id.slice('background:'.length);
    if (activeBackgroundSessionIds.has(backgroundSessionId)) continue;

    backgroundTaskStore.updateTask(task.id, {
      status: 'stopped',
      summary: task.summary
        ? `${task.summary}\nBackground task no longer active after reconnect`
        : 'Background task no longer active after reconnect',
      completedAt: now,
    });
  }
}

function updateClaudiaTaskStatusBySessionId(
  sessionId: string | undefined,
  status: import('@my-claudia/shared').ClaudiaTaskStatus,
): void {
  if (!sessionId) return;
  const claudiaStore = useClaudiaStore.getState();
  const task = claudiaStore.tasks.find((current) => current.sessionId === sessionId);
  if (!task) return;
  claudiaStore.updateTask(task.id, { status, updatedAt: Date.now() });
}

function buildAIReviewToastMessage(aiMsg: import('@my-claudia/shared').AIReviewCompletedMessage): string | undefined {
  const metadata = aiMsg.metadata;
  if (!metadata?.localReviewerUsed) return undefined;

  const outcome = metadata.localReviewerOutcome || 'unknown';
  const files = metadata.reviewedFileCount ?? 0;
  return `Local reviewer used (${outcome}); reviewed ${files} file${files === 1 ? '' : 's'}.`;
}

function buildAIReviewAutoResolveToastMessage(msg: import('@my-claudia/shared').PermissionAutoResolvedMessage): string | undefined {
  const metadata = msg.metadata;
  if (!metadata?.localReviewerUsed) return undefined;

  const outcome = metadata.localReviewerOutcome || 'unknown';
  const files = metadata.reviewedFileCount ?? 0;
  return `AI review auto-approved with local reviewer (${outcome}); reviewed ${files} file${files === 1 ? '' : 's'}.`;
}

/**
 * Process a server message through the unified handler.
 * Handles all message types except `auth_result` (transport-specific).
 */
export function handleServerMessage(
  rawMessage: ServerMessage | any,
  ctx: MessageHandlerContext
): void {
  const msg = unwrapMessage(rawMessage);
  const { serverId, backendId, serverRunsRef, logTag } = ctx;
  const activeServerId = useServerStore.getState().activeServerId;

  // Update lastActivityAt for run activity messages (throttled to avoid excessive re-renders)
  const runMsg = msg as { runId?: string; type: string };
  if (runMsg.runId && (msg.type === 'delta' || msg.type === 'tool_use' || msg.type === 'tool_result' || msg.type === 'tool_activity')) {
    updateRunActivity(runMsg.runId);
  }

  switch (msg.type) {
    case 'pong':
      break;

    case 'delta': {
      if (isRunEventGap(msg.runId, msg.seq)) recoverRunGap(ctx, msg.runId, msg.seq, msg.sessionId);
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      const deltaSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (deltaSession) {
        useChatStore.getState().appendToLastMessage(deltaSession, msg.content);
        useChatStore.getState().appendTextBlock(msg.runId, msg.content);
      } else if (msg.runId) {
        console.warn(`[${logTag}] Delta for untracked run ${msg.runId}`);
      }
      break;
    }

    case 'run_started': {
      if (isRunEventGap(msg.runId, msg.seq)) recoverRunGap(ctx, msg.runId, msg.seq, msg.sessionId);
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      terminalRunSeqByRun.delete(msg.runId);
      const currentSessionId = useProjectStore.getState().selectedSessionId;
      const targetSessionId = msg.sessionId || currentSessionId;
      const assistantMsgId = msg.assistantMessageId || msg.runId;
      const userMsgId = msg.userMessageId;
      const clientReqId = msg.clientRequestId;
      const isBackground = msg.sessionType === 'background';

      const chat = useChatStore.getState();

      if (targetSessionId) {
        const alreadyTrackingRun = chat.activeRuns[msg.runId] === targetSessionId;
        chat.startRun(msg.runId, targetSessionId, isBackground);
        // Initialize runHealth immediately so timer shows from the start
        // (don't wait for the first state_heartbeat which is 30s away)
        const now = Date.now();
        chat.updateRunHealth(msg.runId, {
          sessionId: targetSessionId,
          startedAt: now,
          lastActivityAt: now,
          health: 'healthy',
        });
        if (serverId === activeServerId) {
          chat.clearSystemInfo(targetSessionId);
        }
        if (userMsgId && clientReqId) chat.updateMessageIdByClientMessageId(targetSessionId, clientReqId, userMsgId);
        if (msg.assistantMessageId || !alreadyTrackingRun) {
          chat.addMessage(targetSessionId, {
            id: assistantMsgId,
            sessionId: targetSessionId,
            role: 'assistant',
            content: '',
            createdAt: Date.now(),
          });
        }

        if (!isBackground) {
          // Track run-to-server mapping (only for foreground runs; background cleanup
          // happens via run_completed broadcast, not heartbeat reconciliation)
          if (!serverRunsRef.has(serverId)) {
            serverRunsRef.set(serverId, new Set());
          }
          serverRunsRef.get(serverId)!.add(msg.runId);

          useProjectStore.getState().setSessionActive(targetSessionId, true);
          // Update unified active-session index for both local and gateway contexts
          useSessionsStore.getState().setSessionActiveFlag(
            getSessionBucketKeyForBackend(backendId),
            targetSessionId,
            true
          );
          // Gateway: also update session snapshot flag
          if (backendId) useSessionsStore.getState().setSessionActiveById(backendId, targetSessionId, true);
        }
      } else {
        console.warn(`[${logTag}] run_started ignored: no sessionId`);
      }
      break;
    }

    case 'run_completed': {
      if (isRunEventGap(msg.runId, msg.seq)) recoverRunGap(ctx, msg.runId, msg.seq, msg.sessionId);
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      const completedSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      console.log(`[${logTag}] run_completed runId=${msg.runId} sessionId=${completedSession ?? 'unknown'} seq=${msg.seq ?? 'none'}`);
      if (completedSession) {
        usePromptRequestStore.getState().clearRequestsForSession(completedSession);
        useInteractionStore.getState().clearSession(completedSession);
        useChatStore.getState().finalizeRunToMessage(msg.runId);
        if (msg.usage) {
          useChatStore.getState().addSessionUsage(completedSession, msg.usage);
        }
        useProjectStore.getState().setSessionActive(completedSession, false);
        useSessionsStore.getState().setSessionActiveFlag(
          getSessionBucketKeyForBackend(backendId),
          completedSession,
          false
        );
        if (backendId) useSessionsStore.getState().setSessionActiveById(backendId, completedSession, false);
        void eagerSyncCurrentSession(serverId);
        void recoverCurrentSessionTail(serverId, completedSession);
      }
      recordTerminalRun(msg.runId, msg.seq);
      lastActivityUpdate.delete(msg.runId);
      useChatStore.getState().endRun(msg.runId);
      serverRunsRef.get(serverId)?.delete(msg.runId);
      maxSeqByRun.delete(msg.runId);
      break;
    }

    case 'run_failed': {
      if (isRunEventGap(msg.runId, msg.seq)) recoverRunGap(ctx, msg.runId, msg.seq, msg.sessionId);
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      const failedSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      console.log(`[${logTag}] run_failed runId=${msg.runId} sessionId=${failedSession ?? 'unknown'} seq=${msg.seq ?? 'none'}`);
      if (failedSession) {
        usePromptRequestStore.getState().clearRequestsForSession(failedSession);
        useInteractionStore.getState().clearSession(failedSession);
        if (msg.error) {
          useChatStore.getState().appendToLastMessage(failedSession, `\n\n**Error:** ${msg.error}`);
        }
        useChatStore.getState().finalizeRunToMessage(msg.runId);
        useProjectStore.getState().setSessionActive(failedSession, false);
        useSessionsStore.getState().setSessionActiveFlag(
          getSessionBucketKeyForBackend(backendId),
          failedSession,
          false
        );
        if (backendId) useSessionsStore.getState().setSessionActiveById(backendId, failedSession, false);
        void eagerSyncCurrentSession(serverId);
        void recoverCurrentSessionTail(serverId, failedSession);
      }
      recordTerminalRun(msg.runId, msg.seq);
      lastActivityUpdate.delete(msg.runId);
      useChatStore.getState().endRun(msg.runId);
      serverRunsRef.get(serverId)?.delete(msg.runId);
      maxSeqByRun.delete(msg.runId);
      console.error(`[${logTag}] Run failed:`, msg.error);
      break;
    }

    case 'tool_use': {
      if (isRunEventGap(msg.runId, msg.seq)) recoverRunGap(ctx, msg.runId, msg.seq, msg.sessionId);
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      const toolSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (toolSession) {
        useChatStore.getState().addToolCall(msg.runId, msg.toolUseId, msg.toolName, msg.toolInput);
        useChatStore.getState().addToolUseBlock(msg.runId, msg.toolUseId);
      } else if (msg.runId) {
        console.warn(`[${logTag}] tool_use for untracked run ${msg.runId}`);
      }
      break;
    }

    case 'tool_result': {
      if (isRunEventGap(msg.runId, msg.seq)) recoverRunGap(ctx, msg.runId, msg.seq, msg.sessionId);
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      const resultSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (resultSession) {
        useChatStore.getState().updateToolCallResult(msg.runId, msg.toolUseId, msg.result, msg.isError);
      } else if (msg.runId) {
        console.warn(`[${logTag}] tool_result for untracked run ${msg.runId}`);
      }
      break;
    }

    case 'tool_activity': {
      if (isRunEventGap(msg.runId, msg.seq)) recoverRunGap(ctx, msg.runId, msg.seq, msg.sessionId);
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      if (msg.runId && msg.toolUseId && msg.content) {
        useChatStore.getState().updateToolCallActivity(msg.runId, msg.toolUseId, msg.content);
      }
      break;
    }

    case 'mode_change':
      if (isRunEventGap(msg.runId, msg.seq)) recoverRunGap(ctx, msg.runId, msg.seq, msg.sessionId);
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      useChatStore.getState().setRuntimeMode(msg.sessionId, msg.mode);
      break;

    case 'permission_request': {
      const permMsg = msg as import('@my-claudia/shared').PermissionRequestMessage;
      const backendName = ctx.resolveBackendName();
      usePermissionStore.getState().setPendingRequest({
        requestId: permMsg.requestId,
        sessionId: permMsg.sessionId,
        serverId,
        backendName,
        toolName: permMsg.toolName,
        detail: permMsg.detail,
        matchedRule: permMsg.matchedRule,
        timeoutSec: permMsg.timeoutSeconds,
        requiresCredential: permMsg.requiresCredential,
        credentialHint: permMsg.credentialHint,
        aiInitiated: permMsg.aiInitiated,
      });
      updateClaudiaTaskStatusBySessionId(permMsg.sessionId, 'waiting');
      break;
    }

    case 'prompt_request': {
      const backendName = ctx.resolveBackendName();
      usePromptRequestStore.getState().setPendingRequest({
        requestId: msg.requestId,
        sessionId: msg.sessionId,
        serverId,
        backendName,
        questions: msg.questions,
      });
      break;
    }

    case 'permission_resolved':
      updateClaudiaTaskStatusBySessionId((msg as import('@my-claudia/shared').PermissionResolvedMessage).sessionId, 'running');
      usePermissionStore.getState().clearRequestById(msg.requestId);
      break;

    case 'permission_auto_resolved': {
      updateClaudiaTaskStatusBySessionId((msg as import('@my-claudia/shared').PermissionAutoResolvedMessage).sessionId, 'running');
      const autoResolveToast = buildAIReviewAutoResolveToastMessage(msg as import('@my-claudia/shared').PermissionAutoResolvedMessage);
      if (autoResolveToast) {
        useToastStore.getState().add({
          title: 'Permission auto-approved',
          message: autoResolveToast,
          type: 'success',
        });
      }
      usePermissionStore.getState().clearRequestById(msg.requestId);
      break;
    }

    case 'ai_review_completed': {
      const aiMsg = msg as import('@my-claudia/shared').AIReviewCompletedMessage;
      usePermissionStore.getState().setAIReviewResult(aiMsg.requestId, {
        decision: aiMsg.decision,
        reasoning: aiMsg.reasoning,
        confidence: aiMsg.confidence,
        metadata: aiMsg.metadata,
      });
      const toastMessage = buildAIReviewToastMessage(aiMsg);
      if (toastMessage) {
        useToastStore.getState().add({
          title: 'AI review completed',
          message: toastMessage,
          type: aiMsg.decision === 'deny' ? 'error' : 'info',
        });
      }
      break;
    }

    case 'prompt_request_resolved':
      usePromptRequestStore.getState().clearRequestById(msg.requestId);
      break;

    // Phase 1: Unified Interaction Events
    case 'interaction_prompt':
    case 'interaction_approval':
    case 'interaction_todo_update':
    case 'interaction_plan_review':
      useInteractionStore.getState().upsertInteraction(msg);
      break;

    case 'interaction_resolved':
      useInteractionStore.getState().resolveInteraction(msg.interactionId);
      break;

    case 'process_cleanup_result':
      useProcessMonitorStore.getState().setCleanupResult(msg);
      break;

    case 'system_info':
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      if (serverId === activeServerId) {
        const sessionId = useChatStore.getState().activeRuns[msg.runId];
        if (sessionId) {
          useChatStore.getState().setSystemInfo(sessionId, msg.systemInfo);
        } else {
          console.warn(`[${logTag}] system_info for untracked run ${msg.runId}`);
        }
      }
      break;

    case 'background_task_update': {
      const targetSessionId = msg.parentSessionId || msg.sessionId;
      if (!targetSessionId) break;

      const taskId = `background:${msg.sessionId}`;
      const mappedStatus = msg.status === 'running'
        ? 'in_progress'
        : msg.status === 'paused'
        ? 'paused'
        : msg.status;

      upsertBackgroundTask(taskId, {
        id: taskId,
        serverId,
        sessionId: targetSessionId,
        description: msg.name || 'Background Task',
        source: 'background_run',
        stoppable: false,
        status: mappedStatus,
        startedAt: Date.now(),
        summary: msg.reason,
        completedAt: isCompletedBackgroundStatus(mappedStatus) ? Date.now() : undefined,
      });
      break;
    }

    case 'task_notification': {
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      // Add/update background task in store
      if (msg.sessionId && msg.taskId) {
        upsertBackgroundTask(msg.taskId, {
          id: msg.taskId,
          serverId,
          sessionId: msg.sessionId,
          description: msg.message || 'Background Task',
          source: 'sdk_task',
          stoppable: true,
          status: (msg.status || 'in_progress') as 'started' | 'in_progress' | 'paused' | 'completed' | 'failed' | 'stopped',
          startedAt: Date.now(),
          summary: msg.message,
          completedAt: isCompletedBackgroundStatus(msg.status) ? Date.now() : undefined,
          cliPid: msg.cliPid,
          taskCommand: msg.taskCommand,
          taskRootPid: msg.taskRootPid,
        });
      }

      // Task notifications are displayed in BackgroundTaskPanel — no need to add
      // a system message to the chat. Adding one would break streaming by inserting
      // a message after the active assistant message, causing isLastAssistant to fail.
      break;
    }

    case 'task_progress': {
      upsertBackgroundTask(msg.taskId, {
        id: msg.taskId,
        serverId,
        toolUseId: msg.toolUseId,
        sessionId: msg.sessionId,
        description: msg.description || 'Background Task',
        source: 'sdk_task',
        stoppable: true,
        status: 'in_progress',
        startedAt: Date.now(),
        usage: msg.usage,
        summary: msg.lastToolName ? `Last tool: ${msg.lastToolName}` : undefined,
      });
      break;
    }

    case 'task_status_notification': {
      upsertBackgroundTask(msg.taskId, {
        id: msg.taskId,
        serverId,
        toolUseId: msg.toolUseId,
        sessionId: msg.sessionId,
        description: msg.summary || 'Background Task',
        source: 'sdk_task',
        stoppable: true,
        status: msg.status,
        startedAt: Date.now(),
        completedAt: Date.now(),
        outputFile: msg.outputFile,
        summary: msg.summary,
        usage: msg.usage,
      });
      break;
    }

    case 'supervision_task_update':
    case 'supervision_agent_update':
    case 'supervision_checkpoint':
      handleSupervisionMessage(msg);
      break;

    case 'sessions_created': {
      const { session } = msg as any;
      const store = useProjectStore.getState();
      if (!store.sessions.find((s: any) => s.id === session.id)) {
        store.addSession(session);
      }
      break;
    }

    case 'sessions_updated': {
      const { session } = msg as any;
      useProjectStore.getState().updateSession(session.id, session);
      break;
    }

    case 'local_pr_update':
    case 'local_pr_deleted':
      handleLocalPRMessage(msg);
      break;

    case 'scheduled_task_update':
    case 'scheduled_task_deleted':
      handleScheduledTaskMessage(msg);
      break;

    case 'system_task_update': {
      const { task } = msg as any;
      useSystemTaskStore.getState().updateTask(task);
      break;
    }

    case 'workflow_update':
    case 'workflow_deleted':
    case 'workflow_run_update':
    case 'workflow_step_types_changed':
      handleWorkflowMessage(msg);
      break;

    case 'claudia_task_created': {
      const taskMsg = msg as import('@my-claudia/shared').ClaudiaTaskCreatedMessage;
      const claudiaStore = useClaudiaStore.getState();
      const optimistic = claudiaStore.tasks.find(t => t.id === taskMsg.clientRequestId);
      if (optimistic) {
        claudiaStore.removeTask(taskMsg.clientRequestId);
        claudiaStore.addTask({
          ...optimistic,
          id: taskMsg.taskId,
          sessionId: taskMsg.sessionId || null,
          branchId: taskMsg.branchId || null,
          branchAction: taskMsg.branchAction,
          contextReset: taskMsg.contextReset,
          title: taskMsg.title,
          status: taskMsg.status,
          updatedAt: Date.now(),
        });
      } else {
        claudiaStore.addTask({
          id: taskMsg.taskId,
          sessionId: taskMsg.sessionId || null,
          branchId: taskMsg.branchId || null,
          branchAction: taskMsg.branchAction,
          contextReset: taskMsg.contextReset,
          input: '',
          title: taskMsg.title,
          status: taskMsg.status,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      // Update active branch: only switch on reuse/create, not on fork (parallel tasks stay background)
      if (taskMsg.branchAction !== 'forked') {
        claudiaStore.setActiveBranchId(taskMsg.projectId, taskMsg.branchId);
      }
      break;
    }

    case 'claudia_task_snapshot': {
      const snapshotMsg = msg as import('@my-claudia/shared').ClaudiaTaskSnapshotMessage;
      const snapshotStore = useClaudiaStore.getState();
      const snapshotTasks = [...snapshotMsg.tasks]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(t => ({ ...t, branchId: t.branchId ?? null }));
      snapshotStore.setTasks(snapshotTasks);
      snapshotStore.setActiveBranchIds(
        Object.fromEntries(snapshotMsg.activeBranches.map((state) => [state.projectId, state.branchId]))
      );
      break;
    }

    case 'claudia_message_delta': {
      const inlineDelta = msg as import('@my-claudia/shared').ClaudiaMessageDeltaMessage;
      useClaudiaStore.getState().appendInlineDelta(inlineDelta.clientRequestId, inlineDelta.content);
      break;
    }

    case 'claudia_message_completed': {
      const inlineCompleted = msg as import('@my-claudia/shared').ClaudiaMessageCompletedMessage;
      useClaudiaStore.getState().completeInline(inlineCompleted.clientRequestId, inlineCompleted.responseText);
      break;
    }

    case 'claudia_message_failed': {
      const inlineFailed = msg as import('@my-claudia/shared').ClaudiaMessageFailedMessage;
      useClaudiaStore.getState().failInline(inlineFailed.clientRequestId, inlineFailed.error);
      break;
    }

    case 'claudia_message_promoted': {
      const inlinePromoted = msg as import('@my-claudia/shared').ClaudiaMessagePromotedMessage;
      const claudiaForPromotion = useClaudiaStore.getState();
      const inline = claudiaForPromotion.inlineResponses.find((r) => r.clientRequestId === inlinePromoted.clientRequestId);
      claudiaForPromotion.promoteInline(inlinePromoted.clientRequestId, inlinePromoted.taskId);
      // Create a task entry with the accumulated streaming text
      claudiaForPromotion.addTask({
        id: inlinePromoted.taskId,
        sessionId: inlinePromoted.sessionId,
        branchId: inlinePromoted.branchId || null,
        branchAction: inlinePromoted.branchAction,
        contextReset: inlinePromoted.contextReset,
        input: inline?.input || '',
        title: (inline?.input || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        status: 'running',
        createdAt: inline?.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
      // Update active branch (promoted inline tasks are always on the active branch)
      if (inlinePromoted.branchId && inlinePromoted.branchAction !== 'forked') {
        claudiaForPromotion.setActiveBranchId(inlinePromoted.projectId, inlinePromoted.branchId);
      }
      // Transfer accumulated text to streaming
      if (inline?.streamingText) {
        claudiaForPromotion.appendStreamingText(inlinePromoted.taskId, inline.streamingText);
      }
      break;
    }

    case 'claudia_task_delta': {
      const deltaMsg = msg as import('@my-claudia/shared').ClaudiaTaskDeltaMessage;
      useClaudiaStore.getState().appendStreamingText(deltaMsg.taskId, deltaMsg.content);
      break;
    }

    case 'claudia_task_update': {
      const updateMsg = msg as import('@my-claudia/shared').ClaudiaTaskUpdateMessage;
      const claudiaStoreForUpdate = useClaudiaStore.getState();
      const existing = claudiaStoreForUpdate.tasks.find((t) => t.id === updateMsg.taskId);
      if (!existing) {
        claudiaStoreForUpdate.addTask({
          id: updateMsg.taskId,
          sessionId: updateMsg.sessionId || null,
          branchId: updateMsg.branchId || null,
          branchAction: updateMsg.branchAction,
          contextReset: updateMsg.contextReset,
          input: updateMsg.input || '',
          title: updateMsg.title || updateMsg.input || 'Claudia Task',
          status: updateMsg.status,
          createdAt: updateMsg.createdAt || Date.now(),
          updatedAt: updateMsg.updatedAt || Date.now(),
          ...(updateMsg.summary ? { summary: updateMsg.summary } : {}),
          ...(updateMsg.error ? { error: updateMsg.error } : {}),
          ...(updateMsg.responseText !== undefined ? { responseText: updateMsg.responseText } : {}),
          ...(updateMsg.toolCount != null ? { toolCount: updateMsg.toolCount } : {}),
        });
        if (updateMsg.status === 'completed' || updateMsg.status === 'failed' || updateMsg.status === 'cancelled') {
          claudiaStoreForUpdate.clearStreamingText(updateMsg.taskId);
        }
        break;
      }

      claudiaStoreForUpdate.updateTask(updateMsg.taskId, {
        status: updateMsg.status,
        ...(updateMsg.sessionId ? { sessionId: updateMsg.sessionId } : {}),
        ...(updateMsg.branchId ? { branchId: updateMsg.branchId } : {}),
        ...(updateMsg.branchAction ? { branchAction: updateMsg.branchAction } : {}),
        ...(updateMsg.contextReset !== undefined ? { contextReset: updateMsg.contextReset } : {}),
        ...(updateMsg.input ? { input: updateMsg.input } : {}),
        ...(updateMsg.title ? { title: updateMsg.title } : {}),
        ...(updateMsg.createdAt ? { createdAt: updateMsg.createdAt } : {}),
        ...(updateMsg.updatedAt ? { updatedAt: updateMsg.updatedAt } : {}),
        ...(updateMsg.summary ? { summary: updateMsg.summary } : {}),
        ...(updateMsg.error ? { error: updateMsg.error } : {}),
        ...(updateMsg.responseText !== undefined ? { responseText: updateMsg.responseText } : {}),
        ...(updateMsg.toolCount != null ? { toolCount: updateMsg.toolCount } : {}),
      });
      // Clear streaming text on completion
      if (updateMsg.status === 'completed' || updateMsg.status === 'failed' || updateMsg.status === 'cancelled') {
        claudiaStoreForUpdate.clearStreamingText(updateMsg.taskId);
      }
      break;
    }

    case 'notification_update': {
      const { item } = msg as import('@my-claudia/shared').NotificationUpdateMessage;
      const ownerBackendId = resolveOwnerBackendId(backendId, serverId);
      import('../stores/notificationFeedStore').then(m => m.useNotificationFeedStore.getState().upsertItem({
        ...item,
        ownerBackendId: item.ownerBackendId ?? ownerBackendId,
      }));
      // Toast notification for completed/failed feed items
      if (item.status === 'completed' || item.status === 'failed') {
        import('../stores/toastStore').then(m => {
          m.useToastStore.getState().add({
            title: item.title,
            message: item.status === 'completed' ? (item.summary?.slice(0, 100) || 'Task completed') : (item.error?.slice(0, 100) || 'Task failed'),
            type: item.status === 'completed' ? 'success' : 'error',
          });
        });
      }
      break;
    }

    case 'notification_list': {
      const feedMsg = msg as import('@my-claudia/shared').NotificationListMessage;
      const ownerBackendId = resolveOwnerBackendId(backendId, serverId);
      import('../stores/notificationFeedStore').then(m => {
        m.useNotificationFeedStore.getState().setFeedList(
          feedMsg.items.map((item) => ({
            ...item,
            ownerBackendId: item.ownerBackendId ?? ownerBackendId,
          })),
          feedMsg.hasMore,
          feedMsg.unreadCount,
          feedMsg.append,
        );
        m.useNotificationFeedStore.getState().setLoading(false);
      });
      break;
    }

    case 'notification_read': {
      const readMsg = msg as import('@my-claudia/shared').NotificationReadMessage;
      import('../stores/notificationFeedStore').then(m => {
        m.useNotificationFeedStore.getState().markRead(
          readMsg.itemIds,
          readMsg.unreadCount,
          readMsg.readAt,
        );
      });
      break;
    }

    case 'state_heartbeat': {
      const heartbeat = msg as StateHeartbeatMessage;
      const backendName = ctx.resolveBackendName();
      const chatState = useChatStore.getState();
      clearExpiredTerminalRuns();

      const serverActiveRunIds = new Set(heartbeat.activeRuns.map(r => r.runId));
      const activeBackgroundSessionIds = new Set(
        heartbeat.activeRuns
          .filter(r => r.sessionType === 'background')
          .map(r => r.sessionId)
      );

      // Add missing runs (server has active run, client doesn't know about it)
      for (const run of heartbeat.activeRuns) {
        if (!chatState.activeRuns[run.runId]) {
          if (shouldIgnoreHeartbeatRun(run.runId, run.lastSeq)) {
            console.log(`[${logTag}] Ignoring stale heartbeat resurrection for run ${run.runId} lastSeq=${run.lastSeq ?? 'none'}`);
            continue;
          }
          const isBackground = run.sessionType === 'background';
          console.log(`[${logTag}] Heartbeat resurrecting run ${run.runId} sessionId=${run.sessionId} lastSeq=${run.lastSeq ?? 'none'}`);
          chatState.startRun(run.runId, run.sessionId, isBackground);
          if (!isBackground) {
            // Only track foreground runs in serverRunsRef for heartbeat cleanup
            if (!serverRunsRef.has(serverId)) {
              serverRunsRef.set(serverId, new Set());
            }
            serverRunsRef.get(serverId)!.add(run.runId);
          }
        }
      }

      // Clean up stale runs (client thinks run is active, but server says it's not)
      const trackedRuns = serverRunsRef.get(serverId);
      if (trackedRuns) {
        for (const runId of trackedRuns) {
          if (!serverActiveRunIds.has(runId)) {
            console.log(`[${logTag}] Cleaning up stale run ${runId} (not in server heartbeat)`);
            const sessionId = chatState.activeRuns[runId];
            chatState.finalizeRunToMessage(runId);
            chatState.endRun(runId);
            if (sessionId) {
              useProjectStore.getState().setSessionActive(sessionId, false);
              useSessionsStore.getState().setSessionActiveFlag(
                getSessionBucketKeyForBackend(backendId),
                sessionId,
                false
              );
              void eagerSyncCurrentSession(serverId);
              void recoverCurrentSessionTail(serverId, sessionId);
            }
            trackedRuns.delete(runId);
          }
        }
      }

      // Update run health info from heartbeat
      for (const run of heartbeat.activeRuns) {
        if (run.systemInfo) {
          chatState.setSystemInfo(run.sessionId, run.systemInfo);
        }
        chatState.updateRunHealth(run.runId, {
          sessionId: run.sessionId,
          startedAt: run.startedAt,
          lastActivityAt: run.lastActivityAt,
          health: run.health,
          loopPattern: run.loopPattern,
        });
      }

      reconcileStaleBackgroundRunTasks(serverId, activeBackgroundSessionIds);

      // Reconcile permissions — always clear stale (fixes direct connections not cleaning up)
      const validPermIds = new Set<string>(heartbeat.pendingPermissions.map(p => p.requestId));
      usePermissionStore.getState().clearStaleRequests(serverId, validPermIds);
      for (const perm of heartbeat.pendingPermissions) {
        if (!usePermissionStore.getState().hasRequest(perm.requestId)) {
          usePermissionStore.getState().setPendingRequest({
            requestId: perm.requestId,
            sessionId: perm.sessionId,
            serverId,
            backendName,
            toolName: perm.toolName,
            detail: perm.detail,
            timeoutSec: perm.timeoutSeconds,
            requiresCredential: perm.requiresCredential,
            credentialHint: perm.credentialHint,
            aiInitiated: perm.aiInitiated,
          });
        }
      }

      // Reconcile questions — always clear stale
      const validQIds = new Set<string>(heartbeat.pendingQuestions.map(q => q.requestId));
      usePromptRequestStore.getState().clearStaleRequests(serverId, validQIds);
      for (const q of heartbeat.pendingQuestions) {
        if (!usePromptRequestStore.getState().hasRequest(q.requestId)) {
          usePromptRequestStore.getState().setPendingRequest({
            requestId: q.requestId,
            sessionId: q.sessionId,
            serverId,
            backendName,
            questions: q.questions,
          });
        }
      }

      // Gateway: also reconcile sessionsStore active status (exclude background sessions)
      if (backendId) {
        const activeSessionIds = new Set<string>(
          heartbeat.activeRuns
            .filter(r => r.sessionType !== 'background')
            .map(r => r.sessionId)
        );
        useSessionsStore.getState().reconcileActiveStatus(backendId, activeSessionIds);
      } else {
        const activeSessionIds = new Set<string>(
          heartbeat.activeRuns
            .filter(r => r.sessionType !== 'background')
            .map(r => r.sessionId)
        );
        useSessionsStore.getState().setActiveSessionsForBackend(getSessionBucketKeyForBackend(backendId), activeSessionIds);
      }

      // Sync feed unread count from heartbeat (covers offline/reconnect scenario)
      if (heartbeat.unreadFeedCount !== undefined) {
        import('../stores/notificationFeedStore').then(m => {
          const store = m.useNotificationFeedStore.getState();
          if (store.unreadCount !== heartbeat.unreadFeedCount) {
            m.useNotificationFeedStore.setState({ unreadCount: heartbeat.unreadFeedCount! });
          }
        });
      }
      break;
    }

    case 'terminal_opened': {
      if (!msg.success) {
        console.error(`[${logTag}] Terminal open failed:`, msg.error);
        const entry = xtermRegistry.get(msg.terminalId);
        if (entry) {
          entry.terminal.writeln(`\r\n\x1b[31mTerminal failed to open: ${msg.error || 'Unknown error'}\x1b[0m`);
        }
      }
      break;
    }

    case 'terminal_attached': {
      const attachEntry = xtermRegistry.get(msg.terminalId);
      if (attachEntry) {
        if (msg.success && msg.scrollback) {
          // Replay scrollback buffer to restore terminal history
          for (const chunk of msg.scrollback) {
            attachEntry.terminal.write(chunk);
          }
        } else if (!msg.success) {
          attachEntry.terminal.writeln(`\r\n\x1b[31mTerminal attach failed: ${msg.error || 'Unknown error'}\x1b[0m`);
        }
      }
      useTerminalStore.getState().markReady(msg.terminalId);
      break;
    }

    case 'terminal_output': {
      const entry = xtermRegistry.get(msg.terminalId);
      if (entry) {
        entry.terminal.write(msg.data);
        useTerminalStore.getState().markReady(msg.terminalId);
      }
      break;
    }

    case 'terminal_exited': {
      const exitTerm = xtermRegistry.get(msg.terminalId)?.terminal;
      if (exitTerm) exitTerm.write(`\r\n[Process exited with code ${msg.exitCode}]\r\n`);
      useTerminalStore.getState().handleTerminalExited(msg.terminalId);
      xtermRegistry.delete(msg.terminalId);
      break;
    }

    case 'file_push': {
      useChatStore.getState().addMessage(msg.sessionId, {
        id: msg.messageId || `file-push-${msg.fileId}`,
        sessionId: msg.sessionId,
        role: 'system',
        content: `File pushed: ${msg.fileName}`,
        metadata: {
          filePush: {
            fileId: msg.fileId,
            fileName: msg.fileName,
            mimeType: msg.mimeType,
            fileSize: msg.fileSize,
            description: msg.description,
            autoDownload: msg.autoDownload,
          },
        },
        createdAt: Date.now(),
      });

      useFilePushStore.getState().addItem({
        fileId: msg.fileId,
        fileName: msg.fileName,
        mimeType: msg.mimeType,
        fileSize: msg.fileSize,
        sessionId: msg.sessionId,
        description: msg.description,
        autoDownload: msg.autoDownload,
        serverId,
      });
      if (msg.autoDownload) {
        downloadPushedFile(msg.fileId);
      }
      break;
    }

    case 'error':
      console.error(`[${logTag}] Server error:`, msg.message);
      break;

    case 'plugin_state': {
      const pluginStore = usePluginStore.getState();
      const now = new Date().toISOString();
      pluginStore.setPlugins(msg.plugins.map((p: any) => ({
        manifest: {
          id: p.id,
          name: p.name,
          version: p.version,
          description: p.description,
          permissions: p.permissions,
          platform: p.platform,
        },
        path: p.path,
        status: p.status === 'active' ? 'active' : p.status === 'error' ? 'error' : 'idle',
        enabled: p.enabled,
        error: p.error,
        installedAt: now,
        updatedAt: now,
      })));

      // Register panels from active plugins (so panels survive reconnects)
      for (const p of msg.plugins as any[]) {
        if (p.status === 'active' && p.panels?.length > 0) {
          for (const panel of p.panels) {
            // Only register if not already registered (avoid overwriting visibility)
            const existing = pluginStore.panels.find((ep: any) => ep.id === panel.id);
            if (!existing) {
              pluginStore.registerPanel({
                id: panel.id,
                pluginId: p.id,
                type: 'panel',
                label: panel.label,
                icon: panel.icon,
                iframeUrl: panel.iframeUrl,
                order: panel.order,
                visible: false,
              });
            }
          }
        }
      }
      break;
    }

    case 'plugin_permission_request': {
      const pluginStoreForPerms = usePluginStore.getState();
      pluginStoreForPerms.setPendingPermissionRequest({
        pluginId: (msg as any).pluginId,
        pluginName: (msg as any).pluginName,
        permissions: (msg as any).permissions,
      });
      break;
    }

    case 'plugin_notification': {
      const pluginMsg = msg as import('@my-claudia/shared').PluginNotificationMessage;
      import('../stores/notificationFeedStore').then(m => m.useNotificationFeedStore.getState().upsertItem({
        id: `plugin-${pluginMsg.pluginId}-${Date.now()}`,
        ownerBackendId: resolveOwnerBackendId(backendId, serverId),
        source: 'trigger',
        title: pluginMsg.title,
        summary: pluginMsg.body,
        status: 'completed',
        createdAt: Date.now(),
      }));
      import('../stores/toastStore').then(m => {
        m.useToastStore.getState().add({
          title: pluginMsg.title,
          message: pluginMsg.body,
          type: 'info',
        });
      });
      break;
    }

    case 'plugin_show_panel':
    case 'plugin_panel_registered':
    case 'plugin_panel_unregistered': {
      if (msg.type === 'plugin_show_panel') {
        usePluginStore.getState().updatePanelVisibility(msg.panelId, true);
        useBottomPanelStore.getState().setActiveTab(msg.panelId);
      } else if (msg.type === 'plugin_panel_registered') {
        usePluginStore.getState().registerPanel({
          id: msg.panelId,
          pluginId: msg.pluginId,
          type: 'panel',
          label: msg.label,
          icon: msg.icon,
          iframeUrl: msg.iframeUrl,
          order: msg.order,
          visible: false,
        });
      } else {
        usePluginStore.getState().clearPluginExtensions(msg.pluginId);
      }
      break;
    }

    default:
      console.warn(`[${logTag}] Unknown message type:`, (msg as any).type);
  }
}
