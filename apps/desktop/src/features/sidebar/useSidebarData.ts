import { useMemo, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useProviderMetaStore } from '../../stores/providerMetaStore';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { useInteractionStore } from '../../stores/interactionStore';
import { useChatStore } from '../../stores/chatStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useClaudiaStore } from '../../stores/claudiaStore';
import { useNotificationFeedStore } from '../../stores/notificationFeedStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useClaudiaStatus } from '../../hooks/useClaudiaStatus';
import { isMobileBackendUsable } from '../../services/mobileConnectionState';

/**
 * Aggregates all store selectors and derived data for the Sidebar.
 * Keeps the Sidebar component focused on rendering.
 */
export function useSidebarData() {
  const projects = useProjectStore((s) => s.projects) ?? [];
  const sessions = useProjectStore((s) => s.sessions) ?? [];
  const legacyProviders = useProjectStore((s) => s.providers) ?? [];
  const selectedSessionId = useSelectionStore((s) => s.selectedSessionId);
  const addProject = useProjectStore((s) => s.addProject);
  const addSession = useProjectStore((s) => s.addSession);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const storeReorderProjects = useProjectStore((s) => s.reorderProjects);
  const storeReorderSessions = useProjectStore((s) => s.reorderSessions);

  const activeServerId = useServerStore((s) => s.activeServerId);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const isConnected = isMobileBackendUsable({
    backendId: activeServerId,
    connectionState: facadeConnectionState,
    backends: facadeBackends,
  });
  const scopedProviders = useProviderMetaStore((s) => s.getProviders(activeServerId));
  const providers = scopedProviders.length > 0 ? scopedProviders : legacyProviders;

  const supervisorAgents = useSupervisionStore((s) => s.agents);
  const notificationUnreadCount = useNotificationFeedStore((s) => s.unreadCount);
  const { hasUnread: hasClaudiaUnread, hasRunning: hasClaudiaRunning, hasPermissionPending: hasClaudiaPermissionPending } = useClaudiaStatus();
  const isClaudiaExpanded = useClaudiaStore((s) => s.isExpanded);
  const setClaudiaExpanded = useClaudiaStore((s) => s.setExpanded);

  const permSessionIds = usePermissionStore(s => new Set(s.pendingRequests.map(r => r.sessionId)));
  const interactionSessionIds = useInteractionStore((s) => {
    const ids = new Set<string>();
    for (const interaction of Object.values(s.interactions)) {
      if (
        interaction.type === 'interaction_plan_review'
        || interaction.type === 'interaction_approval'
        || interaction.type === 'interaction_prompt'
      ) {
        ids.add(interaction.sessionId);
      }
    }
    return ids;
  });
  const hasPendingForSession = useCallback((sessionId: string) => {
    return permSessionIds.has(sessionId) || interactionSessionIds.has(sessionId);
  }, [permSessionIds, interactionSessionIds]);

  const chatActiveRuns = useChatStore((s) => s.activeRuns);
  const sessionsActiveByBackend = useSessionsStore((s) => s.activeSessionIdsByBackend);
  const activeRunSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sid of Object.values(chatActiveRuns)) ids.add(sid);
    sessionsActiveByBackend.forEach((set) => {
      set.forEach((sid) => ids.add(sid));
    });
    return ids;
  }, [chatActiveRuns, sessionsActiveByBackend]);

  const ownershipStore = useOwnershipStore();

  const visibleProjects = useMemo(() => {
    if (!activeServerId) return projects;
    return projects.filter((project) => {
      const ownerBackendId = ownershipStore.getProjectBackendId(project.id);
      return !ownerBackendId || ownerBackendId === activeServerId;
    });
  }, [activeServerId, ownershipStore, projects]);

  const visibleProjectIds = useMemo(
    () => new Set(visibleProjects.map((project) => project.id)),
    [visibleProjects]
  );

  const visibleSessions = useMemo(() => {
    if (!activeServerId) return sessions;
    return sessions.filter((session) => {
      const ownerBackendId =
        ownershipStore.getSessionBackendId(session.id)
        ?? ownershipStore.getProjectBackendId(session.projectId);
      return (!ownerBackendId || ownerBackendId === activeServerId) && visibleProjectIds.has(session.projectId);
    });
  }, [activeServerId, ownershipStore, sessions, visibleProjectIds]);

  const internalProjectIds = useMemo(
    () => new Set(visibleProjects.filter(p => p.isInternal).map(p => p.id)),
    [visibleProjects]
  );

  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, typeof sessions>();
    const filteredSessions = visibleSessions.filter(s => s.type !== 'background' && !internalProjectIds.has(s.projectId));
    filteredSessions.forEach(session => {
      const projectSessions = grouped.get(session.projectId) || [];
      projectSessions.push(session);
      grouped.set(session.projectId, projectSessions);
    });
    return grouped;
  }, [visibleSessions, internalProjectIds]);

  const filteredProjects = visibleProjects.filter(p => !p.isInternal);

  const getFilteredSessionsForProject = useCallback((projectId: string) => {
    return sessionsByProject.get(projectId) || [];
  }, [sessionsByProject]);

  const getProviderName = useCallback((session: typeof sessions[0]) => {
    const pid = session.providerId
      || projects.find(p => p.id === session.projectId)?.providerId;
    if (pid) {
      const provider = providers.find(p => p.id === pid);
      return provider?.name || provider?.type || pid;
    }
    const defaultProvider = providers.find(p => p.isDefault);
    return defaultProvider?.name || defaultProvider?.type || undefined;
  }, [providers, projects]);

  const getWorktreeBranch = useCallback((session: typeof sessions[0], project: typeof projects[0] | undefined) => {
    const wd = session.workingDirectory;
    if (!wd || !project?.rootPath) return undefined;
    if (wd === project.rootPath) return undefined;
    const parts = wd.split('/');
    return parts[parts.length - 1] || undefined;
  }, []);

  return {
    projects,
    sessions,
    visibleProjects,
    visibleSessions,
    filteredProjects,
    selectedSessionId,
    activeServerId,
    isConnected,
    providers,
    supervisorAgents,
    notificationUnreadCount,
    hasClaudiaUnread,
    hasClaudiaRunning,
    hasClaudiaPermissionPending,
    isClaudiaExpanded,
    setClaudiaExpanded,
    hasPendingForSession,
    activeRunSessionIds,
    ownershipStore,
    sessionsByProject,
    getFilteredSessionsForProject,
    getProviderName,
    getWorktreeBranch,
    addProject,
    addSession,
    deleteProject,
    storeReorderProjects,
    storeReorderSessions,
  };
}
