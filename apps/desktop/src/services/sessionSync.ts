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

interface BackendSyncState {
  lastSyncTime: number;
  incrementalInterval: ReturnType<typeof setInterval>;
  fullSyncInterval: ReturnType<typeof setInterval>;
}

// Track sync state for each backend
const syncStates = new Map<string, BackendSyncState>();

// Sync configuration
const INCREMENTAL_SYNC_INTERVAL = 30000; // 30 seconds
const FULL_SYNC_INTERVAL = 300000; // 5 minutes

/**
 * Get the base URL for the active server
 */
function getBaseUrl(targetBackendId?: string): string | null {
  // If a specific gateway backend is targeted
  if (targetBackendId) {
    return resolveGatewayBackendUrl(targetBackendId);
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
function getAuthHeaders(isGatewayBackend?: boolean): Record<string, string> {
  if (isGatewayBackend) {
    return getGatewayAuthHeaders();
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
        ...getAuthHeaders(true),
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
  } catch (error) {
    console.error('[SessionSync] Incremental sync failed:', error);
  }
}

/**
 * Perform full sync - fetch all sessions and detect deletions
 */
async function fullSync(backendId: string): Promise<void> {
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
        ...getAuthHeaders(true),
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

    // Detect deleted sessions
    const serverSessionIds = new Set(sessions.map((s: RemoteSession) => s.id));
    const localSessions = store.remoteSessions.get(backendId) || [];

    localSessions.forEach((localSession) => {
      if (!serverSessionIds.has(localSession.id)) {
        console.log(`[SessionSync] Detected deleted session: ${localSession.id}`);
        store.handleSessionEvent(backendId, 'deleted', localSession);
      }
    });

    // Replace with server's complete list
    store.setRemoteSessions(backendId, sessions);

    // Update sync timestamp
    state.lastSyncTime = timestamp;

    console.log(`[SessionSync] Full sync: ${sessions.length} total sessions`);
  } catch (error) {
    console.error('[SessionSync] Full sync failed:', error);
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
