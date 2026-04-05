/**
 * Multi-Server WebSocket Hook
 *
 * All backend connections (including local embedded server) go through
 * the BackendFacade. This hook provides backward-compatible API for
 * ConnectionContext consumers.
 */

import { useCallback, useMemo } from 'react';
import type { ClientMessage } from '@my-claudia/shared';
import { useServerStore } from '../stores/serverStore';
import { useGatewayConnection } from './useGatewayConnection';
import { useFacadeStore } from '../stores/facadeStore';
import { getUsableMobileBackendIds, isMobileBackendUsable } from '../services/mobileConnectionState';

export function useMultiServerSocket() {
  const gatewayConnection = useGatewayConnection();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const facade = useFacadeStore((s) => s.facade);
  useFacadeStore((s) => s.connectionState);
  useFacadeStore((s) =>
    activeServerId
      ? s.backends.find((backend) => backend.backendId === activeServerId)?.runtimeState ?? null
      : null
  );

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
      return isMobileBackendUsable({
        backendId,
        connectionState: useFacadeStore.getState().connectionState,
        backends: useFacadeStore.getState().backends,
      });
    }
    return gatewayConnection.isBackendConnected(backendId);
  }, [facade, gatewayConnection]);

  const isConnected = useCallback(() => {
    if (!activeServerId) return false;
    return isServerConnected(activeServerId);
  }, [activeServerId, isServerConnected]);

  // Read on-demand via getState() — no subscription needed.
  const getConnectedServers = useCallback(() => {
    if (!facade) return [];
    const facadeState = useFacadeStore.getState();
    return getUsableMobileBackendIds(
      facadeState.connectionState,
      facadeState.backends,
    );
  }, [facade]);

  const connect = useCallback(() => {
    if (activeServerId) connectServer(activeServerId);
  }, [activeServerId, connectServer]);

  const disconnect = useCallback(() => {
    if (activeServerId) disconnectServer(activeServerId);
  }, [activeServerId, disconnectServer]);

  const isConnectedValue = isConnected();

  return useMemo(() => ({
    connectServer,
    disconnectServer,
    sendToServer,
    isServerConnected,
    getConnectedServers,
    sendMessage,
    isConnected: isConnectedValue,
    connect,
    disconnect,
  }), [connectServer, disconnectServer, sendToServer, isServerConnected, getConnectedServers, sendMessage, isConnectedValue, connect, disconnect]);
}
