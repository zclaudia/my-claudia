import { useCallback, useEffect, useRef } from 'react';
import { useFacadeStore } from '../stores/facadeStore';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { useRecoveryStore } from '../stores/recoveryStore';
import { appLifecycleManager } from '../services/appLifecycleManager';
import { syncBackendData } from '../services/sessionSync';
import { RecoveryTimerManager } from '../services/recoveryTimers';
import { RecoveryController, type RecoveryControllerEvent } from '../services/recoveryStateMachine';
import {
  noteDataSyncFailed,
  noteDataSyncStarted,
  noteDataSyncSucceeded,
} from '../services/recoveryTransitions';

interface UseRecoveryCoordinatorOptions {
  disableController?: boolean;
  disableLifecycle?: boolean;
  disableReconciliation?: boolean;
}

/**
 * useRecoveryCoordinator
 *
 * Setup-only hook. All recovery phase logic runs imperatively inside
 * RecoveryStateMachine.tick(), completely outside React's render cycle.
 * This eliminates the cascading re-render problem on mobile.
 */
export function useRecoveryCoordinator(
  options: UseRecoveryCoordinatorOptions = {},
): (event: RecoveryControllerEvent) => void {
  const facade = useFacadeStore((s) => s.facade);
  const mode = useFacadeStore((s) => s.mode);
  const activeBackendId = useServerStore((s) => s.activeServerId);
  const selectedSessionId = useProjectStore((s) => s.selectedSessionId);
  const coordinator = useRecoveryStore((s) => s.coordinator);
  const timerManagerRef = useRef<RecoveryTimerManager | null>(null);
  const controllerRef = useRef<RecoveryController | null>(null);

  // Timer manager lifecycle — shared across recovery cycles
  useEffect(() => {
    if (options.disableController) return;
    const mgr = new RecoveryTimerManager();
    timerManagerRef.current = mgr;
    return () => {
      mgr.dispose();
      timerManagerRef.current = null;
    };
  }, [options.disableController]);

  // Recovery state machine lifecycle — tied to facade
  useEffect(() => {
    if (options.disableController) return;
    const mgr = timerManagerRef.current;
    if (!mgr) return;

    const machine = new RecoveryController(mgr);
    controllerRef.current = machine;
    mgr.setReconcileListener(() => machine.dispatch({ type: 'reconcile' }));
    return () => {
      machine.dispose();
      controllerRef.current = null;
      mgr.setReconcileListener(null);
    };
  }, [options.disableController]);

  // Sync selection to recovery store + trigger tick
  useEffect(() => {
    if (options.disableController) return;
    controllerRef.current?.dispatch({
      type: 'selection_changed',
      activeBackendId,
      selectedSessionId,
    });
  }, [activeBackendId, selectedSessionId, options.disableController]);

  // Lifecycle manager — background/resume/network events
  useEffect(() => {
    if (options.disableLifecycle) return;
    if (options.disableController) return;
    if (!facade) return;

    appLifecycleManager.start(facade, {
      onBackground: () => {
        controllerRef.current?.dispatch({ type: 'background' });
        timerManagerRef.current?.stopReconciliation();
      },
      onResume: () => {
        controllerRef.current?.dispatch({ type: 'resume', mode: mode ?? 'direct' });
        timerManagerRef.current?.startReconciliation();
        setTimeout(() => timerManagerRef.current?.runReconciliationTick(), 500);
      },
      onNetworkOffline: () => {
        controllerRef.current?.dispatch({ type: 'network_offline' });
      },
    });

    return () => appLifecycleManager.stop();
  }, [facade, mode, options.disableController, options.disableLifecycle]);

  // Provide reconciliation context whenever facade changes
  useEffect(() => {
    if (options.disableController) return;
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
        };
      },
      openBackend: (backendId: string) => facade.openBackend(backendId),
      syncData: (backendId: string, syncMode: 'full' | 'delta') => {
        const generation = useRecoveryStore.getState().transport.generation;
        noteDataSyncStarted(backendId, syncMode);
        void syncBackendData(backendId, syncMode)
          .then(({ completed, sessions }) => {
            const current = useRecoveryStore.getState();
            if (!completed || current.transport.generation !== generation) return;
            noteDataSyncSucceeded(backendId, sessions);
            controllerRef.current?.dispatch({ type: 'reconcile' });
          })
          .catch((error: unknown) => {
            const msg = error instanceof Error ? error.message : 'Data sync failed';
            const current = useRecoveryStore.getState();
            if (current.transport.generation !== generation) return;
            noteDataSyncFailed(backendId, msg);
            controllerRef.current?.dispatch({ type: 'reconcile' });
          });
      },
    });
  }, [facade, options.disableController]);

  // Start/stop reconciliation based on coordinator status
  useEffect(() => {
    if (options.disableReconciliation) return;
    if (options.disableController) return;
    const mgr = timerManagerRef.current;
    if (!mgr) return;
    if (coordinator === 'ready' || coordinator === 'recovering') {
      mgr.startReconciliation();
    } else {
      mgr.stopReconciliation();
    }
  }, [coordinator, options.disableController, options.disableReconciliation]);

  return useCallback((event: RecoveryControllerEvent) => {
    if (options.disableController) return;
    controllerRef.current?.dispatch(event);
  }, [options.disableController]);
}
