import type { PlanReviewInteractionMessage, ServerMessage } from '@my-claudia/shared';
import type { MessageDispatchContext } from './types';
import { useChatStore } from '../../stores/chatStore';
import { useInteractionStore } from '../../stores/interactionStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useProjectStore } from '../../stores/projectStore';
import { usePromptRequestStore } from '../../stores/promptRequestStore';
import { useSessionRunStateStore } from '../../stores/sessionRunStateStore';
import { useServerStore } from '../../stores/serverStore';
import { eagerSyncCurrentSession, recoverCurrentSessionTail } from '../sessionSync';
import { extractPlanPayload } from '../../features/chat/planReviewPayload';

export function handleRunMessage(msg: ServerMessage, ctx: MessageDispatchContext): boolean {
  const { serverId, backendId, serverRunsRef, logTag } = ctx;
  const activeServerId = useServerStore.getState().activeServerId;

  switch (msg.type) {
    case 'delta': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      const deltaSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (deltaSession) {
        useChatStore.getState().appendToLastMessage(deltaSession, msg.content);
        useChatStore.getState().appendTextBlock(msg.runId, msg.content);
      } else if (msg.runId) {
        console.warn(`[${logTag}] Delta for untracked run ${msg.runId}`);
      }
      return true;
    }

    case 'run_started': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      ctx.clearTerminalRunSeq(msg.runId);
      const targetSessionId = msg.sessionId;
      if (!targetSessionId) {
        console.warn('[messageHandler] run_started missing sessionId, ignoring');
        return true;
      }
      const assistantMsgId = msg.assistantMessageId || msg.runId;
      const userMsgId = msg.userMessageId;
      const clientReqId = msg.clientRequestId;
      const isBackground = msg.sessionType === 'background';

      const chat = useChatStore.getState();
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

        useSessionRunStateStore.getState().markRunStarted({
          backendId,
          runId: msg.runId,
          sessionId: targetSessionId,
          sessionType: msg.sessionType,
          source: 'run_event',
        });
      }
      return true;
    }

    case 'run_completed': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      const completedSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      console.log(`[${logTag}] run_completed runId=${msg.runId} sessionId=${completedSession ?? 'unknown'} seq=${msg.seq ?? 'none'}`);
      if (completedSession) {
        usePromptRequestStore.getState().clearRequestsForSession(completedSession);
        usePermissionStore.getState().clearRequestsForSession(completedSession);
        useInteractionStore.getState().clearSession(completedSession);
        useChatStore.getState().finalizeRunToMessage(msg.runId);
        if (msg.usage) {
          useChatStore.getState().addSessionUsage(completedSession, msg.usage);
        }
        useSessionRunStateStore.getState().markRunEnded({
          backendId,
          runId: msg.runId,
          sessionId: completedSession,
          source: 'run_event',
          cleanupChatRuns: false,
        });
        void eagerSyncCurrentSession(serverId);
        void recoverCurrentSessionTail(serverId, completedSession);
      }
      ctx.recordTerminalRun(msg.runId, msg.seq);
      ctx.clearRunActivity(msg.runId);
      useChatStore.getState().endRun(msg.runId);
      serverRunsRef.get(serverId)?.delete(msg.runId);
      ctx.clearRunSeq(msg.runId);
      return true;
    }

    case 'run_failed': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      const failedSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      console.log(`[${logTag}] run_failed runId=${msg.runId} sessionId=${failedSession ?? 'unknown'} seq=${msg.seq ?? 'none'}`);
      if (failedSession) {
        usePromptRequestStore.getState().clearRequestsForSession(failedSession);
        usePermissionStore.getState().clearRequestsForSession(failedSession);
        useInteractionStore.getState().clearSession(failedSession);
        if (msg.error) {
          useChatStore.getState().appendToLastMessage(failedSession, `\n\n**Error:** ${msg.error}`);
        }
        useChatStore.getState().finalizeRunToMessage(msg.runId);
        useSessionRunStateStore.getState().markRunEnded({
          backendId,
          runId: msg.runId,
          sessionId: failedSession,
          source: 'run_event',
          cleanupChatRuns: false,
        });
        void eagerSyncCurrentSession(serverId);
        void recoverCurrentSessionTail(serverId, failedSession);
      }
      ctx.recordTerminalRun(msg.runId, msg.seq);
      ctx.clearRunActivity(msg.runId);
      useChatStore.getState().endRun(msg.runId);
      serverRunsRef.get(serverId)?.delete(msg.runId);
      ctx.clearRunSeq(msg.runId);
      console.error(`[${logTag}] Run failed:`, msg.error);
      return true;
    }

    case 'tool_use': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      const toolSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (toolSession) {
        useChatStore.getState().addToolCall(msg.runId, msg.toolUseId, msg.toolName, msg.toolInput, msg.semantic, msg.effect);
        useChatStore.getState().addToolUseBlock(msg.runId, msg.toolUseId);
        if (msg.semantic === 'plan_proposal') {
          maybeSynthesizeCursorPlanReview(toolSession, msg.toolUseId, msg.toolInput);
        }
      } else if (msg.runId) {
        console.warn(`[${logTag}] tool_use for untracked run ${msg.runId}`);
      }
      return true;
    }

    case 'tool_result': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      const resultSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
      if (resultSession) {
        useChatStore.getState().updateToolCallResult(msg.runId, msg.toolUseId, msg.result, msg.isError, msg.effect);
      } else if (msg.runId) {
        console.warn(`[${logTag}] tool_result for untracked run ${msg.runId}`);
      }
      return true;
    }

    case 'tool_activity': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      if (msg.runId && msg.toolUseId && msg.content) {
        useChatStore.getState().updateToolCallActivity(msg.runId, msg.toolUseId, msg.content);
      }
      return true;
    }

    case 'mode_change':
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      useChatStore.getState().setRuntimeMode(msg.sessionId, msg.mode);
      useChatStore.getState().setMode(msg.sessionId, msg.mode);
      return true;

    case 'system_info':
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      if (serverId === activeServerId) {
        const sessionId = useChatStore.getState().activeRuns[msg.runId];
        if (sessionId) {
          useChatStore.getState().setSystemInfo(sessionId, msg.systemInfo);
        } else {
          console.warn(`[${logTag}] system_info for untracked run ${msg.runId}`);
        }
      }
      return true;

    default:
      return false;
  }
}

function maybeSynthesizeCursorPlanReview(
  sessionId: string,
  toolUseId: string,
  toolInput: unknown,
): void {
  // Look up the session's provider type. Only synthesize for Cursor.
  const projectState = useProjectStore.getState();
  const session = projectState.sessions.find((s) => s.id === sessionId);
  if (!session?.providerId) return;
  const provider = projectState.providers.find((p) => p.id === session.providerId);
  if (provider?.type !== 'cursor') return;

  // Do not overwrite an existing interaction for this tool (idempotency).
  if (useInteractionStore.getState().interactions[toolUseId]) return;

  const { planContent, todos } = extractPlanPayload(toolInput);
  const interaction: PlanReviewInteractionMessage = {
    type: 'interaction_plan_review',
    interactionId: toolUseId,
    sessionId,
    source: 'client_synth',
    createdAt: Date.now(),
    plan: planContent,
    todos,
  };
  useInteractionStore.getState().upsertInteraction(interaction);
}
