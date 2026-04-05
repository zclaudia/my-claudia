import { useEffect, useRef } from 'react';
import type { BackendFacade } from '@my-claudia/shared';
import { appLifecycleManager } from '../services/appLifecycleManager';
import type { RecoveryJobManager } from '../services/recoveryJobManager';

export function useRecoveryLifecycle(
  facade: BackendFacade | null,
  manager: RecoveryJobManager,
): void {
  const initialRecoveryFired = useRef(false);

  useEffect(() => {
    if (!facade) return;

    // Fire initial recovery on cold start (not just resume)
    if (!initialRecoveryFired.current) {
      initialRecoveryFired.current = true;
      manager.start('resume');
    }

    appLifecycleManager.start(facade, {
      onBackground: () => {
        manager.cancel(undefined, 'background');
      },
      onResume: () => {
        manager.start('resume');
      },
      onNetworkOffline: () => {
        manager.cancel(undefined, 'background');
      },
    });

    return () => appLifecycleManager.stop();
  }, [facade, manager]);
}
