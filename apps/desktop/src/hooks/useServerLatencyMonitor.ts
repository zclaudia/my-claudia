import { useEffect, useMemo } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';
import { probeServerLatency } from '../services/api';
import { isBackendReady } from '../utils/backendConnection';

const PROBE_INTERVAL_MS = 15_000;

export function useServerLatencyMonitor(): void {
  const setServerLatency = useServerStore((s) => s.setServerLatency);
  const backends = useFacadeStore((s) => s.backends);
  const connectionState = useFacadeStore((s) => s.connectionState);

  // Derive a stable key so the effect only re-runs when the set of ready
  // backend IDs actually changes — not on every facade snapshot update.
  const readyBackendIds = useMemo(() => {
    return backends
      .filter((b) => isBackendReady(connectionState, b))
      .map((b) => b.backendId)
      .sort()
      .join(',');
  }, [backends, connectionState]);

  useEffect(() => {
    if (!readyBackendIds) return;
    const serverIds = readyBackendIds.split(',');
    let cancelled = false;

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
  }, [readyBackendIds, setServerLatency]);
}
