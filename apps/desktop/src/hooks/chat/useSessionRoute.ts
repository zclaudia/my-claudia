import { useEffect, useMemo, useRef } from 'react';
import { useFacadeStore } from '../../stores/facadeStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useServerStore } from '../../stores/serverStore';
import { useChatStore } from '../../stores/chatStore';
import { getControlPlaneMode, resolveCanonicalBackendId, resolveLocalBackendId } from '../../utils/controlPlane';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useMobileRecoveryStore } from '../../stores/mobileRecoveryStore';
import { getMobileBackendViewState, isMobileBackendUsable } from '../../services/mobileConnectionState';
import { isAndroid } from '../../utils/platform';

function getStreamKey(backendId: string, sessionId: string): string {
  return `${backendId}:${sessionId}`;
}

export type SessionRoutePhase =
  | 'resolving'
  | 'opening_backend'
  | 'opening_stream'
  | 'ready'
  | 'offline'
  | 'error';

interface UseSessionRouteOptions {
  maintainDesiredState?: boolean;
}

interface SessionRouteState {
  backendId: string | null;
  phase: SessionRoutePhase;
  canSend: boolean;
  canLoadMessages: boolean;
  ownerResolved: boolean;
  lastError: string | null;
}

export function useSessionRoute(
  sessionId: string | null | undefined,
  options: UseSessionRouteOptions = {},
): SessionRouteState {
  const { maintainDesiredState = false } = options;
  const mobileRecoveryEnabled = isAndroid();
  // Facade — imperative calls + stream management only
  const facade = useFacadeStore((s) => s.facade);
  const backends = useFacadeStore((s) => s.backends);
  const sessionStreams = useFacadeStore((s) => s.sessionStreams);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const maxOffset = useChatStore((s) =>
    sessionId ? s.pagination[sessionId]?.maxOffset ?? 0 : 0
  );
  // Recovery store — single source of truth for status decisions
  const transportStatus = useRecoveryStore((s) => (
    mobileRecoveryEnabled ? 'idle' : s.transport.status
  ));
  const transportError = useRecoveryStore((s) => (
    mobileRecoveryEnabled ? null : s.transport.error
  ));
  const recoveryCoordinator = useRecoveryStore((s) => (
    mobileRecoveryEnabled ? 'idle' : s.coordinator
  ));
  const verifiedBackendId = useRecoveryStore((s) => (
    mobileRecoveryEnabled ? null : s.getVerifiedSessionBackendId(sessionId)
  ));
  const recoverySelectedSessionId = useRecoveryStore((s) => (
    mobileRecoveryEnabled ? null : s.selectedSessionId
  ));
  const recoveryActiveBackendId = useRecoveryStore((s) => (
    mobileRecoveryEnabled ? null : s.activeBackendId
  ));
  const recoveryActiveSessionStatus = useRecoveryStore((s) => (
    mobileRecoveryEnabled ? 'idle' : s.activeSession.status
  ));
  const mobileRecoveryPhase = useMobileRecoveryStore((s) => s.phase);
  const mobileRecoveryStep = useMobileRecoveryStore((s) => s.step);
  const mobileRecoverySelectedSessionId = useMobileRecoveryStore((s) => s.selectedSessionId);
  const mobileRecoveryActiveBackendId = useMobileRecoveryStore((s) => s.activeBackendId);
  const mobileRecoveryError = useMobileRecoveryStore((s) => s.lastError);
  const ownerBackendId = useOwnershipStore((s) => {
    if (!sessionId) return null;
    const backendId = s.sessionBackendIds[sessionId] ?? null;
    if (!backendId) return null;
    return resolveCanonicalBackendId(backendId, resolveLocalBackendId() ?? backendId);
  });

  const backendId = useMemo(() => {
    if (verifiedBackendId) return verifiedBackendId;
    if (
      mobileRecoveryEnabled
      && sessionId
      && mobileRecoveryPhase === 'recovering'
      && mobileRecoverySelectedSessionId === sessionId
      && mobileRecoveryActiveBackendId
    ) {
      return mobileRecoveryActiveBackendId;
    }
    if (
      sessionId
      && recoveryCoordinator === 'recovering'
      && recoverySelectedSessionId === sessionId
      && recoveryActiveBackendId
    ) {
      return recoveryActiveBackendId;
    }
    if (ownerBackendId) return ownerBackendId;

    const localBackendId = resolveLocalBackendId(activeServerId ?? null);
    if (getControlPlaneMode() === 'embedded-local') {
      return localBackendId ?? activeServerId ?? null;
    }
    return activeServerId ?? localBackendId ?? null;
  }, [
    activeServerId,
    mobileRecoveryActiveBackendId,
    mobileRecoveryEnabled,
    mobileRecoveryPhase,
    mobileRecoverySelectedSessionId,
    ownerBackendId,
    recoveryActiveBackendId,
    recoveryCoordinator,
    recoverySelectedSessionId,
    sessionId,
    verifiedBackendId,
  ]);

  const backend = useMemo(
    () => (backendId ? backends.find((item) => item.backendId === backendId) ?? null : null),
    [backendId, backends]
  );
  const streamKey = useMemo(
    () => (backendId && sessionId ? getStreamKey(backendId, sessionId) : null),
    [backendId, sessionId]
  );
  const stream = streamKey ? sessionStreams[streamKey] ?? null : null;
  const recoveryBackendStatus = useRecoveryStore((s) => (
    mobileRecoveryEnabled || !backendId ? null : s.backends[backendId]?.status ?? null
  ));
  const recoveryBackendError = useRecoveryStore((s) => (
    mobileRecoveryEnabled || !backendId ? null : s.backends[backendId]?.lastError ?? null
  ));
  const mobileBackendViewState = getMobileBackendViewState(
    backendId,
    facadeConnectionState,
    backends,
    mobileRecoveryPhase,
  );
  const catchUpSignatureRef = useRef<string | null>(null);
  const prevStreamStateRef = useRef<string | undefined>();
  const recoveryBlocksStreamOpen = !!(sessionId
    && recoveryCoordinator === 'recovering'
    && recoverySelectedSessionId === sessionId
    && (recoveryActiveSessionStatus === 'resolving_owner' || recoveryActiveSessionStatus === 'waiting_backend_ready'));
  const mobileRecoveryOwnsDesiredState = !!(
    maintainDesiredState
    && sessionId
    && mobileRecoveryPhase === 'recovering'
    && mobileRecoverySelectedSessionId === sessionId
  );
  const recoveryOwnsDesiredState = !!(
    maintainDesiredState
    && sessionId
    && recoveryCoordinator === 'recovering'
    && recoverySelectedSessionId === sessionId
  ) || mobileRecoveryOwnsDesiredState;

  useEffect(() => {
    catchUpSignatureRef.current = null;
  }, [streamKey]);

  // Reset catch-up signature when stream transitions back to 'open' (e.g. after reconnect).
  // Without this, a reconnect with unchanged maxOffset would skip the catch-up request
  // because the signature (streamKey + maxOffset) hasn't changed.
  useEffect(() => {
    const prev = prevStreamStateRef.current;
    const curr = stream?.state;
    prevStreamStateRef.current = curr;
    if (prev && prev !== 'open' && curr === 'open') {
      catchUpSignatureRef.current = null;
    }
  }, [stream?.state]);

  // Re-open backend when it becomes visible again after disconnect/reconnect.
  // backend?.openState changes from 'open' → 'closed' on disconnect, and the
  // backend reappears as 'visible' on reconnect — we need to re-trigger openBackend.
  const backendOpenState = backend?.openState;
  useEffect(() => {
    if (!maintainDesiredState || !facade || !backendId || recoveryOwnsDesiredState) return;
    if (backendOpenState === 'subscribed' || backendOpenState === 'subscribing') return;
    facade.openBackend(backendId);
  }, [backendId, backendOpenState, facade, maintainDesiredState, recoveryOwnsDesiredState]);

  useEffect(() => {
    if (
      !maintainDesiredState
      || !facade
      || !backendId
      || !sessionId
      || recoveryBlocksStreamOpen
      || recoveryOwnsDesiredState
    ) return;

    facade.openSessionStream(backendId, sessionId);

    return () => {
      facade.closeSessionStream(backendId, sessionId);
    };
  }, [backendId, facade, maintainDesiredState, recoveryBlocksStreamOpen, recoveryOwnsDesiredState, sessionId]);

  useEffect(() => {
    if (
      !maintainDesiredState
      || !facade
      || !backendId
      || !sessionId
      || !streamKey
      || recoveryOwnsDesiredState
    ) return;
    if (stream?.state !== 'open') return;

    const signature = `${streamKey}:${maxOffset}`;
    if (catchUpSignatureRef.current === signature) return;
    catchUpSignatureRef.current = signature;
    facade.catchUpContent(backendId, sessionId, maxOffset);
  }, [backendId, facade, maintainDesiredState, maxOffset, recoveryOwnsDesiredState, sessionId, stream?.state, streamKey]);

  const backendReady = mobileRecoveryEnabled ? mobileBackendViewState === 'ready' : recoveryBackendStatus === 'ready';
  const backendErrored = mobileRecoveryEnabled ? mobileBackendViewState === 'error' : recoveryBackendStatus === 'error';
  const transportReady = mobileRecoveryEnabled ? facadeConnectionState === 'connected' : transportStatus === 'connected';
  const canSend = mobileRecoveryEnabled
    ? !mobileRecoveryOwnsDesiredState && isMobileBackendUsable({
      backendId,
      connectionState: facadeConnectionState,
      backends,
      recoveryPhase: mobileRecoveryPhase,
    })
    : transportReady && backendReady;
  const canLoadMessages = !!backendId;

  let phase: SessionRoutePhase;
  if (!backendId) {
    phase = ownerBackendId ? 'offline' : 'resolving';
  } else if (
    mobileRecoveryEnabled
    && mobileRecoveryPhase === 'recovering'
    && mobileRecoverySelectedSessionId === sessionId
  ) {
    phase = mobileRecoveryStep === 'session' ? 'opening_stream' : 'opening_backend';
  } else if (
    transportStatus === 'error'
    || backendErrored
    || stream?.state === 'error'
    || (mobileRecoveryEnabled && facadeConnectionState === 'error')
  ) {
    phase = 'error';
  } else if ((transportStatus === 'idle' || transportStatus === 'stopped') && !recoveryBackendStatus) {
    phase = 'offline';
  } else if (!backendReady) {
    phase = 'opening_backend';
  } else if (!stream || stream.state === 'closed' || stream.state === 'opening' || stream.state === 'closing') {
    phase = 'opening_stream';
  } else {
    phase = 'ready';
  }

  return {
    backendId,
    phase,
    canSend,
    canLoadMessages,
    ownerResolved: !!ownerBackendId,
    lastError: stream?.lastError
      ?? (mobileRecoveryEnabled ? mobileRecoveryError : null)
      ?? recoveryBackendError
      ?? transportError
      ?? backend?.lastError
      ?? null,
  };
}
