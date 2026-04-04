import { useMemo } from 'react';
import type { BackendSnapshot } from '@my-claudia/shared';
import { useFacadeStore } from '../../stores/facadeStore';
import { useServerStore } from '../../stores/serverStore';
import { useRecoveryStore, type BackendRecoveryViewState } from '../../stores/recoveryStore';
import { useMobileRecoveryStore } from '../../stores/mobileRecoveryStore';
import { isLocalBackendId } from '../../utils/controlPlane';
import { getMobileBackendViewState, type MobileBackendViewState } from '../../services/mobileConnectionState';
import { isAndroid } from '../../utils/platform';

export interface AutomationBackendOption {
  backendId: string;
  name: string;
  isLocal: boolean;
  isReachable: boolean;
  status: BackendRecoveryViewState | MobileBackendViewState;
  latencyMs?: number | null;
  isThisInstance: boolean;
  backend: BackendSnapshot;
}

export function resolveInitialAutomationBackendId(params: {
  preferredBackendId?: string | null;
  activeServerId?: string | null;
  localBackendId?: string | null;
  options: AutomationBackendOption[];
}): string | null {
  const { preferredBackendId, activeServerId, localBackendId, options } = params;

  const existingIds = new Set(options.map((option) => option.backendId));
  if (preferredBackendId && existingIds.has(preferredBackendId)) return preferredBackendId;
  if (activeServerId && existingIds.has(activeServerId)) return activeServerId;
  if (localBackendId && existingIds.has(localBackendId)) return localBackendId;

  const reachable = options.find((option) => option.isReachable);
  if (reachable) return reachable.backendId;

  return options[0]?.backendId ?? preferredBackendId ?? activeServerId ?? localBackendId ?? null;
}

export function useAutomationBackendOptions(): AutomationBackendOption[] {
  const mobileRecoveryEnabled = isAndroid();
  const backends = useFacadeStore((state) => state.backends);
  const facadeConnectionState = useFacadeStore((state) => state.connectionState);
  const connections = useServerStore((state) => state.connections);
  const getRecoveryBackendViewState = useRecoveryStore((s) => (
    mobileRecoveryEnabled ? null : s.getBackendViewState
  ));
  const mobileRecoveryPhase = useMobileRecoveryStore((s) => s.phase);

  return useMemo(
    () =>
      backends.map((backend) => {
        const viewState = mobileRecoveryEnabled
          ? getMobileBackendViewState(
            backend.backendId,
            facadeConnectionState,
            backends,
            mobileRecoveryPhase,
          )
          : getRecoveryBackendViewState?.(backend.backendId) ?? 'offline';
        return {
          backendId: backend.backendId,
          name: backend.name,
          isLocal: isLocalBackendId(backend.backendId),
          isReachable: viewState === 'ready',
          status: viewState,
          latencyMs: connections[backend.backendId]?.latencyMs,
          isThisInstance: backend.isThisInstance,
          backend,
        };
      }),
    [backends, connections, facadeConnectionState, getRecoveryBackendViewState, mobileRecoveryEnabled, mobileRecoveryPhase],
  );
}
