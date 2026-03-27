/**
 * Gateway Connection Hook
 *
 * Manages gateway config polling and provides backward-compatible API
 * that delegates to BackendFacade. The GatewayTransport lifecycle is
 * fully managed by the facade — this hook only handles:
 * 1. Gateway config polling (30s) to discover URL/secret from embedded server
 * 2. Public API that delegates to facade
 */

import { useEffect, useCallback } from 'react';
import type { ClientMessage } from '@my-claudia/shared';
import { useGatewayStore } from '../stores/gatewayStore';
import { getServerGatewayStatus } from '../services/api';
import { useFacadeStore } from '../stores/facadeStore';

export function useGatewayConnection() {
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
    const interval = setInterval(syncFromServer, 30000);

    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Public API — delegates to facade
  const openChannel = useCallback((backendId: string) => {
    useFacadeStore.getState().facade?.openBackend(backendId);
  }, []);

  const sendToBackend = useCallback((backendId: string, message: ClientMessage) => {
    useFacadeStore.getState().facade?.sendToBackend(backendId, message);
  }, []);

  const isBackendConnected = useCallback((backendId: string) => {
    const facade = useFacadeStore.getState().facade;
    if (!facade) return false;
    const backend = facade.getSnapshot().backends.find(b => b.backendId === backendId);
    return backend?.runtimeState === 'ready';
  }, []);

  const disconnectGateway = useCallback(() => {
    useFacadeStore.getState().facade?.disconnect();
  }, []);

  return {
    openChannel,
    sendToBackend,
    isBackendAuthenticated: isBackendConnected,
    isBackendConnected,
    disconnectGateway,
  };
}
