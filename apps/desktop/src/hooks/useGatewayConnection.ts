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
import { useChatStore } from '../stores/chatStore';
import { useProjectStore } from '../stores/projectStore';
import { usePermissionStore } from '../stores/permissionStore';
import { useAskUserQuestionStore } from '../stores/askUserQuestionStore';
import { GatewayTransport } from './transport/GatewayTransport';
import { toGatewayServerId, isGatewayTarget, parseBackendId } from '../stores/gatewayStore';
import { getServerGatewayStatus } from '../services/api';

const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useGatewayConnection() {
  const transportRef = useRef<GatewayTransport | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);

  // Gateway store
  const {
    gatewayUrl,
    gatewaySecret,
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

  // Chat store
  const {
    addMessage,
    appendToLastMessage,
    setLoading,
    setCurrentRunId,
    addToolCall,
    updateToolCallResult,
    clearToolCalls,
    finalizeToolCallsToMessage,
    setSystemInfo,
    clearSystemInfo,
    addSessionUsage,
  } = useChatStore();

  const { selectedSessionId } = useProjectStore();
  const { setPendingRequest } = usePermissionStore();

  // Keep session ref in sync
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  // Poll server gateway status and sync to store
  useEffect(() => {
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
            status.discoveredBackends
          );
        } else {
          useGatewayStore.getState().syncFromServer(null, null, []);
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
   * Handle a backend message (same logic as useMultiServerSocket's message handler)
   */
  const handleBackendMessage = useCallback((backendId: string, message: ServerMessage) => {
    const serverId = toGatewayServerId(backendId);
    const currentSessionId = selectedSessionIdRef.current;
    const currentActiveId = useServerStore.getState().activeServerId;

    // Handle correlation envelope format
    let msg: ServerMessage;
    if ('payload' in (message as any) && 'metadata' in (message as any)) {
      msg = {
        type: (message as any).type,
        ...(message as any).payload
      } as ServerMessage;
    } else {
      msg = message;
    }

    switch (msg.type) {
      case 'auth_result':
        if (msg.success) {
          console.log(`[GatewayConn:${backendId}] Backend auth successful`);
          setServerConnectionStatus(serverId, 'connected');
          setServerLocalConnection(serverId, false); // Gateway = always remote
          reconnectAttemptRef.current = 0;
          updateLastConnected(serverId);
        } else {
          console.error(`[GatewayConn:${backendId}] Backend auth failed:`, msg.error);
          setServerConnectionStatus(serverId, 'error', msg.error);
        }
        break;

      case 'pong':
        break;

      case 'delta':
        if (serverId === currentActiveId && currentSessionId) {
          appendToLastMessage(currentSessionId, msg.content);
        }
        break;

      case 'run_started':
        if (serverId === currentActiveId) {
          setLoading(true);
          setCurrentRunId(msg.runId);
          clearToolCalls();
          clearSystemInfo();
          if (currentSessionId) {
            addMessage(currentSessionId, {
              id: msg.runId,
              sessionId: currentSessionId,
              role: 'assistant',
              content: '',
              createdAt: Date.now()
            });
          }
        }
        break;

      case 'run_completed':
        if (serverId === currentActiveId) {
          setLoading(false);
          setCurrentRunId(null);
          useAskUserQuestionStore.getState().clearRequest();
          if (currentSessionId) {
            finalizeToolCallsToMessage(currentSessionId);
            if (msg.usage) {
              addSessionUsage(currentSessionId, msg.usage);
            }
          }
        }
        break;

      case 'run_failed':
        if (serverId === currentActiveId) {
          setLoading(false);
          setCurrentRunId(null);
          useAskUserQuestionStore.getState().clearRequest();
          if (currentSessionId) {
            finalizeToolCallsToMessage(currentSessionId);
          }
          console.error(`[GatewayConn:${backendId}] Run failed:`, msg.error);
        }
        break;

      case 'tool_use':
        if (serverId === currentActiveId) {
          addToolCall(msg.toolUseId, msg.toolName, msg.toolInput);
        }
        break;

      case 'tool_result':
        if (serverId === currentActiveId) {
          updateToolCallResult(msg.toolUseId, msg.result, msg.isError);
        }
        break;

      case 'permission_request':
        if (serverId === currentActiveId) {
          setPendingRequest({
            requestId: msg.requestId,
            toolName: msg.toolName,
            detail: msg.detail,
            timeoutSec: msg.timeoutSeconds
          });
        }
        break;

      case 'ask_user_question':
        if (serverId === currentActiveId) {
          useAskUserQuestionStore.getState().setPendingRequest({
            requestId: (msg as any).requestId,
            questions: (msg as any).questions
          });
        }
        break;

      case 'system_info':
        if (serverId === currentActiveId) {
          setSystemInfo(msg.systemInfo);
        }
        break;

      case 'error':
        console.error(`[GatewayConn:${backendId}] Server error:`, msg.message);
        break;

      default:
        console.warn(`[GatewayConn:${backendId}] Unknown message type:`, (msg as any).type);
    }
  }, [
    addMessage,
    appendToLastMessage,
    setLoading,
    setCurrentRunId,
    addToolCall,
    updateToolCallResult,
    clearToolCalls,
    finalizeToolCallsToMessage,
    setPendingRequest,
    setSystemInfo,
    clearSystemInfo,
    addSessionUsage,
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
      console.log('[GatewayConn] Max reconnect attempts reached');
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
