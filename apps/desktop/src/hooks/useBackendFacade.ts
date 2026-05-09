/**
 * useBackendFacade
 *
 * Main hook for initializing and managing the BackendFacade lifecycle.
 *
 * - Embedded desktop mode: connects to /ws/backend-facade on the embedded server
 * - Direct mobile/Windows mode: creates DirectBackendFacadeProvider
 *
 * Updates facadeStore with snapshot/event data.
 *
 * See docs/design/backend-facade.md § "Phase 2a"
 */

import { useEffect, useRef } from 'react';
import type { BackendFacade, BackendFacadeEvent, SessionMessage } from '@my-claudia/shared';
import { useFacadeStore } from '../stores/facadeStore';
import { EmbeddedFacadeClient } from '../facade/embedded-facade-client';
import { DirectBackendFacadeProvider } from '../facade/direct-provider';
import { useGatewayStore } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useChatStore, type MessageWithToolCalls } from '../stores/chatStore';
import { useToastStore } from '../stores/toastStore';
import { useOwnershipStore } from '../stores/ownershipStore';
import { useProjectStore } from '../stores/projectStore';
import { handleServerMessage, cleanupServerSyncState } from '../services/messageHandler';
import type { ServerFeature } from '@my-claudia/shared';
import { isLegacyLocalBackendId, resolveCanonicalBackendId, resolveLocalBackendId } from '../utils/controlPlane';
import { useTerminalStore } from '../stores/terminalStore';
import { terminalRegistry } from '../services/terminal/TerminalRegistry';
import { useRecoveryStore } from '../stores/recoveryStore';
import { appLifecycleManager } from '../services/appLifecycleManager';
import { refreshNotificationConfig } from '../services/api/notifications';

// Fix #21: use WeakRef-like pattern — clear on each facade lifecycle
let facadeServerRuns = new Map<string, Set<string>>();
let pendingAutoOpenBackends = new Set<string>();
let autoOpenTimer: ReturnType<typeof setTimeout> | null = null;

// Track auto-open failures per backend to prevent infinite retry loops.
// Cleared on facade lifecycle reset.
const AUTO_OPEN_MAX_FAILURES = 3;
let autoOpenFailures = new Map<string, number>();

function clearPendingAutoOpen(): void {
  pendingAutoOpenBackends.clear();
  autoOpenFailures.clear();
  if (autoOpenTimer) {
    clearTimeout(autoOpenTimer);
    autoOpenTimer = null;
  }
}

/** Called when a backend enters error/offline after auto-open attempt. */
function noteAutoOpenFailure(backendId: string): void {
  autoOpenFailures.set(backendId, (autoOpenFailures.get(backendId) ?? 0) + 1);
}

/** Called when a backend successfully reaches ready state. */
function noteAutoOpenSuccess(backendId: string): void {
  autoOpenFailures.delete(backendId);
}

function scheduleAutoOpenBackends(backendIds: string[]): void {
  for (const backendId of backendIds) {
    // Skip backends that have failed too many times
    if ((autoOpenFailures.get(backendId) ?? 0) >= AUTO_OPEN_MAX_FAILURES) continue;
    pendingAutoOpenBackends.add(backendId);
  }
  if (pendingAutoOpenBackends.size === 0 || autoOpenTimer) return;
  autoOpenTimer = setTimeout(() => {
    autoOpenTimer = null;
    const facade = useFacadeStore.getState().facade;
    const snapshot = facade?.getSnapshot?.() ?? useFacadeStore.getState();
    if (!facade || !('backends' in snapshot)) {
      pendingAutoOpenBackends.clear();
      return;
    }

    const queued = [...pendingAutoOpenBackends];
    pendingAutoOpenBackends.clear();
    for (const backendId of queued) {
      const backend = snapshot.backends.find((item: any) => item.backendId === backendId);
      if (backend && backend.openState === 'unsubscribed' && backend.runtimeState === 'visible') {
        facade.openBackend(backendId);
      }
    }
  }, 0);
}

function hasActiveRunsForBackend(backendId: string): boolean {
  const chatStore = useChatStore.getState();
  const ownershipStore = useOwnershipStore.getState();
  const activeRunsForBackend = facadeServerRuns.get(backendId);

  if (activeRunsForBackend && activeRunsForBackend.size > 0) {
    return true;
  }

  for (const [, sessionId] of Object.entries(chatStore.activeRuns)) {
    const ownerBackendId = ownershipStore.getSessionBackendId(sessionId);
    if (ownerBackendId === backendId) {
      return true;
    }
  }

  return false;
}

/** Persistent device ID for direct mode (survives across sessions). */
function getOrCreateDirectDeviceId(): string {
  const key = 'my-claudia-direct-device-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/**
 * Initialize and manage the BackendFacade lifecycle.
 *
 * Call this once at the app root (e.g. in ConnectionProvider).
 * Components consume facade state from useFacadeStore.
 */
export function useBackendFacade(): void {
  const facadeRef = useRef<BackendFacade | null>(null);
  const unsubEventRef = useRef<(() => void) | null>(null);

  // Embedded mode: use embedded server port
  const embeddedPort = useServerStore((s) => s.localServerPort);

  // Direct mode: use direct gateway config
  const directGatewayUrl = useGatewayStore((s) => s.directGatewayUrl);
  const directGatewaySecret = useGatewayStore((s) => s.directGatewaySecret);

  // Determine mode by control-plane source, not platform.
  const mode = directGatewayUrl && directGatewaySecret ? 'direct' : 'embedded';

  useEffect(() => {
    const serverState = useServerStore.getState();
    serverState.setControlPlaneMode(mode === 'embedded' ? 'embedded-local' : 'gateway-direct');

    // Cleanup previous facade
    if (facadeRef.current) {
      facadeRef.current.disconnect();
      facadeRef.current = null;
    }
    if (unsubEventRef.current) {
      unsubEventRef.current();
      unsubEventRef.current = null;
    }
    useFacadeStore.getState().clearFacade();
    facadeServerRuns = new Map(); // Fix #21: clear stale run tracking
    clearPendingAutoOpen();

    let facade: BackendFacade | null = null;

    if (mode === 'embedded') {
      // Wait for embedded server port
      if (!embeddedPort) return;
      facade = new EmbeddedFacadeClient(embeddedPort);
    } else {
      // Direct mode — need gateway URL and secret
      if (!directGatewayUrl || !directGatewaySecret) return;
      facade = new DirectBackendFacadeProvider({
        url: directGatewayUrl,
        gatewaySecret: directGatewaySecret,
        // Fix #11: generate unique IDs per client to avoid registry collisions
        deviceId: getOrCreateDirectDeviceId(),
        instanceId: `direct-${crypto.randomUUID().slice(0, 8)}`,
      });
    }

    facadeRef.current = facade;
    useFacadeStore.getState().setFacade(facade);

    // Subscribe to events → update facadeStore + sync bridge to gatewayStore.
    // All store writes run synchronously so recovery store stays consistent with
    // facade state. The only deferred call is facade.openBackend() inside
    // syncToGatewayStore — it uses setTimeout(0) to avoid re-entrant event
    // emission that would exceed React's update depth on mobile.
    unsubEventRef.current = facade.onEvent((event: BackendFacadeEvent) => {
      useFacadeStore.getState().applyEvent(event);
      syncToGatewayStore(event);
    });

    const refreshNotifications = async () => {
      try {
        await refreshNotificationConfig();
      } catch (err) {
        console.warn('[Notifications] Failed to refresh notification config:', err);
      }
    };

    // Connect
    facade.connect();

    // Refresh notification policy on startup so mobile picks up gateway changes
    // even when the settings page was never opened in this session.
    void refreshNotifications();

    // Start lifecycle manager for mobile background/foreground handling
    appLifecycleManager.start(facade, {
      onResume: refreshNotifications,
    });

    return () => {
      appLifecycleManager.stop();
      if (unsubEventRef.current) {
        unsubEventRef.current();
        unsubEventRef.current = null;
      }
      if (facadeRef.current) {
        facadeRef.current.disconnect();
        facadeRef.current = null;
      }
      clearPendingAutoOpen();
      useFacadeStore.getState().clearFacade();
    };
  }, [mode, embeddedPort, directGatewayUrl, directGatewaySecret]);
}

/**
 * Sync facade events to gatewayStore for gateway transport state only.
 */
export function syncToGatewayStore(
  event: BackendFacadeEvent,
): void {
  const gwStore = useGatewayStore.getState();
  const serverState = useServerStore.getState();

  switch (event.type) {
    case 'snapshot_updated': {
      const snapshot = event.snapshot;
      gwStore.setConnected(snapshot.connectionState === 'connected');
      const resolvedLocalBackendId =
        snapshot.localBackendId
        || snapshot.backends.find((b) => b.isThisInstance)?.backendId
        || null;
      for (const b of snapshot.backends) {
        serverState.setServerFeatures(b.backendId, b.capabilities as ServerFeature[]);
      }
      // Auto-set activeServerId to local backend ONLY on first boot, legacy migration,
      // or when the current activeServerId no longer exists (e.g. facade swap from
      // standalone → embedded-gateway changes the local backend ID).
      if (resolvedLocalBackendId && isLegacyLocalBackendId(serverState.activeServerId)) {
        serverState.setActiveServer(resolvedLocalBackendId);
      } else if (resolvedLocalBackendId && !serverState.activeServerId) {
        // First boot: no active server yet
        serverState.setActiveServer(resolvedLocalBackendId);
      } else if (
        resolvedLocalBackendId
        && serverState.activeServerId
        && !snapshot.backends.some(b => b.backendId === serverState.activeServerId)
      ) {
        // Active backend no longer exists in the registry-backed snapshot.
        // This covers local backend ID migration and backend removal; fall
        // back to the current local backend so the UI keeps a valid target.
        serverState.setActiveServer(resolvedLocalBackendId);
      }
      // Auto-open backends that should be open:
      // 1. Local backend if visible but closed
      // 2. Active remote backend if visible but closed (handles reconnect)
      //
      // IMPORTANT: Defer openBackend to avoid re-entrant event emission.
      // openBackend() synchronously emits backend_state_changed, which would
      // re-enter this event handler and cause cascading store writes that
      // exceed React's maximum update depth on mobile.
      const facade = useFacadeStore.getState().facade;
      if (facade) {
        const backendsToAutoOpen: string[] = [];
        if (resolvedLocalBackendId) backendsToAutoOpen.push(resolvedLocalBackendId);
        if (serverState.activeServerId && serverState.activeServerId !== resolvedLocalBackendId) {
          backendsToAutoOpen.push(serverState.activeServerId);
        }

        const toOpen = backendsToAutoOpen.filter(bid => {
          const b = snapshot.backends.find(item => item.backendId === bid);
          return b && b.openState === 'unsubscribed' && b.runtimeState === 'visible';
        });

        scheduleAutoOpenBackends(toOpen);
      }
      break;
    }

    case 'connection_state_changed':
      gwStore.setConnected(event.state === 'connected');
      useRecoveryStore.getState().setTransportState(event.state, event.error);
      // Fresh transport connection → give all backends a new chance
      if (event.state === 'connected') {
        autoOpenFailures.clear();
      }
      if (event.state !== 'connected') {
        for (const backend of useFacadeStore.getState().backends) {
          cleanupServerSyncState(backend.backendId);
          cleanupServerSyncState(`gw:${backend.backendId}`);
        }
      }
      break;

    case 'backend_state_changed': {
      // Track auto-open success/failure for retry limiting
      if (event.state === 'ready') {
        noteAutoOpenSuccess(event.backendId);
      } else if (event.state === 'error' || event.state === 'offline') {
        noteAutoOpenFailure(event.backendId);
      }

      if (event.state === 'offline' || event.state === 'error') {
        cleanupServerSyncState(event.backendId);
        cleanupServerSyncState(`gw:${event.backendId}`);
      }

      // Drive terminal lifecycle off the backend state:
      //   offline / error → detach all terminals belonging to this backend
      //   ready          → reattach any controller still in `detached` state
      const termStore = useTerminalStore.getState();
      if ((event.state === 'offline' || event.state === 'error') && event.error !== 'user_closed') {
        for (const [scopeKey, terminalId] of Object.entries(termStore.terminals)) {
          if (!scopeKey.startsWith(`${event.backendId}::`)) continue;
          terminalRegistry.get(terminalId)?.detach('backend_offline');
        }
      } else if (event.state === 'ready') {
        for (const [scopeKey, terminalId] of Object.entries(termStore.terminals)) {
          if (!scopeKey.startsWith(`${event.backendId}::`)) continue;
          const controller = terminalRegistry.get(terminalId);
          if (controller?.getState().kind === 'detached') controller.claim();
        }
      }

      // Only show error toast for permanent failures, not transient disconnects
      // (transport_disconnected is emitted during auto-reconnect and resolves on its own)
      const isTransient = event.error === 'user_closed' || event.error === 'transport_disconnected';
      if (event.error && !isTransient && event.state !== 'ready' && hasActiveRunsForBackend(event.backendId)) {
        useToastStore.getState().add({
          type: 'error',
          title: '远程连接已中断',
          message: `Backend ${event.backendId} 连接断开，正在等待恢复${event.error ? `: ${event.error}` : ''}`,
        });
      }
      break;
    }

    // --- Backend data events → sessionsStore ---
    case 'backend_data_snapshot': {
      const { backendId, sessions, projects } = event;
      const activeItems = sessions.filter((item) => !item.archived);
      const mappedSessions = activeItems.map(item => ({
        id: item.sessionId,
        projectId: item.projectId || '',
        name: item.title || '',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        isActive: item.runStatus === 'running',
        type: 'regular' as const,
      }));

      // Check if sessions actually changed before writing to stores
      const currentSessions = useSessionsStore.getState().remoteSessions.get(backendId);
      const sessionsChanged = !currentSessions
        || currentSessions.length !== mappedSessions.length
        || currentSessions.some((s, i) =>
          s.id !== mappedSessions[i].id
          || s.updatedAt !== mappedSessions[i].updatedAt
          || s.isActive !== mappedSessions[i].isActive
        );

      // Always mark sync as succeeded (snapshot arrival = authoritative sync, even if data unchanged)
      const ownershipVersion = useRecoveryStore.getState().noteDataSyncSucceeded(backendId);
      useOwnershipStore.getState().stampSessionOwnershipVersion(
        activeItems.map(item => item.sessionId),
        ownershipVersion,
      );

      // Only write to sessionsStore if data actually changed (avoids re-renders)
      if (sessionsChanged) {
        useSessionsStore.getState().setRemoteSessions(backendId, mappedSessions);
      }

      // Reconcile session active status from authoritative snapshot.
      // Fixes stale run indicators after background recovery — runs that
      // completed while in background still appear as "running" in chatStore
      // until the first state_heartbeat arrives (up to 30s).
      const activeSessionIds = new Set(
        activeItems.filter(item => item.runStatus === 'running').map(item => item.sessionId)
      );
      useSessionsStore.getState().reconcileActiveStatus(backendId, activeSessionIds);

      // Clean up stale runs: finalize pending messages + clear active run state.
      // Same logic as state_heartbeat cleanup but driven by authoritative snapshot.
      const ownershipState = useOwnershipStore.getState();
      const trackedRuns = facadeServerRuns.get(backendId);
      const knownSessionIdsForBackend = new Set([
        ...(currentSessions?.map((session) => session.id) ?? []),
        ...mappedSessions.map((session) => session.id),
      ]);
      for (const [runId, sessionId] of Object.entries(useChatStore.getState().activeRuns)) {
        if (!sessionId) continue;
        const ownerBackendId = resolveCanonicalBackendId(
          ownershipState.sessionBackendIds[sessionId] ?? null,
          resolveLocalBackendId() ?? ownershipState.sessionBackendIds[sessionId] ?? null,
        );
        const belongsToBackend =
          trackedRuns?.has(runId)
          || knownSessionIdsForBackend.has(sessionId)
          || ownerBackendId === backendId;
        if (!belongsToBackend) continue;
        if (activeSessionIds.has(sessionId)) continue;

        useChatStore.getState().finalizeRunToMessage(runId);
        useChatStore.getState().endRun(runId);
        useProjectStore.getState().setSessionActive(sessionId, false);
        trackedRuns?.delete(runId);
      }

      // Sync projects from snapshot (always replace, even if empty — snapshot is the truth)
      if (projects) {
        useProjectStore.getState().replaceProjectsForBackend(backendId, projects.map(p => ({
          id: p.projectId,
          name: p.name,
          type: 'code' as const,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })));
      }
      break;
    }

    case 'backend_data_event': {
      const { backendId, event: dataEvent } = event;
      if (dataEvent.op === 'session_upsert') {
        const item = dataEvent.item;
        if (item.archived) {
          useSessionsStore.getState().handleSessionEvent(backendId, 'deleted', {
            id: item.sessionId,
            projectId: item.projectId || '',
            isActive: false,
            type: 'regular' as const,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          });
          break;
        }
        const sessionStore = useSessionsStore.getState();
        const existingSessions = sessionStore.remoteSessions.get(backendId) || [];
        const eventType = existingSessions.some(s => s.id === item.sessionId)
          ? 'updated' : 'created';
        sessionStore.handleSessionEvent(backendId, eventType, {
          id: item.sessionId,
          projectId: item.projectId || '',
          name: item.title || '',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          isActive: item.runStatus === 'running',
          type: 'regular' as const,
        });
      } else if (dataEvent.op === 'session_remove') {
        useSessionsStore.getState().handleSessionEvent(backendId, 'deleted', {
          id: dataEvent.sessionId,
          projectId: '',
          isActive: false,
          type: 'regular' as const,
          createdAt: 0,
          updatedAt: 0,
        });
      } else if (dataEvent.op === 'project_upsert') {
        const p = dataEvent.item;
        useProjectStore.getState().upsertProjectForBackend(backendId, {
          id: p.projectId,
          name: p.name,
          type: 'code' as const,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        });
      } else if (dataEvent.op === 'project_remove') {
        useProjectStore.getState().removeProjectForBackend(backendId, dataEvent.projectId);
      }
      break;
    }

    // --- Run events → message handler ---
    case 'run_event': {
      const { backendId, event: serverEvent } = event;
      const { backends } = useFacadeStore.getState();

      handleServerMessage(serverEvent, {
        serverId: backendId,
        backendId,
        serverRunsRef: facadeServerRuns,
        resolveBackendName: () => backends.find(b => b.backendId === backendId)?.name,
        logTag: `Facade:${backendId}`,
      });
      break;
    }

    // --- Content patches → chatStore ---
    case 'content_patch': {
      const { sessionId, messages, latestOffset } = event;
      const restoredMessages: MessageWithToolCalls[] = messages.map((msg: SessionMessage) => ({
        id: msg.messageId,
        sessionId: msg.sessionId,
        role: msg.role === 'tool' ? 'assistant' : msg.role,
        createdAt: msg.createdAt,
        offset: msg.offset,
        content: typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      }));
      useChatStore.getState().appendMessages(sessionId, restoredMessages, { maxOffset: latestOffset });
      useRecoveryStore.getState().noteActiveSessionMessage();
      break;
    }

    case 'content_patch_failed':
      useToastStore.getState().add({
        type: 'error',
        title: '消息同步失败',
        message: event.error,
        sessionId: event.sessionId,
        serverId: event.backendId,
      });
      break;

    default: {
      // Messages not in the BackendFacadeEvent union (plugin_state,
      // backend_message_received, etc.) are forwarded by embedded-facade-client
      // via its default case.  Route them to the shared message handler.
      const ev = event as any;
      const msgType = ev.type as string;
      if (msgType === 'backend_message_received' || msgType?.startsWith('plugin_')) {
        const backendId = ev.backendId ?? useFacadeStore.getState().localBackendId ?? 'local';
        const msg = msgType === 'backend_message_received' ? ev.message : ev;
        handleServerMessage(msg, {
          serverId: backendId,
          backendId,
          serverRunsRef: facadeServerRuns,
          resolveBackendName: () => useFacadeStore.getState().backends.find(b => b.backendId === backendId)?.name,
          logTag: `Facade:${backendId}`,
        });
      }
      break;
    }
  }
}
