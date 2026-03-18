import { useEffect } from 'react';
import { useServerStore } from '../stores/serverStore';
import { toGatewayServerId, useGatewayStore } from '../stores/gatewayStore';
import { probeServerLatency } from '../services/api';

const PROBE_INTERVAL_MS = 15000;

export function useServerLatencyMonitor(): void {
  const servers = useServerStore((s) => s.servers);
  const setServerLatency = useServerStore((s) => s.setServerLatency);
  const discoveredBackends = useGatewayStore((s) => s.discoveredBackends);
  const showLocalBackend = useGatewayStore((s) => s.showLocalBackend);
  const localBackendId = useGatewayStore((s) => s.localBackendId);

  useEffect(() => {
    let cancelled = false;

    const directServerIds = servers
      .filter((server) => server.connectionMode !== 'gateway')
      .map((server) => server.id);

    const gatewayServerIds = discoveredBackends
      .filter((backend) => backend.online)
      .filter((backend) => showLocalBackend || backend.backendId !== localBackendId)
      .map((backend) => toGatewayServerId(backend.backendId));

    const serverIds = [...new Set([...directServerIds, ...gatewayServerIds])];

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
  }, [servers, discoveredBackends, showLocalBackend, localBackendId, setServerLatency]);
}
