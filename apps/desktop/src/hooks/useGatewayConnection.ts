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
            status.connected
          );
        } else {
          useGatewayStore.getState().syncFromServer(null, null, [], null, false);
        }
      } catch {
        // Server not reachable, skip
      }
    };

    syncFromServer();
    const interval = setInterval(syncFromServer, 10000);

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
      onConnected: () => {
        console.log('[GatewayConn] Gateway connected');
        setConnected(true);
        reconnectAttemptRef.current = 0;

        // Send persisted subscription preferences to gateway
        const { subscribedBackendIds } = useGatewayStore.getState();
        if (subscribedBackendIds.length === 0) {
          // Empty = subscribe to all
          transport!.updateSubscriptions([], true);
        } else {
          transport!.updateSubscriptions(subscribedBackendIds);
        }
      },
      onDisconnected: () => {
        console.log('[GatewayConn] Gateway disconnected');
        setConnected(false);
        scheduleReconnect();
      },
      onError: (error) => {
        console.error('[GatewayConn] Gateway error:', error);
      },
      onBackendsUpdated: (backends) => {
        setDiscoveredBackends(backends);
      },
      onBackendAuthResult: (backendId, success, error, features) => {
        setBackendAuthStatus(backendId, success ? 'authenticated' : 'failed');

        if (success) {
          const serverId = toGatewayServerId(backendId);
          setServerConnectionStatus(serverId, 'connected');
          setServerLocalConnection(serverId, false);
          if (features) {
            setServerFeatures(serverId, features);
          }
          reconnectAttemptRef.current = 0;
          updateLastConnected(serverId);
        } else {
          const serverId = toGatewayServerId(backendId);
          setServerConnectionStatus(serverId, 'error', error);
        }
      },
      onBackendMessage: handleBackendMessage,
      onBackendDisconnected: (backendId) => {
        setBackendAuthStatus(backendId, 'failed');
        const serverId = toGatewayServerId(backendId);
        setServerConnectionStatus(serverId, 'disconnected');
      }
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
    handleBackendMessage
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

  // Auto-authenticate backend when active server changes to a gateway target
  useEffect(() => {
    if (!activeServerId || !isGatewayTarget(activeServerId)) return;
    if (!transportRef.current || !transportRef.current.isConnected()) return;

    const backendId = parseBackendId(activeServerId);

    // Already authenticated
    if (transportRef.current.isBackendAuthenticated(backendId)) return;

    console.log(`[GatewayConn] Auto-authenticating backend: ${backendId}`);
    setBackendAuthStatus(backendId, 'pending');
    setServerConnectionStatus(activeServerId, 'connecting');
    transportRef.current.authenticateBackend(backendId);
  }, [activeServerId, setBackendAuthStatus, setServerConnectionStatus]);

  // Auto-authenticate all online backends (gateway handles subscription filtering)
  useEffect(() => {
    if (!isGatewayConnected || !transportRef.current?.isConnected()) return;

    for (const backend of discoveredBackends) {
      if (!backend.online) continue;
      if (transportRef.current.isBackendAuthenticated(backend.backendId)) continue;

      console.log(`[GatewayConn] Auto-authenticating backend: ${backend.backendId}`);
      setBackendAuthStatus(backend.backendId, 'pending');
      setServerConnectionStatus(toGatewayServerId(backend.backendId), 'connecting');
      transportRef.current.authenticateBackend(backend.backendId);
    }
  }, [isGatewayConnected, discoveredBackends, setBackendAuthStatus, setServerConnectionStatus]);

  // Push subscription changes to gateway when subscribedBackendIds changes
  useEffect(() => {
    let prevIds = useGatewayStore.getState().subscribedBackendIds;
    const unsub = useGatewayStore.subscribe((state) => {
      if (state.subscribedBackendIds !== prevIds) {
        prevIds = state.subscribedBackendIds;
        const transport = transportRef.current;
        if (!transport?.isConnected()) return;

        if (state.subscribedBackendIds.length === 0) {
          transport.updateSubscriptions([], true);
        } else {
          transport.updateSubscriptions(state.subscribedBackendIds);
        }
      }
    });
    return unsub;
  }, []);

  // When localBackendId becomes available, clean up any stale remote sessions
  // that leaked through the gateway before the guard was active (startup timing window)
  useEffect(() => {
    if (localBackendId) {
      useSessionsStore.getState().clearBackendSessions(localBackendId);
    }
  }, [localBackendId]);

  // Heartbeat for the gateway connection
  useEffect(() => {
    const interval = setInterval(() => {
      // Refresh backends list periodically when connected
      if (transportRef.current?.isConnected()) {
        transportRef.current.requestBackendsList();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Public API
  const authenticateBackend = useCallback((backendId: string) => {
    const transport = transportRef.current;
    if (!transport || !transport.isConnected()) {
      console.error('[GatewayConn] Cannot authenticate: gateway not connected');
      return;
    }

    setBackendAuthStatus(backendId, 'pending');
    transport.authenticateBackend(backendId);
  }, [setBackendAuthStatus]);

  const sendToBackend = useCallback((backendId: string, message: ClientMessage) => {
    const transport = transportRef.current;
    if (!transport) {
      console.error('[GatewayConn] No gateway transport');
      return;
    }
    transport.sendToBackend(backendId, message);
  }, []);

  const isBackendAuthenticated = useCallback((backendId: string) => {
    return transportRef.current?.isBackendAuthenticated(backendId) || false;
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
    authenticateBackend,
    sendToBackend,
    isBackendAuthenticated,
    disconnectGateway
  };
}
