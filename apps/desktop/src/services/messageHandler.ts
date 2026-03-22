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
import { useAskUserQuestionStore } from '../stores/askUserQuestionStore';
import { handleLocalPRMessage } from '../features/local-pr/handlers';
import { handleWorkflowMessage } from '../features/workflows/handlers';
import { handleScheduledTaskMessage } from '../features/scheduled-tasks/handlers';
import { handleSupervisionMessage } from '../features/supervision/handlers';
import { useSystemTaskStore } from '../stores/systemTaskStore';
import { useInteractionStore } from '../stores/interactionStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { LOCAL_BACKEND_KEY } from '../stores/sessionsStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { usePluginStore } from '../stores/pluginStore';
import { useFilePushStore } from '../stores/filePushStore';
import { useBackgroundTaskStore } from '../stores/backgroundTaskStore';
import { useProcessMonitorStore } from '../stores/processMonitorStore';
import { useClaudiaStore } from '../stores/claudiaStore';
import { downloadPushedFile } from './fileDownload';
import { xtermRegistry } from '../utils/xtermRegistry';

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

function isStaleRunEvent(runId: string, seq?: number): boolean {
  if (seq == null || seq < 1) return false; // Old server without seq — pass through
  const maxSeq = maxSeqByRun.get(runId) ?? 0;
  if (seq <= maxSeq) return true; // Duplicate or stale
  maxSeqByRun.set(runId, seq);
  return false;
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

  switch (msg.type) {
    case 'pong':
      break;

    case 'delta': {
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
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
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
            backendId || LOCAL_BACKEND_KEY,
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
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      const completedSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (completedSession) {
        useAskUserQuestionStore.getState().clearRequestsForSession(completedSession);
        useInteractionStore.getState().clearSession(completedSession);
        useChatStore.getState().finalizeRunToMessage(msg.runId);
        if (msg.usage) {
          useChatStore.getState().addSessionUsage(completedSession, msg.usage);
        }
        useProjectStore.getState().setSessionActive(completedSession, false);
        useSessionsStore.getState().setSessionActiveFlag(
          backendId || LOCAL_BACKEND_KEY,
          completedSession,
          false
        );
        if (backendId) useSessionsStore.getState().setSessionActiveById(backendId, completedSession, false);
      }
      useChatStore.getState().endRun(msg.runId);
      serverRunsRef.get(serverId)?.delete(msg.runId);
      maxSeqByRun.delete(msg.runId);
      break;
    }

    case 'run_failed': {
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      const failedSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (failedSession) {
        useAskUserQuestionStore.getState().clearRequestsForSession(failedSession);
        useInteractionStore.getState().clearSession(failedSession);
        if (msg.error) {
          useChatStore.getState().appendToLastMessage(failedSession, `\n\n**Error:** ${msg.error}`);
        }
        useChatStore.getState().finalizeRunToMessage(msg.runId);
        useProjectStore.getState().setSessionActive(failedSession, false);
        useSessionsStore.getState().setSessionActiveFlag(
          backendId || LOCAL_BACKEND_KEY,
          failedSession,
          false
        );
        if (backendId) useSessionsStore.getState().setSessionActiveById(backendId, failedSession, false);
      }
      useChatStore.getState().endRun(msg.runId);
      serverRunsRef.get(serverId)?.delete(msg.runId);
      maxSeqByRun.delete(msg.runId);
      console.error(`[${logTag}] Run failed:`, msg.error);
      break;
    }

    case 'tool_use': {
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
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      if (msg.runId && msg.toolUseId && msg.content) {
        useChatStore.getState().updateToolCallActivity(msg.runId, msg.toolUseId, msg.content);
      }
      break;
    }

    case 'mode_change':
      if (isStaleRunEvent(msg.runId, msg.seq)) break;
      useChatStore.getState().setMode(msg.sessionId, msg.mode);
      break;

    case 'permission_request': {
      const backendName = ctx.resolveBackendName();
      usePermissionStore.getState().setPendingRequest({
        requestId: msg.requestId,
        sessionId: msg.sessionId,
        serverId,
        backendName,
        toolName: msg.toolName,
        detail: msg.detail,
        timeoutSec: msg.timeoutSeconds,
        requiresCredential: msg.requiresCredential,
        credentialHint: msg.credentialHint,
        aiInitiated: msg.aiInitiated,
      });
      break;
    }

    case 'ask_user_question': {
      const backendName = ctx.resolveBackendName();
      useAskUserQuestionStore.getState().setPendingRequest({
        requestId: msg.requestId,
        sessionId: msg.sessionId,
        serverId,
        backendName,
        questions: msg.questions,
      });
      break;
    }

    case 'permission_resolved':
      usePermissionStore.getState().clearRequestById(msg.requestId);
      break;

    case 'permission_auto_resolved':
      usePermissionStore.getState().clearRequestById(msg.requestId);
      break;

    case 'ask_user_question_resolved':
      useAskUserQuestionStore.getState().clearRequestById(msg.requestId);
      break;

    // Phase 1: Unified Interaction Events
    case 'interaction_ask_user':
    case 'interaction_ask_user_form':
    case 'interaction_approval':
    case 'interaction_todo_update':
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
          title: taskMsg.title,
          status: taskMsg.status,
          updatedAt: Date.now(),
        });
      } else {
        claudiaStore.addTask({
          id: taskMsg.taskId,
          sessionId: taskMsg.sessionId || null,
          input: '',
          title: taskMsg.title,
          status: taskMsg.status,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      break;
    }

    case 'claudia_task_snapshot': {
      const snapshotMsg = msg as import('@my-claudia/shared').ClaudiaTaskSnapshotMessage;
      useClaudiaStore.getState().setTasks(
        [...snapshotMsg.tasks].sort((a, b) => b.createdAt - a.createdAt)
      );
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
          input: updateMsg.input || '',
          title: updateMsg.title || updateMsg.input || 'Claudia Task',
          status: updateMsg.status,
          createdAt: updateMsg.createdAt || Date.now(),
          updatedAt: updateMsg.updatedAt || Date.now(),
          ...(updateMsg.summary ? { summary: updateMsg.summary } : {}),
          ...(updateMsg.error ? { error: updateMsg.error } : {}),
        });
        break;
      }

      claudiaStoreForUpdate.updateTask(updateMsg.taskId, {
        status: updateMsg.status,
        ...(updateMsg.sessionId ? { sessionId: updateMsg.sessionId } : {}),
        ...(updateMsg.input ? { input: updateMsg.input } : {}),
        ...(updateMsg.title ? { title: updateMsg.title } : {}),
        ...(updateMsg.createdAt ? { createdAt: updateMsg.createdAt } : {}),
        ...(updateMsg.updatedAt ? { updatedAt: updateMsg.updatedAt } : {}),
        ...(updateMsg.summary ? { summary: updateMsg.summary } : {}),
        ...(updateMsg.error ? { error: updateMsg.error } : {}),
      });
      break;
    }

    case 'agent_feed_update': {
      const { item } = msg as import('@my-claudia/shared').AgentFeedUpdateMessage;
      import('../stores/agentFeedStore').then(m => m.useAgentFeedStore.getState().upsertItem(item));
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

    case 'agent_feed_list': {
      const feedMsg = msg as import('@my-claudia/shared').AgentFeedListMessage;
      import('../stores/agentFeedStore').then(m => {
        m.useAgentFeedStore.getState().setFeedList(
          feedMsg.items,
          feedMsg.hasMore,
          feedMsg.unreadCount,
          feedMsg.append,
        );
        m.useAgentFeedStore.getState().setLoading(false);
      });
      break;
    }

    case 'agent_feed_read': {
      const readMsg = msg as import('@my-claudia/shared').AgentFeedReadMessage;
      import('../stores/agentFeedStore').then(m => {
        m.useAgentFeedStore.getState().markRead(
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

      const serverActiveRunIds = new Set(heartbeat.activeRuns.map(r => r.runId));
      const activeBackgroundSessionIds = new Set(
        heartbeat.activeRuns
          .filter(r => r.sessionType === 'background')
          .map(r => r.sessionId)
      );

      // Add missing runs (server has active run, client doesn't know about it)
      for (const run of heartbeat.activeRuns) {
        if (!chatState.activeRuns[run.runId]) {
          const isBackground = run.sessionType === 'background';
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
                backendId || LOCAL_BACKEND_KEY,
                sessionId,
                false
              );
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
      useAskUserQuestionStore.getState().clearStaleRequests(serverId, validQIds);
      for (const q of heartbeat.pendingQuestions) {
        if (!useAskUserQuestionStore.getState().hasRequest(q.requestId)) {
          useAskUserQuestionStore.getState().setPendingRequest({
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
        useSessionsStore.getState().setActiveSessionsForBackend(LOCAL_BACKEND_KEY, activeSessionIds);
      }

      // Sync feed unread count from heartbeat (covers offline/reconnect scenario)
      if (heartbeat.unreadFeedCount !== undefined) {
        import('../stores/agentFeedStore').then(m => {
          const store = m.useAgentFeedStore.getState();
          if (store.unreadCount !== heartbeat.unreadFeedCount) {
            m.useAgentFeedStore.setState({ unreadCount: heartbeat.unreadFeedCount! });
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

    case 'plugin_notification':
      console.log(`[${logTag}] Plugin notification:`, msg.title, msg.body);
      break;

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
