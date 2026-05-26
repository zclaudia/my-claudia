import { create } from 'zustand';
import type { RunStatus } from '@my-claudia/shared';
import { useChatStore } from './chatStore';
import { useInteractionStore } from './interactionStore';
import { useOwnershipStore } from './ownershipStore';
import { usePermissionStore } from './permissionStore';
import { useProjectStore } from './projectStore';
import { usePromptRequestStore } from './promptRequestStore';
import { useSessionsStore } from './sessionsStore';

export type SessionRunPhase = 'idle' | 'running' | 'waiting' | 'interrupted';

export type SessionRunStateSource =
  | 'run_event'
  | 'heartbeat'
  | 'backend_snapshot'
  | 'backend_event'
  | 'session_sync';

export interface SessionRunRecord {
  backendId: string;
  sessionId: string;
  phase: SessionRunPhase;
  foregroundRunIds: string[];
  updatedAt: number;
  source: SessionRunStateSource;
}

interface ActiveRunInput {
  runId: string;
  sessionId: string;
  sessionType?: string;
}

interface SessionRunState {
  records: Record<string, SessionRunRecord>;
  markRunStarted: (input: {
    backendId?: string | null;
    runId: string;
    sessionId: string;
    sessionType?: string;
    source?: SessionRunStateSource;
  }) => void;
  markRunEnded: (input: {
    backendId?: string | null;
    runId: string;
    sessionId?: string | null;
    source?: SessionRunStateSource;
    cleanupChatRuns?: boolean;
  }) => void;
  applySessionRunStatus: (input: {
    backendId?: string | null;
    sessionId: string;
    runStatus?: RunStatus | null;
    isActive?: boolean;
    source: SessionRunStateSource;
  }) => void;
  reconcileBackendActiveRuns: (input: {
    backendId?: string | null;
    activeRuns: ActiveRunInput[];
    source: SessionRunStateSource;
  }) => void;
  reconcileBackendSessionStatuses: (input: {
    backendId?: string | null;
    sessions: Array<{ sessionId: string; runStatus?: RunStatus | null; isActive?: boolean }>;
    knownSessionIds?: string[];
    source: SessionRunStateSource;
  }) => void;
  markSessionInactive: (input: {
    backendId?: string | null;
    sessionId: string;
    source: SessionRunStateSource;
    cleanupChatRuns?: boolean;
  }) => void;
  clearBackend: (backendId?: string | null) => void;
}

const LOCAL_BACKEND_KEY = '__local__';

export function isSessionRunActive(record: SessionRunRecord | undefined): boolean {
  return record?.phase === 'running' || record?.phase === 'waiting';
}

function isForegroundRun(sessionType?: string): boolean {
  return sessionType !== 'background';
}

function normalizeBackendId(backendId: string | null | undefined): string {
  return backendId ?? LOCAL_BACKEND_KEY;
}

function recordKey(backendId: string, sessionId: string): string {
  return `${backendId}::${sessionId}`;
}

function resolveRunSessionId(runId: string, records: Record<string, SessionRunRecord>): string | null {
  for (const record of Object.values(records)) {
    if (record.foregroundRunIds.includes(runId)) return record.sessionId;
  }
  return useChatStore.getState().activeRuns?.[runId] ?? null;
}

function setLegacySessionActive(
  backendId: string,
  sessionId: string,
  isActive: boolean,
): void {
  const projectStore = useProjectStore.getState() as ReturnType<typeof useProjectStore.getState> & {
    setSessionActive?: (sessionId: string, isActive: boolean) => void;
  };
  projectStore.setSessionActive?.(sessionId, isActive);

  const sessionsStore = useSessionsStore.getState() as ReturnType<typeof useSessionsStore.getState> & {
    setSessionActiveFlag?: (backendId: string, sessionId: string, isActive: boolean) => void;
    setSessionActiveById?: (backendId: string, sessionId: string, isActive: boolean) => void;
  };
  sessionsStore.setSessionActiveFlag?.(backendId, sessionId, isActive);
  if (backendId !== LOCAL_BACKEND_KEY) {
    sessionsStore.setSessionActiveById?.(backendId, sessionId, isActive);
  }
}

function clearSessionBlockingState(sessionId: string): void {
  const permissionStore = usePermissionStore.getState() as ReturnType<typeof usePermissionStore.getState> & {
    clearRequestsForSession?: (sessionId: string) => void;
  };
  permissionStore.clearRequestsForSession?.(sessionId);

  const promptStore = usePromptRequestStore.getState() as ReturnType<typeof usePromptRequestStore.getState> & {
    clearRequestsForSession?: (sessionId: string) => void;
  };
  promptStore.clearRequestsForSession?.(sessionId);

  const interactionStore = useInteractionStore.getState() as ReturnType<typeof useInteractionStore.getState> & {
    clearSession?: (sessionId: string) => void;
  };
  interactionStore.clearSession?.(sessionId);
}

function cleanupForegroundChatRunsForSession(
  sessionId: string,
  allowedRunIds: Set<string> = new Set(),
): void {
  const chatStore = useChatStore.getState() as ReturnType<typeof useChatStore.getState> & {
    activeRuns?: Record<string, string>;
    backgroundRunIds?: Set<string>;
    finalizeRunToMessage?: (runId: string) => void;
    endRun?: (runId: string) => void;
  };

  for (const [runId, runSessionId] of Object.entries(chatStore.activeRuns ?? {})) {
    if (runSessionId !== sessionId) continue;
    if (chatStore.backgroundRunIds?.has(runId)) continue;
    if (allowedRunIds.has(runId)) continue;
    chatStore.finalizeRunToMessage?.(runId);
    chatStore.endRun?.(runId);
  }
}

function cleanupForegroundChatRunsForBackend(
  backendId: string,
  activeRunIds: Set<string>,
  knownSessionIds: Set<string>,
): void {
  const chatStore = useChatStore.getState() as ReturnType<typeof useChatStore.getState> & {
    activeRuns?: Record<string, string>;
    backgroundRunIds?: Set<string>;
    finalizeRunToMessage?: (runId: string) => void;
    endRun?: (runId: string) => void;
  };
  const ownershipStore = useOwnershipStore.getState() as ReturnType<typeof useOwnershipStore.getState> & {
    sessionBackendIds?: Record<string, string>;
    getSessionBackendId?: (sessionId: string) => string | undefined;
  };

  for (const [runId, sessionId] of Object.entries(chatStore.activeRuns ?? {})) {
    if (chatStore.backgroundRunIds?.has(runId)) continue;
    if (activeRunIds.has(runId)) continue;
    const ownerBackendId = ownershipStore.sessionBackendIds?.[sessionId]
      ?? ownershipStore.getSessionBackendId?.(sessionId);
    const belongsToBackend = ownerBackendId === backendId || knownSessionIds.has(sessionId);
    if (!belongsToBackend) continue;
    chatStore.finalizeRunToMessage?.(runId);
    chatStore.endRun?.(runId);
    clearSessionBlockingState(sessionId);
  }
}

function runStatusToPhase(runStatus?: RunStatus | null, isActive?: boolean): SessionRunPhase {
  if (runStatus === 'waiting') return 'waiting';
  if (runStatus === 'running') return 'running';
  if (isActive) return 'running';
  return 'idle';
}

export const useSessionRunStateStore = create<SessionRunState>((set, get) => ({
  records: {},

  markRunStarted: ({ backendId, runId, sessionId, sessionType, source = 'run_event' }) => {
    if (!isForegroundRun(sessionType)) return;
    const normalizedBackendId = normalizeBackendId(backendId);
    const key = recordKey(normalizedBackendId, sessionId);
    set((state) => {
      const existing = state.records[key];
      const runIds = new Set(existing?.foregroundRunIds ?? []);
      runIds.add(runId);
      return {
        records: {
          ...state.records,
          [key]: {
            backendId: normalizedBackendId,
            sessionId,
            phase: 'running',
            foregroundRunIds: [...runIds],
            updatedAt: Date.now(),
            source,
          },
        },
      };
    });
    setLegacySessionActive(normalizedBackendId, sessionId, true);
  },

  markRunEnded: ({ backendId, runId, sessionId, source = 'run_event', cleanupChatRuns = false }) => {
    const normalizedBackendId = normalizeBackendId(backendId);
    const resolvedSessionId = sessionId || resolveRunSessionId(runId, get().records);
    if (!resolvedSessionId) return;

    let nextPhase: SessionRunPhase = 'idle';
    set((state) => {
      const records = { ...state.records };
      const candidateKeys = Object.keys(records).filter((key) => {
        const record = records[key];
        return record.sessionId === resolvedSessionId
          && (!backendId || record.backendId === normalizedBackendId);
      });
      const keys = candidateKeys.length > 0
        ? candidateKeys
        : [recordKey(normalizedBackendId, resolvedSessionId)];

      for (const key of keys) {
        const existing = records[key];
        const remaining = (existing?.foregroundRunIds ?? []).filter((id) => id !== runId);
        nextPhase = remaining.length > 0 ? 'running' : 'idle';
        records[key] = {
          backendId: existing?.backendId ?? normalizedBackendId,
          sessionId: resolvedSessionId,
          phase: nextPhase,
          foregroundRunIds: remaining,
          updatedAt: Date.now(),
          source,
        };
      }
      return { records };
    });

    if (cleanupChatRuns) {
      cleanupForegroundChatRunsForSession(resolvedSessionId, new Set());
      clearSessionBlockingState(resolvedSessionId);
    }
    if (nextPhase === 'idle') {
      setLegacySessionActive(normalizedBackendId, resolvedSessionId, false);
    }
  },

  applySessionRunStatus: ({ backendId, sessionId, runStatus, isActive, source }) => {
    const phase = runStatusToPhase(runStatus, isActive);
    if (phase === 'idle') {
      get().markSessionInactive({ backendId, sessionId, source });
      return;
    }

    const normalizedBackendId = normalizeBackendId(backendId);
    const key = recordKey(normalizedBackendId, sessionId);
    set((state) => {
      const existing = state.records[key];
      return {
        records: {
          ...state.records,
          [key]: {
            backendId: normalizedBackendId,
            sessionId,
            phase,
            foregroundRunIds: existing?.foregroundRunIds ?? [],
            updatedAt: Date.now(),
            source,
          },
        },
      };
    });
    setLegacySessionActive(normalizedBackendId, sessionId, true);
  },

  reconcileBackendActiveRuns: ({ backendId, activeRuns, source }) => {
    const normalizedBackendId = normalizeBackendId(backendId);
    const foregroundRuns = activeRuns.filter((run) => isForegroundRun(run.sessionType));
    const activeRunIds = new Set(foregroundRuns.map((run) => run.runId));
    const activeSessionRunIds = new Map<string, Set<string>>();
    for (const run of foregroundRuns) {
      const runIds = activeSessionRunIds.get(run.sessionId) ?? new Set<string>();
      runIds.add(run.runId);
      activeSessionRunIds.set(run.sessionId, runIds);
    }

    const staleSessionIds = new Set<string>();
    const knownSessionIds = new Set<string>(activeSessionRunIds.keys());
    set((state) => {
      const records = { ...state.records };
      for (const record of Object.values(records)) {
        if (record.backendId !== normalizedBackendId) continue;
        knownSessionIds.add(record.sessionId);
        if (!activeSessionRunIds.has(record.sessionId) && isSessionRunActive(record)) {
          staleSessionIds.add(record.sessionId);
          records[recordKey(normalizedBackendId, record.sessionId)] = {
            ...record,
            phase: 'idle',
            foregroundRunIds: [],
            updatedAt: Date.now(),
            source,
          };
        }
      }

      for (const [sessionId, runIds] of activeSessionRunIds) {
        records[recordKey(normalizedBackendId, sessionId)] = {
          backendId: normalizedBackendId,
          sessionId,
          phase: 'running',
          foregroundRunIds: [...runIds],
          updatedAt: Date.now(),
          source,
        };
      }

      return { records };
    });

    cleanupForegroundChatRunsForBackend(normalizedBackendId, activeRunIds, knownSessionIds);

    for (const sessionId of staleSessionIds) {
      setLegacySessionActive(normalizedBackendId, sessionId, false);
    }
    for (const sessionId of activeSessionRunIds.keys()) {
      setLegacySessionActive(normalizedBackendId, sessionId, true);
    }
  },

  reconcileBackendSessionStatuses: ({ backendId, sessions, knownSessionIds = [], source }) => {
    const normalizedBackendId = normalizeBackendId(backendId);
    const activeSessionIds = new Set<string>();
    const presentSessionIds = new Set(sessions.map((session) => session.sessionId));
    const cleanupKnownSessionIds = new Set([
      ...knownSessionIds,
      ...presentSessionIds,
    ]);

    set((state) => {
      const records = { ...state.records };
      for (const session of sessions) {
        const phase = runStatusToPhase(session.runStatus, session.isActive);
        const key = recordKey(normalizedBackendId, session.sessionId);
        const existing = records[key];
        if (phase === 'idle') {
          records[key] = {
            backendId: normalizedBackendId,
            sessionId: session.sessionId,
            phase: 'idle',
            foregroundRunIds: [],
            updatedAt: Date.now(),
            source,
          };
        } else {
          activeSessionIds.add(session.sessionId);
          records[key] = {
            backendId: normalizedBackendId,
            sessionId: session.sessionId,
            phase,
            foregroundRunIds: existing?.foregroundRunIds ?? [],
            updatedAt: Date.now(),
            source,
          };
        }
      }

      for (const record of Object.values(records)) {
        if (record.backendId !== normalizedBackendId) continue;
        if (presentSessionIds.has(record.sessionId) || !isSessionRunActive(record)) continue;
        records[recordKey(normalizedBackendId, record.sessionId)] = {
          ...record,
          phase: 'idle',
          foregroundRunIds: [],
          updatedAt: Date.now(),
          source,
        };
      }

      return { records };
    });

    for (const session of sessions) {
      if (activeSessionIds.has(session.sessionId)) {
        setLegacySessionActive(normalizedBackendId, session.sessionId, true);
      } else {
        cleanupForegroundChatRunsForSession(session.sessionId);
        clearSessionBlockingState(session.sessionId);
        setLegacySessionActive(normalizedBackendId, session.sessionId, false);
      }
    }
    cleanupForegroundChatRunsForBackend(normalizedBackendId, new Set(), cleanupKnownSessionIds);
  },

  markSessionInactive: ({ backendId, sessionId, source, cleanupChatRuns = true }) => {
    const normalizedBackendId = normalizeBackendId(backendId);
    const key = recordKey(normalizedBackendId, sessionId);
    set((state) => ({
      records: {
        ...state.records,
        [key]: {
          backendId: normalizedBackendId,
          sessionId,
          phase: 'idle',
          foregroundRunIds: [],
          updatedAt: Date.now(),
          source,
        },
      },
    }));
    if (cleanupChatRuns) {
      cleanupForegroundChatRunsForSession(sessionId);
      clearSessionBlockingState(sessionId);
    }
    setLegacySessionActive(normalizedBackendId, sessionId, false);
  },

  clearBackend: (backendId) => {
    const normalizedBackendId = normalizeBackendId(backendId);
    set((state) => ({
      records: Object.fromEntries(
        Object.entries(state.records).filter(([, record]) => record.backendId !== normalizedBackendId),
      ),
    }));
  },
}));
