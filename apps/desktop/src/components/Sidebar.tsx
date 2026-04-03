import { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { isDesktopTauri } from '../utils/platform';
import { openPopoutWindow } from '../utils/popoutWindow';
import { useOwnershipStore } from '../stores/ownershipStore';

async function openSessionInNewWindow(sessionId: string, projectId: string) {
  if (!isDesktopTauri()) return;
  try {
    const ownerBackendId = useOwnershipStore.getState().getSessionBackendId(sessionId);
    const label = await openPopoutWindow({
      type: 'session-chat',
      params: { sessionWindow: sessionId, projectId },
      title: 'Session',
      connectionTarget: { sessionId, backendId: ownerBackendId },
    });
    useUIStore.getState().addPoppedOutSession(sessionId, label);
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const win = await WebviewWindow.getByLabel(label);
    if (win) {
      const unlisten = await win.onCloseRequested(() => {
        useUIStore.getState().removePoppedOutSession(sessionId);
        unlisten();
      });
    }
  } catch (err) {
    console.error('[Sidebar] Pop out session failed:', err);
  }
}
import { useProjectStore } from '../stores/projectStore';
import { useProviderMetaStore } from '../stores/providerMetaStore';
import { useServerStore } from '../stores/serverStore';
import { useRecoveryStore } from '../stores/recoveryStore';
import { isLegacyLocalBackendId, resolveCanonicalBackendId } from '../utils/controlPlane';
import { useSupervisionStore } from '../stores/supervisionStore';
import { usePermissionStore } from '../stores/permissionStore';
import { usePromptRequestStore } from '../stores/promptRequestStore';
import { useInteractionStore } from '../stores/interactionStore';
import { useChatStore } from '../stores/chatStore';
import { useSwipeBack } from '../hooks/useSwipeBack';
import { useUIStore } from '../stores/uiStore';
import { useClaudiaStore } from '../stores/claudiaStore';
import { useNotificationFeedStore } from '../stores/notificationFeedStore';
import { useClaudiaStatus } from '../hooks/useClaudiaStatus';
import { useSelectionCoordinator } from '../hooks/useSelectionCoordinator';

import { ProjectSettings } from './ProjectSettings';
import { SettingsPanel } from './SettingsPanel';
import { ActiveSessionsPanel } from './ActiveSessionsPanel';
import { PluginPermissionDialog } from './PluginPermissionDialog';
import { SortableList, SortableItem } from './SortableList';

import { useSearchSidebar } from './sidebar/useSearchSidebar';
import { groupSessionsByWorktree as groupSessionsByWorktreeFn } from './sidebar/worktreeGrouping';
import { SidebarHeader } from './sidebar/SidebarHeader';
import { MobileSidebarHeader } from './sidebar/MobileSidebarHeader';
import { SidebarSearch } from './sidebar/SidebarSearch';
import { ProjectListItem } from './sidebar/ProjectListItem';
import { NewProjectForm } from './sidebar/NewProjectForm';
import { SidebarFooter } from './sidebar/SidebarFooter';

import * as api from '../services/api';
import { reorderProjects } from '../services/api/projects';
import { reorderSessions } from '../services/api/sessions';
import type { GitWorktree } from '@my-claudia/shared';
import type { WorktreeGroup } from './sidebar/worktreeGrouping';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  hideHeader?: boolean;
  onOpenDashboard?: (projectId: string) => void;
  onOpenAutomations?: () => void;
  onOpenNotifications?: () => void;
  isNotificationsOpen?: boolean;
}

export function Sidebar({
  collapsed,
  onToggle,
  isMobile,
  isOpen,
  onClose,
  hideHeader,
  onOpenDashboard,
  onOpenAutomations,
  onOpenNotifications,
  isNotificationsOpen = false,
}: SidebarProps) {
  const requestMessageJump = useUIStore((s) => s.requestMessageJump);
  const projects = useProjectStore((s) => s.projects) ?? [];
  const sessions = useProjectStore((s) => s.sessions) ?? [];
  const legacyProviders = useProjectStore((s) => s.providers) ?? [];
  const selectedSessionId = useProjectStore((s) => s.selectedSessionId);
  const addProject = useProjectStore((s) => s.addProject);
  const addSession = useProjectStore((s) => s.addSession);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const storeReorderProjects = useProjectStore((s) => s.reorderProjects);
  const storeReorderSessions = useProjectStore((s) => s.reorderSessions);

  const activeServerId = useServerStore((s) => s.activeServerId);
  const isConnected = useRecoveryStore((s) => {
    if (!activeServerId) return false;
    return s.backends[activeServerId]?.status === 'ready';
  });
  const scopedProviders = useProviderMetaStore((s) => s.getProviders(activeServerId));
  const providers = scopedProviders.length > 0 ? scopedProviders : legacyProviders;
  const {
    selectProject,
    selectSession,
    selectSessionOnBackend,
  } = useSelectionCoordinator();
  const v2Agents = useSupervisionStore((s) => s.agents);
  const notificationUnreadCount = useNotificationFeedStore((s) => s.unreadCount);
  const { hasUnread: hasClaudiaUnread, hasRunning: hasClaudiaRunning, hasPermissionPending: hasClaudiaPermissionPending } = useClaudiaStatus();
  const isClaudiaExpanded = useClaudiaStore((s) => s.isExpanded);
  const setClaudiaExpanded = useClaudiaStore((s) => s.setExpanded);

  // Sessions with pending approval-style interactions
  const permSessionIds = usePermissionStore(s => new Set(s.pendingRequests.map(r => r.sessionId)));
  const promptSessionIds = usePromptRequestStore(s => new Set(s.pendingRequests.map(r => r.sessionId)));
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
    return permSessionIds.has(sessionId)
      || promptSessionIds.has(sessionId)
      || interactionSessionIds.has(sessionId);
  }, [permSessionIds, promptSessionIds, interactionSessionIds]);

  // Active run session IDs for status indicator
  const activeRunSessionIds = useChatStore((s) => {
    const ids = new Set<string>();
    for (const sid of Object.values(s.activeRuns)) ids.add(sid);
    return ids;
  });

  // Helper: resolve provider display name for a session
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

  // Helper: extract worktree branch from workingDirectory
  const getWorktreeBranch = useCallback((session: typeof sessions[0], project: typeof projects[0] | undefined) => {
    const wd = session.workingDirectory;
    if (!wd || !project?.rootPath) return undefined;
    if (wd === project.rootPath) return undefined;
    const parts = wd.split('/');
    return parts[parts.length - 1] || undefined;
  }, []);

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRootPath, setNewProjectRootPath] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingSessionForProject, setCreatingSessionForProject] = useState<string | null>(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionProviderId, setNewSessionProviderId] = useState<string>('');
  const [contextMenuProject, setContextMenuProject] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const search = useSearchSidebar();
  const [expandedWorktrees, setExpandedWorktrees] = useState<Set<string>>(new Set());
  const [regularSessionsCollapsed, setRegularSessionsCollapsed] = useState<Set<string>>(new Set());
  const [worktreesByProject, setWorktreesByProject] = useState<Map<string, GitWorktree[]>>(new Map());

  const settingsProject = settingsProjectId ? projects?.find(p => p.id === settingsProjectId) || null : null;

  const internalProjectIds = useMemo(
    () => new Set(projects.filter(p => p.isInternal).map(p => p.id)),
    [projects]
  );

  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, typeof sessions>();
    const visibleSessions = sessions.filter(s => s.type !== 'background' && !internalProjectIds.has(s.projectId));
    visibleSessions.forEach(session => {
      const projectSessions = grouped.get(session.projectId) || [];
      projectSessions.push(session);
      grouped.set(session.projectId, projectSessions);
    });
    return grouped;
  }, [sessions]);

  const filteredProjects = projects.filter(p => !p.isInternal);

  const getFilteredSessionsForProject = useCallback((projectId: string) => {
    return sessionsByProject.get(projectId) || [];
  }, [sessionsByProject]);

  // Fetch worktree data lazily when a project is expanded
  useEffect(() => {
    for (const projectId of expandedProjects) {
      if (!worktreesByProject.has(projectId)) {
        api.getProjectWorktrees(projectId).then(wts => {
          setWorktreesByProject(prev => new Map(prev).set(projectId, wts));
        }).catch(() => {
          setWorktreesByProject(prev => new Map(prev).set(projectId, []));
        });
      }
    }
  }, [expandedProjects, worktreesByProject]);

  // Group sessions by worktree for a project
  const getWorktreeGroupsForProject = useCallback((projectId: string): WorktreeGroup[] => {
    const projectSessions = sessionsByProject.get(projectId) || [];
    const project = projects.find(p => p.id === projectId);
    const worktrees = worktreesByProject.get(projectId) || [];
    return groupSessionsByWorktreeFn(projectSessions, project?.rootPath, worktrees);
  }, [sessionsByProject, projects, worktreesByProject]);

  const toggleWorktree = useCallback((key: string) => {
    setExpandedWorktrees(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Auto-expand worktree group when a session is selected
  useEffect(() => {
    if (!selectedSessionId) return;
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session) return;
    const groups = getWorktreeGroupsForProject(session.projectId);
    if (groups.length === 0) return;
    for (const group of groups) {
      if (group.sessions.some(s => s.id === selectedSessionId)) {
        const wtKey = `${session.projectId}:${group.key}`;
        setExpandedWorktrees(prev => {
          if (prev.has(wtKey)) return prev;
          return new Set(prev).add(wtKey);
        });
        break;
      }
    }
  }, [selectedSessionId, sessions, getWorktreeGroupsForProject]);

  const toggleRegularSessions = useCallback((projectId: string) => {
    setRegularSessionsCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const toggleProject = (projectId: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId);
    } else {
      newExpanded.add(projectId);
    }
    setExpandedProjects(newExpanded);
  };

  const handleActiveSessionSelect = useCallback((backendId: string, sessionId: string) => {
    useUIStore.getState().requestForceScrollToBottom(sessionId);
    if (isLegacyLocalBackendId(backendId)) {
      const resolvedBackendId = resolveCanonicalBackendId(backendId, backendId);
      if (resolvedBackendId) selectSessionOnBackend(resolvedBackendId, sessionId);
      return;
    }
    selectSessionOnBackend(backendId, sessionId);
  }, [selectSessionOnBackend, selectSession]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !isConnected) return;
    setCreatingProject(true);
    try {
      const project = await api.createProject({
        name: newProjectName.trim(),
        type: 'code',
        rootPath: newProjectRootPath.trim() || undefined
      });
      addProject(project);
      setNewProjectName('');
      setNewProjectRootPath('');
      setShowNewProjectForm(false);
      setExpandedProjects((prev) => new Set(prev).add(project.id));
      selectProject(project.id);
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setCreatingProject(false);
    }
  };

  const handleCreateSession = async (projectId: string) => {
    if (!isConnected) return;
    try {
      const session = await api.createSession({
        projectId,
        name: newSessionName.trim() || undefined,
        providerId: newSessionProviderId || undefined,
      });
      addSession(session);
      setNewSessionName('');
      setNewSessionProviderId('');
      setCreatingSessionForProject(null);
      selectSession(session.id);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const openContextMenu = (e: React.MouseEvent, _type: 'project', id: string) => {
    e.stopPropagation();
    const clickX = e.clientX;
    const clickY = e.clientY;
    const menuWidth = isMobile ? 176 : 144;
    const menuHeight = isMobile ? 190 : 140;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const margin = 8;

    let top = clickY + 6;
    if (top + menuHeight > viewportH - margin) {
      top = clickY - menuHeight - 6;
    }
    top = Math.max(margin, Math.min(top, viewportH - menuHeight - margin));

    let left = clickX - menuWidth + 12;
    left = Math.max(margin, Math.min(left, viewportW - menuWidth - margin));

    setContextMenuPos({ top, left });
    setContextMenuProject(contextMenuProject === id ? null : id);
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!isConnected) return;
    try {
      await api.deleteProject(projectId);
      deleteProject(projectId);
      setContextMenuProject(null);
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const handleReorderProjects = useCallback((orderedIds: string[]) => {
    storeReorderProjects(orderedIds);
    reorderProjects(orderedIds).catch((err) => console.error('[Sidebar] Failed to persist project order:', err));
  }, [storeReorderProjects]);

  const handleReorderSessions = useCallback((projectId: string, orderedIds: string[]) => {
    const currentVisibleIds = getFilteredSessionsForProject(projectId).map((session) => session.id);
    const reorderedSet = new Set(orderedIds);
    const nextSubset = [...orderedIds];
    const mergedIds = currentVisibleIds.map((id) => (
      reorderedSet.has(id) ? (nextSubset.shift() ?? id) : id
    ));
    storeReorderSessions(projectId, mergedIds);
    reorderSessions(projectId, mergedIds).catch((err) => console.error('[Sidebar] Failed to persist session order:', err));
  }, [getFilteredSessionsForProject, storeReorderSessions]);

  const handleSearchResultSelect = useCallback((sessionId: string, messageId: string, ownerBackendId?: string) => {
    requestMessageJump(sessionId, messageId);
    selectSession(sessionId, { backendId: ownerBackendId });
    if (onClose) onClose();
  }, [requestMessageJump, selectSession, onClose]);

  const handleSessionSelect = useCallback((sessionId: string) => {
    selectSession(sessionId);
    if (isMobile && onClose) onClose();
  }, [selectSession, isMobile, onClose]);

  const handlePopOutSession = useCallback((sessionId: string, projectId: string) => {
    openSessionInNewWindow(sessionId, projectId);
  }, []);

  const sidebarSwipeRef = useSwipeBack({
    onSwipe: () => onClose?.(),
    enabled: isMobile && !!isOpen,
    direction: 'left',
    fullWidth: true,
    threshold: 60,
  });

  // Shared project list renderer
  const renderProjectList = () => (
    <>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground px-2">No projects yet</p>
      ) : filteredProjects.length === 0 ? (
        <p className="text-sm text-muted-foreground px-2">No active sessions</p>
      ) : (
        <SortableList
          items={filteredProjects.map((p) => p.id)}
          onReorder={handleReorderProjects}
          className="space-y-2"
        >
          {filteredProjects.map((project) => (
            <SortableItem
              key={project.id}
              id={project.id}
              wrapperClassName="items-start"
              dragHandleClassName="w-4 h-4 -ml-1 mr-0.5 mt-2"
            >
              <ProjectListItem
                project={project}
                isExpanded={expandedProjects.has(project.id)}
                onToggle={() => toggleProject(project.id)}
                sessions={getFilteredSessionsForProject(project.id)}
                selectedSessionId={selectedSessionId}
                onSelectSession={handleSessionSelect}
                onOpenDashboard={isMobile ? (pid) => { onOpenDashboard?.(pid); onClose?.(); } : onOpenDashboard}
                hasPendingForSession={hasPendingForSession}
                activeRunSessionIds={activeRunSessionIds}
                getProviderName={getProviderName}
                getWorktreeBranch={getWorktreeBranch}
                v2Agent={v2Agents[project.id]}
                worktrees={worktreesByProject.get(project.id) || []}
                expandedWorktrees={expandedWorktrees}
                onToggleWorktree={toggleWorktree}
                regularSessionsCollapsed={regularSessionsCollapsed.has(project.id)}
                onToggleRegularSessions={() => toggleRegularSessions(project.id)}
                onReorderSessions={handleReorderSessions}
                isMobile={isMobile}
                contextMenuProject={contextMenuProject}
                contextMenuPos={contextMenuPos}
                onOpenContextMenu={openContextMenu}
                onCloseContextMenu={() => setContextMenuProject(null)}
                onSettingsProject={setSettingsProjectId}
                onDeleteProject={handleDeleteProject}
                isCreatingSession={creatingSessionForProject === project.id}
                newSessionName={newSessionName}
                onNewSessionNameChange={setNewSessionName}
                newSessionProviderId={newSessionProviderId}
                onNewSessionProviderIdChange={setNewSessionProviderId}
                onStartCreatingSession={() => setCreatingSessionForProject(project.id)}
                onCreateSession={() => handleCreateSession(project.id)}
                onCancelCreateSession={() => {
                  setCreatingSessionForProject(null);
                  setNewSessionName('');
                  setNewSessionProviderId('');
                }}
                isConnected={isConnected}
                providers={providers}
                onPopOutSession={handlePopOutSession}
              />
            </SortableItem>
          ))}
        </SortableList>
      )}

      <NewProjectForm
        showForm={showNewProjectForm}
        onShowForm={setShowNewProjectForm}
        newProjectName={newProjectName}
        onProjectNameChange={setNewProjectName}
        newProjectRootPath={newProjectRootPath}
        onProjectRootPathChange={setNewProjectRootPath}
        onCreateProject={handleCreateProject}
        creatingProject={creatingProject}
        isConnected={isConnected}
        isMobile={isMobile}
      />
    </>
  );

  // Portaled modals shared between mobile and desktop
  const renderPortaledModals = () => (
    <>
      {!!settingsProjectId && createPortal(
        <ProjectSettings
          project={settingsProject}
          isOpen={!!settingsProjectId}
          onClose={() => setSettingsProjectId(null)}
        />,
        document.body
      )}
      {showSettings && createPortal(
        <SettingsPanel
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
        />,
        document.body
      )}
      {createPortal(<PluginPermissionDialog />, document.body)}
    </>
  );

  // Mobile: render as overlay drawer
  if (isMobile) {
    if (!isOpen) return null;

    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={onClose}
        />
        {/* Drawer */}
        <div ref={sidebarSwipeRef} className="fixed inset-y-0 left-0 w-64 bg-card/80 glass z-50 shadow-apple-xl flex flex-col safe-top-pad safe-bottom-pad">
          <MobileSidebarHeader
            onClose={onClose}
            onOpenNotifications={onOpenNotifications}
            isNotificationsOpen={isNotificationsOpen}
            notificationUnreadCount={notificationUnreadCount}
            isClaudiaExpanded={isClaudiaExpanded}
            setClaudiaExpanded={setClaudiaExpanded}
            hasClaudiaPermissionPending={hasClaudiaPermissionPending}
            hasClaudiaUnread={hasClaudiaUnread}
            hasClaudiaRunning={hasClaudiaRunning}
          />

          <SidebarSearch
            search={search}
            isMobile
            sessions={sessions}
            onResultSelect={handleSearchResultSelect}
          />

          {/* Project List */}
          <div className="flex-1 overflow-y-auto scrollbar-hidden p-2">
            {renderProjectList()}
          </div>

          {/* Active Sessions - Fixed at bottom */}
          <div className="flex-shrink-0">
            <ActiveSessionsPanel
              onSessionSelect={(backendId, sessionId) => {
                handleActiveSessionSelect(backendId, sessionId);
                if (onClose) onClose();
              }}
            />
          </div>

          <SidebarFooter
            onShowSettings={() => setShowSettings(true)}
            isMobile
          />
        </div>

        {renderPortaledModals()}
      </>
    );
  }

  // Desktop: use CSS to show/hide sidebar instead of unmounting
  return (
    <>
    <div
      className={`bg-card/80 glass border-r border-border/50 flex flex-col transition-[width] duration-200 ease-out ${
        collapsed ? 'w-0 overflow-hidden' : 'w-64'
      }`}
    >
      {!collapsed && (
        <>
      {!hideHeader && (
        <SidebarHeader onToggle={onToggle} />
      )}

      <SidebarSearch
        search={search}
        sessions={sessions}
        onResultSelect={handleSearchResultSelect}
      />

      {/* Project List */}
      <div className="flex-1 overflow-y-auto scrollbar-hidden p-2">
        {renderProjectList()}
      </div>

      {/* Active Sessions - Fixed at bottom */}
      <div className="flex-shrink-0">
        <ActiveSessionsPanel
          onSessionSelect={handleActiveSessionSelect}
        />
      </div>

      <SidebarFooter
        onOpenAutomations={onOpenAutomations}
        onShowSettings={() => setShowSettings(true)}
        onClose={onClose}
      />

      </>
    )}
    </div>
    {renderPortaledModals()}
    </>
  );
}
