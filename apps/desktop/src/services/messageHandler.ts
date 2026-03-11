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
import { useSupervisionStore } from '../stores/supervisionStore';
import { useLocalPRStore } from '../stores/localPRStore';
import { useScheduledTaskStore } from '../stores/scheduledTaskStore';
import { useSystemTaskStore } from '../stores/systemTaskStore';
import { useWorkflowStore } from '../stores/workflowStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { LOCAL_BACKEND_KEY } from '../stores/sessionsStore';
import { useTerminalStore } from '../stores/terminalStore';
import { usePluginStore } from '../stores/pluginStore';
import { useFilePushStore } from '../stores/filePushStore';
import { useBackgroundTaskStore } from '../stores/backgroundTaskStore';
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
      const currentSessionId = useProjectStore.getState().selectedSessionId;
      const targetSessionId = msg.sessionId || currentSessionId;
      const assistantMsgId = msg.assistantMessageId || msg.runId;
      const userMsgId = msg.userMessageId;
      const clientReqId = msg.clientRequestId;
      const isBackground = msg.sessionType === 'background';

      const chat = useChatStore.getState();

      if (targetSessionId) {
        chat.startRun(msg.runId, targetSessionId, isBackground);
        if (serverId === activeServerId) {
          chat.clearSystemInfo(targetSessionId);
        }
        if (userMsgId && clientReqId) chat.updateMessageIdByClientMessageId(targetSessionId, clientReqId, userMsgId);
        chat.addMessage(targetSessionId, {
          id: assistantMsgId,
          sessionId: targetSessionId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
        });

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
      const completedSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (completedSession) {
        useAskUserQuestionStore.getState().clearRequestsForSession(completedSession);
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
      break;
    }

    case 'run_failed': {
      const failedSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (failedSession) {
        useAskUserQuestionStore.getState().clearRequestsForSession(failedSession);
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
      console.error(`[${logTag}] Run failed:`, msg.error);
      break;
    }

    case 'tool_use': {
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
      const resultSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (resultSession) {
        useChatStore.getState().updateToolCallResult(msg.runId, msg.toolUseId, msg.result, msg.isError);
      } else if (msg.runId) {
        console.warn(`[${logTag}] tool_result for untracked run ${msg.runId}`);
      }
      break;
    }

    case 'tool_activity': {
      if (msg.runId && msg.toolUseId && msg.content) {
        useChatStore.getState().updateToolCallActivity(msg.runId, msg.toolUseId, msg.content);
      }
      break;
    }

    case 'mode_change':
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

    case 'system_info':
      if (serverId === activeServerId) {
        const sessionId = useChatStore.getState().activeRuns[msg.runId];
        if (sessionId) {
          useChatStore.getState().setSystemInfo(sessionId, msg.systemInfo);
        } else {
          console.warn(`[${logTag}] system_info for untracked run ${msg.runId}`);
        }
      }
      break;

    case 'task_notification': {
      // Add/update background task in store
      if (msg.sessionId && msg.taskId) {
        const backgroundTaskStore = useBackgroundTaskStore.getState();
        const existingTask = backgroundTaskStore.tasks[msg.taskId];

        if (existingTask) {
          // Update existing task
          backgroundTaskStore.updateTask(msg.taskId, {
            status: msg.status as 'started' | 'in_progress' | 'completed' | 'failed' | 'stopped',
            summary: msg.message,
            completedAt: msg.status === 'completed' || msg.status === 'failed' || msg.status === 'stopped' ? Date.now() : undefined,
          });
        } else {
          // Add new task
          backgroundTaskStore.addTask({
            id: msg.taskId,
            sessionId: msg.sessionId,
            description: msg.message || 'Background Task',
            status: msg.status as 'started' | 'in_progress' | 'completed' | 'failed' | 'stopped',
            startedAt: Date.now(),
            completedAt: msg.status === 'completed' || msg.status === 'failed' || msg.status === 'stopped' ? Date.now() : undefined,
          });
        }
      }

      // Task notifications are displayed in BackgroundTaskPanel — no need to add
      // a system message to the chat. Adding one would break streaming by inserting
      // a message after the active assistant message, causing isLastAssistant to fail.
      break;
    }

    case 'supervision_task_update': {
      const v2Store = useSupervisionStore.getState();
      const { task, projectId } = msg as any;
      v2Store.upsertTask(projectId, task);
      break;
    }

    case 'supervision_agent_update': {
      const v2Store = useSupervisionStore.getState();
      const { projectId, agent } = msg as any;
      v2Store.setAgent(projectId, agent);
      break;
    }

    case 'supervision_checkpoint': {
      const v2Store = useSupervisionStore.getState();
      const { projectId, summary } = msg as any;
      v2Store.setCheckpointSummary(projectId, summary);
      break;
    }

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

    case 'local_pr_update': {
      const { projectId, pr } = msg as any;
      useLocalPRStore.getState().upsertPR(projectId, pr);
      break;
    }

    case 'local_pr_deleted': {
      const { projectId, prId } = msg as any;
      useLocalPRStore.getState().removePR(projectId, prId);
      break;
    }

    case 'scheduled_task_update': {
      const { projectId, task } = msg as any;
      useScheduledTaskStore.getState().upsertTask(projectId, task);
      break;
    }

    case 'scheduled_task_deleted': {
      const { projectId, taskId } = msg as any;
      useScheduledTaskStore.getState().removeTask(projectId, taskId);
      break;
    }

    case 'system_task_update': {
      const { task } = msg as any;
      useSystemTaskStore.getState().updateTask(task);
      break;
    }

    case 'workflow_update': {
      const { projectId, workflow } = msg as any;
      useWorkflowStore.getState().upsertWorkflow(projectId, workflow);
      break;
    }

    case 'workflow_deleted': {
      const { projectId, workflowId } = msg as any;
      useWorkflowStore.getState().removeWorkflow(projectId, workflowId);
      break;
    }

    case 'workflow_run_update': {
      const { projectId, run, stepRuns } = msg as any;
      useWorkflowStore.getState().upsertRun(projectId, run, stepRuns);
      break;
    }

    case 'workflow_step_types_changed': {
      useWorkflowStore.getState().loadStepTypes();
      break;
    }

    case 'state_heartbeat': {
      const heartbeat = msg as StateHeartbeatMessage;
      const backendName = ctx.resolveBackendName();
      const chatState = useChatStore.getState();

      const serverActiveRunIds = new Set(heartbeat.activeRuns.map(r => r.runId));

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
      // Skip plugin UI messages on mobile — mobile only supports pure backend plugins
      if (window.matchMedia('(max-width: 767px)').matches) break;

      if (msg.type === 'plugin_show_panel') {
        useTerminalStore.getState().setBottomPanelTab(`plugin:${msg.panelId}`);
      } else if (msg.type === 'plugin_panel_registered') {
        usePluginStore.getState().registerPanel({
          id: msg.panelId,
          pluginId: msg.pluginId,
          type: 'panel',
          label: msg.label,
          icon: msg.icon,
          iframeUrl: msg.iframeUrl,
          order: msg.order,
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
