import { useEffect, useMemo, useRef } from 'react';
import { useFacadeStore } from '../../stores/facadeStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useServerStore } from '../../stores/serverStore';
import { useChatStore } from '../../stores/chatStore';
import { getControlPlaneMode, resolveCanonicalBackendId, resolveLocalBackendId } from '../../utils/controlPlane';

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
  const facade = useFacadeStore((s) => s.facade);
  const connectionState = useFacadeStore((s) => s.connectionState);
  const connectionError = useFacadeStore((s) => s.connectionError);
  const backends = useFacadeStore((s) => s.backends);
  const sessionStreams = useFacadeStore((s) => s.sessionStreams);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const serverConnections = useServerStore((s) => s.connections);
  const maxOffset = useChatStore((s) =>
    sessionId ? s.pagination[sessionId]?.maxOffset ?? 0 : 0
  );
  const ownerBackendId = useOwnershipStore((s) => {
    if (!sessionId) return null;
    const backendId = s.sessionBackendIds[sessionId] ?? null;
    if (!backendId) return null;
    return resolveCanonicalBackendId(backendId, resolveLocalBackendId() ?? backendId);
  });

  const backendId = useMemo(() => {
    if (ownerBackendId) return ownerBackendId;

    const localBackendId = resolveLocalBackendId(activeServerId ?? null);
    if (getControlPlaneMode() === 'embedded-local') {
      return localBackendId ?? activeServerId ?? null;
    }
    return activeServerId ?? localBackendId ?? null;
  }, [activeServerId, ownerBackendId]);

  const backend = useMemo(
    () => (backendId ? backends.find((item) => item.backendId === backendId) ?? null : null),
    [backendId, backends]
  );
  const streamKey = useMemo(
    () => (backendId && sessionId ? getStreamKey(backendId, sessionId) : null),
    [backendId, sessionId]
  );
  const stream = streamKey ? sessionStreams[streamKey] ?? null : null;
  const serverConnection = backendId ? serverConnections[backendId] ?? null : null;
  const catchUpSignatureRef = useRef<string | null>(null);
  const prevStreamStateRef = useRef<string | undefined>();

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
    if (!maintainDesiredState || !facade || !backendId) return;
    facade.openBackend(backendId);
  }, [backendId, backendOpenState, facade, maintainDesiredState]);

  useEffect(() => {
    if (!maintainDesiredState || !facade || !backendId || !sessionId) return;

    facade.openSessionStream(backendId, sessionId);

    return () => {
      facade.closeSessionStream(backendId, sessionId);
    };
  }, [backendId, facade, maintainDesiredState, sessionId]);

  useEffect(() => {
    if (!maintainDesiredState || !facade || !backendId || !sessionId || !streamKey) return;
    if (stream?.state !== 'open') return;

    const signature = `${streamKey}:${maxOffset}`;
    if (catchUpSignatureRef.current === signature) return;
    catchUpSignatureRef.current = signature;
    facade.catchUpContent(backendId, sessionId, maxOffset);
  }, [backendId, facade, maintainDesiredState, maxOffset, sessionId, stream?.state, streamKey]);

  const backendReady = backend?.runtimeState === 'ready' || (!backend && serverConnection?.status === 'connected');
  const backendErrored = backend?.runtimeState === 'error' || (!backend && serverConnection?.status === 'error');
  const backendOffline = (
    backend
      ? backend.runtimeState === 'offline' || backend.openState === 'closed'
      : serverConnection?.status === 'disconnected'
  );
  const transportReady = connectionState === 'connected' || (!backend && serverConnection?.status === 'connected');
  const canSend = transportReady && backendReady;
  const canLoadMessages = !!backendId;

  let phase: SessionRoutePhase;
  if (!backendId) {
    phase = ownerBackendId ? 'offline' : 'resolving';
  } else if (connectionState === 'error' || backendErrored || stream?.state === 'error') {
    phase = 'error';
  } else if (connectionState === 'disconnected' && !serverConnection) {
    phase = 'offline';
  } else if (connectionState !== 'connected' && !(transportReady && !backend)) {
    phase = 'opening_backend';
  } else if (backendOffline) {
    phase = 'opening_backend';
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
    lastError: stream?.lastError ?? backend?.lastError ?? connectionError ?? null,
  };
}
