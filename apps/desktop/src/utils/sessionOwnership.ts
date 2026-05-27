import { useOwnershipStore } from '../stores/ownershipStore';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { getControlPlaneMode, resolveLocalBackendId } from './controlPlane';

export function resolveSessionOwnerBackendId(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;

  const ownership = useOwnershipStore.getState();
  const sessionOwnerBackendId = ownership.getSessionBackendId(sessionId);
  const localSession = useProjectStore.getState().sessions.find((session) => session.id === sessionId);
  const projectOwnerBackendId = localSession
    ? ownership.getProjectBackendId(localSession.projectId)
    : null;

  if (projectOwnerBackendId) {
    if (sessionOwnerBackendId && sessionOwnerBackendId !== projectOwnerBackendId) {
      console.warn(
        `[SessionOwnership] Session ${sessionId} owner mismatch: session=${sessionOwnerBackendId} project=${projectOwnerBackendId}; preferring project owner`,
      );
    }
    return projectOwnerBackendId;
  }

  if (sessionOwnerBackendId) {
    return sessionOwnerBackendId;
  }

  if (getControlPlaneMode() === 'embedded-local') {
    return resolveLocalBackendId(useServerStore.getState().activeServerId) ?? useServerStore.getState().activeServerId;
  }

  return useServerStore.getState().activeServerId;
}
