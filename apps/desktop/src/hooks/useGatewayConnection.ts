/**
 * Gateway Connection Hook
 *
 * Manages a singleton GatewayTransport lifecycle.
 * Connects when gateway config is available, handles reconnection,
 * and routes backend messages to the appropriate handlers.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { ClientMessage, ServerMessage } from '@my-claudia/shared';
import { useGatewayStore } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';
import { GatewayTransport } from './transport/GatewayTransport';
import { toGatewayServerId, isGatewayTarget, parseBackendId } from '../stores/gatewayStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { handleServerMessage } from '../services/messageHandler';
import { getServerGatewayStatus } from '../services/api';
import { stopSessionSync } from '../services/sessionSync';

const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_ATTEMPTS = 30;

export function useGatewayConnection() {
  const transportRef = useRef<GatewayTransport | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  // Track which runs belong to which backend server (for heartbeat reconciliation)
  const serverRunsRef = useRef<Map<string, Set<string>>>(new Map());

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

    const serverId = toGatewayServerId(backendId);

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
        setServerConnectionStatus(serverId, 'connected');
        setServerLocalConnection(serverId, false);
        if (msg.publicKey) {
          useServerStore.getState().setServerPublicKey(serverId, msg.publicKey);
        }
        reconnectAttemptRef.current = 0;
        updateLastConnected(serverId);
      } else {
        console.error(`[GatewayConn:${backendId}] Backend auth failed:`, msg.error);
        setServerConnectionStatus(serverId, 'error', msg.error);
      }
      return;
    }

    // Delegate all other messages to the shared handler
    handleServerMessage(message, {
      serverId,
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
          useSessionsStore.getState().handleSessionEvent(backendId, 'updated', {
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
        useSessionsStore.getState().clearBackendSessions(backendId);
      },

      // Channel: update server connection status
      onChannelOpened: (backendId, _channelId, _epoch, capabilities) => {
        const serverId = toGatewayServerId(backendId);
        setServerConnectionStatus(serverId, 'connected');
        setServerLocalConnection(serverId, false);
        setServerFeatures(serverId, capabilities as Parameters<typeof setServerFeatures>[1]);
        setBackendAuthStatus(backendId, 'authenticated');
        reconnectAttemptRef.current = 0;
        updateLastConnected(serverId);
      },

      onChannelRejected: (backendId, reason) => {
        const serverId = toGatewayServerId(backendId);
        setServerConnectionStatus(serverId, 'error', reason);
        setServerFeatures(serverId, []);
        setBackendAuthStatus(backendId, 'failed');
      },

      onChannelClosed: (_channelId, backendId, _reason) => {
        const serverId = toGatewayServerId(backendId);
        setServerConnectionStatus(serverId, 'disconnected');
        setServerFeatures(serverId, []);
        setBackendAuthStatus(backendId, 'failed');
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
          serverId: toGatewayServerId(backendId),
          backendId,
          serverRunsRef: serverRunsRef.current,
          resolveBackendName: () => useGatewayStore.getState().discoveredBackends.find(b => b.backendId === backendId)?.name,
          logTag: `Gateway:${backendId}`,
        });
      },

      onSessionStreamClosed: (_channelId, _sessionId, reason) => {
        console.log(`[GatewayConn] Session stream closed: ${reason}`);
      },

      onContentPatch: (_channelId, _sessionId, _messages, _latestOffset) => {
        // TODO: integrate with session content cache
        console.log(`[GatewayConn] Content patch received`);
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
    updateLastConnected,
  ]);

  /**
   * Schedule reconnection
   */
  const scheduleReconnect = useCallback(() => {
    if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[GatewayConn] Max reconnect attempts reached, clearing stale sessions');
      stopSessionSync();
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
  }, []);

  // Reconnect immediately when app returns to foreground (mobile background/foreground)
  useEffect(() => {
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
  }, []);

  // Create/destroy transport when gateway config changes
  useEffect(() => {
    if (!gatewayUrl || !gatewaySecret) {
      // No gateway config — clean up
      if (transportRef.current) {
        transportRef.current.disconnect();
        transportRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setConnected(false);
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
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [gatewayUrl, gatewaySecret, createTransport, setConnected]);

  // V2: Auto-open channel + subscribe catalog when active server changes to a gateway target
  useEffect(() => {
    if (!activeServerId || !isGatewayTarget(activeServerId)) return;
    const transport = transportRef.current;
    if (!transport || !transport.isConnected()) return;

    const backendId = parseBackendId(activeServerId);
    if (transport.getChannelId(backendId)) return; // Already have channel

    const registryItems = transport.getRegistryItems();
    const presence = registryItems.get(backendId);
    if (!presence) return;

    console.log(`[GatewayConn] V2: Opening channel + subscribing catalog: ${backendId}`);
    setBackendAuthStatus(backendId, 'pending');
    setServerConnectionStatus(activeServerId, 'connecting');
    transport.openChannel(backendId, presence.epoch);
    transport.subscribeCatalog(backendId, presence.epoch);
  }, [activeServerId, setBackendAuthStatus, setServerConnectionStatus]);

  // V2: Auto-open channels for all online backends
  useEffect(() => {
    if (!isGatewayConnected) return;
    const transport = transportRef.current;
    if (!transport?.isConnected()) return;

    const registryItems = transport.getRegistryItems();
    for (const [backendId, presence] of registryItems) {
      if (!presence.visible) continue;
      if (transport.getChannelId(backendId)) continue; // Already have channel

      console.log(`[GatewayConn] V2: Auto-opening channel: ${backendId}`);
      setBackendAuthStatus(backendId, 'pending');
      setServerConnectionStatus(toGatewayServerId(backendId), 'connecting');
      transport.openChannel(backendId, presence.epoch);
      transport.subscribeCatalog(backendId, presence.epoch);
    }
  }, [isGatewayConnected, discoveredBackends, setBackendAuthStatus, setServerConnectionStatus]);

  // When localBackendId becomes available, clean up any stale remote sessions
  // that leaked through the gateway before the guard was active (startup timing window)
  useEffect(() => {
    if (localBackendId) {
      useSessionsStore.getState().clearBackendSessions(localBackendId);
    }
  }, [localBackendId]);

  // V2: No heartbeat polling needed — registry is push-based

  // Public API (v2)
  const openChannel = useCallback((backendId: string) => {
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
    const transport = transportRef.current;
    if (!transport || !transport.isConnected()) {
      console.error('[GatewayConn] Cannot send: gateway not connected');
      return;
    }
    transport.sendToBackend(backendId, message);
  }, []);

  const isBackendConnected = useCallback((backendId: string) => {
    return !!transportRef.current?.getChannelId(backendId);
  }, []);

  const disconnectGateway = useCallback(() => {
    if (transportRef.current) {
      transportRef.current.disconnect();
      transportRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setConnected(false);
  }, [setConnected]);

  return {
    openChannel,
    sendToBackend,
    isBackendAuthenticated: isBackendConnected,
    isBackendConnected,
    disconnectGateway,
  };
}
