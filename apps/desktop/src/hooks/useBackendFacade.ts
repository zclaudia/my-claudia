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
import type { BackendFacade, BackendFacadeEvent, BackendSnapshot } from '@my-claudia/shared';
import type { GatewayBackendInfo, SessionMessage } from '@my-claudia/shared';
import { useFacadeStore } from '../stores/facadeStore';
import { EmbeddedFacadeClient } from '../facade/embedded-facade-client';
import { DirectBackendFacadeProvider } from '../facade/direct-provider';
import { useGatewayStore, toGatewayServerId } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useChatStore, type MessageWithToolCalls } from '../stores/chatStore';
import { handleServerMessage } from '../services/messageHandler';
import { isAndroid } from '../utils/platform';

// Fix #21: use WeakRef-like pattern — clear on each facade lifecycle
let facadeServerRuns = new Map<string, Set<string>>();

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

  const isMobileDevice = isAndroid();

  // Determine mode
  const mode = isMobileDevice ? 'direct' : 'embedded';

  useEffect(() => {
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

// ============================================================================
// Sync Bridge: facade → gatewayStore (backward compatibility)
// ============================================================================

/**
 * Maps BackendSnapshot to GatewayBackendInfo for backward compatibility.
 * Existing components read `gatewayStore.discoveredBackends` (GatewayBackendInfo[]).
 * This bridge keeps that data in sync with the facade's BackendSnapshot[].
 */
function backendSnapshotToGatewayInfo(b: BackendSnapshot): GatewayBackendInfo {
  return {
    backendId: b.backendId,
    name: b.name,
    online: b.online,
    isThisInstance: b.isThisInstance,
    isThisDevice: b.isThisDevice,
    instanceId: b.instanceId,
    deviceId: b.deviceId,
    channel: b.channel,
  };
}

/**
 * Sync facade events to gatewayStore so existing components (33 files)
 * continue to work without modification during the migration period.
 *
 * Once all components migrate to facadeStore, this bridge can be removed.
 */
function syncToGatewayStore(event: BackendFacadeEvent): void {
  const gwStore = useGatewayStore.getState();

  switch (event.type) {
    case 'snapshot_updated': {
      const snapshot = event.snapshot;
      const backends = snapshot.backends.map(backendSnapshotToGatewayInfo);
      gwStore.setDiscoveredBackends(backends);
      gwStore.setConnected(snapshot.connectionState === 'connected');
      // Sync identity fields
      useGatewayStore.setState({
        localBackendId: snapshot.localBackendId,
        currentInstanceId: snapshot.currentInstanceId,
        currentDeviceId: snapshot.currentDeviceId,
      });
      break;
    }

    case 'connection_state_changed':
      gwStore.setConnected(event.state === 'connected');
      break;

    case 'backend_state_changed': {
      // Update the specific backend in discoveredBackends
      const currentBackends = gwStore.discoveredBackends;
      const idx = currentBackends.findIndex(b => b.backendId === event.backendId);
      if (idx >= 0) {
        const updated = [...currentBackends];
        updated[idx] = {
          ...updated[idx],
          online: event.state !== 'offline' && event.state !== 'error',
        };
        gwStore.setDiscoveredBackends(updated);
      }
      break;
    }

    // --- Catalog events → sessionsStore ---
    case 'catalog_snapshot': {
      const { backendId, items } = event;
      useSessionsStore.getState().setRemoteSessions(backendId, items.map(item => ({
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
      // Skip local backend messages (embedded server handles them via direct WS)
      const { localBackendId } = useGatewayStore.getState();
      if (localBackendId && backendId === localBackendId) break;

      handleServerMessage(serverEvent, {
        serverId: toGatewayServerId(backendId),
        backendId,
        serverRunsRef: facadeServerRuns,
        resolveBackendName: () =>
          useGatewayStore.getState().discoveredBackends.find(b => b.backendId === backendId)?.name,
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

    default:
      break;
  }
}
