/**
 * Session Sync Service - Periodic synchronization as fallback to WebSocket push
 *
 * Implements dual sync mechanism:
 * - Incremental sync: every 30s (only changed sessions)
 * - Full sync: every 5min (detects deletions)
 */

import { useSessionsStore, type RemoteSession } from '../stores/sessionsStore';
import { useServerStore } from '../stores/serverStore';

import { resolveGatewayBackendUrl, getGatewayAuthHeaders } from './gatewayProxy';
import { useChatStore } from '../stores/chatStore';
import { useProjectStore } from '../stores/projectStore';
import * as api from './api';
import { getControlPlaneMode, isLocalBackendId } from '../utils/controlPlane';

interface BackendSyncState {
  lastSyncTime: number;
  incrementalInterval: ReturnType<typeof setInterval>;
  fullSyncInterval: ReturnType<typeof setInterval>;
  missingSyncRequestUrlLogged: boolean;
}

// Track sync state for each backend
const syncStates = new Map<string, BackendSyncState>();

// Prevent concurrent sync operations per backend (skip-if-busy)
const activeSyncs = new Set<string>();

// Sync configuration
const INCREMENTAL_SYNC_INTERVAL = 30000; // 30 seconds
const FULL_SYNC_INTERVAL = 300000; // 5 minutes

/**
 * Check if the currently viewed session has missing messages and fetch them.
 * Only runs for the active session that's currently displayed to the user.
 */
async function fillMessageGapForSession(
  session: RemoteSession,
  afterOffsetOverride?: number
): Promise<void> {
  const currentSessionId = useProjectStore.getState().selectedSessionId;
  if (!currentSessionId || session.id !== currentSessionId) return;
  if (!session.lastMessageOffset) return;

  const pagination = useChatStore.getState().pagination[currentSessionId];
  const localMaxOffset = afterOffsetOverride ?? pagination?.maxOffset ?? 0;

  // If server's max offset is ahead of what we have, fetch missing messages.
  if (session.lastMessageOffset <= localMaxOffset) return;

  try {
    console.log(
      `[SessionSync] Gap detected for session ${currentSessionId}: ` +
      `local maxOffset=${localMaxOffset}, server lastMessageOffset=${session.lastMessageOffset}`
    );
    const result = await api.getSessionMessages(currentSessionId, {
      afterOffset: localMaxOffset,
      limit: 100,
    });
    if (result.messages.length > 0) {
      useChatStore.getState().appendMessages(currentSessionId, result.messages, result.pagination);
      console.log(`[SessionSync] Filled ${result.messages.length} missing messages`);
    }
  } catch (error) {
    console.error('[SessionSync] Failed to fill message gap:', error);
  }
}

async function checkAndFillMessageGaps(sessions: RemoteSession[]): Promise<void> {
  const currentSessionId = useProjectStore.getState().selectedSessionId;
  if (!currentSessionId) return;

  const session = sessions.find((s) => s.id === currentSessionId);
  if (!session) return;
  await fillMessageGapForSession(session);
}

/**
 * Get the HTTP base URL used for session sync requests.
 * For gateway targets this is a proxy URL, not the backend's raw origin.
 */
function getSyncRequestBaseUrl(targetBackendId?: string): string | null {
  const localPort = useServerStore.getState().localServerPort;
  const controlPlaneMode = getControlPlaneMode();

  if (targetBackendId) {
    if (controlPlaneMode === 'embedded-local' && isLocalBackendId(targetBackendId)) {
      if (!localPort) return null;
      return `http://localhost:${localPort}`;
    }
    return resolveGatewayBackendUrl(targetBackendId);
  }

  // Fallback: use active server
  const activeId = useServerStore.getState().activeServerId;
  if (activeId) {
    if (controlPlaneMode === 'embedded-local' && isLocalBackendId(activeId)) {
      if (!localPort) return null;
      return `http://localhost:${localPort}`;
    }
    return resolveGatewayBackendUrl(activeId);
  }

  if (!localPort) return null;
  return `http://localhost:${localPort}`;
}

/**
 * Get auth headers for API requests.
 */
function getAuthHeaders(targetBackendId?: string): Record<string, string> {
  const controlPlaneMode = getControlPlaneMode();

  if (targetBackendId) {
    if (controlPlaneMode === 'embedded-local' && isLocalBackendId(targetBackendId)) {
      return {};
    }
    return getGatewayAuthHeaders();
  }

  // Fallback: infer from active server
  const activeId = useServerStore.getState().activeServerId;
  if (!activeId) return {};

  if (controlPlaneMode === 'embedded-local' && isLocalBackendId(activeId)) {
    return {};
  }

  if (activeId) {
    return getGatewayAuthHeaders();
  }

  // Direct/local server: no auth needed
  return {};
}

/**
 * Perform incremental sync - only fetch sessions updated since last sync
 */
async function incrementalSync(backendId: string): Promise<void> {
  if (activeSyncs.has(backendId)) return; // skip if another sync is in progress
  activeSyncs.add(backendId);
  try {
    const state = syncStates.get(backendId);
    if (!state) return;

    const requestBaseUrl = getSyncRequestBaseUrl(backendId);
    if (!requestBaseUrl) {
      if (!state.missingSyncRequestUrlLogged) {
        console.debug(
          `[SessionSync] Skipping incremental sync for ${backendId}: no request URL available yet`
        );
        state.missingSyncRequestUrlLogged = true;
      }
      return;
    }
    state.missingSyncRequestUrlLogged = false;

    const url = `${requestBaseUrl}/api/sessions/sync?since=${state.lastSyncTime}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(backendId),
      },
    });

    if (!response.ok) {
      console.error('[SessionSync] Incremental sync failed:', response.status);
      return;
    }

    const data = await response.json();

    if (!data.success) {
      console.error('[SessionSync] Sync returned error:', data.error);
      return;
    }

    // Update local state with changed sessions
    const { sessions, timestamp } = data.data;
    const store = useSessionsStore.getState();
    const existing = store.remoteSessions.get(backendId) || [];

    sessions.forEach((session: RemoteSession) => {
      const existingSession = existing.find((s) => s.id === session.id);

      if (!existingSession) {
        // New session (possibly from missed push)
        console.log(`[SessionSync] Found new session: ${session.id}`);
        store.handleSessionEvent(backendId, 'created', session);
      } else if (existingSession.updatedAt < session.updatedAt) {
        // Updated session
        console.log(`[SessionSync] Session updated: ${session.id}`);
        store.handleSessionEvent(backendId, 'updated', session);
      }
    });

    // Update sync timestamp
    state.lastSyncTime = timestamp;

    if (sessions.length > 0) {
      console.log(
        `[SessionSync] Incremental sync: ${sessions.length} changed sessions`
      );
    }

    // Check for message gaps in the currently viewed session
    await checkAndFillMessageGaps(sessions);
  } catch (error) {
    console.error('[SessionSync] Incremental sync failed:', error);
  } finally {
    activeSyncs.delete(backendId);
  }
}

/**
 * Perform full sync - fetch all sessions and detect deletions
 */
async function fullSync(backendId: string): Promise<void> {
  if (activeSyncs.has(backendId)) return; // skip if another sync is in progress
  activeSyncs.add(backendId);
  try {
    const state = syncStates.get(backendId);
    if (!state) return;

    const requestBaseUrl = getSyncRequestBaseUrl(backendId);
    if (!requestBaseUrl) {
      if (!state.missingSyncRequestUrlLogged) {
        console.debug(
          `[SessionSync] Skipping full sync for ${backendId}: no request URL available yet`
        );
        state.missingSyncRequestUrlLogged = true;
      }
      return;
    }
    state.missingSyncRequestUrlLogged = false;

    // Request all sessions (since=0)
    const url = `${requestBaseUrl}/api/sessions/sync?since=0`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(backendId),
      },
    });

    if (!response.ok) {
      console.error('[SessionSync] Full sync failed:', response.status);
      return;
    }

    const data = await response.json();

    if (!data.success) {
      console.error('[SessionSync] Sync returned error:', data.error);
      return;
    }

    const { sessions, timestamp } = data.data;
    const store = useSessionsStore.getState();

    // Detect deleted sessions and clean up projectStore too (cross-store consistency)
    const serverSessionIds = new Set(sessions.map((s: RemoteSession) => s.id));
    const localSessions = store.remoteSessions.get(backendId) || [];
    const projectStore = useProjectStore.getState();

    for (const localSession of localSessions) {
      if (!serverSessionIds.has(localSession.id)) {
        console.log(`[SessionSync] Detected deleted session: ${localSession.id}`);
        projectStore.deleteSession(localSession.id);
      }
    }

    // Replace sessionsStore with server's complete list (no need for individual delete events)
    store.setRemoteSessions(backendId, sessions);

    // Update sync timestamp
    state.lastSyncTime = timestamp;

    console.log(`[SessionSync] Full sync: ${sessions.length} total sessions`);

    // Check for message gaps in the currently viewed session
    await checkAndFillMessageGaps(sessions);
  } catch (error) {
    console.error('[SessionSync] Full sync failed:', error);
  } finally {
    activeSyncs.delete(backendId);
  }
}

/**
 * Eagerly sync messages for the currently viewed session.
 * Directly fetches messages after the local maxOffset without depending on session list.
 */
export async function eagerSyncCurrentSession(_backendId: string): Promise<void> {
  const currentSessionId = useProjectStore.getState().selectedSessionId;
  if (!currentSessionId) return;

  const pagination = useChatStore.getState().pagination[currentSessionId];
  if (!pagination?.maxOffset) return;

  try {
    const result = await api.getSessionMessages(currentSessionId, {
      afterOffset: pagination.maxOffset,
      limit: 100,
    });
    if (result.messages.length > 0) {
      useChatStore.getState().appendMessages(currentSessionId, result.messages, result.pagination);
      console.log(`[SessionSync] Eager sync filled ${result.messages.length} messages for session ${currentSessionId}`);
    }
  } catch (error) {
    console.error('[SessionSync] Eager sync failed:', error);
  }
}

/**
 * Reload the latest window of the currently viewed session and merge it into the
 * chat cache. This recovers partial assistant bodies and middle gaps inside the
 * latest message window, which plain afterOffset sync cannot repair.
 *
 * Deduplication: if the same session already has a pending recovery request,
 * the call is coalesced — only one HTTP request is in-flight per session at a time,
 * and at most one trailing request is queued.
 */
const pendingRecovery = new Map<string, Promise<void>>();
const trailingRecovery = new Set<string>();

export async function recoverCurrentSessionTail(targetServerId: string, sessionId?: string): Promise<void> {
  const currentSessionId = useProjectStore.getState().selectedSessionId;
  const activeServerId = useServerStore.getState().activeServerId;
  const targetSessionId = sessionId ?? currentSessionId;

  if (!targetSessionId || currentSessionId !== targetSessionId) return;
  if (!activeServerId || activeServerId !== targetServerId) return;

  const key = `${targetServerId}:${targetSessionId}`;

  // Already in-flight: mark trailing so we re-run once after the current finishes
  if (pendingRecovery.has(key)) {
    trailingRecovery.add(key);
    return;
  }

  const run = async () => {
    try {
      const result = await api.getSessionMessages(targetSessionId, { limit: 100 });
      useChatStore.getState().mergeMessages(targetSessionId, result.messages, result.pagination);
      console.log(`[SessionSync] Recovered tail snapshot for session ${targetSessionId}: ${result.messages.length} messages`);
    } catch (error) {
      console.error('[SessionSync] Failed to recover current session tail:', error);
    } finally {
      pendingRecovery.delete(key);
      // If trailing requests accumulated, run exactly one more
      if (trailingRecovery.delete(key)) {
        void recoverCurrentSessionTail(targetServerId, targetSessionId);
      }
    }
  };

  const promise = run();
  pendingRecovery.set(key, promise);
}

/**
 * Trigger immediate gap-fill for a pushed session snapshot.
 * Used by WebSocket session events so cross-device messages appear without waiting
 * for the 30s incremental sync cycle or a manual session switch.
 */
export async function eagerSyncSessionUpdate(session: RemoteSession): Promise<void> {
  await fillMessageGapForSession(session);
}

/**
 * Trigger immediate sync across all active backends.
 * Called on visibility change (app comes to foreground) to catch up on missed messages.
 */
export function eagerSyncAllBackends(): void {
  if (syncStates.size === 0) return;

  console.log(`[SessionSync] Eager sync triggered for ${syncStates.size} backend(s)`);
  for (const backendId of syncStates.keys()) {
    incrementalSync(backendId);
    eagerSyncCurrentSession(backendId);
  }
}

/**
 * Start periodic session synchronization for a specific backend
 */
export function startSessionSync(
  backendId: string,
  options?: { skipInitialFullSync?: boolean }
): void {
  // Stop any existing sync for this backend first
  stopSessionSync(backendId);

  console.log(`[SessionSync] Starting sync for backend ${backendId}`);

  // Initial full sync overlaps with useDataLoader() for the currently active backend.
  // Allow callers to skip it to avoid a redundant `/sessions` + `/sessions/sync?since=0`
  // burst during server switching.
  if (!options?.skipInitialFullSync) {
    fullSync(backendId);
  }

  // Schedule incremental sync every 30 seconds
  const incrementalInterval = setInterval(() => {
    incrementalSync(backendId);
  }, INCREMENTAL_SYNC_INTERVAL);

  // Schedule full sync every 5 minutes
  const fullSyncInterval = setInterval(() => {
    fullSync(backendId);
  }, FULL_SYNC_INTERVAL);

  // Store sync state for this backend
  syncStates.set(backendId, {
    lastSyncTime: 0,
    incrementalInterval,
    fullSyncInterval,
    missingSyncRequestUrlLogged: false,
  });
}

/**
 * Stop periodic session synchronization for a specific backend
 * If backendId is not provided, stops all syncs
 */
export function stopSessionSync(backendId?: string): void {
  if (backendId) {
    const state = syncStates.get(backendId);
    if (state) {
      clearInterval(state.incrementalInterval);
      clearInterval(state.fullSyncInterval);
      syncStates.delete(backendId);
      console.log(`[SessionSync] Stopped sync for backend ${backendId}`);
    }
  } else {
    // Stop all syncs
    syncStates.forEach((state, id) => {
      clearInterval(state.incrementalInterval);
      clearInterval(state.fullSyncInterval);
      console.log(`[SessionSync] Stopped sync for backend ${id}`);
    });
    syncStates.clear();
    console.log('[SessionSync] Stopped all syncs');
  }
}

/**
 * Check if sync is currently running for a specific backend
 */
export function isSyncRunning(backendId?: string): boolean {
  if (backendId) {
    return syncStates.has(backendId);
  }
  return syncStates.size > 0;
}
