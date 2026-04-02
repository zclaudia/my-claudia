import type { BackendConnectionState, BackendSnapshot } from '@my-claudia/shared';

export type EffectiveBackendStatus = 'connected' | 'connecting' | 'idle' | 'disconnected' | 'error';

export function canReachBackend(
  connectionState: BackendConnectionState,
  backend: Pick<BackendSnapshot, 'online'>,
): boolean {
  return connectionState === 'connected' && backend.online;
}

export function isBackendReady(
  connectionState: BackendConnectionState,
  backend: Pick<BackendSnapshot, 'online' | 'runtimeState'>,
): boolean {
  return canReachBackend(connectionState, backend) && backend.runtimeState === 'ready';
}

export function getEffectiveBackendStatus(
  connectionState: BackendConnectionState,
  backend: Pick<BackendSnapshot, 'online' | 'runtimeState' | 'openState'>,
): EffectiveBackendStatus {
  if (connectionState === 'error') return 'error';
  if (connectionState === 'idle' || connectionState === 'disconnected') return 'disconnected';
  if (connectionState === 'connecting' || connectionState === 'reconnecting') return 'connecting';

  if (!backend.online) return 'disconnected';

  switch (backend.runtimeState) {
    case 'ready':
      return 'connected';
    case 'error':
      return 'error';
    case 'offline':
      return 'disconnected';
    case 'opening':
      return 'connecting';
    case 'visible':
      return 'idle';
    default:
      return backend.openState === 'open' ? 'connecting' : 'disconnected';
  }
}
