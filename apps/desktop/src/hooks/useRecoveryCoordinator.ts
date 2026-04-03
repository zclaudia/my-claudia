import { useEffect, useRef } from 'react';
import { useFacadeStore } from '../stores/facadeStore';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { useRecoveryStore, getRecoverySessionStream, RECOVERY_TIMEOUTS } from '../stores/recoveryStore';
import { appLifecycleManager } from '../services/appLifecycleManager';
import { recoverCurrentSessionTail, syncBackendCatalog } from '../services/sessionSync';
import { useOwnershipStore } from '../stores/ownershipStore';
import { useChatStore } from '../stores/chatStore';
import { RecoveryTimerManager } from '../services/recoveryTimers';

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
  const timerManagerRef = useRef<RecoveryTimerManager | null>(null);

  useEffect(() => {
    useRecoveryStore.getState().setSelection(activeBackendId, selectedSessionId);
  }, [activeBackendId, selectedSessionId]);

  // Timer manager lifecycle — shared across recovery cycles
  useEffect(() => {
    const mgr = new RecoveryTimerManager();
    timerManagerRef.current = mgr;
    return () => {
      mgr.dispose();
      timerManagerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!facade) return;

    appLifecycleManager.start(facade, {
      onBackground: () => {
        useRecoveryStore.getState().noteBackground();
        timerManagerRef.current?.stopReconciliation();
      },
      onResume: () => {
        const store = useRecoveryStore.getState();
        store.startRecovery(mode ?? 'direct');
        timerManagerRef.current?.startReconciliation();
        setTimeout(() => timerManagerRef.current?.runReconciliationTick(), 500);
      },
      onNetworkOffline: () => {
        useRecoveryStore.getState().setTransportState('reconnecting', 'network_offline');
      },
    });

    return () => appLifecycleManager.stop();
  }, [facade, mode]);

  // Provide reconciliation context whenever facade changes
  useEffect(() => {
    const mgr = timerManagerRef.current;
    if (!mgr || !facade) return;

    mgr.setReconciliationContext({
      getFacadeSnapshot: () => {
        const facadeState = useFacadeStore.getState();
        return facade.getSnapshot?.() ?? {
          snapshotVersion: facadeState.snapshotVersion,
          capturedAt: Date.now(),
          mode: facadeState.mode ?? 'embedded',
          connectionState: facadeState.connectionState,
          localBackendId: facadeState.localBackendId,
          currentInstanceId: facadeState.currentInstanceId,
          currentDeviceId: facadeState.currentDeviceId,
          backends: facadeState.backends,
          sessionStreams: facadeState.sessionStreams,
          registryRevision: facadeState.registryRevision,
        };
      },
      openBackend: (backendId: string) => facade.openBackend(backendId),
      syncCatalog: (backendId: string, syncMode: 'full' | 'delta') => {
        const generation = useRecoveryStore.getState().transport.generation;
        useRecoveryStore.getState().noteCatalogSyncStarted(backendId, syncMode);
        void syncBackendCatalog(backendId, syncMode)
          .then(({ completed, sessions }) => {
            const current = useRecoveryStore.getState();
            if (!completed || current.transport.generation !== generation) return;
            const ownershipVersion = current.noteCatalogSyncSucceeded(backendId);
            useOwnershipStore.getState().stampSessionOwnershipVersion(
              sessions.map((s) => s.id), ownershipVersion,
            );
            current.completeRecoveryIfPossible();
          })
          .catch((error: unknown) => {
            const msg = error instanceof Error ? error.message : 'Catalog sync failed';
            const current = useRecoveryStore.getState();
            if (current.transport.generation !== generation) return;
            current.noteCatalogSyncFailed(backendId, msg);
          });
      },
    });
  }, [facade]);

  // Start reconciliation when coordinator is ready or recovering
  useEffect(() => {
    const mgr = timerManagerRef.current;
    if (!mgr) return;
    if (coordinator === 'ready' || coordinator === 'recovering') {
      mgr.startReconciliation();
    } else {
      mgr.stopReconciliation();
    }
  }, [coordinator]);

  // Main recovery orchestration effect
  useEffect(() => {
    if (!facade) return;
    const mgr = timerManagerRef.current;

    if (coordinator !== 'recovering') {
      catalogSyncKeyRef.current = null;
      sessionRecoveryKeyRef.current = null;
      mgr?.cancelAllWithPrefix('recovery:');
      return;
    }
    if (transportStatus !== 'connected') {
      // Start transport timeout if connecting/reconnecting
      if (
        (transportStatus === 'connecting' || transportStatus === 'reconnecting')
        && mgr && !mgr.hasTimeout('recovery:transport')
      ) {
        mgr.startTimeout('recovery:transport', RECOVERY_TIMEOUTS.TRANSPORT_CONNECT, () => {
          useRecoveryStore.getState().noteTransportTimeout();
        });
      }
      return;
    }
    mgr?.cancelTimeout('recovery:transport');

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
      mgr?.startTimeout(`recovery:catalog:${targetBackendId}`, RECOVERY_TIMEOUTS.CATALOG_SYNC, () => {
        useRecoveryStore.getState().noteCatalogSyncTimeout(targetBackendId);
      });
      void syncBackendCatalog(targetBackendId, 'full')
        .then(({ completed, sessions }) => {
          mgr?.cancelTimeout(`recovery:catalog:${targetBackendId}`);
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
          mgr?.cancelTimeout(`recovery:catalog:${targetBackendId}`);
          const message = error instanceof Error ? error.message : 'Catalog sync failed';
          const current = useRecoveryStore.getState();
          if (current.transport.generation !== generation) return;
          current.noteCatalogSyncFailed(targetBackendId, message);
        });
      return false;
    };

    // Phase 1: Ensure backend channel is open
    if (backendSnapshot && backendSnapshot.online && backendSnapshot.runtimeState !== 'ready') {
      const openKey = `${generation}:${backendId}:open`;
      if (catalogSyncKeyRef.current !== openKey) {
        catalogSyncKeyRef.current = openKey;
        useRecoveryStore.getState().noteBackendDesiredOpen(backendId);
        facade.openBackend(backendId);
        mgr?.startTimeout(`recovery:backend:${backendId}`, RECOVERY_TIMEOUTS.BACKEND_OPEN, () => {
          useRecoveryStore.getState().noteBackendTimeout(backendId);
        });
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

    // Channel must be open (runtimeState === 'ready') to proceed
    if (!backendSnapshot || backendSnapshot.runtimeState !== 'ready') {
      return;
    }
    mgr?.cancelTimeout(`recovery:backend:${backendId}`);

    // Phase 2: Catalog sync
    if (!catalogState || (catalogState.status !== 'ready' && !catalogState.status.startsWith('syncing'))) {
      if (runCatalogSync(backendId)) return;
      return;
    }

    if (catalogState.status !== 'ready') {
      return;
    }

    // No active session — done if backend and catalog are ready
    if (!selectedSessionId) {
      useRecoveryStore.getState().completeRecoveryIfPossible();
      return;
    }

    // Phase 3: Active session recovery
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
          mgr?.startTimeout(`recovery:backend:${ownerBackendId}`, RECOVERY_TIMEOUTS.BACKEND_OPEN, () => {
            useRecoveryStore.getState().noteBackendTimeout(ownerBackendId);
          });
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
      mgr?.startTimeout('recovery:session:stream', RECOVERY_TIMEOUTS.SESSION_STREAM_OPEN, () => {
        useRecoveryStore.getState().noteActiveSessionTimeout();
      });
      return;
    }
    mgr?.cancelTimeout('recovery:session:stream');

    const sessionKey = `${generation}:${ownerBackendId}:${selectedSessionId}:session`;
    if (sessionRecoveryKeyRef.current === sessionKey) return;
    sessionRecoveryKeyRef.current = sessionKey;

    const afterOffset = useChatStore.getState().pagination[selectedSessionId]?.maxOffset ?? 0;
    useRecoveryStore.getState().noteActiveSessionCatchingUp(selectedSessionId, ownerBackendId);
    facade.catchUpContent(ownerBackendId, selectedSessionId, afterOffset);
    mgr?.startTimeout('recovery:session:catchup', RECOVERY_TIMEOUTS.SESSION_CATCHUP, () => {
      useRecoveryStore.getState().noteActiveSessionTimeout();
    });
    useRecoveryStore.getState().noteActiveSessionHydrating(selectedSessionId, ownerBackendId);
    void recoverCurrentSessionTail(ownerBackendId, selectedSessionId)
      .then(() => {
        mgr?.cancelTimeout('recovery:session:catchup');
        const current = useRecoveryStore.getState();
        if (current.transport.generation !== generation || current.selectedSessionId !== selectedSessionId) return;
        current.noteActiveSessionLive(selectedSessionId, ownerBackendId);
        current.completeRecoveryIfPossible();
      })
      .catch((error: unknown) => {
        mgr?.cancelTimeout('recovery:session:catchup');
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
