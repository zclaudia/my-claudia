import { useOwnershipStore } from '../stores/ownershipStore';
import { useProjectStore } from '../stores/projectStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useServerStore } from '../stores/serverStore';
import { getControlPlaneMode, resolveCanonicalBackendId, resolveLocalBackendId } from '../utils/controlPlane';
import { isMobileBackendUsable } from './mobileConnectionState';
import { resolveSessionOwnerBackendId } from '../utils/sessionOwnership';

export interface SelectSessionOptions {
  backendId?: string | null;
}

interface SelectionCoordinatorDeps {
  activeServerId: string | null;
  connectionState: import('@my-claudia/shared').BackendConnectionState;
  backends: import('@my-claudia/shared').BackendSnapshot[];
  connectServer: (backendId: string) => void;
  schedule?: (callback: () => void) => void;
}

export function createSelectionCoordinator(deps: SelectionCoordinatorDeps) {
  const {
    activeServerId,
    connectionState,
    backends,
    connectServer,
    schedule = (callback) => {
      window.setTimeout(callback, 0);
    },
  } = deps;

  const resolveSessionSelection = (sessionId: string): { projectId: string | null; ownerBackendId: string | null } => {
    const localSession = useProjectStore.getState().sessions.find((session) => session.id === sessionId);
    if (localSession) {
      return {
        projectId: localSession.projectId,
        ownerBackendId: resolveSessionOwnerBackendId(sessionId),
      };
    }

    for (const [backendId, sessions] of useSessionsStore.getState().remoteSessions) {
      const remoteSession = sessions.find((session) => session.id === sessionId);
      if (remoteSession) {
        return {
          projectId: remoteSession.projectId,
          ownerBackendId: backendId,
        };
      }
    }

    return {
      projectId: null,
      ownerBackendId:
        getControlPlaneMode() === 'embedded-local'
          ? resolveLocalBackendId()
          : useServerStore.getState().activeServerId,
    };
  };

  const selectBackend = (backendId: string | null | undefined) => {
    const canonicalBackendId = resolveCanonicalBackendId(backendId, resolveLocalBackendId() ?? backendId ?? null);
    if (!canonicalBackendId) return;

    if (activeServerId === canonicalBackendId) {
      const backendReady = isMobileBackendUsable({
        backendId: canonicalBackendId,
        connectionState,
        backends,
      });
      if (backendReady) {
        return;
      }
      connectServer(canonicalBackendId);
      return;
    }

    useProjectStore.getState().selectSession(null);
    useProjectStore.getState().selectProject(null);
    useServerStore.getState().setActiveServer(canonicalBackendId);
    connectServer(canonicalBackendId);
  };

  const selectProject = (projectId: string | null) => {
    if (!projectId) {
      useProjectStore.getState().selectProject(null);
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
      schedule(() => {
        useProjectStore.getState().selectProject(projectId);
      });
      return;
    }

    useProjectStore.getState().selectProject(projectId);
  };

  const selectSession = (sessionId: string | null, options?: SelectSessionOptions) => {
    if (!sessionId) {
      useProjectStore.getState().selectSession(null);
      return;
    }

    const resolvedSession = resolveSessionSelection(sessionId);
    const ownerBackendId =
      options?.backendId
      ?? resolvedSession.ownerBackendId;

    const currentBackendId = useServerStore.getState().activeServerId;
    if (ownerBackendId) {
      selectBackend(ownerBackendId);
    }

    if (ownerBackendId && currentBackendId && currentBackendId !== ownerBackendId) {
      schedule(() => {
        useProjectStore.getState().selectSession(sessionId, resolvedSession.projectId);
      });
      return;
    }

    if (!currentBackendId && ownerBackendId && getControlPlaneMode() === 'embedded-local') {
      useServerStore.getState().setActiveServer(ownerBackendId);
    }

    useProjectStore.getState().selectSession(sessionId, resolvedSession.projectId);
  };

  const selectSessionOnBackend = (backendId: string, sessionId: string) => {
    selectSession(sessionId, { backendId });
  };

  return {
    selectBackend,
    selectProject,
    selectSession,
    selectSessionOnBackend,
  };
}
