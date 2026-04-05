import type { BackendConnectionState, BackendSnapshot } from '@my-claudia/shared';
import { shouldShowNonCurrentInstanceBackend } from '../stores/gatewayStore';

export type MobileBackendViewState =
  | 'ready'
  | 'transport_reconnecting'
  | 'backend_subscribing'
  | 'backend_visible'
  | 'error'
  | 'offline';

export type MobileControlPlaneState = 'ready' | 'error' | 'connecting';

export function isMobileBackendUsable(input: {
  backendId: string | null | undefined;
  connectionState: BackendConnectionState;
  backends: BackendSnapshot[];
}): boolean {
  const { backendId, connectionState, backends } = input;
  if (!backendId) return false;
  if (connectionState !== 'connected') return false;
  return backends.some((backend) => backend.backendId === backendId && backend.runtimeState === 'ready');
}

export function getUsableMobileBackendIds(
  connectionState: BackendConnectionState,
  backends: BackendSnapshot[],
): string[] {
  if (connectionState !== 'connected') return [];
  return backends
    .filter((backend) => backend.runtimeState === 'ready')
    .map((backend) => backend.backendId);
}

export function isMobileGatewayConnected(
  connectionState: BackendConnectionState,
): boolean {
  return connectionState === 'connected';
}

export function getMobileControlPlaneState(
  connectionState: BackendConnectionState,
  snapshotVersion: number,
): MobileControlPlaneState {
  if (connectionState === 'connected' && snapshotVersion > 1) return 'ready';
  if (connectionState === 'error') return 'error';
  return 'connecting';
}

export function getVisibleMobileBackends(
  backends: BackendSnapshot[],
  currentInstanceId: string | null,
  showLocalBackend: boolean,
): BackendSnapshot[] {
  return backends.filter(
    (backend) =>
      backend.runtimeState !== 'offline'
      && shouldShowNonCurrentInstanceBackend(backend, currentInstanceId, showLocalBackend),
  );
}

export function getMobileBackendViewState(
  backendId: string | null | undefined,
  connectionState: BackendConnectionState,
  backends: BackendSnapshot[],
): MobileBackendViewState {
  if (!backendId) return 'offline';

  const backend = backends.find((item) => item.backendId === backendId);
  if (!backend || backend.runtimeState === 'offline') return 'offline';
  if (connectionState !== 'connected') return 'transport_reconnecting';
  if (backend.runtimeState === 'ready') return 'ready';
  if (backend.runtimeState === 'error') return 'error';
  if (backend.runtimeState === 'visible') return 'backend_visible';
  return 'backend_subscribing';
}
