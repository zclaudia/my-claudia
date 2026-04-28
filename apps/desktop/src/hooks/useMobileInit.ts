import { useEffect, useRef } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useGatewayStore } from '../stores/gatewayStore';
import { useFacadeStore } from '../stores/facadeStore';
import { useConnection } from '../contexts/ConnectionContext';
import { isLocalBackendId } from '../utils/controlPlane';
import {
  getMobileBackendViewState,
  isMobileGatewayConnected,
} from '../services/mobileConnectionState';

/**
 * Mobile-specific initialization:
 * 1. Prevents auto-connecting to localhost on first load
 * 2. Auto-reconnects to the last used backend when gateway discovers it
 */
export function useMobileInit(isMobile: boolean) {
  const { connectServer } = useConnection();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const lastActiveBackendId = useGatewayStore((s) => s.lastActiveBackendId);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);

  const mobileInitDone = useRef(false);
  const mobileAutoConnectDone = useRef(false);

  // Prevent localhost connection on initial load
  useEffect(() => {
    if (!isMobile || mobileInitDone.current) return;
    mobileInitDone.current = true;

    const { activeServerId } = useServerStore.getState();
    if (isLocalBackendId(activeServerId)) {
      useServerStore.getState().setActiveServer(null);
    }
  }, [isMobile]);

  // Auto-reconnect to last used backend when gateway discovers it
  useEffect(() => {
    if (!isMobile || mobileAutoConnectDone.current) return;
    if (!lastActiveBackendId) return;
    if (!isMobileGatewayConnected(facadeConnectionState)) return;

    const backendId = lastActiveBackendId;
    const activeBackendViewState = getMobileBackendViewState(
      backendId,
      facadeConnectionState,
      facadeBackends,
    );
    const activeBackendReady = activeBackendViewState === 'ready' || activeBackendViewState === 'backend_subscribing';
    if (activeServerId === backendId && activeBackendReady) {
      mobileAutoConnectDone.current = true;
      return;
    }

    const backendViewState = getMobileBackendViewState(
      backendId,
      facadeConnectionState,
      facadeBackends,
    );
    if (backendViewState === 'offline') return;

    mobileAutoConnectDone.current = true;
    console.log('[App] Auto-reconnecting to last used backend:', lastActiveBackendId);
    useServerStore.getState().setActiveServer(lastActiveBackendId);
    connectServer(lastActiveBackendId);
  }, [isMobile, lastActiveBackendId, facadeConnectionState, facadeBackends, activeServerId, connectServer]);
}
