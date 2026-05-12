import type { StateHeartbeatMessage } from '@my-claudia/shared';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { usePromptRequestStore } from '../../stores/promptRequestStore';
import { useInteractionStore } from '../../stores/interactionStore';
import { useSessionsStore, getSessionBucketKeyForBackend } from '../../stores/sessionsStore';
import { eagerSyncCurrentSession, recoverCurrentSessionTail } from '../sessionSync';
import { getProjectsForBackend } from '../api/projects';
import { resolveCanonicalBackendId, resolveLocalBackendId } from '../../utils/controlPlane';
import { parseBackendId } from '../../stores/gatewayStore';
import { useBackgroundTaskStore } from '../../stores/backgroundTaskStore';
import type { MessageHandlerContext } from './types';
import type { InteractionPromptMessage } from '@my-claudia/shared';

function resolveOwnerBackendId(backendId: string | null, serverId: string): string {
  const rawBackendId = backendId || parseBackendId(serverId) || serverId;
  return resolveCanonicalBackendId(rawBackendId, resolveLocalBackendId() ?? rawBackendId) ?? rawBackendId;
}

function buildProviderPromptInteraction(
  prompt: {
    requestId: string;
    sessionId: string;
    questions: import('@my-claudia/shared').AskUserQuestionItem[];
  },
): InteractionPromptMessage {
  return {
    type: 'interaction_prompt',
    interactionId: prompt.requestId,
    sessionId: prompt.sessionId,
    source: 'provider_native',
    createdAt: Date.now(),
    title: Array.isArray(prompt.questions) && prompt.questions.length > 1 ? 'Questions' : 'Question',
    fields: (prompt.questions || []).map((question, index) => {
      const promptQuestion = question as typeof question & {
        placeholder?: string;
        allowCustomValue?: boolean;
        customValuePlaceholder?: string;
      };
      return {
        id: `question_${index}`,
        label: question.question,
        description: question.header,
        type: question.multiSelect ? 'multiselect' : 'select',
        options: (question.options || []).map((option) => ({
          value: option.label,
          label: option.label,
          description: option.description,
        })),
        placeholder: promptQuestion.placeholder || 'Type your answer...',
        allowCustomValue: promptQuestion.allowCustomValue ?? true,
        customValuePlaceholder: promptQuestion.customValuePlaceholder || 'Other',
      };
    }),
    submitLabel: 'Submit',
    cancelLabel: 'Skip',
    responseMode: 'prompt_answer',
    variant: 'question',
  };
}

export interface HeartbeatState {
  entityVersions: Map<string, { projects: number; plugins: number }>;
  projectFetchInFlight: Map<string, { version: number; generation: number; promise: Promise<void> }>;
  serverSyncGenerations: Map<string, number>;
  terminalRunSeqByRun: Map<string, { seq?: number; endedAt: number }>;
  TERMINAL_RUN_TOMBSTONE_MS: number;
}

function clearExpiredTerminalRuns(state: HeartbeatState, now = Date.now()): void {
  for (const [runId, tombstone] of state.terminalRunSeqByRun) {
    if (now - tombstone.endedAt > state.TERMINAL_RUN_TOMBSTONE_MS) {
      state.terminalRunSeqByRun.delete(runId);
    }
  }
}

function shouldIgnoreHeartbeatRun(state: HeartbeatState, runId: string, lastSeq?: number): boolean {
  const tombstone = state.terminalRunSeqByRun.get(runId);
  if (!tombstone) return false;
  if (Date.now() - tombstone.endedAt > state.TERMINAL_RUN_TOMBSTONE_MS) {
    state.terminalRunSeqByRun.delete(runId);
    return false;
  }
  if (tombstone.seq == null || lastSeq == null) return true;
  return lastSeq <= tombstone.seq;
}

function reconcileStaleBackgroundRunTasks(
  serverId: string,
  activeBackgroundSessionIds: Set<string>,
): void {
  const backgroundTaskStore = useBackgroundTaskStore.getState();
  const now = Date.now();

  for (const task of Object.values(backgroundTaskStore.tasks) as any[]) {
    if (task.serverId && task.serverId !== serverId) continue;
    if (task.status !== 'started' && task.status !== 'in_progress' && task.status !== 'paused') continue;

    let backgroundSessionId: string | null = null;
    if (task.source === 'background_run' && task.id.startsWith('background:')) {
      backgroundSessionId = task.id.slice('background:'.length);
    } else if (task.source === 'sdk_task') {
      backgroundSessionId = task.sessionId;
    }
    if (!backgroundSessionId) continue;

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

export function handleHeartbeat(
  heartbeat: StateHeartbeatMessage,
  ctx: MessageHandlerContext,
  state: HeartbeatState,
): void {
  const { serverId, backendId, serverRunsRef, logTag } = ctx;
  const backendName = ctx.resolveBackendName();
  const chatState = useChatStore.getState();
  clearExpiredTerminalRuns(state);

  useServerStore.getState().recordHeartbeat(serverId);

  const serverActiveRunIds = new Set(heartbeat.activeRuns.map(r => r.runId));
  const activeBackgroundSessionIds = new Set(
    heartbeat.activeRuns
      .filter(r => r.sessionType === 'background')
      .map(r => r.sessionId)
  );

  // Add missing runs
  for (const run of heartbeat.activeRuns) {
    if (!chatState.activeRuns[run.runId]) {
      if (shouldIgnoreHeartbeatRun(state, run.runId, run.lastSeq)) {
        console.log(`[${logTag}] Ignoring stale heartbeat resurrection for run ${run.runId} lastSeq=${run.lastSeq ?? 'none'}`);
        continue;
      }
      const isBackground = run.sessionType === 'background';
      console.log(`[${logTag}] Heartbeat resurrecting run ${run.runId} sessionId=${run.sessionId} lastSeq=${run.lastSeq ?? 'none'}`);
      chatState.startRun(run.runId, run.sessionId, isBackground);
      if (!isBackground) {
        if (!serverRunsRef.has(serverId)) {
          serverRunsRef.set(serverId, new Set());
        }
        serverRunsRef.get(serverId)!.add(run.runId);
      }
    }
  }

  // Clean up stale runs
  const trackedRuns = serverRunsRef.get(serverId);
  if (trackedRuns) {
    for (const runId of trackedRuns) {
      if (!serverActiveRunIds.has(runId)) {
        console.log(`[${logTag}] Cleaning up stale run ${runId} (not in server heartbeat)`);
        const sessionId = chatState.activeRuns[runId];
        chatState.finalizeRunToMessage(runId);
        chatState.endRun(runId);
        if (sessionId) {
          usePermissionStore.getState().clearRequestsForSession(sessionId);
          usePromptRequestStore.getState().clearRequestsForSession(sessionId);
          useInteractionStore.getState().clearSession(sessionId);
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

  // Update run health
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

  // Reconcile permissions
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

  // Reconcile questions
  const validQIds = new Set<string>(heartbeat.pendingQuestions.map(q => q.requestId));
  usePromptRequestStore.getState().clearStaleRequests(serverId, validQIds);
  for (const q of heartbeat.pendingQuestions) {
    if (!usePromptRequestStore.getState().hasRequest(q.requestId)) {
      usePromptRequestStore.getState().setPendingRequest({
        requestId: q.requestId,
        sessionId: q.sessionId,
        serverId,
      });
    }
    if (!(useInteractionStore.getState().has?.(q.requestId) ?? false)) {
      useInteractionStore.getState().upsertInteraction(buildProviderPromptInteraction({
        requestId: q.requestId,
        sessionId: q.sessionId,
        questions: q.questions,
      }));
    }
  }

  // Reconcile active sessions
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

  // Sync feed unread count
  if (heartbeat.unreadFeedCount !== undefined) {
    import('../../stores/notificationFeedStore').then(m => {
      const store = m.useNotificationFeedStore.getState();
      const derivedUnreadCount = store.items.reduce((count, item) => count + (item.readAt ? 0 : 1), 0);
      const nextUnreadCount = store.hydrated && !store.hasMore
        ? derivedUnreadCount
        : heartbeat.unreadFeedCount!;
      const nextUnreadCountsByTab = store.hydrated && !store.hasMore
        ? store.unreadCountsByTab
        : (heartbeat.unreadFeedCountsByTab ?? store.unreadCountsByTab);
      if (
        store.unreadCount !== nextUnreadCount
        || store.unreadCountsByTab !== nextUnreadCountsByTab
      ) {
        m.useNotificationFeedStore.setState({
          unreadCount: nextUnreadCount,
          unreadCountsByTab: nextUnreadCountsByTab,
        });
      }
    });
  }

  // Version-based reconciliation
  if (heartbeat.versions) {
    const cached = state.entityVersions.get(serverId) ?? { projects: 0, plugins: 0 };
    const generation = state.serverSyncGenerations.get(serverId) ?? 0;

    if (heartbeat.versions.projects && heartbeat.versions.projects !== cached.projects) {
      const targetVersion = heartbeat.versions.projects;
      const pendingFetch = state.projectFetchInFlight.get(serverId);
      if (pendingFetch?.version !== targetVersion || pendingFetch.generation !== generation) {
        console.log(`[${logTag}] Projects version ${cached.projects} → ${targetVersion}, fetching`);
        const ownerBackendId = resolveOwnerBackendId(backendId, serverId);
        const fetchPromise = getProjectsForBackend(backendId ?? null)
          .then((projects) => {
            const current = state.projectFetchInFlight.get(serverId);
            const latestKnownVersion = state.entityVersions.get(serverId)?.projects ?? 0;
            const latestGeneration = state.serverSyncGenerations.get(serverId) ?? 0;
            if (
              current?.version !== targetVersion
              || current.generation !== generation
              || latestKnownVersion > targetVersion
              || latestGeneration !== generation
            ) {
              return;
            }
            useProjectStore.getState().replaceProjectsForBackend(ownerBackendId, projects);
            cached.projects = targetVersion;
            state.entityVersions.set(serverId, cached);
            if (current?.version === targetVersion && current.generation === generation) {
              state.projectFetchInFlight.delete(serverId);
            }
          })
          .catch(err => {
            const current = state.projectFetchInFlight.get(serverId);
            if (current?.version === targetVersion && current.generation === generation) {
              state.projectFetchInFlight.delete(serverId);
            }
            console.error(`[${logTag}] Project fetch failed:`, err);
          });
        state.projectFetchInFlight.set(serverId, { version: targetVersion, generation, promise: fetchPromise });
      }
    }

    if (heartbeat.versions.plugins) {
      cached.plugins = heartbeat.versions.plugins;
    }

    state.entityVersions.set(serverId, cached);
  }
}
