import { useEffect, useCallback } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';
import * as api from '../services/api';

export function useDataLoader() {
  const { connectionStatus, activeServerId } = useServerStore();

  const loadData = useCallback(async () => {
    if (connectionStatus !== 'connected') return;

    console.log(`[DataLoader] Loading data for server: ${activeServerId}`);

    try {
      // Servers list is always local config (getServers uses fetchLocalApi)
      // Projects and sessions route to the active server (fetchApi)
      const [servers, projects, sessions] = await Promise.all([
        api.getServers(),
        api.getProjects(),
        api.getSessions()
      ]);
      useServerStore.getState().setServers(servers);
      useProjectStore.getState().setProjects(projects);
      useProjectStore.getState().setSessions(sessions);
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
