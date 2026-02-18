import { useEffect, useCallback } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';
import { isGatewayTarget } from '../stores/gatewayStore';
import * as api from '../services/api';

export function useDataLoader() {
  const { connectionStatus, activeServerId } = useServerStore();

  const loadData = useCallback(async () => {
    if (connectionStatus !== 'connected') return;

    console.log(`[DataLoader] Loading data for server: ${activeServerId}`);

    // On gateway connections (mobile), skip getServers — it uses fetchLocalApi
    // which targets localhost:3100 and will fail since there's no local server
    const isGateway = isGatewayTarget(activeServerId);

    try {
      const [servers, projects, sessions, providers] = await Promise.all([
        isGateway ? Promise.resolve([]) : api.getServers(),
        api.getProjects(),
        api.getSessions(),
        api.getProviders()
      ]);
      if (!isGateway) {
        useServerStore.getState().setServers(servers);
      }
      const store = useProjectStore.getState();
      store.setProjects(projects);
      store.setSessions(sessions);
      store.setProviders(providers);

      // If current selectedSessionId doesn't exist in the new sessions, auto-select
      const { selectedSessionId } = store;
      if (selectedSessionId && !sessions.find(s => s.id === selectedSessionId)) {
        // Pick the most recently updated session, or null
        const latest = sessions.length > 0
          ? sessions.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
          : null;
        useProjectStore.getState().selectSession(latest?.id ?? null);
      }
    } catch (err) {
      console.error('[DataLoader] Error loading data:', err);
    }
  }, [connectionStatus, activeServerId]);

  // Load data when connected or server changes
  useEffect(() => {
    if (connectionStatus === 'connected') {
      const timer = setTimeout(() => {
        loadData();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [loadData, activeServerId, connectionStatus]);

  // Note: Session messages are loaded by ChatInterface with pagination support

  return {
    loadData
  };
}
