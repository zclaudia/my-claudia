import { useEffect, useMemo, useRef } from 'react';
import { useFacadeStore } from '../stores/facadeStore';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { useOwnershipStore } from '../stores/ownershipStore';
import { useChatStore } from '../stores/chatStore';

function getStreamKey(backendId: string, sessionId: string): string {
  return `${backendId}:${sessionId}`;
}

/**
 * Keeps the currently selected session subscribed to the facade run stream.
 * Without this, gateway-backed sessions only recover content after a later
 * HTTP sync, which makes tool events appear all at once on session switch or
 * run completion.
 */
export function useActiveSessionStream(): void {
  const facade = useFacadeStore((s) => s.facade);
  const sessionStreams = useFacadeStore((s) => s.sessionStreams);
  const selectedSessionId = useProjectStore((s) => s.selectedSessionId);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const ownedBackendId = useOwnershipStore((s) =>
    selectedSessionId ? s.sessionBackendIds[selectedSessionId] ?? null : null
  );
  const maxOffset = useChatStore((s) =>
    selectedSessionId ? s.pagination[selectedSessionId]?.maxOffset ?? 0 : 0
  );

  const targetBackendId = ownedBackendId ?? activeServerId;
  const streamKey = useMemo(
    () => (targetBackendId && selectedSessionId ? getStreamKey(targetBackendId, selectedSessionId) : null),
    [targetBackendId, selectedSessionId]
  );
  const streamState = streamKey ? sessionStreams[streamKey]?.state : undefined;
  const catchUpSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    catchUpSignatureRef.current = null;
  }, [streamKey]);

  useEffect(() => {
    if (!facade || !targetBackendId || !selectedSessionId) return;

    facade.openSessionStream(targetBackendId, selectedSessionId);

    return () => {
      facade.closeSessionStream(targetBackendId, selectedSessionId);
    };
  }, [facade, targetBackendId, selectedSessionId]);

  useEffect(() => {
    if (!facade || !targetBackendId || !selectedSessionId || !streamKey) return;
    if (streamState !== 'open') return;

    const signature = `${streamKey}:${maxOffset}`;
    if (catchUpSignatureRef.current === signature) return;
    catchUpSignatureRef.current = signature;
    facade.catchUpContent(targetBackendId, selectedSessionId, maxOffset);
  }, [facade, targetBackendId, selectedSessionId, streamKey, streamState, maxOffset]);
}
