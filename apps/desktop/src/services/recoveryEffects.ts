import type { BackendFacade } from '@my-claudia/shared';
import { useRecoveryStore, RECOVERY_TIMEOUTS } from '../stores/recoveryStore';
import { useChatStore } from '../stores/chatStore';
import { syncBackendData, recoverCurrentSessionTail } from './sessionSync';
import type { RecoveryTimerManager } from './recoveryTimers';
import type { RecoveryPlan } from './recoveryPlanner';
import {
  noteBackendOpenRequested,
  noteBackendOpenTimeout,
  noteBackendUnavailable,
  noteDataSyncFailed,
  noteDataSyncStarted,
  noteDataSyncSucceeded,
  noteSessionCatchUpStarted,
  noteSessionHydrationStarted,
  noteSessionOwnerUnavailable,
  noteSessionOwnershipUnverified,
  noteSessionRecoveryFailed,
  noteSessionRecoverySucceeded,
  noteSessionRecoveryTimeout,
  noteSessionStreamOpening,
  noteSessionWaiting,
  noteTransportRecoveryTimeout,
} from './recoveryTransitions';
import { logRecoveryEffect, logRecoveryWarning } from './recoveryLogger';

export type InflightOperationKind = 'data_sync' | 'backend_open' | 'session_recovery';

export interface InflightOperation {
  kind: InflightOperationKind;
  generation: number;
  backendId: string;
  sessionId?: string;
}

export interface RecoveryInflightState {
  dataSyncOp: InflightOperation | null;
  backendOpenOp: InflightOperation | null;
  sessionRecoveryOp: InflightOperation | null;
}

export interface RecoveryExecutionContext {
  facade: BackendFacade;
  generation: number;
  ownershipVersion: number | null;
  timerManager: RecoveryTimerManager;
  inflight: RecoveryInflightState;
  matchesOp: (current: InflightOperation | null, next: InflightOperation) => boolean;
  clearInflight: () => void;
  clearInflightForBackend: (backendId: string) => void;
  scheduleTick: () => void;
}

function runDataSync(backendId: string, ctx: RecoveryExecutionContext): boolean {
  const op: InflightOperation = {
    kind: 'data_sync',
    generation: ctx.generation,
    backendId,
  };
  if (ctx.matchesOp(ctx.inflight.dataSyncOp, op)) return true;

  ctx.inflight.dataSyncOp = op;
  logRecoveryEffect('data_sync:start', {
    backendId,
    generation: ctx.generation,
  });
  noteDataSyncStarted(backendId, 'full');
  ctx.timerManager.startTimeout(`recovery:data:${backendId}`, RECOVERY_TIMEOUTS.DATA_SYNC, () => {
    useRecoveryStore.getState().noteDataSyncTimeout(backendId);
    ctx.clearInflightForBackend(backendId);
    ctx.scheduleTick();
  });

  void syncBackendData(backendId, 'full')
    .then(({ completed, sessions }) => {
      ctx.timerManager.cancelTimeout(`recovery:data:${backendId}`);
      ctx.clearInflightForBackend(backendId);
      if (!completed) {
        logRecoveryWarning('data_sync:incomplete', {
          backendId,
          generation: ctx.generation,
        });
        noteDataSyncFailed(backendId, 'Data sync incomplete');
        ctx.scheduleTick();
        return;
      }
      const current = useRecoveryStore.getState();
      if (current.transport.generation !== ctx.generation) return;
      logRecoveryEffect('data_sync:success', {
        backendId,
        generation: ctx.generation,
        sessionCount: sessions.length,
      });
      noteDataSyncSucceeded(backendId, sessions);
      ctx.scheduleTick();
    })
    .catch((error: unknown) => {
      ctx.timerManager.cancelTimeout(`recovery:data:${backendId}`);
      ctx.clearInflightForBackend(backendId);
      const message = error instanceof Error ? error.message : 'Data sync failed';
      const current = useRecoveryStore.getState();
      if (current.transport.generation !== ctx.generation) return;
      logRecoveryWarning('data_sync:error', {
        backendId,
        generation: ctx.generation,
        message,
      });
      noteDataSyncFailed(backendId, message);
      ctx.scheduleTick();
    });

  return false;
}

function runOpenBackend(backendId: string, ctx: RecoveryExecutionContext): void {
  const op: InflightOperation = {
    kind: 'backend_open',
    generation: ctx.generation,
    backendId,
  };
  if (ctx.matchesOp(ctx.inflight.backendOpenOp, op)) return;

  ctx.inflight.backendOpenOp = op;
  logRecoveryEffect('backend_open:start', {
    backendId,
    generation: ctx.generation,
  });
  noteBackendOpenRequested(backendId);
  ctx.facade.openBackend(backendId);
  ctx.timerManager.startTimeout(`recovery:backend:${backendId}`, RECOVERY_TIMEOUTS.BACKEND_SUBSCRIBE, () => {
    noteBackendOpenTimeout(backendId);
    ctx.clearInflightForBackend(backendId);
    ctx.scheduleTick();
  });
}

function runOpenSessionStream(sessionId: string, backendId: string, ctx: RecoveryExecutionContext): void {
  if (ctx.ownershipVersion == null) {
    logRecoveryWarning('session_stream:missing_ownership', {
      sessionId,
      backendId,
      generation: ctx.generation,
    });
    noteSessionOwnershipUnverified();
    return;
  }

  logRecoveryEffect('session_stream:open', {
    sessionId,
    backendId,
    generation: ctx.generation,
    ownershipVersion: ctx.ownershipVersion,
  });
  noteSessionStreamOpening(sessionId, backendId, ctx.ownershipVersion);
  ctx.facade.openSessionStream(backendId, sessionId);
  ctx.timerManager.startTimeout(`recovery:session:stream:${sessionId}`, RECOVERY_TIMEOUTS.SESSION_STREAM_OPEN, () => {
    noteSessionRecoveryTimeout();
    ctx.scheduleTick();
  });
}

function runRecoverSessionTail(sessionId: string, backendId: string, ctx: RecoveryExecutionContext): void {
  if (ctx.ownershipVersion == null) {
    logRecoveryWarning('session_recovery:missing_ownership', {
      sessionId,
      backendId,
      generation: ctx.generation,
    });
    noteSessionOwnershipUnverified();
    return;
  }

  ctx.timerManager.cancelTimeout(`recovery:session:stream:${sessionId}`);

  const sessionOp: InflightOperation = {
    kind: 'session_recovery',
    generation: ctx.generation,
    backendId,
    sessionId,
  };
  if (ctx.matchesOp(ctx.inflight.sessionRecoveryOp, sessionOp)) return;

  ctx.inflight.sessionRecoveryOp = sessionOp;
  const afterOffset = useChatStore.getState().pagination[sessionId]?.maxOffset ?? 0;
  logRecoveryEffect('session_recovery:start', {
    sessionId,
    backendId,
    generation: ctx.generation,
    ownershipVersion: ctx.ownershipVersion,
    afterOffset,
  });
  noteSessionCatchUpStarted(sessionId, backendId, ctx.ownershipVersion);
  ctx.facade.catchUpContent(backendId, sessionId, afterOffset);
  ctx.timerManager.startTimeout(`recovery:session:catchup:${sessionId}`, RECOVERY_TIMEOUTS.SESSION_CATCHUP, () => {
    noteSessionRecoveryTimeout();
    ctx.inflight.sessionRecoveryOp = null;
    ctx.scheduleTick();
  });
  noteSessionHydrationStarted(sessionId, backendId);

  void recoverCurrentSessionTail(backendId, sessionId)
    .then(() => {
      ctx.timerManager.cancelTimeout(`recovery:session:catchup:${sessionId}`);
      ctx.inflight.sessionRecoveryOp = null;
      const current = useRecoveryStore.getState();
      if (current.transport.generation !== ctx.generation || current.selectedSessionId !== sessionId) return;
      logRecoveryEffect('session_recovery:success', {
        sessionId,
        backendId,
        generation: ctx.generation,
      });
      noteSessionRecoverySucceeded(sessionId, backendId);
      ctx.clearInflight();
    })
    .catch((error: unknown) => {
      ctx.timerManager.cancelTimeout(`recovery:session:catchup:${sessionId}`);
      ctx.inflight.sessionRecoveryOp = null;
      const message = error instanceof Error ? error.message : 'Session recovery failed';
      const current = useRecoveryStore.getState();
      if (current.transport.generation !== ctx.generation) return;
      logRecoveryWarning('session_recovery:error', {
        sessionId,
        backendId,
        generation: ctx.generation,
        message,
      });
      noteSessionRecoveryFailed(message);
      ctx.scheduleTick();
    });
}

export function executeRecoveryPlan(plan: RecoveryPlan, ctx: RecoveryExecutionContext): void {
  logRecoveryEffect('effect', {
    state: plan.state,
    effect: plan.effect.type,
    generation: ctx.generation,
    backendId: 'backendId' in plan.effect ? plan.effect.backendId : undefined,
    sessionId: 'sessionId' in plan.effect ? plan.effect.sessionId : undefined,
  });
  switch (plan.effect.type) {
    case 'reset_recovery':
      ctx.clearInflight();
      ctx.timerManager.cancelAllWithPrefix('recovery:');
      return;
    case 'ensure_transport_timeout':
      if (
        (plan.effect.transportStatus === 'connecting' || plan.effect.transportStatus === 'reconnecting')
        && !ctx.timerManager.hasTimeout('recovery:transport')
      ) {
        ctx.timerManager.startTimeout('recovery:transport', RECOVERY_TIMEOUTS.TRANSPORT_CONNECT, () => {
          noteTransportRecoveryTimeout();
          ctx.scheduleTick();
        });
      }
      return;
    case 'complete_recovery':
      ctx.timerManager.cancelTimeout('recovery:transport');
      useRecoveryStore.getState().completeRecoveryIfPossible();
      ctx.clearInflight();
      return;
    case 'mark_backend_absent':
      noteBackendUnavailable(plan.effect.hasSelectedSession);
      return;
    case 'await_backend_ready':
      ctx.timerManager.cancelTimeout(`recovery:backend:${plan.effect.backendId}`);
      return;
    case 'open_backend':
      runOpenBackend(plan.effect.backendId, ctx);
      if (plan.effect.sessionId) {
        noteSessionWaiting(plan.effect.sessionId, plan.effect.backendId);
      }
      return;
    case 'sync_data':
      ctx.timerManager.cancelTimeout('recovery:transport');
      ctx.timerManager.cancelTimeout(`recovery:backend:${plan.effect.backendId}`);
      ctx.clearInflightForBackend(plan.effect.backendId);
      if (plan.effect.sessionId) {
        noteSessionWaiting(plan.effect.sessionId, plan.effect.backendId);
      }
      runDataSync(plan.effect.backendId, ctx);
      return;
    case 'await_data':
      ctx.timerManager.cancelTimeout('recovery:transport');
      ctx.timerManager.cancelTimeout(`recovery:backend:${plan.effect.backendId}`);
      ctx.clearInflightForBackend(plan.effect.backendId);
      return;
    case 'mark_session_owner_unavailable':
      noteSessionOwnerUnavailable();
      return;
    case 'await_owner_verification':
      noteSessionWaiting(plan.effect.sessionId, plan.effect.backendId);
      return;
    case 'open_session_stream':
      runOpenSessionStream(plan.effect.sessionId, plan.effect.backendId, ctx);
      return;
    case 'recover_session_tail':
      runRecoverSessionTail(plan.effect.sessionId, plan.effect.backendId, ctx);
      return;
    default:
      return;
  }
}
