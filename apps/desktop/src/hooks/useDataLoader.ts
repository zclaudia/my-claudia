import { useEffect, useCallback } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';
import * as api from '../services/api';

export function useDataLoader() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const isActiveConnected = useServerStore((s) => {
    if (!s.activeServerId) return false;
    return s.connections[s.activeServerId]?.status === 'connected';
  });
  const setDataServerId = useProjectStore((s) => s.setDataServerId);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    if (!isActiveConnected) return;

    console.log(`[DataLoader] Loading data for server: ${activeServerId}`);

    try {
      const [projects, sessions, providers] = await Promise.all([
        api.getProjects({ signal }),
        api.getSessions(undefined, { signal }),
        api.getProviders({ signal })
      ]);
      const store = useProjectStore.getState();
      store.setProjects(projects);
      store.mergeSessions(sessions);
      store.setProviders(providers);
      store.setDataServerId(activeServerId);

      // If current selectedSessionId doesn't exist in the new sessions, auto-select
      const { selectedSessionId } = store;
      if (selectedSessionId && !sessions.find(s => s.id === selectedSessionId)) {
        const latest = sessions.length > 0
          ? sessions.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
          : null;
        useProjectStore.getState().selectSession(latest?.id ?? null);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('[DataLoader] Error loading data:', err);
    }
  }, [isActiveConnected, activeServerId]);

  // Load data when connected or server changes
  useEffect(() => {
    if (isActiveConnected) {
      const controller = new AbortController();
      setDataServerId(null);
      const timer = setTimeout(() => {
        loadData(controller.signal);
      }, 100);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }
  }, [loadData, activeServerId, isActiveConnected, setDataServerId]);

  // Note: Session messages are loaded by ChatInterface with pagination support

  return {
    loadData
  };
}
