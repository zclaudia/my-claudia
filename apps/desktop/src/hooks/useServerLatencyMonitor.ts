import { useEffect } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';
import { probeServerLatency } from '../services/api';
import { isBackendReady } from '../utils/backendConnection';

const PROBE_INTERVAL_MS = 15000;

export function useServerLatencyMonitor(): void {
  const setServerLatency = useServerStore((s) => s.setServerLatency);
  const backends = useFacadeStore((s) => s.backends);
  const connectionState = useFacadeStore((s) => s.connectionState);

  useEffect(() => {
    let cancelled = false;

    const serverIds = backends
      .filter((b) => isBackendReady(connectionState, b))
      .map((b) => b.backendId);

    const probeAll = async () => {
      await Promise.all(serverIds.map(async (serverId) => {
        const latencyMs = await probeServerLatency(serverId);
        if (!cancelled) {
          setServerLatency(serverId, latencyMs);
        }
      }));
    };

    void probeAll();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void probeAll();
      }
    }, PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [backends, connectionState, setServerLatency]);
}
