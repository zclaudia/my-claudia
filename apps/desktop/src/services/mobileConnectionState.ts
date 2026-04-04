import type { BackendConnectionState, BackendSnapshot } from '@my-claudia/shared';
import type { MobileRecoveryPhase } from '../stores/mobileRecoveryStore';
import { shouldShowNonCurrentInstanceBackend } from '../stores/gatewayStore';

export type MobileBackendViewState =
  | 'ready'
  | 'transport_reconnecting'
  | 'backend_subscribing'
  | 'backend_visible'
  | 'error'
  | 'offline';

export type MobileControlPlaneState = 'ready' | 'error' | 'connecting';

interface MobileConnectionStateInput {
  backendId: string | null | undefined;
  connectionState: BackendConnectionState;
  backends: BackendSnapshot[];
  recoveryPhase: MobileRecoveryPhase;
}

/** Recovery is in a transient/error phase — backends should not be considered usable */
function isRecoveryBlocking(recoveryPhase: MobileRecoveryPhase): boolean {
  return recoveryPhase === 'recovering' || recoveryPhase === 'error' || recoveryPhase === 'background';
}

export function isMobileBackendUsable({
  backendId,
  connectionState,
  backends,
  recoveryPhase,
}: MobileConnectionStateInput): boolean {
  if (!backendId) return false;
  if (connectionState !== 'connected') return false;
  if (isRecoveryBlocking(recoveryPhase)) return false;
  return backends.some((backend) => backend.backendId === backendId && backend.runtimeState === 'ready');
}

export function getUsableMobileBackendIds(
  connectionState: BackendConnectionState,
  backends: BackendSnapshot[],
  recoveryPhase: MobileRecoveryPhase,
): string[] {
  if (connectionState !== 'connected') return [];
  if (isRecoveryBlocking(recoveryPhase)) return [];
  return backends
    .filter((backend) => backend.runtimeState === 'ready')
    .map((backend) => backend.backendId);
}

export function isMobileGatewayConnected(
  connectionState: BackendConnectionState,
  recoveryPhase: MobileRecoveryPhase,
): boolean {
  return connectionState === 'connected' && !isRecoveryBlocking(recoveryPhase);
}

export function getMobileControlPlaneState(
  connectionState: BackendConnectionState,
  recoveryPhase: MobileRecoveryPhase,
): MobileControlPlaneState {
  if (isMobileGatewayConnected(connectionState, recoveryPhase)) {
    return 'ready';
  }
  if (connectionState === 'error' || recoveryPhase === 'error') {
    return 'error';
  }
  return 'connecting';
}

export function getVisibleMobileBackends(
  backends: BackendSnapshot[],
  recoveryPhase: MobileRecoveryPhase,
  currentInstanceId: string | null,
  showLocalBackend: boolean,
): BackendSnapshot[] {
  if (isRecoveryBlocking(recoveryPhase)) return [];
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
  recoveryPhase: MobileRecoveryPhase,
): MobileBackendViewState {
  if (!backendId) return 'offline';

  const backend = backends.find((item) => item.backendId === backendId);
  if (!backend || backend.runtimeState === 'offline') return 'offline';
  if (recoveryPhase === 'error') return 'error';
  if (connectionState !== 'connected') return 'transport_reconnecting';
  if (recoveryPhase === 'recovering' || recoveryPhase === 'background') return 'backend_subscribing';
  if (backend.runtimeState === 'ready') return 'ready';
  if (backend.runtimeState === 'visible') return 'backend_visible';
  return 'backend_subscribing';
}
