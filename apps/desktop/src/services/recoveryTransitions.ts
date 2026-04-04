import { useRecoveryStore } from '../stores/recoveryStore';
import { useOwnershipStore } from '../stores/ownershipStore';
import { logRecoveryTransition } from './recoveryLogger';

export function resetRecoveryTransitions(): void {
  useRecoveryStore.getState().completeRecoveryIfPossible();
}

export function noteTransportRecoveryTimeout(): void {
  logRecoveryTransition('transport:timeout');
  useRecoveryStore.getState().noteTransportTimeout();
}

export function noteTransportStaleConnection(): void {
  logRecoveryTransition('transport:stale_connection');
  useRecoveryStore.getState().setTransportState('reconnecting', 'reconciliation: stale connection');
}

export function noteBackendOpenRequested(backendId: string): void {
  logRecoveryTransition('backend:open_requested', { backendId });
  useRecoveryStore.getState().noteBackendSubscribing(backendId);
}

export function noteBackendOpenTimeout(backendId: string): void {
  logRecoveryTransition('backend:open_timeout', { backendId });
  useRecoveryStore.getState().noteBackendTimeout(backendId);
}

export function noteBackendUnavailable(hasSelectedSession: boolean): void {
  logRecoveryTransition('backend:unavailable', { hasSelectedSession });
  if (hasSelectedSession) {
    useRecoveryStore.getState().noteActiveSessionError('Backend unavailable after reconnect');
    return;
  }
  useRecoveryStore.getState().markReady();
}

export function noteDataSyncStarted(backendId: string, mode: 'full' | 'delta'): void {
  logRecoveryTransition('data:sync_started', { backendId, mode });
  useRecoveryStore.getState().noteDataSyncStarted(backendId, mode);
}

export function noteDataSyncSucceeded(
  backendId: string,
  sessions: Array<{ id: string }>,
): void {
  logRecoveryTransition('data:sync_succeeded', { backendId, sessionCount: sessions.length });
  const current = useRecoveryStore.getState();
  const ownershipVersion = current.noteDataSyncSucceeded(backendId);
  useOwnershipStore.getState().stampSessionOwnershipVersion(
    sessions.map((session) => session.id),
    ownershipVersion,
  );
  current.completeRecoveryIfPossible();
}

export function noteDataSyncFailed(backendId: string, error: string): void {
  logRecoveryTransition('data:sync_failed', { backendId, error });
  useRecoveryStore.getState().noteDataSyncFailed(backendId, error);
}

export function noteDataSyncTimeout(backendId: string): void {
  logRecoveryTransition('data:sync_timeout', { backendId });
  useRecoveryStore.getState().noteDataSyncTimeout(backendId);
}

export function noteSessionWaiting(sessionId: string, backendId: string): void {
  logRecoveryTransition('session:waiting_backend', { sessionId, backendId });
  useRecoveryStore.getState().noteActiveSessionWaiting(sessionId, backendId);
}

export function noteSessionOwnerUnavailable(): void {
  logRecoveryTransition('session:owner_unavailable');
  useRecoveryStore.getState().noteActiveSessionError('Session owner backend unavailable');
}

export function noteSessionOwnershipUnverified(): void {
  logRecoveryTransition('session:ownership_unverified');
  useRecoveryStore.getState().noteActiveSessionError('Session ownership not verified');
}

export function noteSessionStreamOpening(sessionId: string, backendId: string, ownershipVersion: number): void {
  logRecoveryTransition('session:stream_opening', { sessionId, backendId, ownershipVersion });
  const store = useRecoveryStore.getState();
  store.noteActiveSessionOwnerVerified(sessionId, backendId, ownershipVersion);
  store.noteActiveSessionOpeningStream(sessionId, backendId);
}

export function noteSessionCatchUpStarted(sessionId: string, backendId: string, ownershipVersion: number): void {
  logRecoveryTransition('session:catchup_started', { sessionId, backendId, ownershipVersion });
  const store = useRecoveryStore.getState();
  store.noteActiveSessionOwnerVerified(sessionId, backendId, ownershipVersion);
  store.noteActiveSessionCatchingUp(sessionId, backendId);
}

export function noteSessionHydrationStarted(sessionId: string, backendId: string): void {
  logRecoveryTransition('session:hydration_started', { sessionId, backendId });
  useRecoveryStore.getState().noteActiveSessionHydrating(sessionId, backendId);
}

export function noteSessionMarkedStale(): void {
  logRecoveryTransition('session:marked_stale');
  useRecoveryStore.getState().noteActiveSessionStale();
}

export function noteSessionResolvingOwner(sessionId: string, backendId: string): void {
  logRecoveryTransition('session:resolving_owner', { sessionId, backendId });
  useRecoveryStore.getState().noteActiveSessionResolving(sessionId, backendId);
}

export function noteSessionRecoverySucceeded(sessionId: string, backendId: string): void {
  logRecoveryTransition('session:recovery_succeeded', { sessionId, backendId });
  const current = useRecoveryStore.getState();
  current.noteActiveSessionLive(sessionId, backendId);
  current.completeRecoveryIfPossible();
}

export function noteSessionRecoveryFailed(error: string): void {
  logRecoveryTransition('session:recovery_failed', { error });
  useRecoveryStore.getState().noteActiveSessionError(error);
}

export function noteSessionRecoveryTimeout(): void {
  logRecoveryTransition('session:recovery_timeout');
  useRecoveryStore.getState().noteActiveSessionTimeout();
}
