import { useEffect, useMemo } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useRecoveryStore } from '../stores/recoveryStore';
import { useFacadeStore } from '../stores/facadeStore';
import { useMobileRecoveryStore } from '../stores/mobileRecoveryStore';
import { probeServerLatency } from '../services/api';
import { getUsableMobileBackendIds } from '../services/mobileConnectionState';
import { isAndroid } from '../utils/platform';

const PROBE_INTERVAL_MS = 15_000;

export function useServerLatencyMonitor(): void {
  const mobileRecoveryEnabled = isAndroid();
  const setServerLatency = useServerStore((s) => s.setServerLatency);
  const recoveryBackends = useRecoveryStore((s) => (
    mobileRecoveryEnabled ? null : s.backends
  ));
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const mobileRecoveryPhase = useMobileRecoveryStore((s) => s.phase);

  const readyBackendIds = useMemo(() => {
    if (mobileRecoveryEnabled) {
      return getUsableMobileBackendIds(
        facadeConnectionState,
        facadeBackends,
        mobileRecoveryPhase,
      ).sort().join(',');
    }
    return Object.entries(recoveryBackends ?? {})
      .filter(([, b]) => b.status === 'ready')
      .map(([id]) => id)
      .sort()
      .join(',');
  }, [facadeBackends, facadeConnectionState, mobileRecoveryEnabled, mobileRecoveryPhase, recoveryBackends]);

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
