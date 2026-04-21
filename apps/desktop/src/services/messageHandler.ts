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
 */

import type { ServerMessage, StateHeartbeatMessage } from '@my-claudia/shared';
import { useChatStore } from '../stores/chatStore';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { usePermissionStore } from '../stores/permissionStore';
import { usePromptRequestStore } from '../stores/promptRequestStore';
import { dispatchFeatureMessage } from '../features/message-dispatcher';
import { useSystemTaskStore } from '../stores/systemTaskStore';
import { useInteractionStore } from '../stores/interactionStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { getSessionBucketKeyForBackend } from '../stores/sessionsStore';
import { useFilePushStore } from '../stores/filePushStore';
import { useBackgroundTaskStore } from '../stores/backgroundTaskStore';
import { useProcessMonitorStore } from '../stores/processMonitorStore';
import { useClaudiaStore } from '../stores/claudiaStore';
import { useToastStore } from '../stores/toastStore';
import { useNotchPanelStore } from '../stores/notchPanelStore';
import { downloadPushedFile } from './fileDownload';
import { eagerSyncCurrentSession, recoverCurrentSessionTail } from './sessionSync';
import { handleClaudiaMessage } from './message-handlers/claudia-messages';
import { handleTerminalMessage } from './message-handlers/terminal-messages';
import { handlePluginMessage } from './message-handlers/plugin-messages';
import { handleNotificationMessage } from './message-handlers/notification-messages';
import { handleHeartbeat } from './message-handlers/heartbeat-reconciliation';
import type { HeartbeatState } from './message-handlers/heartbeat-reconciliation';

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
  if (metadata?.payloadDisposition === 'do_not_send') {
    return 'AI review skipped remote analysis because sensitive local material was detected.';
  }
  if (metadata?.payloadDisposition !== 'send_with_redaction') return undefined;
  const files = metadata.reviewedFileCount ?? 0;
  const redactions = metadata.redactionCount ?? 0;
  return `AI review used sanitized local payload; redactions ${redactions}; reviewed ${files} file${files === 1 ? '' : 's'}.`;
}

function buildAIReviewAutoResolveToastMessage(msg: import('@my-claudia/shared').PermissionAutoResolvedMessage): string | undefined {
  const metadata = msg.metadata;
  if (metadata?.payloadDisposition === 'do_not_send') {
    return 'AI review skipped remote analysis because sensitive local material was detected.';
  }
  if (metadata?.payloadDisposition !== 'send_with_redaction') return undefined;
  const files = metadata.reviewedFileCount ?? 0;
  const redactions = metadata.redactionCount ?? 0;
  return `AI review auto-approved with sanitized local payload; redactions ${redactions}; reviewed ${files} file${files === 1 ? '' : 's'}.`;
}

/**
 * Clean up per-server state caches when a server disconnects.
 */
export function cleanupServerSyncState(serverId: string): void {
  entityVersions.delete(serverId);
  projectFetchInFlight.delete(serverId);
  serverSyncGenerations.set(serverId, (serverSyncGenerations.get(serverId) ?? 0) + 1);
}

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
  const { serverId, backendId, serverRunsRef, logTag } = ctx;
  const activeServerId = useServerStore.getState().activeServerId;

  // Update lastActivityAt for run activity messages (throttled)
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
      const targetSessionId = msg.sessionId;
      if (!targetSessionId) {
        console.warn('[messageHandler] run_started missing sessionId, ignoring');
        break;
      }
      const assistantMsgId = msg.assistantMessageId || msg.runId;
      const userMsgId = msg.userMessageId;
      const clientReqId = msg.clientRequestId;
      const isBackground = msg.sessionType === 'background';

      const chat = useChatStore.getState();

      if (targetSessionId) {
        const alreadyTrackingRun = chat.activeRuns[msg.runId] === targetSessionId;
        chat.startRun(msg.runId, targetSessionId, isBackground);
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
          if (!serverRunsRef.has(serverId)) {
            serverRunsRef.set(serverId, new Set());
          }
          serverRunsRef.get(serverId)!.add(msg.runId);

          useProjectStore.getState().setSessionActive(targetSessionId, true);
          useSessionsStore.getState().setSessionActiveFlag(
            getSessionBucketKeyForBackend(backendId),
            targetSessionId,
            true
          );
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

    // ── Permissions ──

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
        workflowMode: permMsg.workflowMode,
        workflowRunId: permMsg.workflowRunId,
      });
      updateClaudiaTaskStatusBySessionId(permMsg.sessionId, 'waiting');
      useToastStore.getState().add({
        title: 'Permission required',
        message: `${permMsg.toolName} needs approval`,
        type: 'info',
        icon: 'permission',
        sessionId: permMsg.sessionId,
        serverId,
      });
      useNotchPanelStore.getState().open({ auto: true, previewTitle: 'Permission required', tab: 'approvals' });
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
          icon: 'permission',
          serverId,
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
          icon: 'permission',
          serverId,
        });
      }
      break;
    }

    case 'permission_workflow_progress': {
      const progressMsg = msg as any;
      usePermissionStore.getState().setWorkflowProgress(progressMsg.requestId, {
        workflowRunId: progressMsg.workflowRunId,
        currentStep: progressMsg.currentStep,
        completedSteps: progressMsg.completedSteps,
        totalSteps: progressMsg.totalSteps,
      });
      break;
    }

    // ── Interactions ──

    case 'interaction_prompt':
      if (msg.source === 'provider_native') {
        usePromptRequestStore.getState().setPendingRequest({
          requestId: msg.interactionId,
          sessionId: msg.sessionId,
          serverId,
        });
      }
      useInteractionStore.getState().upsertInteraction(msg);
      break;

    case 'interaction_approval':
    case 'interaction_todo_update':
    case 'interaction_plan_review':
      useInteractionStore.getState().upsertInteraction(msg);
      break;

    case 'interaction_resolved':
      usePromptRequestStore.getState().clearRequestById(msg.interactionId);
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

    // ── Background Tasks ──

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

    // ── Sessions / Projects ──

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

    case 'system_task_update': {
      const { task } = msg as any;
      useSystemTaskStore.getState().updateTask(task);
      break;
    }

    // ── Delegated handlers ──

    case 'claudia_task_created':
    case 'claudia_task_snapshot':
    case 'claudia_message_delta':
    case 'claudia_message_completed':
    case 'claudia_message_failed':
    case 'claudia_message_promoted':
    case 'claudia_task_delta':
    case 'claudia_task_update':
      handleClaudiaMessage(msg, serverId);
      break;

    case 'notification_update':
    case 'notification_list':
    case 'notification_read':
      handleNotificationMessage(msg, serverId, backendId);
      break;

    case 'state_heartbeat':
      handleHeartbeat(msg as StateHeartbeatMessage, ctx, heartbeatState);
      break;

    case 'terminal_opened':
    case 'terminal_attached':
    case 'terminal_output':
    case 'terminal_exited':
      handleTerminalMessage(msg, logTag);
      break;

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

    case 'plugin_state':
    case 'plugin_permission_request':
    case 'plugin_notification':
    case 'plugin_show_panel':
    case 'plugin_panel_registered':
    case 'plugin_panel_unregistered':
      handlePluginMessage(msg, serverId, backendId);
      break;

    // ── Feature dispatch ──

    case 'supervision_task_update':
    case 'supervision_agent_update':
    case 'supervision_checkpoint':
    case 'local_pr_update':
    case 'local_pr_deleted':
    case 'workflow_update':
    case 'workflow_deleted':
    case 'workflow_run_update':
    case 'workflow_step_types_changed':
    case 'workflow_trigger_sources_changed':
      dispatchFeatureMessage(msg);
      break;

    default:
      console.warn(`[${logTag}] Unknown message type:`, (msg as any).type);
  }
}
