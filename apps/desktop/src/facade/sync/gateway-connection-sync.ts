import type { BackendFacadeEvent, ServerFeature } from '@my-claudia/shared';
import { useFacadeStore } from '../../stores/facadeStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useServerStore } from '../../stores/serverStore';
import { cleanupServerSyncState } from '../../services/messageHandler';
import { isLegacyLocalBackendId } from '../../utils/controlPlane';
import { clearAutoOpenFailures, scheduleAutoOpenBackends } from './state';

export function syncSnapshotToGatewayStore(event: Extract<BackendFacadeEvent, { type: 'snapshot_updated' }>): void {
  const snapshot = event.snapshot;
  const gwStore = useGatewayStore.getState();
  const serverState = useServerStore.getState();

  gwStore.setConnected(snapshot.connectionState === 'connected');
  const resolvedLocalBackendId =
    snapshot.localBackendId
    || snapshot.backends.find((b) => b.isThisInstance)?.backendId
    || null;
  for (const b of snapshot.backends) {
    serverState.setServerFeatures(b.backendId, b.capabilities as ServerFeature[]);
  }

  if (resolvedLocalBackendId && isLegacyLocalBackendId(serverState.activeServerId)) {
    serverState.setActiveServer(resolvedLocalBackendId);
  } else if (resolvedLocalBackendId && !serverState.activeServerId) {
    serverState.setActiveServer(resolvedLocalBackendId);
  } else if (
    resolvedLocalBackendId
    && serverState.activeServerId
    && !snapshot.backends.some(b => b.backendId === serverState.activeServerId)
  ) {
    serverState.setActiveServer(resolvedLocalBackendId);
  }

  const facade = useFacadeStore.getState().facade;
  if (facade) {
    const backendsToAutoOpen: string[] = [];
    if (resolvedLocalBackendId) backendsToAutoOpen.push(resolvedLocalBackendId);
    if (serverState.activeServerId && serverState.activeServerId !== resolvedLocalBackendId) {
      backendsToAutoOpen.push(serverState.activeServerId);
    }

    const toOpen = backendsToAutoOpen.filter(bid => {
      const b = snapshot.backends.find(item => item.backendId === bid);
      return b && b.openState === 'unsubscribed' && b.runtimeState === 'visible';
    });

    scheduleAutoOpenBackends(toOpen);
  }
}

export function syncConnectionState(event: Extract<BackendFacadeEvent, { type: 'connection_state_changed' }>): void {
  useGatewayStore.getState().setConnected(event.state === 'connected');
  useRecoveryStore.getState().setTransportState(event.state, event.error);
  if (event.state === 'connected') {
    clearAutoOpenFailures();
  }
  if (event.state !== 'connected') {
    for (const backend of useFacadeStore.getState().backends) {
      cleanupServerSyncState(backend.backendId);
      cleanupServerSyncState(`gw:${backend.backendId}`);
    }
  }
}
