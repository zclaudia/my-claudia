import { useCallback } from 'react';
import { useServerStore } from '../stores/serverStore';
import type { BackendServer } from '@my-claudia/shared';
import * as api from '../services/api';

/**
 * Hook for managing server configurations (add/update/delete)
 * Uses HTTP REST API instead of WebSocket messages
 */
export function useServerManager() {
  const refreshServers = useCallback(async () => {
    try {
      const servers = await api.getServers();
      useServerStore.getState().setServers(servers);
    } catch (err) {
      console.error('[ServerManager] Failed to refresh servers:', err);
    }
  }, []);

  const addServer = useCallback(
    async (server: Omit<BackendServer, 'id' | 'createdAt' | 'lastConnected'>) => {
      await api.createServer(server as any);
      await refreshServers();
    },
    [refreshServers]
  );

  const updateServer = useCallback(
    async (id: string, updates: Partial<Omit<BackendServer, 'id' | 'createdAt'>>) => {
      await api.updateServer(id, updates);
      await refreshServers();
    },
    [refreshServers]
  );

  const deleteServer = useCallback(
    async (id: string) => {
      await api.deleteServer(id);
      await refreshServers();
    },
    [refreshServers]
  );

  const setDefaultServer = useCallback(
    async (id: string) => {
      await api.updateServer(id, { isDefault: true });
      await refreshServers();
    },
    [refreshServers]
  );

  return {
    addServer,
    updateServer,
    deleteServer,
    setDefaultServer
  };
}
