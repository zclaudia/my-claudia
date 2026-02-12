/**
 * Multi-Server WebSocket Hook
 *
 * Manages multiple simultaneous server connections.
 * Direct servers use DirectTransport (one per server).
 * Gateway backends are handled by useGatewayConnection (single shared transport).
 */

import { useEffect, useRef, useCallback } from 'react';
import type { ClientMessage, ServerMessage, BackendServer } from '@my-claudia/shared';
import { useChatStore } from '../stores/chatStore';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { usePermissionStore } from '../stores/permissionStore';
import { useAskUserQuestionStore } from '../stores/askUserQuestionStore';
import { DirectTransport } from './transport/DirectTransport';
import type { Transport } from './transport/BaseTransport';
import { useGatewayConnection } from './useGatewayConnection';
import { isGatewayTarget, parseBackendId } from '../stores/gatewayStore';

const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

interface ServerTransportState {
  transport: Transport;
  reconnectAttempts: number;
  reconnectTimeout: number | null;
}

export function useMultiServerSocket() {
  // Map of serverId -> transport state (direct servers only)
  const transportsRef = useRef<Map<string, ServerTransportState>>(new Map());
  const selectedSessionIdRef = useRef<string | null>(null);
  // Stable ref for connectServer — used by scheduleReconnect and auto-connect effect
  // to avoid circular deps and infinite re-render loops
  const connectServerRef = useRef<(serverId: string) => void>(() => {});

  // Gateway connection (manages all gateway backends)
  const gatewayConnection = useGatewayConnection();

  // Store hooks
  const {
    addMessage,
    appendToLastMessage,
    startRun,
    endRun,
    addToolCall,
    updateToolCallResult,
    finalizeToolCallsToMessage,
    setSystemInfo,
    clearSystemInfo,
    addSessionUsage,
  } = useChatStore();

  const { selectedSessionId } = useProjectStore();

  const {
    servers,
    activeServerId,
    setServerConnectionStatus,
    setServerLocalConnection,
    setServerFeatures,
    updateLastConnected
  } = useServerStore();

  const { setPendingRequest } = usePermissionStore();

  // Keep ref in sync with state
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  /**
   * Create message handler for a specific direct server
   */
  const createMessageHandler = useCallback((serverId: string) => {
    return (rawMessage: ServerMessage | any) => {
      const currentSessionId = selectedSessionIdRef.current;

      // Handle correlation envelope format
      let message: ServerMessage;
      if ('payload' in rawMessage && 'metadata' in rawMessage) {
        message = {
          type: rawMessage.type,
          ...rawMessage.payload
        } as ServerMessage;
      } else {
        message = rawMessage as ServerMessage;
      }

      switch (message.type) {
        case 'auth_result':
          setServerConnectionStatus(serverId, 'connected');
          setServerLocalConnection(serverId, message.isLocalConnection || false);
          if (message.features) {
            setServerFeatures(serverId, message.features);
          }
          if (message.success) {
            console.log(`[Socket:${serverId}] Authentication successful`);
            const state = transportsRef.current.get(serverId);
            if (state) {
              state.reconnectAttempts = 0;
            }
            updateLastConnected(serverId);
          } else {
            console.error(`[Socket:${serverId}] Authentication failed:`, message.error);
            setServerConnectionStatus(serverId, 'error', message.error);
          }
          break;

        case 'pong':
          break;

        case 'delta': {
          const runSession = useChatStore.getState().activeRuns[message.runId];
          if (serverId === activeServerId && runSession) {
            appendToLastMessage(runSession, message.content);
          }
          break;
        }

        case 'run_started':
          if (serverId === activeServerId && currentSessionId) {
            startRun(message.runId, currentSessionId);
            clearSystemInfo();
            addMessage(currentSessionId, {
              id: message.runId,
              sessionId: currentSessionId,
              role: 'assistant',
              content: '',
              createdAt: Date.now()
            });
          }
          break;

        case 'run_completed': {
          const runSession = useChatStore.getState().activeRuns[message.runId];
          if (serverId === activeServerId) {
            if (runSession) {
              finalizeToolCallsToMessage(message.runId);
              if (message.usage) {
                addSessionUsage(runSession, message.usage);
              }
            }
            endRun(message.runId);
            useAskUserQuestionStore.getState().clearRequest();
          }
          break;
        }

        case 'run_failed': {
          const runSession = useChatStore.getState().activeRuns[message.runId];
          if (serverId === activeServerId) {
            if (runSession) {
              finalizeToolCallsToMessage(message.runId);
            }
            endRun(message.runId);
            useAskUserQuestionStore.getState().clearRequest();
            console.error(`[Socket:${serverId}] Run failed:`, message.error);
          }
          break;
        }

        case 'tool_use':
          if (serverId === activeServerId) {
            addToolCall(message.runId, message.toolUseId, message.toolName, message.toolInput);
          }
          break;

        case 'tool_result':
          if (serverId === activeServerId) {
            updateToolCallResult(message.runId, message.toolUseId, message.result, message.isError);
          }
          break;

        case 'permission_request':
          if (serverId === activeServerId) {
            setPendingRequest({
              requestId: message.requestId,
              toolName: message.toolName,
              detail: message.detail,
              timeoutSec: message.timeoutSeconds
            });
          }
          break;

        case 'ask_user_question':
          if (serverId === activeServerId) {
            useAskUserQuestionStore.getState().setPendingRequest({
              requestId: message.requestId,
              questions: message.questions
            });
          }
          break;

        case 'system_info':
          if (serverId === activeServerId) {
            setSystemInfo(message.systemInfo);
          }
          break;

        case 'error':
          console.error(`[Socket:${serverId}] Server error:`, message.message);
          break;

        default:
          console.warn(`[Socket:${serverId}] Unknown message type:`, (message as any).type);
      }
    };
  }, [
    activeServerId,
    servers,
    addMessage,
    appendToLastMessage,
    startRun,
    endRun,
    addToolCall,
    updateToolCallResult,
    finalizeToolCallsToMessage,
    setPendingRequest,
    setSystemInfo,
    clearSystemInfo,
    addSessionUsage,
    setServerConnectionStatus,
    setServerLocalConnection,
    setServerFeatures,
    updateLastConnected
  ]);

  /**
   * Create DirectTransport for a server
   */
  const createTransportForServer = useCallback((server: BackendServer, messageHandler: (msg: ServerMessage) => void): Transport | null => {
    console.log(`[Socket:${server.id}] Creating direct transport for: ${server.address}`);

    const config = {
      url: '',
      onMessage: messageHandler,
      onOpen: () => {
        console.log(`[Socket:${server.id}] Transport connected`);
        setServerConnectionStatus(server.id, 'connected');

        // Send authentication message
        const authMessage: ClientMessage = {
          type: 'auth'
        };

        const state = transportsRef.current.get(server.id);
        state?.transport.send(authMessage);
      },
      onClose: () => {
        console.log(`[Socket:${server.id}] Transport disconnected`);
        setServerConnectionStatus(server.id, 'disconnected');
        scheduleReconnect(server.id);
      },
      onError: (error: Event) => {
        console.error(`[Socket:${server.id}] Transport error:`, error);
        setServerConnectionStatus(server.id, 'error');
      }
    };

    const address = server.address.includes('://')
      ? server.address.replace(/^http/, 'ws')
      : `ws://${server.address}`;

    let wsUrl = `${address}/ws`;

    if (server.clientId) {
      wsUrl += `?clientId=${encodeURIComponent(server.clientId)}`;
    }

    return new DirectTransport({
      ...config,
      url: wsUrl
    });
  }, [setServerConnectionStatus]);

  /**
   * Schedule reconnection for a specific server
   */
  const scheduleReconnect = useCallback((serverId: string) => {
    const state = transportsRef.current.get(serverId);
    if (!state) return;

    if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log(`[Socket:${serverId}] Max reconnect attempts reached`);
      setServerConnectionStatus(serverId, 'error');
      return;
    }

    if (state.reconnectTimeout) {
      clearTimeout(state.reconnectTimeout);
    }

    state.reconnectAttempts++;
    console.log(`[Socket:${serverId}] Scheduling reconnect attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

    state.reconnectTimeout = window.setTimeout(() => {
      connectServerRef.current(serverId);
    }, RECONNECT_INTERVAL);
  }, [setServerConnectionStatus]);

  /**
   * Connect to a specific server
   * For gateway targets: delegates to gateway connection
   * For direct servers: creates DirectTransport
   */
  const connectServer = useCallback((serverId: string) => {
    // Gateway targets are handled by useGatewayConnection
    if (isGatewayTarget(serverId)) {
      const backendId = parseBackendId(serverId);
      gatewayConnection.authenticateBackend(backendId);
      return;
    }

    const server = servers.find(s => s.id === serverId);
    if (!server) {
      console.error(`[Socket] Server not found: ${serverId}`);
      return;
    }

    // Skip gateway-mode servers (legacy entries)
    if (server.connectionMode === 'gateway') {
      console.warn(`[Socket] Skipping legacy gateway server: ${serverId}`);
      return;
    }

    // Check if already connected
    const existingState = transportsRef.current.get(serverId);
    if (existingState?.transport.isConnected()) {
      console.log(`[Socket:${serverId}] Already connected`);
      return;
    }

    // If there's an existing disconnected transport, clean it up
    if (existingState) {
      if (existingState.reconnectTimeout) {
        clearTimeout(existingState.reconnectTimeout);
      }
      existingState.transport.disconnect();
      transportsRef.current.delete(serverId);
    }

    console.log(`[Socket:${serverId}] Connecting...`);
    setServerConnectionStatus(serverId, 'connecting');

    const messageHandler = createMessageHandler(serverId);
    const transport = createTransportForServer(server, messageHandler);

    if (transport) {
      transportsRef.current.set(serverId, {
        transport,
        reconnectAttempts: 0,
        reconnectTimeout: null
      });
      transport.connect();
    }
  }, [servers, createMessageHandler, createTransportForServer, setServerConnectionStatus, gatewayConnection]);

  /**
   * Disconnect from a specific server
   */
  const disconnectServer = useCallback((serverId: string) => {
    // Gateway targets: nothing to disconnect per-backend (gateway WS stays up)
    if (isGatewayTarget(serverId)) {
      return;
    }

    const state = transportsRef.current.get(serverId);
    if (!state) return;

    console.log(`[Socket:${serverId}] Disconnecting...`);

    if (state.reconnectTimeout) {
      clearTimeout(state.reconnectTimeout);
    }

    state.transport.disconnect();
    transportsRef.current.delete(serverId);
    setServerConnectionStatus(serverId, 'disconnected');
  }, [setServerConnectionStatus]);

  /**
   * Send message to a specific server
   */
  const sendToServer = useCallback((serverId: string, message: ClientMessage) => {
    // Gateway targets: route through gateway connection
    if (isGatewayTarget(serverId)) {
      const backendId = parseBackendId(serverId);
      gatewayConnection.sendToBackend(backendId, message);
      return;
    }

    const state = transportsRef.current.get(serverId);
    if (!state?.transport.isConnected()) {
      console.error(`[Socket:${serverId}] Cannot send message: not connected`);
      return;
    }
    state.transport.send(message);
  }, [gatewayConnection]);

  /**
   * Send message to the active server
   */
  const sendMessage = useCallback((message: ClientMessage) => {
    if (!activeServerId) {
      console.error('[Socket] Cannot send message: no active server');
      return;
    }
    sendToServer(activeServerId, message);
  }, [activeServerId, sendToServer]);

  /**
   * Check if a specific server is connected
   */
  const isServerConnected = useCallback((serverId: string) => {
    // Gateway targets: check via gateway connection
    if (isGatewayTarget(serverId)) {
      const backendId = parseBackendId(serverId);
      return gatewayConnection.isBackendAuthenticated(backendId);
    }

    const state = transportsRef.current.get(serverId);
    return state?.transport.isConnected() || false;
  }, [gatewayConnection]);

  /**
   * Check if the active server is connected
   */
  const isConnected = useCallback(() => {
    if (!activeServerId) return false;
    return isServerConnected(activeServerId);
  }, [activeServerId, isServerConnected]);

  /**
   * Get list of connected server IDs
   */
  const getConnectedServers = useCallback(() => {
    return [...transportsRef.current.entries()]
      .filter(([_, state]) => state.transport.isConnected())
      .map(([id]) => id);
  }, []);

  // Keep connectServer ref in sync
  useEffect(() => {
    connectServerRef.current = connectServer;
  }, [connectServer]);

  // Auto-connect to active server when it changes (direct servers only)
  // Gateway targets are auto-connected by useGatewayConnection
  useEffect(() => {
    if (activeServerId && !isGatewayTarget(activeServerId)) {
      const state = transportsRef.current.get(activeServerId);
      if (!state || !state.transport.isConnected()) {
        // Add small delay on initial connection to allow backend server to fully start
        // This prevents connection errors when app starts before server is ready
        const delay = !state ? 800 : 0; // 800ms for initial connection, immediate for reconnection
        const timeoutId = setTimeout(() => {
          connectServerRef.current(activeServerId);
        }, delay);

        // Cleanup timeout if effect re-runs or component unmounts
        return () => clearTimeout(timeoutId);
      }
    }
  }, [activeServerId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      transportsRef.current.forEach((state) => {
        if (state.reconnectTimeout) {
          clearTimeout(state.reconnectTimeout);
        }
        state.transport.disconnect();
      });
      transportsRef.current.clear();
    };
  }, []);

  // Heartbeat for all connected direct servers
  useEffect(() => {
    const interval = setInterval(() => {
      transportsRef.current.forEach((state) => {
        if (state.transport.isConnected()) {
          state.transport.send({ type: 'ping' });
        }
      });
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return {
    // Server-specific operations
    connectServer,
    disconnectServer,
    sendToServer,
    isServerConnected,
    getConnectedServers,

    // Active server operations (backward compatible)
    sendMessage,
    isConnected: isConnected(),
    connect: () => activeServerId && connectServer(activeServerId),
    disconnect: () => activeServerId && disconnectServer(activeServerId)
  };
}
