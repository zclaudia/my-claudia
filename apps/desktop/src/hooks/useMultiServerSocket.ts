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

export function useMultiServerSocket() {
  const gatewayConnection = useGatewayConnection();
  const { activeServerId } = useServerStore();

  const connectServer = useCallback((backendId: string) => {
    const facade = useFacadeStore.getState().facade;
    if (facade) {
      facade.openBackend(backendId);
      return;
    }
    gatewayConnection.openChannel(backendId);
  }, [gatewayConnection]);

  const disconnectServer = useCallback((backendId: string) => {
    const facade = useFacadeStore.getState().facade;
    if (facade) {
      facade.closeBackend(backendId);
    }
  }, []);

  const sendToServer = useCallback((backendId: string, message: ClientMessage) => {
    const facade = useFacadeStore.getState().facade;
    if (facade) {
      facade.sendToBackend(backendId, message);
      return;
    }
    gatewayConnection.sendToBackend(backendId, message);
  }, [gatewayConnection]);

  const sendMessage = useCallback((message: ClientMessage) => {
    if (!activeServerId) {
      console.error('[Socket] Cannot send message: no active server');
      return;
    }
    sendToServer(activeServerId, message);
  }, [activeServerId, sendToServer]);

  const isServerConnected = useCallback((backendId: string) => {
    const facade = useFacadeStore.getState().facade;
    if (facade) {
      const snapshot = facade.getSnapshot();
      const backend = snapshot.backends.find(b => b.backendId === backendId);
      return backend?.runtimeState === 'ready';
    }
    return gatewayConnection.isBackendConnected(backendId);
  }, [gatewayConnection]);

  const isConnected = useCallback(() => {
    if (!activeServerId) return false;
    return isServerConnected(activeServerId);
  }, [activeServerId, isServerConnected]);

  const getConnectedServers = useCallback(() => {
    const facade = useFacadeStore.getState().facade;
    if (facade) {
      return facade.getSnapshot().backends
        .filter(b => b.runtimeState === 'ready')
        .map(b => b.backendId);
    }
    return [];
  }, []);

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
