import { useEffect, useMemo } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';
import { probeServerLatency } from '../services/api';
import { getUsableMobileBackendIds } from '../services/mobileConnectionState';

const PROBE_INTERVAL_MS = 15_000;

export function useServerLatencyMonitor(): void {
  const setServerLatency = useServerStore((s) => s.setServerLatency);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);

  const readyBackendIds = useMemo(() => {
    return getUsableMobileBackendIds(
      facadeConnectionState,
      facadeBackends,
    ).sort().join(',');
  }, [facadeBackends, facadeConnectionState]);

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
