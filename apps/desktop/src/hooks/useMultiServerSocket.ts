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
import { useRecoveryStore, isBackendReady as isBackendReadyRecovery } from '../stores/recoveryStore';
import { useMobileRecoveryStore } from '../stores/mobileRecoveryStore';
import { getUsableMobileBackendIds, isMobileBackendUsable } from '../services/mobileConnectionState';
import { isAndroid } from '../utils/platform';

export function useMultiServerSocket() {
  const mobileRecoveryEnabled = isAndroid();
  const gatewayConnection = useGatewayConnection();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const facade = useFacadeStore((s) => s.facade);
  useFacadeStore((s) => s.connectionState);
  useFacadeStore((s) =>
    activeServerId
      ? s.backends.find((backend) => backend.backendId === activeServerId)?.runtimeState ?? null
      : null
  );
  useMobileRecoveryStore((s) => s.phase);
  // Desktop still derives connectivity from the legacy recovery store.
  // On Android, mobileRecoveryStore/facadeStore are the source of truth, so
  // keep these subscriptions inert to avoid re-rendering off the old state machine.
  useRecoveryStore((s) => (mobileRecoveryEnabled ? null : s.transport.status));
  useRecoveryStore((s) => (
    mobileRecoveryEnabled
      ? null
      : activeServerId ? s.backends[activeServerId]?.status ?? null : null
  ));

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
      if (mobileRecoveryEnabled) {
        return isMobileBackendUsable({
          backendId,
          connectionState: useFacadeStore.getState().connectionState,
          backends: useFacadeStore.getState().backends,
          recoveryPhase: useMobileRecoveryStore.getState().phase,
        });
      }
      return isBackendReadyRecovery(backendId);
    }
    return gatewayConnection.isBackendConnected(backendId);
  }, [facade, gatewayConnection, mobileRecoveryEnabled]);

  const isConnected = useCallback(() => {
    if (!activeServerId) return false;
    return isServerConnected(activeServerId);
  }, [activeServerId, isServerConnected]);

  // Read on-demand via getState() — no subscription needed.
  // This prevents recovery store writes from cascading through
  // ConnectionProvider to all useConnection() consumers.
  const getConnectedServers = useCallback(() => {
    if (!facade) return [];
    if (mobileRecoveryEnabled) {
      const facadeState = useFacadeStore.getState();
      return getUsableMobileBackendIds(
        facadeState.connectionState,
        facadeState.backends,
        useMobileRecoveryStore.getState().phase,
      );
    }
    const backends = useRecoveryStore.getState().backends;
    return Object.entries(backends)
      .filter(([, b]) => b.status === 'ready')
      .map(([id]) => id);
  }, [facade, mobileRecoveryEnabled]);

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
