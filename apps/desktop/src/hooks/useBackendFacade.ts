/**
 * useBackendFacade
 *
 * Main hook for initializing and managing the BackendFacade lifecycle.
 *
 * - Embedded desktop mode: connects to /ws/backend-facade on the embedded server
 * - Direct mobile/Windows mode: creates DirectBackendFacadeProvider
 *
 * Updates facadeStore with snapshot/event data.
 *
 * See docs/design/backend-facade.md § "Phase 2a"
 */

import { useEffect, useRef } from 'react';
import type { BackendFacade, BackendFacadeEvent, BackendSnapshot } from '@my-claudia/shared';
import type { GatewayBackendInfo } from '@my-claudia/shared';
import { useFacadeStore } from '../stores/facadeStore';
import { EmbeddedFacadeClient } from '../facade/embedded-facade-client';
import { DirectBackendFacadeProvider } from '../facade/direct-provider';
import { useGatewayStore } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';
import { isAndroid } from '../utils/platform';

/**
 * Initialize and manage the BackendFacade lifecycle.
 *
 * Call this once at the app root (e.g. in ConnectionProvider).
 * Components consume facade state from useFacadeStore.
 */
export function useBackendFacade(): void {
  const facadeRef = useRef<BackendFacade | null>(null);
  const unsubEventRef = useRef<(() => void) | null>(null);

  // Embedded mode: use embedded server port
  const embeddedPort = useServerStore((s) => s.localServerPort);

  // Direct mode: use direct gateway config
  const directGatewayUrl = useGatewayStore((s) => s.directGatewayUrl);
  const directGatewaySecret = useGatewayStore((s) => s.directGatewaySecret);

  const isMobileDevice = isAndroid();

  // Determine mode
  const mode = isMobileDevice ? 'direct' : 'embedded';

  useEffect(() => {
    // Cleanup previous facade
    if (facadeRef.current) {
      facadeRef.current.disconnect();
      facadeRef.current = null;
    }
    if (unsubEventRef.current) {
      unsubEventRef.current();
      unsubEventRef.current = null;
    }
    useFacadeStore.getState().clearFacade();

    let facade: BackendFacade | null = null;

    if (mode === 'embedded') {
      // Wait for embedded server port
      if (!embeddedPort) return;
      facade = new EmbeddedFacadeClient(embeddedPort);
    } else {
      // Direct mode — need gateway URL and secret
      if (!directGatewayUrl || !directGatewaySecret) return;
      facade = new DirectBackendFacadeProvider({
        url: directGatewayUrl,
        gatewaySecret: directGatewaySecret,
        // TODO: get from device config
        deviceId: 'mobile-device',
        instanceId: 'mobile-instance',
      });
    }

    facadeRef.current = facade;
    useFacadeStore.getState().setFacade(facade);

    // Subscribe to events → update facadeStore + sync bridge to gatewayStore
    unsubEventRef.current = facade.onEvent((event: BackendFacadeEvent) => {
      useFacadeStore.getState().applyEvent(event);
      syncToGatewayStore(event);
    });

    // Connect
    facade.connect();

    return () => {
      if (unsubEventRef.current) {
        unsubEventRef.current();
        unsubEventRef.current = null;
      }
      if (facadeRef.current) {
        facadeRef.current.disconnect();
        facadeRef.current = null;
      }
      useFacadeStore.getState().clearFacade();
    };
  }, [mode, embeddedPort, directGatewayUrl, directGatewaySecret]);
}

// ============================================================================
// Sync Bridge: facade → gatewayStore (backward compatibility)
// ============================================================================

/**
 * Maps BackendSnapshot to GatewayBackendInfo for backward compatibility.
 * Existing components read `gatewayStore.discoveredBackends` (GatewayBackendInfo[]).
 * This bridge keeps that data in sync with the facade's BackendSnapshot[].
 */
function backendSnapshotToGatewayInfo(b: BackendSnapshot): GatewayBackendInfo {
  return {
    backendId: b.backendId,
    name: b.name,
    online: b.online,
    isThisInstance: b.isThisInstance,
    isThisDevice: b.isThisDevice,
    instanceId: b.instanceId,
    deviceId: b.deviceId,
    channel: b.channel,
  };
}

/**
 * Sync facade events to gatewayStore so existing components (33 files)
 * continue to work without modification during the migration period.
 *
 * Once all components migrate to facadeStore, this bridge can be removed.
 */
function syncToGatewayStore(event: BackendFacadeEvent): void {
  const gwStore = useGatewayStore.getState();

  switch (event.type) {
    case 'snapshot_updated': {
      const snapshot = event.snapshot;
      const backends = snapshot.backends.map(backendSnapshotToGatewayInfo);
      gwStore.setDiscoveredBackends(backends);
      gwStore.setConnected(snapshot.connectionState === 'connected');
      // Sync identity fields
      useGatewayStore.setState({
        localBackendId: snapshot.localBackendId,
        currentInstanceId: snapshot.currentInstanceId,
        currentDeviceId: snapshot.currentDeviceId,
      });
      break;
    }

    case 'connection_state_changed':
      gwStore.setConnected(event.state === 'connected');
      break;

    case 'backend_state_changed': {
      // Update the specific backend in discoveredBackends
      const currentBackends = gwStore.discoveredBackends;
      const idx = currentBackends.findIndex(b => b.backendId === event.backendId);
      if (idx >= 0) {
        const updated = [...currentBackends];
        updated[idx] = {
          ...updated[idx],
          online: event.state !== 'offline' && event.state !== 'error',
        };
        gwStore.setDiscoveredBackends(updated);
      }
      break;
    }

    // catalog_snapshot, catalog_event, run_event, content_patch
    // are handled by their own existing handlers (sessionsStore, chatStore)
    // and don't need to sync to gatewayStore.
    default:
      break;
  }
}
