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
import { useAgentStore } from '../stores/agentStore';
import { GatewayTransport } from './transport/GatewayTransport';
import { toGatewayServerId, isGatewayTarget, parseBackendId } from '../stores/gatewayStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { xtermRegistry } from '../utils/xtermRegistry';
import { useTerminalStore } from '../stores/terminalStore';
import { useSupervisionStore } from '../stores/supervisionStore';
import { getServerGatewayStatus } from '../services/api';

const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useGatewayConnection() {
  const transportRef = useRef<GatewayTransport | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);
  // Track which runs belong to which backend server (for heartbeat reconciliation)
  const serverRunsRef = useRef<Map<string, Set<string>>>(new Map());

  // Gateway store
  const {
    gatewayUrl,
    gatewaySecret,
    isConnected: isGatewayConnected,
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

  // Chat store
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
  const { setPendingRequest } = usePermissionStore();

  // Keep session ref in sync
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

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
          if (msg.publicKey) {
            useServerStore.getState().setServerPublicKey(serverId, msg.publicKey);
          }
          reconnectAttemptRef.current = 0;
          updateLastConnected(serverId);
        } else {
          console.error(`[GatewayConn:${backendId}] Backend auth failed:`, msg.error);
          setServerConnectionStatus(serverId, 'error', msg.error);
        }
        break;

      case 'pong':
        break;

      case 'delta': {
        // Use sessionId from message (preferred), fall back to activeRuns lookup
        const deltaSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
        if (deltaSession) {
          appendToLastMessage(deltaSession, msg.content);
          // Mark unread for agent if panel is closed
          if (msg.runId === useAgentStore.getState().activeRunId && !useAgentStore.getState().isExpanded) {
            useAgentStore.getState().setHasUnread(true);
          }
        } else if (msg.runId) {
          console.warn(`[GatewayConn:${backendId}] Delta for untracked run ${msg.runId} (server=${serverId}, active=${currentActiveId})`);
        }
        break;
      }

      case 'run_started': {
        // Use sessionId from server message (preferred), fall back to ref for old servers
        const targetSessionId = msg.sessionId || currentSessionId;
        const isAgentRun = (msg as any).clientRequestId?.startsWith('agent_');
        // Track run-to-server mapping for heartbeat reconciliation
        if (!serverRunsRef.current.has(serverId)) {
          serverRunsRef.current.set(serverId, new Set());
        }
        serverRunsRef.current.get(serverId)!.add(msg.runId);
        if (isAgentRun) {
          const agentSessionId = useAgentStore.getState().agentSessionId;
          if (agentSessionId) {
            startRun(msg.runId, agentSessionId);
            useAgentStore.getState().setActiveRunId(msg.runId);
            useAgentStore.getState().setLoading(true);
            addMessage(agentSessionId, {
              id: msg.runId,
              sessionId: agentSessionId,
              role: 'assistant',
              content: '',
              createdAt: Date.now()
            });
          }
        } else if (targetSessionId) {
          startRun(msg.runId, targetSessionId);
          if (serverId === currentActiveId) {
            clearSystemInfo();
          }
          addMessage(targetSessionId, {
            id: msg.runId,
            sessionId: targetSessionId,
            role: 'assistant',
            content: '',
            createdAt: Date.now()
          });
          // Update session active status
          useProjectStore.getState().setSessionActive(targetSessionId, true);
        } else {
          console.warn(`[GatewayConn:${backendId}] run_started ignored: no sessionId (server=${serverId}, active=${currentActiveId})`);
        }
        break;
      }

      case 'run_completed': {
        // Use sessionId from message (preferred), fall back to activeRuns lookup
        const completedSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
        // Clean up agent run state
        if (msg.runId === useAgentStore.getState().activeRunId) {
          useAgentStore.getState().setActiveRunId(null);
          useAgentStore.getState().setLoading(false);
        }
        // Clear ask_user_question requests for this backend regardless of active state
        useAskUserQuestionStore.getState().clearRequestsForServer(serverId);
        if (completedSession) {
          finalizeToolCallsToMessage(msg.runId);
          if (msg.usage) {
            addSessionUsage(completedSession, msg.usage);
          }
          // Update session active status (skip for agent sessions)
          if (completedSession !== useAgentStore.getState().agentSessionId) {
            useProjectStore.getState().setSessionActive(completedSession, false);
          }
        }
        endRun(msg.runId);
        serverRunsRef.current.get(serverId)?.delete(msg.runId);
        break;
      }

      case 'run_failed': {
        // Use sessionId from message (preferred), fall back to activeRuns lookup
        const failedSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
        // Clean up agent run state
        if (msg.runId === useAgentStore.getState().activeRunId) {
          useAgentStore.getState().setActiveRunId(null);
          useAgentStore.getState().setLoading(false);
        }
        // Clear ask_user_question requests for this backend regardless of active state
        useAskUserQuestionStore.getState().clearRequestsForServer(serverId);
        if (failedSession) {
          if (msg.error) {
            appendToLastMessage(failedSession, `\n\n**Error:** ${msg.error}`);
          }
          finalizeToolCallsToMessage(msg.runId);
          // Update session active status (skip for agent sessions)
          if (failedSession !== useAgentStore.getState().agentSessionId) {
            useProjectStore.getState().setSessionActive(failedSession, false);
          }
        }
        endRun(msg.runId);
        serverRunsRef.current.get(serverId)?.delete(msg.runId);
        console.error(`[GatewayConn:${backendId}] Run failed:`, msg.error);
        break;
      }

      case 'tool_use': {
        // Use sessionId from message or fall back to activeRuns lookup
        const toolSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
        if (toolSession) {
          addToolCall(msg.runId, msg.toolUseId, msg.toolName, msg.toolInput);
        } else if (msg.runId) {
          console.warn(`[GatewayConn:${backendId}] tool_use for untracked run ${msg.runId}`);
        }
        break;
      }

      case 'tool_result': {
        // Use sessionId from message or fall back to activeRuns lookup
        const resultSession = msg.sessionId || useChatStore.getState().activeRuns[msg.runId];
        if (resultSession) {
          updateToolCallResult(msg.runId, msg.toolUseId, msg.result, msg.isError);
        } else if (msg.runId) {
          console.warn(`[GatewayConn:${backendId}] tool_result for untracked run ${msg.runId}`);
        }
        break;
      }

      case 'permission_request': {
        // Gateway handles subscription filtering — no local check needed
        const permBackends = useGatewayStore.getState().discoveredBackends;
        const permBackendInfo = permBackends.find(b => b.backendId === backendId);
        setPendingRequest({
          requestId: msg.requestId,
          sessionId: msg.sessionId,
          serverId,
          backendName: permBackendInfo?.name,
          toolName: msg.toolName,
          detail: msg.detail,
          timeoutSec: msg.timeoutSeconds,
          requiresCredential: (msg as any).requiresCredential,
          credentialHint: (msg as any).credentialHint,
        });
        break;
      }

      case 'ask_user_question': {
        // Gateway handles subscription filtering — no local check needed
        const aqBackends = useGatewayStore.getState().discoveredBackends;
        const aqBackendInfo = aqBackends.find(b => b.backendId === backendId);
        useAskUserQuestionStore.getState().setPendingRequest({
          requestId: (msg as any).requestId,
          sessionId: (msg as any).sessionId,
          serverId,
          backendName: aqBackendInfo?.name,
          questions: (msg as any).questions
        });
        break;
      }

      case 'permission_resolved': {
        // Another device resolved this permission — clear it locally
        const resolvedId = (msg as any).requestId;
        usePermissionStore.getState().clearRequestById(resolvedId);
        break;
      }

      case 'ask_user_question_resolved': {
        // Another device answered this question — clear it locally
        const resolvedId = (msg as any).requestId;
        useAskUserQuestionStore.getState().clearRequestById(resolvedId);
        break;
      }

      case 'state_heartbeat': {
        // Reconcile state from backend heartbeat
        const heartbeat = msg as any;
        const backends = useGatewayStore.getState().discoveredBackends;
        const backendInfo = backends.find(b => b.backendId === backendId);
        const backendName = backendInfo?.name;

        // Reconcile permissions
        const validPermIds = new Set<string>(heartbeat.pendingPermissions.map((p: any) => p.requestId as string));
        usePermissionStore.getState().clearStaleRequests(serverId, validPermIds);
        for (const perm of heartbeat.pendingPermissions) {
          if (!usePermissionStore.getState().hasRequest(perm.requestId)) {
            setPendingRequest({
              requestId: perm.requestId,
              sessionId: perm.sessionId,
              serverId,
              backendName,
              toolName: perm.toolName,
              detail: perm.detail,
              timeoutSec: perm.timeoutSeconds,
              requiresCredential: perm.requiresCredential,
              credentialHint: perm.credentialHint,
            });
          }
        }

        // Reconcile questions
        const validQIds = new Set<string>(heartbeat.pendingQuestions.map((q: any) => q.requestId as string));
        useAskUserQuestionStore.getState().clearStaleRequests(serverId, validQIds);
        for (const q of heartbeat.pendingQuestions) {
          if (!useAskUserQuestionStore.getState().hasRequest(q.requestId)) {
            useAskUserQuestionStore.getState().setPendingRequest({
              requestId: q.requestId,
              sessionId: q.sessionId,
              serverId,
              backendName,
              questions: q.questions
            });
          }
        }

        // Reconcile session active status
        const activeSessionIds = new Set<string>(heartbeat.activeRuns.map((r: any) => r.sessionId as string));
        useSessionsStore.getState().reconcileActiveStatus(backendId, activeSessionIds);

        // Reconcile chatStore active runs (restores loading state on reconnect, cleans up stale runs)
        const chatState = useChatStore.getState();
        const serverActiveRunIds = new Set(
          (heartbeat.activeRuns as Array<{ runId: string; sessionId: string }>).map(r => r.runId)
        );
        // Add missing runs
        for (const run of heartbeat.activeRuns as Array<{ runId: string; sessionId: string }>) {
          if (!chatState.activeRuns[run.runId]) {
            chatState.startRun(run.runId, run.sessionId);
            // Also track in serverRunsRef so stale-run cleanup can find it
            if (!serverRunsRef.current.has(serverId)) {
              serverRunsRef.current.set(serverId, new Set());
            }
            serverRunsRef.current.get(serverId)!.add(run.runId);
          }
        }
        // Clean up stale runs (client thinks run is active, but server says it's not)
        const trackedRuns = serverRunsRef.current.get(serverId);
        if (trackedRuns) {
          for (const runId of trackedRuns) {
            if (!serverActiveRunIds.has(runId)) {
              console.log(`[GatewayConn:${backendId}] Cleaning up stale run ${runId} (not in server heartbeat)`);
              const sessionId = chatState.activeRuns[runId];
              chatState.endRun(runId);
              if (sessionId) {
                useProjectStore.getState().setSessionActive(sessionId, false);
              }
              trackedRuns.delete(runId);
            }
          }
        }
        break;
      }

      case 'agent_permission_intercepted':
        useAgentStore.getState().recordInterception(
          (msg as any).toolName,
          (msg as any).decision,
          (msg as any).sessionId
        );
        if (!useAgentStore.getState().isExpanded) {
          useAgentStore.getState().setHasUnread(true);
        }
        break;

      case 'background_task_update': {
        const agentStore = useAgentStore.getState();
        agentStore.updateBackgroundSession((msg as any).sessionId, {
          status: (msg as any).status,
          name: (msg as any).name,
          parentSessionId: (msg as any).parentSessionId,
        });
        if ((msg as any).status === 'completed' || (msg as any).status === 'failed') {
          const sid = (msg as any).sessionId;
          setTimeout(() => {
            useAgentStore.getState().removeBackgroundSession(sid);
          }, 30000);
        }
        if (!agentStore.isExpanded) {
          agentStore.setHasUnread(true);
        }
        break;
      }

      case 'background_permission_pending': {
        const agentStore2 = useAgentStore.getState();
        agentStore2.addBackgroundPermission((msg as any).sessionId, {
          requestId: (msg as any).requestId,
          toolName: (msg as any).toolName,
          detail: (msg as any).detail,
          timeoutSeconds: (msg as any).timeoutSeconds,
        });
        if (!agentStore2.isExpanded) {
          agentStore2.setHasUnread(true);
        }
        break;
      }

      case 'supervision_update': {
        const supStore = useSupervisionStore.getState();
        const sup = (msg as any).supervision;
        if (['completed', 'failed', 'cancelled'].includes(sup.status)) {
          supStore.updateSupervision(sup);
          setTimeout(() => supStore.removeSupervision(sup.sessionId), 10000);
        } else {
          supStore.updateSupervision(sup);
        }
        break;
      }

      case 'system_info':
        if (serverId === currentActiveId) {
          setSystemInfo(msg.systemInfo);
        }
        break;

      case 'terminal_opened': {
        if (!msg.success) {
          console.error(`[GatewayConn:${backendId}] Terminal open failed:`, msg.error);
        }
        break;
      }

      case 'terminal_output': {
        const term = xtermRegistry.get(msg.terminalId)?.terminal;
        if (term) term.write(msg.data);
        useTerminalStore.getState().markReady(msg.terminalId);
        break;
      }

      case 'terminal_exited': {
        const exitTerm = xtermRegistry.get(msg.terminalId)?.terminal;
        if (exitTerm) exitTerm.write(`\r\n[Process exited with code ${msg.exitCode}]\r\n`);
        useTerminalStore.getState().handleTerminalExited(msg.terminalId);
        break;
      }

      case 'error':
        console.error(`[GatewayConn:${backendId}] Server error:`, msg.message);
        break;

      default:
        console.warn(`[GatewayConn:${backendId}] Unknown message type:`, (msg as any).type);
    }
  }, [
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
