/**
 * Session Sync Service - Periodic synchronization as fallback to WebSocket push
 *
 * Implements dual sync mechanism:
 * - Incremental sync: every 30s (only changed sessions)
 * - Full sync: every 5min (detects deletions)
 */

import { useSessionsStore, type RemoteSession } from '../stores/sessionsStore';
import { useServerStore } from '../stores/serverStore';
import { isGatewayTarget, parseBackendId } from '../stores/gatewayStore';
import { resolveGatewayBackendUrl, getGatewayAuthHeaders } from './gatewayProxy';
import { useChatStore } from '../stores/chatStore';
import { useProjectStore } from '../stores/projectStore';
import * as api from './api';

interface BackendSyncState {
  lastSyncTime: number;
  incrementalInterval: ReturnType<typeof setInterval>;
  fullSyncInterval: ReturnType<typeof setInterval>;
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
 * Get the base URL for a backend (gateway or direct)
 */
function getBaseUrl(targetBackendId?: string): string | null {
  if (targetBackendId) {
    if (isGatewayTarget(targetBackendId)) {
      const backendId = parseBackendId(targetBackendId);
      return resolveGatewayBackendUrl(backendId);
    }
    // Direct server: look up by serverId
    const server = useServerStore.getState().servers.find(s => s.id === targetBackendId);
    if (!server) return null;
    const addr = server.address.includes('://') ? server.address.replace(/^ws/, 'http') : `http://${server.address}`;
    return addr;
  }

  // Fallback: use active server
  const activeId = useServerStore.getState().activeServerId;
  if (!activeId) return null;

  if (isGatewayTarget(activeId)) {
    const backendId = parseBackendId(activeId);
    return resolveGatewayBackendUrl(backendId);
  }

  // Direct server: connect directly to backend
  const server = useServerStore.getState().getActiveServer();
  if (!server) return null;

  const serverAddr = server.address.includes('://')
    ? server.address.replace(/^ws/, 'http')
    : `http://${server.address}`;
  return serverAddr;
}

/**
 * Get auth headers for API requests.
 */
function getAuthHeaders(targetBackendId?: string): Record<string, string> {
  if (targetBackendId) {
    if (isGatewayTarget(targetBackendId)) {
      return getGatewayAuthHeaders();
    }
    // Direct server: look up by serverId
    const server = useServerStore.getState().servers.find(s => s.id === targetBackendId);
    if (!server?.clientId) return {};
    return { Authorization: `Bearer ${server.clientId}` };
  }

  // Fallback: infer from active server
  const activeId = useServerStore.getState().activeServerId;
  if (!activeId) return {};

  if (isGatewayTarget(activeId)) {
    return getGatewayAuthHeaders();
  }

  // Direct server
  const server = useServerStore.getState().getActiveServer();
  if (!server?.clientId) return {};

  return {
    Authorization: `Bearer ${server.clientId}`,
  };
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

    const baseUrl = getBaseUrl(backendId);
    if (!baseUrl) {
      console.warn('[SessionSync] No base URL available');
      return;
    }

    const url = `${baseUrl}/api/sessions/sync?since=${state.lastSyncTime}`;
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

    const baseUrl = getBaseUrl(backendId);
    if (!baseUrl) {
      console.warn('[SessionSync] No base URL available');
      return;
    }

    // Request all sessions (since=0)
    const url = `${baseUrl}/api/sessions/sync?since=0`;
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
export function startSessionSync(backendId: string): void {
  // Stop any existing sync for this backend first
  stopSessionSync(backendId);

  console.log(`[SessionSync] Starting sync for backend ${backendId}`);

  // Perform immediate full sync to initialize
  fullSync(backendId);

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
