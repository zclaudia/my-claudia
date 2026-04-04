import { useEffect, useCallback } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';
import { useRecoveryStore } from '../stores/recoveryStore';
import { useFacadeStore } from '../stores/facadeStore';
import { useMobileRecoveryStore } from '../stores/mobileRecoveryStore';
import * as api from '../services/api';
import { isMobileBackendUsable } from '../services/mobileConnectionState';
import { isAndroid } from '../utils/platform';

export function useDataLoader() {
  const mobileRecoveryEnabled = isAndroid();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const recoveryIsActiveConnected = useRecoveryStore((s) => {
    if (mobileRecoveryEnabled || !activeServerId) return false;
    return s.backends[activeServerId]?.status === 'ready';
  });
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const mobileRecoveryPhase = useMobileRecoveryStore((s) => s.phase);
  const isActiveConnected = mobileRecoveryEnabled
    ? isMobileBackendUsable({
      backendId: activeServerId,
      connectionState: facadeConnectionState,
      backends: facadeBackends,
      recoveryPhase: mobileRecoveryPhase,
    })
    : recoveryIsActiveConnected;
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
      // Skip internal project sessions (e.g. __claudia) when auto-selecting
      const { selectedSessionId } = store;
      if (selectedSessionId && !sessions.find(s => s.id === selectedSessionId)) {
        const internalProjectIds = new Set(
          (store.projects || []).filter(p => p.isInternal).map(p => p.id)
        );
        const userSessions = sessions.filter(s => !internalProjectIds.has(s.projectId) && s.type !== 'background');
        const latest = userSessions.length > 0
          ? userSessions.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
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
