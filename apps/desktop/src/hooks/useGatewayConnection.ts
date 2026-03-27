/**
 * Gateway Connection Hook
 *
 * Manages a singleton GatewayTransport lifecycle.
 * Connects when gateway config is available, handles reconnection,
 * and routes backend messages to the appropriate handlers.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { ClientMessage, ServerMessage, SessionMessage } from '@my-claudia/shared';
import { useGatewayStore } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';
import { GatewayTransport } from './transport/GatewayTransport';
import { useSessionsStore } from '../stores/sessionsStore';
import { useProjectStore } from '../stores/projectStore';
import { useChatStore } from '../stores/chatStore';
import type { MessageWithToolCalls } from '../stores/chatStore';
import { handleServerMessage } from '../services/messageHandler';
import { getServerGatewayStatus } from '../services/api';
import { startSessionSync, stopSessionSync } from '../services/sessionSync';
import { useFacadeStore } from '../stores/facadeStore';

const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_ATTEMPTS = 30;

export function useGatewayConnection() {
  // When facade is active, skip transport creation — facade handles gateway communication.
  // Only keep gateway config polling and session sync.
  const facadeActive = useFacadeStore((s) => s.facade !== null);

  const transportRef = useRef<GatewayTransport | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  // Track which runs belong to which backend server (for heartbeat reconciliation)
  const serverRunsRef = useRef<Map<string, Set<string>>>(new Map());
  const activeStreamRef = useRef<{ backendId: string; channelId: string; sessionId: string } | null>(null);

  // Gateway store
  const {
    gatewayUrl,
    gatewaySecret,
    isConnected: isGatewayConnected,
    localBackendId,
    discoveredBackends,
    setConnected,
    setDiscoveredBackends,
    setBackendAuthStatus
  } = useGatewayStore();

  // Server store
  const {
    activeServerId,
    setServerConnectionStatus,
    setServerLocalConnection,
    setServerFeatures,
    updateLastConnected
  } = useServerStore();
  const selectedSessionId = useProjectStore((state) => state.selectedSessionId);

  const clearActiveSessionStreamRef = useCallback(() => {
    activeStreamRef.current = null;
  }, []);

  const closeActiveSessionStream = useCallback(() => {
    const current = activeStreamRef.current;
    const transport = transportRef.current;
    if (current && transport?.isConnected()) {
      transport.closeSessionStream(current.channelId, current.sessionId);
    }
    activeStreamRef.current = null;
  }, []);

  const ensureActiveSessionStream = useCallback(() => {
    if (!selectedSessionId || !activeServerId) return;
    const transport = transportRef.current;
    if (!transport?.isConnected()) return;

    const channelId = transport.getChannelId(activeServerId);
    if (!channelId) return;

    const current = activeStreamRef.current;
    const needsReopen = !current
      || current.backendId !== activeServerId
      || current.channelId !== channelId
      || current.sessionId !== selectedSessionId;

    if (current && needsReopen) {
      transport.closeSessionStream(current.channelId, current.sessionId);
    }

    if (needsReopen) {
      console.log(`[GatewayConn] Opening session stream ${selectedSessionId} on ${activeServerId}`);
      transport.openSessionStream(channelId, selectedSessionId);
      activeStreamRef.current = { backendId: activeServerId, channelId, sessionId: selectedSessionId };
    }

    const afterOffset = useChatStore.getState().pagination[selectedSessionId]?.maxOffset ?? 0;
    console.log(`[GatewayConn] Catch-up request ${selectedSessionId} afterOffset=${afterOffset} on ${activeServerId}`);
    transport.catchUpContent(channelId, selectedSessionId, afterOffset);
  }, [activeServerId, selectedSessionId]);

  const stopGatewaySessionSync = useCallback((backendId?: string) => {
    if (backendId) {
      stopSessionSync(backendId);
      return;
    }

    const backendIds = new Set<string>();
    for (const backend of useGatewayStore.getState().discoveredBackends) {
      backendIds.add(backend.backendId);
    }

    const registryItems = transportRef.current?.getRegistryItems();
    if (registryItems) {
      for (const backendId of registryItems.keys()) {
        backendIds.add(backendId);
      }
    }

    for (const currentBackendId of backendIds) {
      stopSessionSync(currentBackendId);
    }
  }, []);

  const markGatewayBackendsDisconnected = useCallback(() => {
    const backendIds = new Set<string>();
    for (const backend of useGatewayStore.getState().discoveredBackends) {
      backendIds.add(backend.backendId);
    }

    const registryItems = transportRef.current?.getRegistryItems();
    if (registryItems) {
      for (const backendId of registryItems.keys()) {
        backendIds.add(backendId);
      }
    }

    for (const backendId of backendIds) {
      const serverId = backendId;
      setServerConnectionStatus(serverId, 'disconnected');
      setServerFeatures(serverId, []);
      setBackendAuthStatus(backendId, 'failed');
    }
  }, [setBackendAuthStatus, setServerConnectionStatus, setServerFeatures]);

  // Poll server gateway status and sync to store
  // Skip when direct config is active (mobile mode — no local server to poll)
  useEffect(() => {
    const { directGatewayUrl, directGatewaySecret } = useGatewayStore.getState();
    if (directGatewayUrl && directGatewaySecret) {
      // Mobile: use persisted direct config instead of polling server
      useGatewayStore.getState().syncFromServer(directGatewayUrl, directGatewaySecret, []);
      return;
    }

    let mounted = true;

    const syncFromServer = async () => {
      try {
        const status = await getServerGatewayStatus();
        if (!mounted) return;
        // Sync as soon as gateway is enabled with URL/secret configured,
        // don't wait for connected=true (that requires async gateway handshake)
        if (status.enabled && status.gatewayUrl && status.gatewaySecret) {
          useGatewayStore.getState().syncFromServer(
            status.gatewayUrl,
            status.gatewaySecret,
            status.discoveredBackends,
            status.backendId,
            status.connected,
            status.instanceId ?? null,
            status.currentDeviceId ?? null
          );
        } else {
          useGatewayStore.getState().syncFromServer(null, null, [], null, false);
        }
      } catch {
        // Server not reachable, skip
      }
    };

    syncFromServer();
    // Poll at 30s interval (reduced from 10s) — registry push handles real-time updates
    const interval = setInterval(syncFromServer, 30000);

    return () => { mounted = false; clearInterval(interval); };
  }, []);

  /**
   * Handle a backend message routed through the gateway transport.
   * Auth is handled inline; everything else delegates to shared handler.
   */
  const handleBackendMessage = useCallback((backendId: string, message: ServerMessage) => {
    // Skip messages from our own embedded server — the direct local connection handles them.
    const { localBackendId } = useGatewayStore.getState();
    if (localBackendId && backendId === localBackendId) {
      return;
    }

    // Handle correlation envelope format for auth check
    let msg: ServerMessage;
    if ('payload' in (message as any) && 'metadata' in (message as any)) {
      msg = {
        type: (message as any).type,
        ...(message as any).payload
      } as ServerMessage;
    } else {
      msg = message;
    }

    // Auth result is transport-specific — handle inline
    if (msg.type === 'auth_result') {
      if (msg.success) {
        console.log(`[GatewayConn:${backendId}] Backend auth successful`);
        setServerConnectionStatus(backendId, 'connected');
        setServerLocalConnection(backendId, false);
        if (msg.publicKey) {
          useServerStore.getState().setServerPublicKey(backendId, msg.publicKey);
        }
        reconnectAttemptRef.current = 0;
        updateLastConnected(backendId);
      } else {
        console.error(`[GatewayConn:${backendId}] Backend auth failed:`, msg.error);
        setServerConnectionStatus(backendId, 'error', msg.error);
      }
      return;
    }

    // Delegate all other messages to the shared handler
    handleServerMessage(message, {
      serverId: backendId,
      backendId,
      serverRunsRef: serverRunsRef.current,
      resolveBackendName: () => useGatewayStore.getState().discoveredBackends.find(b => b.backendId === backendId)?.name,
      logTag: `GatewayConn:${backendId}`,
    });
  }, [
    setServerConnectionStatus,
    setServerLocalConnection,
    updateLastConnected
  ]);

  /**
   * Create the gateway transport
   */
  const createTransport = useCallback(() => {
    if (!gatewayUrl || !gatewaySecret) return;

    // Build WS URL
    const normalizedUrl = gatewayUrl.includes('://')
      ? gatewayUrl.replace(/^http/, 'ws')
      : `ws://${gatewayUrl}`;
    const wsUrl = `${normalizedUrl}/ws`;

    const transport = new GatewayTransport({
      url: wsUrl,
      gatewaySecret,
      deviceId: `client-${crypto.randomUUID().slice(0, 8)}`,
      instanceId: `client-${crypto.randomUUID().slice(0, 8)}`,

      onConnected: (_peerSessionId, _recoveryToken) => {
        console.log('[GatewayConn] Gateway V2 connected');
        setConnected(true);
        reconnectAttemptRef.current = 0;
      },

      onDisconnected: () => {
        console.log('[GatewayConn] Gateway V2 disconnected');
        setConnected(false);
        clearActiveSessionStreamRef();
        stopGatewaySessionSync();
        markGatewayBackendsDisconnected();
        scheduleReconnect();
      },

      onError: (error) => {
        console.error('[GatewayConn] Gateway V2 error:', error);
      },

      // Registry: convert BackendPresence[] to discoveredBackends format
      onRegistryChanged: (items) => {
        const backends = items
          .filter(item => item.visible)
          .map(item => ({
            backendId: item.backendId,
            name: item.name,
            online: true,
            instanceId: item.instanceId,
            deviceId: item.deviceId,
            channel: item.channel,
          }));
        setDiscoveredBackends(backends);
      },

      // Catalog: map to session store
      onCatalogSnapshot: (backendId, _epoch, items) => {
        useSessionsStore.getState().setRemoteSessions(backendId, items.map(item => ({
          id: item.sessionId,
          projectId: '',
          name: item.title || '',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          isActive: item.activeRunStatus === 'running',
          type: 'regular' as const,
        })));
      },

      onCatalogEvent: (backendId, _epoch, op, item, sessionId) => {
        if (op === 'upsert' && item) {
          const sessionStore = useSessionsStore.getState();
          const existingSessions = sessionStore.remoteSessions.get(backendId) || [];
          const eventType = existingSessions.some(session => session.id === item.sessionId)
            ? 'updated'
            : 'created';
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
      },

      onCatalogReset: (backendId, _epoch) => {
        if (activeStreamRef.current?.backendId === backendId) {
          clearActiveSessionStreamRef();
        }
        stopGatewaySessionSync(backendId);
        useSessionsStore.getState().clearBackendSessions(backendId);
      },

      // Channel: update server connection status
      onChannelOpened: (backendId, _channelId, _epoch, capabilities) => {
        const serverId = backendId;
        setServerConnectionStatus(serverId, 'connected');
        setServerLocalConnection(serverId, false);
        setServerFeatures(serverId, capabilities as Parameters<typeof setServerFeatures>[1]);
        setBackendAuthStatus(backendId, 'authenticated');
        reconnectAttemptRef.current = 0;
        updateLastConnected(serverId);
        startSessionSync(serverId);
        ensureActiveSessionStream();
      },

      onChannelRejected: (backendId, reason) => {
        const serverId = backendId;
        setServerConnectionStatus(serverId, 'error', reason);
        setServerFeatures(serverId, []);
        setBackendAuthStatus(backendId, 'failed');
        if (activeStreamRef.current?.backendId === backendId) {
          clearActiveSessionStreamRef();
        }
        stopGatewaySessionSync(backendId);
      },

      onChannelClosed: (channelId, backendId, reason) => {
        const serverId = backendId;
        setServerConnectionStatus(serverId, 'disconnected');
        setServerFeatures(serverId, []);
        setBackendAuthStatus(backendId, 'failed');
        if (activeStreamRef.current?.channelId === channelId) {
          console.log(`[GatewayConn] Session stream dropped with channel ${channelId}: ${reason}`);
          clearActiveSessionStreamRef();
        }
        stopGatewaySessionSync(backendId);
      },

      onChannelMessage: (backendId, message) => {
        handleBackendMessage(backendId, message);
      },

      // Stream: route to message handler
      onRunStreamEvent: (_channelId, _sessionId, event) => {
        // Resolve backendId from channelId via transport's internal channel map
        const channelInfo = (transport as any).channels?.get(event.channelId) as { backendId: string } | undefined;
        const backendId = channelInfo?.backendId;
        if (!backendId) return;

        // Skip messages from our own embedded server
        const { localBackendId } = useGatewayStore.getState();
        if (localBackendId && backendId === localBackendId) return;

        // Map RunStreamEvent to ServerMessage format for shared handler
        const serverMessage = {
          type: event.eventType,
          runId: event.runId,
          sessionId: event.sessionId,
          seq: event.seq,
          ...(event.payload as object),
        } as ServerMessage;

        handleServerMessage(serverMessage, {
          serverId: backendId,
          backendId,
          serverRunsRef: serverRunsRef.current,
          resolveBackendName: () => useGatewayStore.getState().discoveredBackends.find(b => b.backendId === backendId)?.name,
          logTag: `Gateway:${backendId}`,
        });
      },

      onSessionStreamClosed: (_channelId, _sessionId, reason) => {
        console.log(`[GatewayConn] Session stream closed: ${reason}`);
        clearActiveSessionStreamRef();
      },

      onContentPatch: (_channelId, sessionId, messages, latestOffset) => {
        const restoredMessages: MessageWithToolCalls[] = messages.map((message: SessionMessage) => ({
          id: message.messageId,
          sessionId: message.sessionId,
          role: message.role === 'tool' ? 'assistant' : message.role,
          createdAt: message.createdAt,
          offset: message.offset,
          content: typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content),
        }));
        console.log(`[GatewayConn] Content patch received: session=${sessionId}, count=${restoredMessages.length}, latestOffset=${latestOffset}`);
        useChatStore.getState().appendMessages(sessionId, restoredMessages, { maxOffset: latestOffset });
      },
    });

    return transport;
  }, [
    gatewayUrl,
    gatewaySecret,
    setConnected,
    setDiscoveredBackends,
    setBackendAuthStatus,
    setServerConnectionStatus,
    setServerLocalConnection,
    setServerFeatures,
    handleBackendMessage,
    ensureActiveSessionStream,
    clearActiveSessionStreamRef,
    markGatewayBackendsDisconnected,
    stopGatewaySessionSync,
    updateLastConnected,
  ]);

  /**
   * Schedule reconnection
   */
  const scheduleReconnect = useCallback(() => {
    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[GatewayConn] Max reconnect attempts reached, clearing stale sessions');
      stopGatewaySessionSync();
      useSessionsStore.getState().clearAllSessions();
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    reconnectAttemptRef.current++;
    console.log(`[GatewayConn] Reconnecting in ${RECONNECT_INTERVAL}ms (attempt ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimeoutRef.current = window.setTimeout(() => {
      const transport = transportRef.current;
      if (transport && !transport.isConnected()) {
        transport.connect();
      }
    }, RECONNECT_INTERVAL);
  }, [stopGatewaySessionSync]);

  // Reconnect immediately when app returns to foreground (mobile background/foreground)
  // Skip when facade is active — facade handles reconnection
  useEffect(() => {
    if (facadeActive) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const transport = transportRef.current;
      if (!transport || transport.isConnected()) return;

      console.log('[GatewayConn] App visible, attempting immediate reconnect');
      reconnectAttemptRef.current = 0;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      transport.connect();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [facadeActive]);

  // Create/destroy transport when gateway config changes
  // Skip when facade is active — facade handles gateway communication
  useEffect(() => {
    if (facadeActive) {
      // Facade handles transport — clean up any leftover legacy transport
      if (transportRef.current) {
        transportRef.current.disconnect();
        transportRef.current = null;
      }
      clearActiveSessionStreamRef();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      return;
    }

    if (!gatewayUrl || !gatewaySecret) {
      // No gateway config — clean up
      if (transportRef.current) {
        transportRef.current.disconnect();
        transportRef.current = null;
      }
      clearActiveSessionStreamRef();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setConnected(false);
      stopGatewaySessionSync();
      markGatewayBackendsDisconnected();
      return;
    }

    // Create and connect transport
    const transport = createTransport();
    if (transport) {
      transportRef.current = transport;
      reconnectAttemptRef.current = 0;
      transport.connect();
    }

    return () => {
      if (transportRef.current) {
        transportRef.current.disconnect();
        transportRef.current = null;
      }
      clearActiveSessionStreamRef();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      stopGatewaySessionSync();
    };
  }, [facadeActive, gatewayUrl, gatewaySecret, clearActiveSessionStreamRef, createTransport, markGatewayBackendsDisconnected, setConnected, stopGatewaySessionSync]);

  // V2: Auto-open channel + subscribe catalog when active server changes to a gateway target
  // Skip when facade is active — facade handles channel management
  useEffect(() => {
    if (facadeActive) return;
    if (!activeServerId) return;
    const transport = transportRef.current;
    if (!transport || !transport.isConnected()) return;

    if (transport.getChannelId(activeServerId)) return; // Already have channel

    const registryItems = transport.getRegistryItems();
    const presence = registryItems.get(activeServerId);
    if (!presence) return;

    console.log(`[GatewayConn] V2: Opening channel + subscribing catalog: ${activeServerId}`);
    setBackendAuthStatus(activeServerId, 'pending');
    setServerConnectionStatus(activeServerId, 'connecting');
    transport.openChannel(activeServerId, presence.epoch);
    transport.subscribeCatalog(activeServerId, presence.epoch);
  }, [facadeActive, activeServerId, setBackendAuthStatus, setServerConnectionStatus]);

  // V2: Auto-open channels for all online backends
  // Skip when facade is active — facade handles channel management
  useEffect(() => {
    if (facadeActive) return;
    if (!isGatewayConnected) return;
    const transport = transportRef.current;
    if (!transport?.isConnected()) return;

    const registryItems = transport.getRegistryItems();
    for (const [backendId, presence] of registryItems) {
      if (!presence.visible) continue;
      if (transport.getChannelId(backendId)) continue; // Already have channel

      console.log(`[GatewayConn] V2: Auto-opening channel: ${backendId}`);
      setBackendAuthStatus(backendId, 'pending');
      setServerConnectionStatus(backendId, 'connecting');
      transport.openChannel(backendId, presence.epoch);
      transport.subscribeCatalog(backendId, presence.epoch);
    }
  }, [facadeActive, isGatewayConnected, discoveredBackends, setBackendAuthStatus, setServerConnectionStatus]);

  // When localBackendId becomes available, clean up any stale remote sessions
  // that leaked through the gateway before the guard was active (startup timing window)
  useEffect(() => {
    if (localBackendId) {
      useSessionsStore.getState().clearBackendSessions(localBackendId);
    }
  }, [localBackendId]);

  // Skip session stream management when facade is active — facade handles streams
  useEffect(() => {
    if (facadeActive) return;
    if (!selectedSessionId || !activeServerId) {
      closeActiveSessionStream();
      return;
    }

    ensureActiveSessionStream();
  }, [facadeActive, activeServerId, closeActiveSessionStream, ensureActiveSessionStream, selectedSessionId]);

  // V2: No heartbeat polling needed — registry is push-based

  // Public API (v2) — delegates to facade when active
  const openChannel = useCallback((backendId: string) => {
    // When facade is active, delegate to facade
    const facade = useFacadeStore.getState().facade;
    if (facade) {
      facade.openBackend(backendId);
      return;
    }

    const transport = transportRef.current;
    if (!transport || !transport.isConnected()) {
      console.error('[GatewayConn] Cannot open channel: gateway not connected');
      return;
    }

    const registryItems = transport.getRegistryItems();
    const presence = registryItems.get(backendId);
    if (!presence) {
      console.error('[GatewayConn] Backend not in registry:', backendId);
      return;
    }

    setBackendAuthStatus(backendId, 'pending');
    transport.openChannel(backendId, presence.epoch);
    transport.subscribeCatalog(backendId, presence.epoch);
  }, [setBackendAuthStatus]);

  const sendToBackend = useCallback((backendId: string, message: ClientMessage) => {
    // When facade is active, delegate to facade
    const facade = useFacadeStore.getState().facade;
    if (facade) {
      facade.sendToBackend(backendId, message);
      return;
    }

    const transport = transportRef.current;
    if (!transport || !transport.isConnected()) {
      console.error('[GatewayConn] Cannot send: gateway not connected');
      return;
    }
    transport.sendToBackend(backendId, message);
  }, []);

  const isBackendConnected = useCallback((backendId: string) => {
    // When facade is active, check facade snapshot
    const facade = useFacadeStore.getState().facade;
    if (facade) {
      const snapshot = facade.getSnapshot();
      const backend = snapshot.backends.find(b => b.backendId === backendId);
      return backend?.runtimeState === 'ready';
    }

    return !!transportRef.current?.getChannelId(backendId);
  }, []);

  const disconnectGateway = useCallback(() => {
    // When facade is active, delegate to facade
    const facade = useFacadeStore.getState().facade;
    if (facade) {
      facade.disconnect();
      return;
    }

    if (transportRef.current) {
      transportRef.current.disconnect();
      transportRef.current = null;
    }
    clearActiveSessionStreamRef();
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setConnected(false);
    stopGatewaySessionSync();
    markGatewayBackendsDisconnected();
  }, [clearActiveSessionStreamRef, markGatewayBackendsDisconnected, setConnected, stopGatewaySessionSync]);

  return {
    openChannel,
    sendToBackend,
    isBackendAuthenticated: isBackendConnected,
    isBackendConnected,
    disconnectGateway,
  };
}
