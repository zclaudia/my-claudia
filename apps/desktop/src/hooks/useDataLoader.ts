import { useEffect, useCallback } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';
import * as api from '../services/api';

export function useDataLoader() {
  const { connectionStatus, activeServerId } = useServerStore();

  const loadData = useCallback(async () => {
    if (connectionStatus !== 'connected') return;

    console.log('[DataLoader] Loading data from local server via HTTP');

    try {
      // Load servers, projects, and sessions from the local server.
      // These API functions always target the local backend via fetchLocalApi.
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
  }, [connectionStatus]);

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
