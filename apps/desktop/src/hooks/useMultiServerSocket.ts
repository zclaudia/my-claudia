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
import { isBackendReady } from '../utils/backendConnection';

export function useMultiServerSocket() {
  const gatewayConnection = useGatewayConnection();
  const { activeServerId } = useServerStore();
  const facade = useFacadeStore((s) => s.facade);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const connectionState = useFacadeStore((s) => s.connectionState);

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
      const backend = facadeBackends.find(b => b.backendId === backendId);
      return backend ? isBackendReady(connectionState, backend) : false;
    }
    return gatewayConnection.isBackendConnected(backendId);
  }, [connectionState, facade, facadeBackends, gatewayConnection]);

  const isConnected = useCallback(() => {
    if (!activeServerId) return false;
    return isServerConnected(activeServerId);
  }, [activeServerId, isServerConnected]);

  const getConnectedServers = useCallback(() => {
    if (facade) {
      return facadeBackends
        .filter(b => isBackendReady(connectionState, b))
        .map(b => b.backendId);
    }
    return [];
  }, [connectionState, facade, facadeBackends]);

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
