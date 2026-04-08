import { useMemo } from 'react';
import { useConnection } from '../contexts/ConnectionContext';
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';
import { createSelectionCoordinator } from '../services/selectionCoordinator';

export function useSelectionCoordinator() {
  const { connectServer } = useConnection();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);

  return useMemo(() => createSelectionCoordinator({
    activeServerId,
    connectionState: facadeConnectionState,
    backends: facadeBackends,
    connectServer,
  }), [
    activeServerId,
    connectServer,
    facadeBackends,
    facadeConnectionState,
  ]);
}
