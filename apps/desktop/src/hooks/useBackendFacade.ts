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
import type { BackendFacade, BackendFacadeEvent } from '@my-claudia/shared';
import { useFacadeStore } from '../stores/facadeStore';
import { EmbeddedFacadeClient } from '../facade/embedded-facade-client';
import { DirectBackendFacadeProvider } from '../facade/direct-provider';
import { useGatewayStore } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';
import { appLifecycleManager } from '../services/appLifecycleManager';
import { refreshNotificationConfig } from '../services/api/notifications';
import { clearPendingAutoOpen, resetFacadeSyncState, syncToGatewayStore } from '../facade/sync';

export { syncToGatewayStore } from '../facade/sync';

/** Persistent device ID for direct mode (survives across sessions). */
function getOrCreateDirectDeviceId(): string {
  const key = 'my-claudia-direct-device-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

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

  // Determine mode by control-plane source, not platform.
  const mode = directGatewayUrl && directGatewaySecret ? 'direct' : 'embedded';

  useEffect(() => {
    const serverState = useServerStore.getState();
    serverState.setControlPlaneMode(mode === 'embedded' ? 'embedded-local' : 'gateway-direct');

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
    resetFacadeSyncState();

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
        // Fix #11: generate unique IDs per client to avoid registry collisions
        deviceId: getOrCreateDirectDeviceId(),
        instanceId: `direct-${crypto.randomUUID().slice(0, 8)}`,
      });
    }

    facadeRef.current = facade;
    useFacadeStore.getState().setFacade(facade);

    // Subscribe to events → update facadeStore + sync bridge to gatewayStore.
    // All store writes run synchronously so recovery store stays consistent with
    // facade state. The only deferred call is facade.openBackend() inside
    // syncToGatewayStore — it uses setTimeout(0) to avoid re-entrant event
    // emission that would exceed React's update depth on mobile.
    unsubEventRef.current = facade.onEvent((event: BackendFacadeEvent) => {
      useFacadeStore.getState().applyEvent(event);
      syncToGatewayStore(event);
    });

    const refreshNotifications = async () => {
      try {
        await refreshNotificationConfig();
      } catch (err) {
        console.warn('[Notifications] Failed to refresh notification config:', err);
      }
    };

    // Connect
    facade.connect();

    // Refresh notification policy on startup so mobile picks up gateway changes
    // even when the settings page was never opened in this session.
    void refreshNotifications();

    // Start lifecycle manager for mobile background/foreground handling
    appLifecycleManager.start(facade, {
      onResume: refreshNotifications,
    });

    return () => {
      appLifecycleManager.stop();
      if (unsubEventRef.current) {
        unsubEventRef.current();
        unsubEventRef.current = null;
      }
      if (facadeRef.current) {
        facadeRef.current.disconnect();
        facadeRef.current = null;
      }
      clearPendingAutoOpen();
      useFacadeStore.getState().clearFacade();
    };
  }, [mode, embeddedPort, directGatewayUrl, directGatewaySecret]);
}

