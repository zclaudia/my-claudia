import type { BackendSnapshot } from '@my-claudia/shared';
import type {
  BackendRecoveryState,
  DataSyncState,
  TransportStatus,
} from '../stores/recoveryStore';

export type RecoveryPlan =
  | {
      state: 'idle';
      effect: { type: 'reset_recovery' };
    }
  | {
      state: 'await_transport';
      effect: { type: 'ensure_transport_timeout'; transportStatus: TransportStatus };
    }
  | {
      state: 'complete_if_possible';
      effect: { type: 'complete_recovery' };
    }
  | {
      state: 'backend_absent';
      effect: { type: 'mark_backend_absent'; hasSelectedSession: boolean };
    }
  | {
      state: 'await_backend_ready';
      effect: { type: 'await_backend_ready'; backendId: string };
    }
  | {
      state: 'open_backend';
      effect: { type: 'open_backend'; backendId: string; sessionId: string | null };
    }
  | {
      state: 'sync_data';
      effect: { type: 'sync_data'; backendId: string; sessionId: string | null };
    }
  | {
      state: 'await_data';
      effect: { type: 'await_data'; backendId: string };
    }
  | {
      state: 'session_owner_unavailable';
      effect: { type: 'mark_session_owner_unavailable' };
    }
  | {
      state: 'await_owner_verification';
      effect: { type: 'await_owner_verification'; sessionId: string; backendId: string };
    }
  | {
      state: 'open_session_stream';
      effect: { type: 'open_session_stream'; sessionId: string; backendId: string };
    }
  | {
      state: 'recover_session_tail';
      effect: { type: 'recover_session_tail'; sessionId: string; backendId: string };
    };

export interface RecoveryPlanContext {
  coordinator: 'ready' | 'background' | 'recovering' | 'error';
  transportStatus: TransportStatus;
  activeBackendId: string | null;
  selectedSessionId: string | null;
  backendId: string | null;
  backendSnapshot: BackendSnapshot | null;
  backendState: BackendRecoveryState | null;
  dataSyncState: DataSyncState | null;
  ownerBackendId: string | null;
  ownerBackendSnapshot: BackendSnapshot | null;
  ownerBackendState: BackendRecoveryState | null;
  ownerDataSyncState: DataSyncState | null;
  ownershipVersion: number | null;
  streamState: string | null;
}

function needsDataSync(dataSyncState: DataSyncState | null): boolean {
  return !dataSyncState || (dataSyncState.status !== 'ready' && !dataSyncState.status.startsWith('syncing'));
}

export function planRecoveryStep(ctx: RecoveryPlanContext): RecoveryPlan {
  if (ctx.coordinator !== 'recovering') {
    return { state: 'idle', effect: { type: 'reset_recovery' } };
  }

  if (ctx.transportStatus !== 'connected') {
    return {
      state: 'await_transport',
      effect: { type: 'ensure_transport_timeout', transportStatus: ctx.transportStatus },
    };
  }

  if (!ctx.activeBackendId || !ctx.backendId) {
    return { state: 'complete_if_possible', effect: { type: 'complete_recovery' } };
  }

  if (ctx.backendSnapshot && ctx.backendSnapshot.online && ctx.backendSnapshot.runtimeState !== 'ready') {
    return {
      state: 'open_backend',
      effect: { type: 'open_backend', backendId: ctx.backendId, sessionId: null },
    };
  }

  if (ctx.backendState?.status === 'absent') {
    return {
      state: 'backend_absent',
      effect: { type: 'mark_backend_absent', hasSelectedSession: !!ctx.selectedSessionId },
    };
  }

  if (!ctx.backendSnapshot || ctx.backendSnapshot.runtimeState !== 'ready') {
    return {
      state: 'await_backend_ready',
      effect: { type: 'await_backend_ready', backendId: ctx.backendId },
    };
  }

  if (needsDataSync(ctx.dataSyncState)) {
    return {
      state: 'sync_data',
      effect: { type: 'sync_data', backendId: ctx.backendId, sessionId: null },
    };
  }

  if (ctx.dataSyncState?.status !== 'ready') {
    return {
      state: 'await_data',
      effect: { type: 'await_data', backendId: ctx.backendId },
    };
  }

  if (!ctx.selectedSessionId) {
    return { state: 'complete_if_possible', effect: { type: 'complete_recovery' } };
  }

  if (!ctx.ownerBackendId) {
    return {
      state: 'session_owner_unavailable',
      effect: { type: 'mark_session_owner_unavailable' },
    };
  }

  if (ctx.ownerBackendState?.status === 'absent' || (!ctx.ownerBackendSnapshot && ctx.ownerBackendId !== ctx.backendId)) {
    return {
      state: 'session_owner_unavailable',
      effect: { type: 'mark_session_owner_unavailable' },
    };
  }

  if (ctx.ownerBackendState?.status !== 'ready') {
    if (ctx.ownerBackendSnapshot?.online) {
      return {
        state: 'open_backend',
        effect: {
          type: 'open_backend',
          sessionId: ctx.selectedSessionId,
          backendId: ctx.ownerBackendId,
        },
      };
    }
    return {
      state: 'session_owner_unavailable',
      effect: { type: 'mark_session_owner_unavailable' },
    };
  }

  if (needsDataSync(ctx.ownerDataSyncState)) {
    return {
      state: 'sync_data',
      effect: {
        type: 'sync_data',
        sessionId: ctx.selectedSessionId,
        backendId: ctx.ownerBackendId,
      },
    };
  }

  if (!ctx.ownershipVersion || ctx.ownerDataSyncState?.status !== 'ready') {
    return {
      state: 'await_owner_verification',
      effect: {
        type: 'await_owner_verification',
        sessionId: ctx.selectedSessionId,
        backendId: ctx.ownerBackendId,
      },
    };
  }

  if (ctx.streamState !== 'open') {
    return {
      state: 'open_session_stream',
      effect: {
        type: 'open_session_stream',
        sessionId: ctx.selectedSessionId,
        backendId: ctx.ownerBackendId,
      },
    };
  }

  return {
    state: 'recover_session_tail',
    effect: {
      type: 'recover_session_tail',
      sessionId: ctx.selectedSessionId,
      backendId: ctx.ownerBackendId,
    },
  };
}
