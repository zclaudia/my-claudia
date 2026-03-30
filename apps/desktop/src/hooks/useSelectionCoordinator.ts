import { useCallback } from 'react';
import { useConnection } from '../contexts/ConnectionContext';
import { useOwnershipStore } from '../stores/ownershipStore';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { getControlPlaneMode, resolveCanonicalBackendId, resolveLocalBackendId } from '../utils/controlPlane';

interface SelectSessionOptions {
  backendId?: string | null;
}

export function useSelectionCoordinator() {
  const { connectServer } = useConnection();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeServerStatus = useServerStore((s) =>
    s.activeServerId ? s.connections[s.activeServerId]?.status ?? 'disconnected' : 'disconnected'
  );
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const selectProjectInStore = useProjectStore((s) => s.selectProject);
  const selectSessionInStore = useProjectStore((s) => s.selectSession);

  const selectBackend = useCallback((backendId: string | null | undefined) => {
    const canonicalBackendId = resolveCanonicalBackendId(backendId, resolveLocalBackendId() ?? backendId ?? null);
    if (!canonicalBackendId) return;
    const isSameBackend = activeServerId === canonicalBackendId;
    if (isSameBackend && (activeServerStatus === 'connected' || activeServerStatus === 'connecting')) {
      return;
    }
    if (!isSameBackend) {
      setActiveServer(canonicalBackendId);
    }
    connectServer(canonicalBackendId);
  }, [activeServerId, activeServerStatus, connectServer, setActiveServer]);

  const selectProject = useCallback((projectId: string | null) => {
    if (!projectId) {
      selectProjectInStore(null);
      return;
    }

    const ownerBackendId =
      useOwnershipStore.getState().getProjectBackendId(projectId)
      ?? (getControlPlaneMode() === 'embedded-local'
        ? resolveLocalBackendId()
        : useServerStore.getState().activeServerId);

    const currentBackendId = useServerStore.getState().activeServerId;
    if (ownerBackendId) {
      selectBackend(ownerBackendId);
    }

    if (ownerBackendId && currentBackendId && currentBackendId !== ownerBackendId) {
      window.setTimeout(() => {
        useProjectStore.getState().selectProject(projectId);
      }, 0);
      return;
    }

    selectProjectInStore(projectId);
  }, [selectBackend, selectProjectInStore]);

  const selectSession = useCallback((sessionId: string | null, options?: SelectSessionOptions) => {
    if (!sessionId) {
      selectSessionInStore(null);
      return;
    }

    const ownerBackendId =
      options?.backendId
      ?? useOwnershipStore.getState().getSessionBackendId(sessionId)
      ?? (getControlPlaneMode() === 'embedded-local'
        ? resolveLocalBackendId()
        : useServerStore.getState().activeServerId);

    const currentBackendId = useServerStore.getState().activeServerId;
    if (ownerBackendId) {
      selectBackend(ownerBackendId);
    }

    if (ownerBackendId && currentBackendId && currentBackendId !== ownerBackendId) {
      window.setTimeout(() => {
        useProjectStore.getState().selectSession(sessionId);
      }, 0);
      return;
    }

    selectSessionInStore(sessionId);
  }, [selectBackend, selectSessionInStore]);

  const selectSessionOnBackend = useCallback((backendId: string, sessionId: string) => {
    selectSession(sessionId, { backendId });
  }, [selectSession]);

  return {
    selectBackend,
    selectProject,
    selectSession,
    selectSessionOnBackend,
  };
}
