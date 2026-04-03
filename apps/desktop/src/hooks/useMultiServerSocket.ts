/**
 * Multi-Server WebSocket Hook
 *
 * All backend connections (including local embedded server) go through
 * the BackendFacade. This hook provides backward-compatible API for
 * ConnectionContext consumers.
 */

import { useCallback } from 'react';
import type { ClientMessage } from '@my-claudia/shared';
import { useServerStore } from '../stores/serverStore';
import { useGatewayConnection } from './useGatewayConnection';
import { useFacadeStore } from '../stores/facadeStore';
import { useRecoveryStore, isBackendReady as isBackendReadyRecovery } from '../stores/recoveryStore';

export function useMultiServerSocket() {
  const gatewayConnection = useGatewayConnection();
  const { activeServerId } = useServerStore();
  const facade = useFacadeStore((s) => s.facade);
  const recoveryBackends = useRecoveryStore((s) => s.backends);

  const connectServer = useCallback((backendId: string) => {
    if (facade) {
      facade.openBackend(backendId);
      return;
    }
    gatewayConnection.openChannel(backendId);
  }, [facade, gatewayConnection]);

  const disconnectServer = useCallback((backendId: string) => {
    if (facade) {
      facade.closeBackend(backendId);
    }
  }, [facade]);

  const sendToServer = useCallback((backendId: string, message: ClientMessage) => {
    if (facade) {
      facade.sendToBackend(backendId, message);
      return;
    }
    gatewayConnection.sendToBackend(backendId, message);
  }, [facade, gatewayConnection]);

  const sendMessage = useCallback((message: ClientMessage) => {
    if (!activeServerId) {
      console.error('[Socket] Cannot send message: no active server');
      return;
    }
    sendToServer(activeServerId, message);
  }, [activeServerId, sendToServer]);

  const isServerConnected = useCallback((backendId: string) => {
    if (facade) {
      return isBackendReadyRecovery(backendId);
    }
    return gatewayConnection.isBackendConnected(backendId);
  }, [facade, gatewayConnection]);

  const isConnected = useCallback(() => {
    if (!activeServerId) return false;
    return isServerConnected(activeServerId);
  }, [activeServerId, isServerConnected]);

  const getConnectedServers = useCallback(() => {
    if (facade) {
      return Object.entries(recoveryBackends)
        .filter(([, b]) => b.status === 'ready')
        .map(([id]) => id);
    }
    return [];
  }, [facade, recoveryBackends]);

  return {
    connectServer,
    disconnectServer,
    sendToServer,
    isServerConnected,
    getConnectedServers,
    sendMessage,
    isConnected: isConnected(),
    connect: () => activeServerId && connectServer(activeServerId),
    disconnect: () => activeServerId && disconnectServer(activeServerId),
  };
}
