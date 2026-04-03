import { useEffect, useRef } from 'react';
import { useFacadeStore } from '../stores/facadeStore';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { useRecoveryStore, getRecoverySessionStream } from '../stores/recoveryStore';
import { appLifecycleManager } from '../services/appLifecycleManager';
import { recoverCurrentSessionTail, syncBackendCatalog } from '../services/sessionSync';
import { useOwnershipStore } from '../stores/ownershipStore';
import { useChatStore } from '../stores/chatStore';

export function useRecoveryCoordinator(): void {
  const facade = useFacadeStore((s) => s.facade);
  const mode = useFacadeStore((s) => s.mode);
  const backends = useFacadeStore((s) => s.backends);
  const sessionStreams = useFacadeStore((s) => s.sessionStreams);
  const activeBackendId = useServerStore((s) => s.activeServerId);
  const selectedSessionId = useProjectStore((s) => s.selectedSessionId);
  const coordinator = useRecoveryStore((s) => s.coordinator);
  const transportStatus = useRecoveryStore((s) => s.transport.status);
  const transportGeneration = useRecoveryStore((s) => s.transport.generation);
  const recoveryActiveBackendId = useRecoveryStore((s) => s.activeBackendId);
  const recoveryBackends = useRecoveryStore((s) => s.backends);
  const recoveryCatalogs = useRecoveryStore((s) => s.catalogs);
  const catalogSyncKeyRef = useRef<string | null>(null);
  const sessionRecoveryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    useRecoveryStore.getState().setSelection(activeBackendId, selectedSessionId);
  }, [activeBackendId, selectedSessionId]);

  useEffect(() => {
    if (!facade) return;

    appLifecycleManager.start(facade, {
      onBackground: () => {
        useRecoveryStore.getState().noteBackground();
      },
      onResume: () => {
        const store = useRecoveryStore.getState();
        store.startRecovery(mode ?? 'direct');
      },
    });

    return () => appLifecycleManager.stop();
  }, [facade, mode]);

  useEffect(() => {
    if (!facade) return;
    if (coordinator !== 'recovering') {
      catalogSyncKeyRef.current = null;
      sessionRecoveryKeyRef.current = null;
      return;
    }
    if (transportStatus !== 'connected') return;

    if (!recoveryActiveBackendId) {
      useRecoveryStore.getState().completeRecoveryIfPossible();
      return;
    }

    const backendId = recoveryActiveBackendId;
    const backendSnapshot = backends.find((item) => item.backendId === backendId) ?? null;
    const backendState = recoveryBackends[backendId] ?? null;
    const catalogState = recoveryCatalogs[backendId] ?? null;
    const generation = transportGeneration;
    const runCatalogSync = (targetBackendId: string) => {
      const syncKey = `${generation}:${targetBackendId}:catalog`;
      if (catalogSyncKeyRef.current === syncKey) return true;
      catalogSyncKeyRef.current = syncKey;
      useRecoveryStore.getState().noteCatalogSyncStarted(targetBackendId, 'full');
      void syncBackendCatalog(targetBackendId, 'full')
        .then(({ completed, sessions }) => {
          const current = useRecoveryStore.getState();
          if (!completed) return;
          if (current.transport.generation !== generation) return;
          const ownershipVersion = current.noteCatalogSyncSucceeded(targetBackendId);
          useOwnershipStore.getState().stampSessionOwnershipVersion(
            sessions.map((session) => session.id),
            ownershipVersion,
          );
          current.completeRecoveryIfPossible();
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Catalog sync failed';
          const current = useRecoveryStore.getState();
          if (current.transport.generation !== generation) return;
          current.noteCatalogSyncFailed(targetBackendId, message);
        });
      return false;
    };

    if (backendSnapshot && backendSnapshot.online && backendSnapshot.runtimeState !== 'ready') {
      const openKey = `${generation}:${backendId}:open`;
      if (catalogSyncKeyRef.current !== openKey) {
        catalogSyncKeyRef.current = openKey;
        useRecoveryStore.getState().noteBackendDesiredOpen(backendId);
        facade.openBackend(backendId);
      }
      return;
    }

    if (backendState?.status === 'absent') {
      if (selectedSessionId) {
        useRecoveryStore.getState().noteActiveSessionError('Backend unavailable after reconnect');
        return;
      }
      useRecoveryStore.getState().markReady();
      return;
    }

    if (!backendSnapshot || backendSnapshot.runtimeState !== 'ready' || backendState?.status !== 'ready') {
      return;
    }

    if (!catalogState || (catalogState.status !== 'ready' && !catalogState.status.startsWith('syncing'))) {
      if (runCatalogSync(backendId)) return;
      return;
    }

    if (!selectedSessionId) {
      useRecoveryStore.getState().completeRecoveryIfPossible();
      return;
    }

    const ownershipStore = useOwnershipStore.getState();
    const ownerBackendId =
      useRecoveryStore.getState().getVerifiedSessionBackendId(selectedSessionId)
      ?? ownershipStore.getSessionBackendId(selectedSessionId)
      ?? backendId;
    const ownershipVersion =
      ownershipStore.getSessionOwnershipVersion(selectedSessionId)
      ?? recoveryCatalogs[backendId]?.ownershipVersion
      ?? null;
    const ownerBackendState = recoveryBackends[ownerBackendId] ?? null;
    const ownerCatalogState = recoveryCatalogs[ownerBackendId] ?? null;
    const ownerBackendSnapshot = backends.find((item) => item.backendId === ownerBackendId) ?? null;

    if (ownerBackendState?.status === 'absent' || (!ownerBackendSnapshot && ownerBackendId !== backendId)) {
      useRecoveryStore.getState().noteActiveSessionError('Session owner backend unavailable');
      return;
    }

    if (ownerBackendState?.status !== 'ready') {
      if (ownerBackendSnapshot?.online) {
        const ownerOpenKey = `${generation}:${ownerBackendId}:open`;
        if (catalogSyncKeyRef.current !== ownerOpenKey) {
          catalogSyncKeyRef.current = ownerOpenKey;
          useRecoveryStore.getState().noteBackendDesiredOpen(ownerBackendId);
          facade.openBackend(ownerBackendId);
        }
        useRecoveryStore.getState().noteActiveSessionWaiting(selectedSessionId, ownerBackendId);
        return;
      }
      useRecoveryStore.getState().noteActiveSessionError('Session owner backend unavailable');
      return;
    }

    if (!ownerCatalogState || (ownerCatalogState.status !== 'ready' && !ownerCatalogState.status.startsWith('syncing'))) {
      useRecoveryStore.getState().noteActiveSessionWaiting(selectedSessionId, ownerBackendId);
      if (runCatalogSync(ownerBackendId)) return;
      return;
    }

    if (!ownershipVersion || ownerBackendState?.status !== 'ready' || ownerCatalogState?.status !== 'ready') {
      useRecoveryStore.getState().noteActiveSessionWaiting(selectedSessionId, ownerBackendId);
      return;
    }

    useRecoveryStore.getState().noteActiveSessionOwnerVerified(selectedSessionId, ownerBackendId, ownershipVersion);

    const stream = getRecoverySessionStream(sessionStreams, ownerBackendId, selectedSessionId);
    if (stream?.state !== 'open') {
      useRecoveryStore.getState().noteActiveSessionOpeningStream(selectedSessionId, ownerBackendId);
      facade.openSessionStream(ownerBackendId, selectedSessionId);
      return;
    }

    const sessionKey = `${generation}:${ownerBackendId}:${selectedSessionId}:session`;
    if (sessionRecoveryKeyRef.current === sessionKey) return;
    sessionRecoveryKeyRef.current = sessionKey;

    const afterOffset = useChatStore.getState().pagination[selectedSessionId]?.maxOffset ?? 0;
    useRecoveryStore.getState().noteActiveSessionCatchingUp(selectedSessionId, ownerBackendId);
    facade.catchUpContent(ownerBackendId, selectedSessionId, afterOffset);
    useRecoveryStore.getState().noteActiveSessionHydrating(selectedSessionId, ownerBackendId);
    void recoverCurrentSessionTail(ownerBackendId, selectedSessionId)
      .then(() => {
        const current = useRecoveryStore.getState();
        if (current.transport.generation !== generation || current.selectedSessionId !== selectedSessionId) return;
        current.noteActiveSessionLive(selectedSessionId, ownerBackendId);
        current.completeRecoveryIfPossible();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Session recovery failed';
        const current = useRecoveryStore.getState();
        if (current.transport.generation !== generation) return;
        current.noteActiveSessionError(message);
      });
  }, [
    activeBackendId,
    backends,
    coordinator,
    facade,
    recoveryActiveBackendId,
    recoveryBackends,
    recoveryCatalogs,
    selectedSessionId,
    sessionStreams,
    transportGeneration,
    transportStatus,
  ]);
}
