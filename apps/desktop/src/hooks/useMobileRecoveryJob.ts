import { useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';
import { useChatStore } from '../stores/chatStore';
import { RecoveryJobManager, type RecoveryJobContext } from '../services/recoveryJobManager';
import { recoverCurrentSessionTail, syncBackendData } from '../services/sessionSync';
import {
  getMobileRecoveryOwnerBackendId,
} from '../services/mobileRecoveryDependencies';
import {
  noteDataSyncFailed,
  noteDataSyncStarted,
  noteDataSyncSucceeded,
} from '../services/recoveryTransitions';

const STEP_TIMEOUTS = {
  transport: 12_000,
  backend: 12_000,
  session: 15_000,
} as const;

async function waitFor<T = unknown>(
  predicate: () => boolean,
  timeoutMs: number,
  ctx: RecoveryJobContext,
  errorMessage: string,
  selector?: (state: Parameters<Parameters<typeof useFacadeStore.subscribe>[0]>[0]) => T,
): Promise<void> {
  ctx.throwIfCancelled();
  if (predicate()) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId: number | null = null;
    let unsubscribeStore: (() => void) | null = null;
    let unsubscribeCancel: (() => void) | null = null;

    const cleanup = () => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      unsubscribeStore?.();
      unsubscribeStore = null;
      unsubscribeCancel?.();
      unsubscribeCancel = null;
    };

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const check = () => {
      try {
        ctx.throwIfCancelled();
        if (predicate()) {
          settle();
        }
      } catch (error) {
        settle(error instanceof Error ? error : new Error(errorMessage));
      }
    };

    timeoutId = window.setTimeout(() => {
      settle(new Error(errorMessage));
    }, timeoutMs);

    unsubscribeCancel = ctx.onCancel(() => {
      settle(new Error('Recovery job cancelled'));
    });

    // When a selector is provided, only invoke check() when the selected
    // slice of the store changes — avoids running the predicate on every
    // unrelated store update (e.g. session stream events, other backends).
    if (selector) {
      let prev = selector(useFacadeStore.getState());
      unsubscribeStore = useFacadeStore.subscribe((state) => {
        const next = selector(state);
        if (next === prev) return;
        prev = next;
        check();
      });
    } else {
      unsubscribeStore = useFacadeStore.subscribe(check);
    }

    check();
  });
}

async function ensureTransportConnected(ctx: RecoveryJobContext): Promise<void> {
  const facade = useFacadeStore.getState().facade;
  if (!facade) {
    throw new Error('Backend facade unavailable');
  }

  const transportState = useFacadeStore.getState().connectionState;
  if (transportState !== 'connected') {
    facade.forceReconnect?.();
    facade.probeHealth?.();
  }

  await waitFor(
    () => useFacadeStore.getState().connectionState === 'connected',
    STEP_TIMEOUTS.transport,
    ctx,
    'Transport recovery timed out',
    (s) => s.connectionState,
  );
}

async function ensureActiveBackendReady(ctx: RecoveryJobContext): Promise<void> {
  const backendId = ctx.activeBackendId;
  if (!backendId) return;

  const facade = useFacadeStore.getState().facade;
  if (!facade) {
    throw new Error('Backend facade unavailable');
  }

  const snapshot = useFacadeStore.getState().backends.find((item) => item.backendId === backendId) ?? null;
  if (!snapshot) {
    throw new Error('Active backend missing from snapshot');
  }

  if (snapshot.runtimeState !== 'ready') {
    facade.openBackend(backendId);
  }

  await waitFor(
    () => {
      const current = useFacadeStore.getState().backends.find((item) => item.backendId === backendId) ?? null;
      return current?.runtimeState === 'ready';
    },
    STEP_TIMEOUTS.backend,
    ctx,
    'Backend recovery timed out',
    (s) => s.backends.find((item) => item.backendId === backendId)?.runtimeState,
  );

  noteDataSyncStarted(backendId, 'full');
  const { completed, sessions } = await syncBackendData(backendId, 'full');
  ctx.throwIfCancelled();
  if (!completed) {
    noteDataSyncFailed(backendId, 'Data sync incomplete');
    throw new Error('Data sync incomplete');
  }
  noteDataSyncSucceeded(backendId, sessions);
}

async function ensureActiveSessionReady(ctx: RecoveryJobContext): Promise<void> {
  const backendId = ctx.activeBackendId;
  const sessionId = ctx.selectedSessionId;
  if (!backendId || !sessionId) return;

  const facade = useFacadeStore.getState().facade;
  if (!facade) {
    throw new Error('Backend facade unavailable');
  }

  const ownerBackendId = getMobileRecoveryOwnerBackendId(sessionId, backendId);
  if (!ownerBackendId) {
    throw new Error('Session owner backend unavailable');
  }

  if (ownerBackendId !== backendId) {
    facade.openBackend(ownerBackendId);
    await waitFor(
      () => {
        const current = useFacadeStore.getState().backends.find((item) => item.backendId === ownerBackendId) ?? null;
        return current?.runtimeState === 'ready';
      },
      STEP_TIMEOUTS.backend,
      ctx,
      'Owner backend recovery timed out',
      (s) => s.backends.find((item) => item.backendId === ownerBackendId)?.runtimeState,
    );

    noteDataSyncStarted(ownerBackendId, 'full');
    const { completed, sessions } = await syncBackendData(ownerBackendId, 'full');
    ctx.throwIfCancelled();
    if (!completed) {
      noteDataSyncFailed(ownerBackendId, 'Owner data sync incomplete');
      throw new Error('Owner data sync incomplete');
    }
    noteDataSyncSucceeded(ownerBackendId, sessions);
  }

  facade.openSessionStream(ownerBackendId, sessionId);
  const sessionStreamKey = `${ownerBackendId}:${sessionId}`;
  await waitFor(
    () => {
      const stream = useFacadeStore.getState().sessionStreams[sessionStreamKey];
      return stream?.state === 'open';
    },
    STEP_TIMEOUTS.session,
    ctx,
    'Session stream recovery timed out',
    (s) => s.sessionStreams[sessionStreamKey]?.state,
  );

  const afterOffset = useChatStore.getState().pagination[sessionId]?.maxOffset ?? 0;
  facade.catchUpContent(ownerBackendId, sessionId, afterOffset);
  await recoverCurrentSessionTail(ownerBackendId, sessionId);
}

export function useMobileRecoveryJobManager(): RecoveryJobManager {
  const managerRef = useRef<RecoveryJobManager | null>(null);
  const activeBackendId = useServerStore((s) => s.activeServerId);
  const selectedSessionId = useProjectStore((s) => s.selectedSessionId);

  if (!managerRef.current) {
    managerRef.current = new RecoveryJobManager({
      ensureTransportConnected,
      ensureActiveBackendReady,
      ensureActiveSessionReady,
    });
  }

  useEffect(() => {
    managerRef.current?.updateSelection(activeBackendId, selectedSessionId);
  }, [activeBackendId, selectedSessionId]);

  // Cancel active job on unmount to prevent stale facade operations
  useEffect(() => {
    const mgr = managerRef.current;
    return () => { mgr?.dispose(); };
  }, []);

  return managerRef.current;
}
