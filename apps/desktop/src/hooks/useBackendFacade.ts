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
import { handleServerMessage, cleanupServerSyncState } from '../services/messageHandler';
import type { BackendConnectionState, BackendRuntimeState, ServerFeature } from '@my-claudia/shared';
import type { ConnectionStatus } from '../stores/serverStore';
import { isLegacyLocalBackendId } from '../utils/controlPlane';
import { useTerminalStore } from '../stores/terminalStore';
import { xtermRegistry } from '../utils/xtermRegistry';
import { useRecoveryStore } from '../stores/recoveryStore';

/** Map facade BackendRuntimeState to serverStore ConnectionStatus. */
function runtimeStateToConnectionStatus(state: BackendRuntimeState): ConnectionStatus {
  switch (state) {
    case 'ready':
      return 'connected';
    case 'opening':
      return 'connecting';
    case 'error':
      return 'error';
    default:
      return 'disconnected';
  }
}

function transportStateToConnectionStatus(state: BackendConnectionState): ConnectionStatus {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'error':
      return 'error';
    case 'disconnected':
      return 'disconnected';
    default:
      return 'connecting';
  }
}

// Fix #21: use WeakRef-like pattern — clear on each facade lifecycle
let facadeServerRuns = new Map<string, Set<string>>();

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
    serverState.setControlPlaneState('connecting');

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

    // Subscribe to events → update facadeStore + sync bridge to gatewayStore
    unsubEventRef.current = facade.onEvent((event: BackendFacadeEvent) => {
      useFacadeStore.getState().applyEvent(event);
      syncToGatewayStore(event);
    });

    // Connect
    facade.connect();

    return () => {
      if (unsubEventRef.current) {
        unsubEventRef.current();
        unsubEventRef.current = null;
      }
      if (facadeRef.current) {
        facadeRef.current.disconnect();
        facadeRef.current = null;
      }
      useFacadeStore.getState().clearFacade();
    };
  }, [mode, embeddedPort, directGatewayUrl, directGatewaySecret]);
}

/**
 * Sync facade events to gatewayStore for gateway transport state only.
 */
export function syncToGatewayStore(event: BackendFacadeEvent): void {
  const gwStore = useGatewayStore.getState();
  const serverState = useServerStore.getState();

  switch (event.type) {
    case 'snapshot_updated': {
      const snapshot = event.snapshot;
      useRecoveryStore.getState().applySnapshot(snapshot);
      gwStore.setConnected(snapshot.connectionState === 'connected');
      // Sync per-backend connection status to serverStore
      const resolvedLocalBackendId =
        snapshot.localBackendId
        || snapshot.backends.find((b) => b.isThisInstance)?.backendId
        || null;
      serverState.setControlPlaneState(snapshot.connectionState === 'connected' ? 'ready' : 'connecting');
      for (const b of snapshot.backends) {
        const status = snapshot.connectionState === 'connected'
          ? runtimeStateToConnectionStatus(b.runtimeState)
          : transportStateToConnectionStatus(snapshot.connectionState);
        serverState.setServerConnectionStatus(b.backendId, status, b.lastError ?? undefined);
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
      const facade = useFacadeStore.getState().facade;
      if (facade) {
        const backendsToAutoOpen = new Set<string>();
        if (resolvedLocalBackendId) backendsToAutoOpen.add(resolvedLocalBackendId);
        if (serverState.activeServerId) backendsToAutoOpen.add(serverState.activeServerId);

        for (const bid of backendsToAutoOpen) {
          const b = snapshot.backends.find(item => item.backendId === bid);
          if (b && b.openState === 'closed' && b.runtimeState === 'visible') {
            facade.openBackend(bid);
          }
        }
      }
      break;
    }

    case 'connection_state_changed':
      useRecoveryStore.getState().setTransportState(event.state, event.error ?? null);
      useServerStore.getState().setControlPlaneState(event.state === 'connected' ? 'ready' : event.state === 'error' ? 'error' : 'connecting');
      gwStore.setConnected(event.state === 'connected');
      if (event.state !== 'connected') {
        const downgradedStatus = transportStateToConnectionStatus(event.state);
        for (const backend of useFacadeStore.getState().backends) {
          serverState.setServerConnectionStatus(backend.backendId, downgradedStatus, event.error);
          // Clear per-server version caches so reconnect triggers full reconciliation
          // in both direct (`backendId`) and gateway-prefixed (`gw:${backendId}`) contexts.
          cleanupServerSyncState(backend.backendId);
          cleanupServerSyncState(`gw:${backend.backendId}`);
        }
      }
      break;

    case 'backend_state_changed': {
      const recoveryStore = useRecoveryStore.getState();
      if (event.state === 'ready') {
        recoveryStore.applySnapshot(useFacadeStore.getState().facade?.getSnapshot?.() ?? {
          snapshotVersion: useFacadeStore.getState().snapshotVersion,
          capturedAt: Date.now(),
          mode: useFacadeStore.getState().mode ?? 'embedded',
          connectionState: useFacadeStore.getState().connectionState,
          localBackendId: useFacadeStore.getState().localBackendId,
          currentInstanceId: useFacadeStore.getState().currentInstanceId,
          currentDeviceId: useFacadeStore.getState().currentDeviceId,
          backends: useFacadeStore.getState().backends,
          sessionStreams: useFacadeStore.getState().sessionStreams,
          registryRevision: useFacadeStore.getState().registryRevision,
        });
      }
      // Sync to serverStore
      const connStatus = runtimeStateToConnectionStatus(event.state);
      useServerStore.getState().setServerConnectionStatus(event.backendId, connStatus, event.error);

      if (event.state === 'offline' || event.state === 'error') {
        cleanupServerSyncState(event.backendId);
        cleanupServerSyncState(`gw:${event.backendId}`);
      }

      // When a backend goes offline, mark its terminals for reattach so they
      // auto-recover when the backend comes back.
      const shouldMarkTerminalsForReattach =
        (event.state === 'offline' || event.state === 'error')
        && event.error !== 'user_closed';
      if (shouldMarkTerminalsForReattach) {
        const termStore = useTerminalStore.getState();
        for (const [scopeKey, terminalId] of Object.entries(termStore.terminals)) {
          if (scopeKey.startsWith(`${event.backendId}::`)) {
            termStore.markNeedsReattach(terminalId);
            xtermRegistry.markDetached(terminalId);
          }
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

    // --- Catalog events → sessionsStore ---
    case 'catalog_snapshot': {
      const { backendId, items } = event;
      useSessionsStore.getState().setRemoteSessions(backendId, items
        .filter((item) => !item.archived)
        .map(item => ({
        id: item.sessionId,
        projectId: '',
        name: item.title || '',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        isActive: item.activeRunStatus === 'running',
        type: 'regular' as const,
      })));
      break;
    }

    case 'catalog_event': {
      const { backendId, op, item, sessionId } = event;
      if (op === 'upsert' && item) {
        if (item.archived) {
          useSessionsStore.getState().handleSessionEvent(backendId, 'deleted', {
            id: item.sessionId,
            projectId: '',
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
          projectId: '',
          name: item.title || '',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          isActive: item.activeRunStatus === 'running',
          type: 'regular' as const,
        });
      } else if (op === 'remove' && sessionId) {
        useSessionsStore.getState().handleSessionEvent(backendId, 'deleted', {
          id: sessionId,
          projectId: '',
          isActive: false,
          type: 'regular' as const,
          createdAt: 0,
          updatedAt: 0,
        });
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
      break;
    }

    case 'content_patch_failed':
      useToastStore.getState().add({
        type: 'error',
        title: '消息同步失败',
        message: event.error,
      });
      break;

    default:
      break;
  }
}
