import { sendMessage } from '../transport/broadcast.js';
import type { ActiveRun } from '../transport/types.js';
import { cleanupPendingPermissions, findProcessPidsByTaskCommand, upsertAssistantMessage } from './run-lifecycle.js';
import {
  buildStatusOutput,
  formatProviderErrorMessage,
  SYSTEM_INFO_COMMANDS,
} from '../../../utils/server-utils.js';
import { normalizeFromToolUse } from '../interactions/interaction-normalizer.js';
import { trackAndAutoComplete, finalizeSession, clearSession } from '../interactions/todo-state-tracker.js';
import { pluginEvents } from '../../../infrastructure/events/index.js';
import { generateToolSignature } from '../../../loop-detection.js';
import type { ProviderRegistryPort } from '../../../infrastructure/providers/registry.js';
import type { ClaudeMessage, SystemInfo } from '../../../infrastructure/providers/types.js';
import type { NotificationSender } from '../../../infrastructure/push/notification-sender.js';
import type { NotificationService } from '../../../domains/notification-feed/index.js';
import { postRunCompletedNotification, postRunFailedNotification } from './run-terminal-notifications.js';

export interface ProviderEventState {
  sdkSessionId?: string;
  systemInfo?: SystemInfo;
}

interface HandleProviderEventParams {
  activeRun: ActiveRun;
  activeRuns: Map<string, ActiveRun>;
  client: ActiveRun['client'];
  db: ActiveRun['db'];
  input: string;
  modeValue: string;
  notificationService: NotificationSender;
  notificationsService?: NotificationService;
  persistSessionWorkingDirectory: (nextWorkingDirectory: string | null | undefined) => void;
  providerType: string;
  runId: string;
  sendRunEvent: (event: import('@my-claudia/shared/protocol/messages').ServerMessage) => void;
  sessionId: string;
  sessionType: ActiveRun['sessionType'];
  state: ProviderEventState;
  toolUseIdToName: Map<string, string>;
  msg: ClaudeMessage;
  broadcastHeartbeat: () => void;
  providerRegistry: ProviderRegistryPort;
}

export function handleProviderEvent({
  activeRun,
  activeRuns,
  broadcastHeartbeat,
  client,
  db,
  input,
  modeValue,
  msg,
  notificationService,
  notificationsService,
  persistSessionWorkingDirectory,
  providerRegistry,
  providerType,
  runId,
  sendRunEvent,
  sessionId,
  sessionType,
  state,
  toolUseIdToName,
}: HandleProviderEventParams): void {
  switch (msg.type) {
    case 'init':
      if (msg.systemInfo) {
        state.systemInfo = msg.systemInfo;
        activeRun.latestSystemInfo = msg.systemInfo;
        persistSessionWorkingDirectory(msg.systemInfo.cwd);
        sendRunEvent({
          type: 'system_info',
          runId,
          systemInfo: {
            model: msg.systemInfo.model,
            claudeCodeVersion: msg.systemInfo.claudeCodeVersion,
            cwd: msg.systemInfo.cwd,
            permissionMode: msg.systemInfo.permissionMode,
            apiKeySource: msg.systemInfo.apiKeySource,
            tools: msg.systemInfo.tools,
            mcpServers: msg.systemInfo.mcpServers,
            slashCommands: msg.systemInfo.slashCommands,
            agents: msg.systemInfo.agents,
          },
        });
      }

      if (msg.sessionId && msg.sessionId !== state.sdkSessionId) {
        state.sdkSessionId = msg.sessionId;
        db.prepare(`
          UPDATE sessions SET sdk_session_id = ?, updated_at = ? WHERE id = ?
        `).run(state.sdkSessionId, Date.now(), sessionId);

        activeRun.providerSessionId = state.sdkSessionId;

        sendRunEvent({
          type: 'session_created',
          sessionId,
          sdkSessionId: msg.sessionId,
        });
      }
      break;

    case 'assistant': {
      if (!msg.content) break;

      activeRun.fullContent += msg.content;
      const lastBlock = activeRun.contentBlocks[activeRun.contentBlocks.length - 1];
      if (lastBlock && lastBlock.type === 'text') {
        lastBlock.content += msg.content;
      } else {
        activeRun.contentBlocks.push({ type: 'text', content: msg.content });
      }
      sendRunEvent({
        type: 'delta',
        runId,
        sessionId: activeRun.sessionId,
        content: msg.content,
      });
      break;
    }

    case 'tool_use': {
      if (msg.toolUseId && msg.toolName) {
        toolUseIdToName.set(msg.toolUseId, msg.toolName);
      }

      if (msg.toolName) {
        const inputRecord = msg.toolInput as Record<string, unknown> | undefined;
        const toolSignature = generateToolSignature(msg.toolName, inputRecord, activeRun.providerType);
        activeRun.recentToolCalls.push(toolSignature);
        if (activeRun.recentToolCalls.length > 20) {
          activeRun.recentToolCalls.shift();
        }
      }

      activeRun.collectedToolCalls.push({
        toolUseId: msg.toolUseId || '',
        name: msg.toolName || '',
        input: msg.toolInput,
        effect: msg.toolEffect,
      });
      activeRun.contentBlocks.push({ type: 'tool_use', toolUseId: msg.toolUseId || '' });
      sendRunEvent({
        type: 'tool_use',
        runId,
        sessionId: activeRun.sessionId,
        toolUseId: msg.toolUseId || '',
        toolName: msg.toolName || '',
        toolInput: msg.toolInput,
        semantic: msg.toolSemantic,
        effect: msg.toolEffect,
      });
      pluginEvents.emit('run.toolCall', {
        runId,
        sessionId: activeRun.sessionId,
        toolName: msg.toolName,
        toolUseId: msg.toolUseId,
        toolInput: msg.toolInput,
      }).catch((err: unknown) => {
        console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err);
      });

      const todoInteraction = normalizeFromToolUse({
        sessionId: activeRun.sessionId,
        runId,
        providerType,
        toolUseId: msg.toolUseId || '',
        toolName: msg.toolName || '',
        toolInput: msg.toolInput,
        interactionKind: msg.toolInteractionKind,
      });
      if (todoInteraction) {
        // Auto-complete items in previous todo lists that disappeared from the new list
        for (const update of trackAndAutoComplete(sessionId, todoInteraction.interactionId, todoInteraction.todos)) {
          sendRunEvent({
            type: 'interaction_todo_update',
            interactionId: update.interactionId,
            sessionId: activeRun.sessionId,
            runId,
            provider: providerType,
            source: 'tool_call',
            createdAt: Date.now(),
            todos: update.todos,
          });
        }
        sendRunEvent(todoInteraction);
      }
      break;
    }

    case 'tool_result': {
      const toolName = msg.toolUseId ? toolUseIdToName.get(msg.toolUseId) || '' : '';
      const collected = activeRun.collectedToolCalls.find(tc => tc.toolUseId === msg.toolUseId);
      if (collected) {
        collected.output = msg.toolResult;
        collected.isError = msg.isToolError || false;
      }

      sendRunEvent({
        type: 'tool_result',
        runId,
        sessionId: activeRun.sessionId,
        toolUseId: msg.toolUseId || '',
        toolName,
        result: msg.toolResult,
        isError: msg.isToolError,
      });
      pluginEvents.emit('run.toolResult', {
        runId,
        sessionId: activeRun.sessionId,
        toolName,
        toolUseId: msg.toolUseId,
        result: msg.toolResult,
        isError: msg.isToolError,
      }).catch((err: unknown) => {
        console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err);
      });

      break;
    }

    case 'mode_transition': {
      // Provider SDKs translate their own plan-mode tool calls (Claude's
      // EnterPlanMode / ExitPlanMode, Codex's normalized equivalents, Cursor's
      // switchMode, …) into this normalized event. The runtime stays
      // provider-agnostic — no tool-name or providerType branches here.
      const transition = msg.modeTransition;
      if (!transition) break;

      const targetMode = transition.mode;
      sendRunEvent({
        type: 'mode_change',
        runId,
        sessionId: activeRun.sessionId,
        mode: targetMode,
      });

      if (transition.reason === 'enter') {
        if (modeValue !== 'plan') {
          activeRun.aiInitiatedPlanMode = true;
          activeRun.originalMode = activeRun.originalMode ?? modeValue;
          console.log(`[Permission] AI entered plan mode during ${modeValue} run (provider=${activeRun.providerType})`);
        }
      } else if (transition.reason === 'exit') {
        activeRun.aiInitiatedPlanMode = false;
      }

      // Let the provider sync any session-level mode state (permission gating).
      const adapter = activeRun.providerType ? providerRegistry.get(activeRun.providerType) : undefined;
      adapter?.setSessionMode?.(activeRun.sessionId, targetMode);
      break;
    }

    case 'tool_activity': {
      const lastAgentToolUseId = [...activeRun.collectedToolCalls]
        .reverse()
        .find(tc => tc.name === 'Agent' && !tc.output)?.toolUseId;
      if (lastAgentToolUseId && msg.content) {
        sendRunEvent({
          type: 'tool_activity',
          runId,
          sessionId: activeRun.sessionId,
          toolUseId: lastAgentToolUseId,
          content: msg.content,
        });
      }
      break;
    }

    case 'result': {
      if (msg.content && !activeRun.fullContent) {
        activeRun.fullContent = msg.content;
        activeRun.contentBlocks.push({ type: 'text', content: msg.content });
        sendRunEvent({
          type: 'delta',
          runId,
          sessionId: activeRun.sessionId,
          content: msg.content,
        });
      }

      const inputTrimmed = input.trim().toLowerCase();
      if (!activeRun.fullContent && SYSTEM_INFO_COMMANDS.includes(inputTrimmed) && state.systemInfo) {
        const statusOutput = buildStatusOutput(state.systemInfo);
        if (statusOutput) {
          activeRun.fullContent = statusOutput;
          sendRunEvent({
            type: 'delta',
            runId,
            sessionId: activeRun.sessionId,
            content: statusOutput,
          });
        }
      }

      // Providers may declare a fallback message in their policy for the
      // case where a tool-driven turn ends without any final assistant text
      // (the policy is the source of truth — no provider-type literal here).
      if (
        !activeRun.fullContent &&
        activeRun.collectedToolCalls.length > 0 &&
        activeRun.providerType
      ) {
        const fallback = providerRegistry.getPolicy(activeRun.providerType)?.emptyResultFallback;
        if (fallback) {
          activeRun.fullContent = fallback;
          activeRun.contentBlocks.push({ type: 'text', content: fallback });
          sendRunEvent({
            type: 'delta',
            runId,
            sessionId: activeRun.sessionId,
            content: fallback,
          });
        }
      }

      const lastBlock = activeRun.contentBlocks[activeRun.contentBlocks.length - 1];
      const endsWithThinking = lastBlock?.type === 'text' &&
        lastBlock.content.trimEnd().endsWith('</think>');
      if (endsWithThinking) {
        console.warn(`[Truncation] Run ${runId} ended with a thinking block as last output. Possible provider truncation.`);
        const warning = '\n\n⚠️ *The model appeared to stop mid-thought without producing a response. This may be caused by output token limits or provider compatibility issues. Try sending "continue" or starting a new session.*';
        activeRun.fullContent += warning;
        activeRun.contentBlocks.push({ type: 'text', content: warning });
        sendRunEvent({
          type: 'delta',
          runId,
          sessionId: activeRun.sessionId,
          content: warning,
        });
      }

      upsertAssistantMessage(activeRun, {
        usage: msg.usage,
        indexMetadata: true,
      });

      // Auto-complete all remaining pending/in_progress todo items on run completion
      for (const update of finalizeSession(sessionId)) {
        sendRunEvent({
          type: 'interaction_todo_update',
          interactionId: update.interactionId,
          sessionId: activeRun.sessionId,
          runId,
          provider: providerType,
          source: 'tool_call',
          createdAt: Date.now(),
          todos: update.todos,
        });
      }

      if (activeRun.completed) {
        if (msg.usage) {
          sendRunEvent({
            type: 'run_completed',
            runId,
            sessionId: activeRun.sessionId,
            usage: msg.usage,
          });
        }
      } else {
        sendRunEvent({
          type: 'run_completed',
          runId,
          sessionId: activeRun.sessionId,
          usage: msg.usage,
        });
        activeRun.completed = true;
        pluginEvents.emit('run.completed', {
          runId,
          sessionId: activeRun.sessionId,
          usage: msg.usage,
        }).catch((err: unknown) => {
          console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err);
        });
        broadcastHeartbeat();
        postRunCompletedNotification({
          db,
          sessionId,
          notificationSender: notificationService,
          notificationsService,
        });
      }

      if (sessionType === 'background') {
        sendRunEvent({
          type: 'background_task_update',
          sessionId,
          status: 'completed',
        } as import('@my-claudia/shared/protocol/messages').BackgroundTaskUpdateMessage);
      }
      break;
    }

    case 'error': {
      const rawProviderError = (msg.error || 'Provider error') as string;
      const authHint = activeRun.providerType
        ? providerRegistry.getPolicy(activeRun.providerType)?.authErrorHint
        : undefined;
      const errorMessage = formatProviderErrorMessage(rawProviderError, activeRun.providerType, authHint);
      console.error(`[Provider Error] runId=${runId} provider=${activeRun.providerType}: ${rawProviderError}`);

      if (!activeRun.completed) {
        try {
          upsertAssistantMessage(activeRun, { indexMetadata: true });
        } catch (saveErr) {
          console.error(`[Error Save] Failed for run ${runId}:`, saveErr);
        }
        sendRunEvent({
          type: 'run_failed',
          runId,
          sessionId: activeRun.sessionId,
          error: errorMessage,
        });
        activeRun.completed = true;
        pluginEvents.emit('run.error', {
          runId,
          sessionId: activeRun.sessionId,
          error: errorMessage,
        }).catch((err: unknown) => {
          console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err);
        });
        broadcastHeartbeat();
        postRunFailedNotification({
          db,
          sessionId,
          error: errorMessage,
          notificationSender: notificationService,
          notificationsService,
        });
      }

      clearSession(sessionId);
      cleanupPendingPermissions(activeRun, errorMessage);
      activeRuns.delete(runId);
      break;
    }

    case 'task_notification': {
      // Track in-flight background tasks so the stream stays open for follow-up turns.
      if (msg.taskStatus === 'started') {
        activeRun.pendingBackgroundTasks++;
      } else if (
        msg.taskStatus === 'completed' ||
        msg.taskStatus === 'failed' ||
        msg.taskStatus === 'stopped'
      ) {
        activeRun.pendingBackgroundTasks = Math.max(0, activeRun.pendingBackgroundTasks - 1);
      }

      const adapter = activeRun.providerType ? providerRegistry.get(activeRun.providerType) : undefined;
      const buildTaskNotificationEvent = () => {
        const cliPid = activeRun.providerSessionId
          ? adapter?.getCliPid?.(activeRun.providerSessionId)
          : undefined;
        const taskProcInfo = msg.taskId ? adapter?.getTaskProcessInfo?.(msg.taskId) : undefined;
        return {
          cliPid,
          taskProcInfo,
          event: {
            type: 'task_notification',
            runId,
            sessionId: activeRun.sessionId,
            taskId: msg.taskId,
            status: msg.taskStatus,
            message: msg.taskMessage,
            cliPid,
            taskCommand: taskProcInfo?.command,
            taskRootPid: taskProcInfo?.rootPid,
          } as import('@my-claudia/shared/protocol/messages').TaskNotificationMessage,
        };
      };

      const { cliPid, taskProcInfo, event } = buildTaskNotificationEvent();
      sendRunEvent(event);

      if (msg.taskId && msg.taskStatus === 'started' && !taskProcInfo?.rootPid) {
        const timer = setTimeout(async () => {
          try {
            const refreshed = buildTaskNotificationEvent();
            let resolvedRootPid = refreshed.taskProcInfo?.rootPid;

            if (!resolvedRootPid && refreshed.event.taskCommand) {
              const matchedPids = await findProcessPidsByTaskCommand(
                refreshed.event.taskCommand,
                [refreshed.event.cliPid, refreshed.event.taskRootPid].filter((pid): pid is number => typeof pid === 'number'),
              );
              resolvedRootPid = matchedPids[0];
            }

            if (resolvedRootPid && resolvedRootPid !== taskProcInfo?.rootPid) {
              sendRunEvent({
                ...refreshed.event,
                taskRootPid: resolvedRootPid,
              });
            }
          } catch (error) {
            console.warn(
              `[Task Notification] Failed to backfill PID for taskId=${msg.taskId}:`,
              error instanceof Error ? error.message : error
            );
          }
        }, 1800);
        timer.unref();
      }
      break;
    }
  }
}
