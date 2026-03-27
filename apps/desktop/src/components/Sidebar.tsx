import { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Bot, FileText, Wrench } from 'lucide-react';
import { isDesktopTauri } from '../utils/platform';
import { openPopoutWindow } from '../utils/popoutWindow';

async function openSessionInNewWindow(sessionId: string, projectId: string) {
  if (!isDesktopTauri()) return;
  try {
    const label = await openPopoutWindow({
      type: 'session-chat',
      params: { sessionWindow: sessionId, projectId },
      title: 'Session',
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
import { useServerStore } from '../stores/serverStore';
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

import { ProjectSettings } from './ProjectSettings';
import { SettingsPanel } from './SettingsPanel';
import { SearchFilters } from './SearchFilters';
import { ActiveSessionsPanel } from './ActiveSessionsPanel';
import { ServerSelector } from './ServerSelector';
import { PluginPermissionDialog } from './PluginPermissionDialog';
import { BrandMark } from './BrandMark';
import { SessionItem } from './sidebar/SessionItem';
import { WorktreeGroupItem } from './sidebar/WorktreeGroupItem';
import { SupervisorGroupItem } from './sidebar/SupervisorGroupItem';
import { groupSessionsByWorktree } from './sidebar/worktreeGrouping';
import { useSearchSidebar } from './sidebar/useSearchSidebar';
import { SortableList, SortableItem } from './SortableList';
import * as api from '../services/api';
import { reorderProjects } from '../services/api/projects';
import { reorderSessions } from '../services/api/sessions';
import type { GitWorktree, Session } from '@my-claudia/shared';

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

function normalizeSearchPreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized || 'No preview text';
}

function splitProjectSessions(sessionList: Session[]) {
  const mainSession = sessionList.find((session) => session.projectRole === 'main') ?? null;
  const taskSessions: Session[] = [];
  const regularSessions: Session[] = [];

  for (const session of sessionList) {
    if (mainSession && session.id === mainSession.id) continue;
    if (mainSession && session.projectRole === 'task' && session.parentSessionId === mainSession.id) {
      taskSessions.push(session);
      continue;
    }
    regularSessions.push(session);
  }

  return { mainSession, taskSessions, regularSessions };
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
  const {
    projects = [],
    sessions = [],
    providers = [],
    selectedSessionId,
    selectProject,
    selectSession,
    addProject,
    addSession,
    deleteProject,
    reorderProjects: storeReorderProjects,
    reorderSessions: storeReorderSessions,
  } = useProjectStore();

  const { connectionStatus, setActiveServer } = useServerStore();
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
  // Fallback chain: session → project → system default provider
  const getProviderName = useCallback((session: typeof sessions[0]) => {
    const pid = session.providerId
      || projects.find(p => p.id === session.projectId)?.providerId;
    if (pid) {
      const provider = providers.find(p => p.id === pid);
      return provider?.name || provider?.type || pid;
    }
    // No explicit provider — use system default
    const defaultProvider = providers.find(p => p.isDefault);
    return defaultProvider?.name || defaultProvider?.type || undefined;
  }, [providers, projects]);

  // Helper: extract worktree branch from workingDirectory
  const getWorktreeBranch = useCallback((session: typeof sessions[0], project: typeof projects[0] | undefined) => {
    const wd = session.workingDirectory;
    if (!wd || !project?.rootPath) return undefined;
    if (wd === project.rootPath) return undefined;
    // Show last path segment as branch hint
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
  const {
    searchQuery, setSearchQuery, searchResults, setSearchResults, isSearching,
    searchHistory, showSearchHistory, showFilters, setShowFilters, searchFilters,
    hasMoreResults, isLoadingMore, searchInputRef, searchResultsContainerRef,
    handleSearch, handleLoadMore, handleSelectHistoryItem, handleSearchFocus,
    handleSearchBlur, handleClearHistory, handleFiltersChange,
  } = search;
  const [expandedWorktrees, setExpandedWorktrees] = useState<Set<string>>(new Set());
  const [regularSessionsCollapsed, setRegularSessionsCollapsed] = useState<Set<string>>(new Set());
  const [worktreesByProject, setWorktreesByProject] = useState<Map<string, GitWorktree[]>>(new Map());

  const settingsProject = settingsProjectId ? projects?.find(p => p.id === settingsProjectId) || null : null;

  // Memoize sessions grouped by project ID to avoid repeated filtering
  // This significantly improves performance when toggling project expansion
  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, typeof sessions>();
    // Filter out background sessions (e.g. review, conflict resolution) from sidebar
    const visibleSessions = sessions.filter(s => s.type !== 'background');
    visibleSessions.forEach(session => {
      const projectSessions = grouped.get(session.projectId) || [];
      projectSessions.push(session);
      grouped.set(session.projectId, projectSessions);
    });
    return grouped;
  }, [sessions]);

  // Show all projects except internal ones (e.g. Agent Assistant)
  const filteredProjects = projects.filter(p => !p.isInternal);

  // Get sessions for a specific project
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
          // Non-git project or error — store empty array
          setWorktreesByProject(prev => new Map(prev).set(projectId, []));
        });
      }
    }
  }, [expandedProjects, worktreesByProject]);

  // Group sessions by worktree for a project (returns [] if flat list should be used)
  const getWorktreeGroupsForProject = useCallback((projectId: string) => {
    const projectSessions = sessionsByProject.get(projectId) || [];
    const project = projects.find(p => p.id === projectId);
    const worktrees = worktreesByProject.get(projectId) || [];
    return groupSessionsByWorktree(projectSessions, project?.rootPath, worktrees);
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
    if (groups.length === 0) return; // flat list mode
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
    // Don't select project on toggle - only toggle expand/collapse state
    // This prevents unnecessary re-renders of ChatInterface and MessageList
  };

  const isConnected = connectionStatus === 'connected';

  const handleActiveSessionSelect = useCallback((backendId: string, sessionId: string) => {
    useUIStore.getState().requestForceScrollToBottom(sessionId);
    const selectWithServerContext = (targetServerId: string) => {
      const current = useServerStore.getState().activeServerId;
      if (current === targetServerId) {
        selectSession(sessionId);
        return;
      }
      // Switch server first, then select session on next tick to reduce
      // cross-server stale reads during context transitions.
      setActiveServer(targetServerId);
      setTimeout(() => selectSession(sessionId), 0);
    };

    // Switch to the matching server context first, then select session.
    if (backendId === 'local' || backendId === '__local__') {
      selectWithServerContext('local');
      return;
    }

    selectWithServerContext(backendId);
  }, [setActiveServer, selectSession]);

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
      // Auto-expand and select the new project
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

  // Compute fixed position for project context menu and keep it inside viewport.
  const openContextMenu = (e: React.MouseEvent, _type: 'project', id: string) => {
    e.stopPropagation();
    const clickX = e.clientX;
    const clickY = e.clientY;
    const menuWidth = isMobile ? 176 : 144; // w-44 / w-36
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

  const sidebarSwipeRef = useSwipeBack({
    onSwipe: () => onClose?.(),
    enabled: isMobile && !!isOpen,
    direction: 'left',
    fullWidth: true,
    threshold: 60,
  });

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
          {/* Header with close button */}
          <div className="h-[72px] border-b border-border flex items-center justify-between px-4">
            <h1 className="font-semibold text-lg">MyClaudia</h1>
            <button
              onClick={onClose}
              className="p-2 min-w-[44px] min-h-[44px] rounded hover:bg-secondary active:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center"
              title="Close menu"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Server Selector */}
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <ServerSelector />
              </div>
              <button
                onClick={() => {
                  onOpenNotifications?.();
                  onClose?.();
                }}
                className={`relative h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-full transition-colors ${
                  isNotificationsOpen ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
                title="Notifications"
                aria-label="Open notifications"
              >
                <Bell size={18} strokeWidth={1.75} />
                {notificationUnreadCount > 0 && !isNotificationsOpen && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center bg-primary text-primary-foreground text-[9px] font-medium rounded-full px-0.5">
                    {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  setClaudiaExpanded(true);
                  onClose?.();
                }}
                className={`relative h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-full transition-colors ${
                  isClaudiaExpanded ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
                title="Open Claudia"
                aria-label="Open Claudia"
              >
                <BrandMark className="w-[18px] h-[18px] object-contain" />
                {(hasClaudiaPermissionPending || hasClaudiaUnread || hasClaudiaRunning) && !isClaudiaExpanded && (
                  <span
                    className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                      hasClaudiaPermissionPending
                        ? 'bg-orange-500'
                        : hasClaudiaUnread
                        ? 'bg-primary animate-pulse'
                        : 'bg-amber-500 animate-pulse'
                    }`}
                  />
                )}
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-border relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={handleSearchFocus}
              onBlur={handleSearchBlur}
              placeholder="Search messages..."
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              className="w-full px-3 py-2.5 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
            />
          </div>

          {/* Search History */}
          {showSearchHistory && !searchQuery.trim() && searchHistory.length > 0 && (
            <div className="border-b border-border max-h-60 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2 bg-secondary/50">
                <span className="text-xs text-muted-foreground font-medium">Recent Searches</span>
                <button
                  onClick={handleClearHistory}
                  className="text-xs text-muted-foreground hover:text-foreground px-1"
                >
                  Clear
                </button>
              </div>
              {searchHistory.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => handleSelectHistoryItem(entry.query)}
                  className="w-full px-3 py-2.5 text-left text-sm hover:bg-secondary active:bg-secondary border-b border-border/50 last:border-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate flex-1">{entry.query}</span>
                    <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                      {entry.resultCount}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Search Results */}
          {searchQuery.trim() && (
            <div ref={searchResultsContainerRef} className="border-b border-border max-h-60 overflow-y-auto">
              {isSearching ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>
              ) : searchResults.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
              ) : (
                <>
                  {searchResults.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        requestMessageJump(r.sessionId, r.id);
                        selectSession(r.sessionId);
                        setSearchQuery('');
                        setSearchResults([]);
                        if (onClose) onClose();
                      }}
                      className="w-full text-left px-3 py-2.5 text-xs hover:bg-secondary active:bg-secondary border-b border-border/50 last:border-0"
                    >
                      <div className="font-medium text-foreground truncate">{r.sessionName || 'Untitled'}</div>
                      <div className="text-muted-foreground mt-0.5 line-clamp-2 whitespace-normal break-words">
                        {normalizeSearchPreview(r.content)}
                      </div>
                      {r.resultType && r.resultType !== 'message' && (
                        <div className="text-xs text-primary mt-1">
                          {r.resultType === 'file' ? <span className="inline-flex items-center gap-1"><FileText size={11} strokeWidth={1.75} /> File</span> : <span className="inline-flex items-center gap-1"><Wrench size={11} strokeWidth={1.75} /> Tool</span>}
                        </div>
                      )}
                    </button>
                  ))}
                  {hasMoreResults && (
                    <button
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      className="w-full px-3 py-2 text-xs text-primary hover:bg-secondary disabled:opacity-50"
                    >
                      {isLoadingMore ? 'Loading...' : `Load More (${searchResults.length} shown)`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Project List */}
          <div className="flex-1 overflow-y-auto scrollbar-hidden p-2">

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
                    <div className="flex items-center group relative">
                      <button
                        onClick={() => toggleProject(project.id)}
                        className="flex-1 min-w-0 min-h-[36px] text-left px-1 text-sm flex items-center gap-1.5 text-foreground"
                      >
                        <svg
                          className={`w-3 h-3 flex-shrink-0 transition-transform text-muted-foreground/60 ${
                            expandedProjects.has(project.id) ? 'rotate-90' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                        <span className="truncate text-sm font-bold uppercase tracking-wider text-foreground/80">{project.name}</span>
                        {v2Agents[project.id] && (
                          <span className={`ml-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                            v2Agents[project.id].phase === 'active' ? 'bg-green-500 animate-pulse' :
                            v2Agents[project.id].phase === 'paused' ? 'bg-yellow-500' :
                            'bg-gray-400'
                          }`} />
                        )}
                      </button>
                      {/* Project menu button */}
                      {(
                        <button
                          onClick={(e) => openContextMenu(e, 'project', project.id)}
                          className="w-8 h-8 rounded hover:bg-secondary active:bg-secondary flex-shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100"
                        >
                          <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                      )}

                      {/* Project context menu */}
                      {contextMenuProject === project.id && contextMenuPos && (
                        createPortal(
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setContextMenuProject(null)} />
                            <div className="fixed w-44 bg-popover border border-border rounded-lg shadow-lg z-50" style={{ top: contextMenuPos.top, left: contextMenuPos.left }}>
                              <button
                                onClick={() => {
                                  setSettingsProjectId(project.id);
                                  setContextMenuProject(null);
                                }}
                                className="w-full text-left px-3 py-3 text-sm hover:bg-secondary active:bg-secondary flex items-center gap-2"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                Settings
                              </button>
                              <button
                                onClick={() => {
                                  setCreatingSessionForProject(project.id);
                                  setContextMenuProject(null);
                                }}
                                disabled={!isConnected}
                                className="w-full text-left px-3 py-3 text-sm hover:bg-secondary active:bg-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                New Session
                              </button>
                              <button
                                onClick={() => handleDeleteProject(project.id)}
                                className="w-full text-left px-3 py-3 text-sm text-destructive hover:bg-secondary active:bg-secondary flex items-center gap-2"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                Delete
                              </button>
                            </div>
                          </>,
                          document.body
                        )
                      )}
                    </div>

                    {/* Sessions */}
                    {expandedProjects.has(project.id) && (() => {
                      const projectSessions = getFilteredSessionsForProject(project.id);
                      const { mainSession, taskSessions, regularSessions } = splitProjectSessions(projectSessions);
                      const worktrees = worktreesByProject.get(project.id) || [];
                      const regularSessionIds = new Set(regularSessions.map((session) => session.id));
                      const groups = groupSessionsByWorktree(projectSessions, project.rootPath, worktrees)
                        .map((group) => ({
                          ...group,
                          sessions: group.sessions.filter((session) => regularSessionIds.has(session.id)),
                        }))
                        .filter((group) => group.sessions.length > 0);
                      const renderSession = (session: typeof sessions[0]) => (
                        <SessionItem
                          key={session.id}
                          session={session}
                          isSelected={selectedSessionId === session.id}
                          onSelect={(id) => { selectSession(id); if (onClose) onClose(); }}
                          hasPending={hasPendingForSession(session.id)}
                          isActive={activeRunSessionIds.has(session.id)}
                          providerName={getProviderName(session)}
                          worktreeBranch={getWorktreeBranch(session, projects.find(p => p.id === session.projectId))}
                          isMobile
                        />
                      );

                      const renderSortableSessions = (sessionList: typeof sessions, className = 'space-y-0.5') => (
                        <SortableList
                          items={sessionList.map((s) => s.id)}
                          onReorder={(ordered) => handleReorderSessions(project.id, ordered)}
                          className={className}
                        >
                          {sessionList.map((session) => (
                            <SortableItem key={session.id} id={session.id} dragHandleClassName="w-3 h-3 -ml-0.5 mr-0.5">
                              {renderSession(session)}
                            </SortableItem>
                          ))}
                        </SortableList>
                      );

                      const isCollapsed = regularSessionsCollapsed.has(project.id);
                      const renderRegularSessions = () => {
                        if (regularSessions.length === 0) return null;
                        if (groups.length === 0) {
                          return renderSortableSessions(regularSessions);
                        }
                        return groups.map(group => (
                          <WorktreeGroupItem
                            key={group.key}
                            group={group}
                            isExpanded={expandedWorktrees.has(`${project.id}:${group.key}`)}
                            onToggle={() => toggleWorktree(`${project.id}:${group.key}`)}
                            isMobile
                          >
                            {renderSortableSessions(group.sessions)}
                          </WorktreeGroupItem>
                        ));
                      };

                      return (
                        <div className="ml-1 mt-0.5" data-testid="session-list">
                          {mainSession && (
                            <SupervisorGroupItem
                              key={mainSession.id}
                              onSelect={() => {
                                if (onOpenDashboard) onOpenDashboard(project.id);
                                if (onClose) onClose();
                              }}
                              isSelected={selectedSessionId === mainSession.id}
                              isActive={activeRunSessionIds.has(mainSession.id)}
                              phase={v2Agents[project.id]?.phase}
                              taskCount={taskSessions.length}
                              taskChildren={taskSessions.length > 0 ? renderSortableSessions(taskSessions) : null}
                            />
                          )}
                          {regularSessions.length > 0 && mainSession && (
                            <div className="mt-1">
                              <button
                                onClick={() => toggleRegularSessions(project.id)}
                                className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                                  Sessions
                                </span>
                                <span className="text-[10px] text-muted-foreground/50">
                                  {regularSessions.length}
                                </span>
                                <svg
                                  className={`ml-auto w-2.5 h-2.5 opacity-40 transition-transform duration-200 ${!isCollapsed ? 'rotate-90' : ''}`}
                                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                              {!isCollapsed && (
                                <div className="mt-0.5">
                                  {renderRegularSessions()}
                                </div>
                              )}
                            </div>
                          )}
                          {!mainSession && renderRegularSessions()}

                          {/* New session form */}
                          {creatingSessionForProject === project.id && (
                            <div>
                            <input
                              type="text"
                              value={newSessionName}
                              onChange={(e) => setNewSessionName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreateSession(project.id);
                                if (e.key === 'Escape') {
                                  setCreatingSessionForProject(null);
                                  setNewSessionName('');
                                  setNewSessionProviderId('');
                                }
                              }}
                              placeholder="Session name (optional)"
                              className="w-full px-3 py-2.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                              autoFocus
                            />
                            {providers.length > 0 && (
                              <select
                                value={newSessionProviderId}
                                onChange={(e) => setNewSessionProviderId(e.target.value)}
                                className="w-full px-3 py-2.5 mt-2 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                              >
                                <option value="">Default (from project)</option>
                                {providers.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.type}){p.isDefault ? ' *' : ''}
                                  </option>
                                ))}
                              </select>
                            )}
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleCreateSession(project.id)}
                                className="flex-1 px-3 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 rounded-lg text-sm"
                              >
                                Create
                              </button>
                              <button
                                onClick={() => {
                                  setCreatingSessionForProject(null);
                                  setNewSessionName('');
                                  setNewSessionProviderId('');
                                }}
                                className="flex-1 px-3 py-2.5 bg-muted/60 hover:bg-muted active:bg-muted/80 rounded-lg text-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                    })()}
                  </SortableItem>
                ))}
              </SortableList>
            )}

            {/* New Project */}
            {showNewProjectForm ? (
              <div className="mt-1 px-1">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowNewProjectForm(false);
                      setNewProjectName('');
                      setNewProjectRootPath('');
                    }
                  }}
                  placeholder="Project name"
                  className="w-full px-3 py-2.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  autoFocus
                />
                <input
                  type="text"
                  value={newProjectRootPath}
                  onChange={(e) => setNewProjectRootPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateProject();
                    if (e.key === 'Escape') {
                      setShowNewProjectForm(false);
                      setNewProjectName('');
                      setNewProjectRootPath('');
                    }
                  }}
                  placeholder="Working directory (e.g. /path/to/project)"
                  className="w-full px-3 py-2.5 mt-1 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim() || creatingProject}
                    className="flex-1 px-3 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 rounded-lg text-sm disabled:opacity-50"
                  >
                    {creatingProject ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setShowNewProjectForm(false);
                      setNewProjectName('');
                      setNewProjectRootPath('');
                    }}
                    className="flex-1 px-3 py-2.5 bg-muted/60 hover:bg-muted active:bg-muted/80 rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowNewProjectForm(true)}
                disabled={!isConnected}
                className="w-full mt-1 min-h-[36px] text-left px-1 text-sm flex items-center gap-1.5 text-muted-foreground/50 hover:text-muted-foreground active:text-muted-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-[11px] tracking-wide">New Project</span>
              </button>
            )}
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

          {/* Settings */}
          <div className="border-t border-border p-2">
            <button
              onClick={() => setShowSettings(true)}
              data-testid="settings-button"
              className="w-full text-left px-3 py-3 rounded text-sm text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground flex items-center gap-2"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Settings
            </button>
          </div>

        </div>

        {/* Portaled modals: render outside glass container to avoid stacking context issues */}
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
      </>
    );
  }

  // Desktop: use CSS to show/hide sidebar instead of unmounting
  // This avoids expensive remounting and improves toggle performance
  return (
    <>
    <div
      className={`bg-card/80 glass border-r border-border/50 flex flex-col transition-[width] duration-200 ease-out ${
        collapsed ? 'w-0 overflow-hidden' : 'w-64'
      }`}
    >
      {/* Only render content when not collapsed to improve performance */}
      {!collapsed && (
        <>
      {/* Header - only shown if hideHeader is false */}
      {!hideHeader && (
        <div
          className="h-16 flex items-center justify-between pl-3 pr-3 mt-6"
          data-tauri-drag-region
        >
          <div className="flex items-center gap-2" data-tauri-drag-region>
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Bot size={18} strokeWidth={1.75} className="text-primary" />
            </div>
            <div className="flex flex-col" data-tauri-drag-region>
              <h1 className="font-semibold text-base text-foreground leading-tight" data-tauri-drag-region>MyClaudia</h1>
              <span className="text-xs text-muted-foreground">AI Assistant</span>
            </div>
          </div>
          <button
            onClick={onToggle}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
            title="Collapse sidebar"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2 relative">
        <div className="flex items-center gap-1">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            placeholder="Search messages..."
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className="flex-1 px-2.5 py-1.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-1 rounded hover:bg-secondary ${showFilters ? 'bg-secondary text-primary' : 'text-muted-foreground'}`}
            title="Filters"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>
        </div>

        {/* Search History Dropdown */}
        {showSearchHistory && !searchQuery.trim() && searchHistory.length > 0 && (
          <div className="absolute top-full left-3 right-3 mt-1 bg-card border border-border rounded shadow-lg z-50 max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
              <span className="text-xs text-muted-foreground font-medium">Recent Searches</span>
              <button
                onClick={handleClearHistory}
                className="text-xs text-muted-foreground hover:text-foreground px-1"
              >
                Clear
              </button>
            </div>
            {searchHistory.map((entry) => (
              <button
                key={entry.id}
                onClick={() => handleSelectHistoryItem(entry.query)}
                className="w-full px-2 py-1.5 text-left text-sm hover:bg-secondary flex items-center justify-between group"
              >
                <span className="truncate flex-1">{entry.query}</span>
                <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                  {entry.resultCount} results
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Search Filters */}
        {showFilters && (
          <div className="absolute top-full left-3 right-3 mt-1 z-50">
            <SearchFilters
              filters={searchFilters}
              sessions={sessions}
              onFiltersChange={handleFiltersChange}
              onClose={() => setShowFilters(false)}
            />
          </div>
        )}
      </div>

      {/* Search Results */}
      {searchQuery.trim() && (
        <div ref={searchResultsContainerRef} className="border-b border-border max-h-48 overflow-y-auto mx-2">
          {isSearching ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching...</div>
          ) : searchResults.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No results</div>
          ) : (
            <>
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    requestMessageJump(r.sessionId, r.id);
                    selectSession(r.sessionId);
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-secondary border-b border-border/50 last:border-0"
                >
                  <div className="font-medium text-foreground truncate">{r.sessionName || 'Untitled'}</div>
                  <div className="text-muted-foreground mt-0.5 line-clamp-2 whitespace-normal break-words">
                    {normalizeSearchPreview(r.content)}
                  </div>
                  {r.resultType && r.resultType !== 'message' && (
                    <div className="text-xs text-primary mt-0.5">
                      {r.resultType === 'file' ? <span className="inline-flex items-center gap-1"><FileText size={11} strokeWidth={1.75} /> File</span> : <span className="inline-flex items-center gap-1"><Wrench size={11} strokeWidth={1.75} /> Tool</span>}
                    </div>
                  )}
                </button>
              ))}
              {hasMoreResults && (
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="w-full px-2 py-1.5 text-xs text-primary hover:bg-secondary disabled:opacity-50"
                >
                  {isLoadingMore ? 'Loading...' : `Load More (${searchResults.length} shown)`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Project List */}
      <div className="flex-1 overflow-y-auto scrollbar-hidden p-2">

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
                <div className="flex items-center group relative">
                  <button
                    onClick={() => toggleProject(project.id)}
                    className="flex-1 min-w-0 h-7 text-left px-1 text-sm flex items-center gap-1.5"
                  >
                    <svg
                      className={`w-3 h-3 flex-shrink-0 transition-transform text-muted-foreground/60 ${
                        expandedProjects.has(project.id) ? 'rotate-90' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    <span className="truncate text-sm font-bold uppercase tracking-wider text-foreground/80">{project.name}</span>
                  </button>
                  {/* Project menu button */}
                  {(
                    <button
                      onClick={(e) => openContextMenu(e, 'project', project.id)}
                      className="w-6 h-6 rounded opacity-0 group-hover:opacity-100 hover:bg-secondary flex-shrink-0 flex items-center justify-center"
                    >
                      <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                      </svg>
                    </button>
                  )}

                  {/* Project context menu */}
                  {contextMenuProject === project.id && contextMenuPos && (
                  createPortal(
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setContextMenuProject(null)} />
                      <div className="fixed w-36 bg-popover border border-border rounded shadow-lg z-50" style={{ top: contextMenuPos.top, left: contextMenuPos.left }}>
                        <button
                          onClick={() => {
                            setSettingsProjectId(project.id);
                            setContextMenuProject(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Settings
                        </button>
                        <button
                          onClick={() => {
                            setCreatingSessionForProject(project.id);
                            setContextMenuProject(null);
                          }}
                          disabled={!isConnected}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          New Session
                        </button>
                        <button
                          onClick={() => handleDeleteProject(project.id)}
                          className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-secondary flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    </>,
                    document.body
                  )
                  )}
                </div>

                {/* Sessions */}
                {expandedProjects.has(project.id) && (() => {
                  const projectSessions = getFilteredSessionsForProject(project.id);
                  const { mainSession, taskSessions, regularSessions } = splitProjectSessions(projectSessions);
                  const worktrees = worktreesByProject.get(project.id) || [];
                  const regularSessionIds = new Set(regularSessions.map((session) => session.id));
                  const groups = groupSessionsByWorktree(projectSessions, project.rootPath, worktrees)
                    .map((group) => ({
                      ...group,
                      sessions: group.sessions.filter((session) => regularSessionIds.has(session.id)),
                    }))
                    .filter((group) => group.sessions.length > 0);
                  const renderSession = (session: typeof sessions[0]) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      isSelected={selectedSessionId === session.id}
                      onSelect={(id) => { selectSession(id); if (isMobile && onClose) onClose(); }}
                      hasPending={hasPendingForSession(session.id)}
                      isActive={activeRunSessionIds.has(session.id)}
                      providerName={getProviderName(session)}
                      worktreeBranch={getWorktreeBranch(session, projects.find(p => p.id === session.projectId))}
                      onPopOut={isDesktopTauri() && !isMobile ? () => openSessionInNewWindow(session.id, session.projectId) : undefined}
                    />
                  );

                  // Render a list of sessions with supervisor grouping applied
                  const renderSortableSessions = (sessionList: typeof sessions, className = 'space-y-0.5') => (
                    <SortableList
                      items={sessionList.map((s) => s.id)}
                      onReorder={(ordered) => handleReorderSessions(project.id, ordered)}
                      className={className}
                    >
                      {sessionList.map((session) => (
                        <SortableItem key={session.id} id={session.id} dragHandleClassName="w-3 h-3 -ml-0.5 mr-0.5">
                          {renderSession(session)}
                        </SortableItem>
                      ))}
                    </SortableList>
                  );

                  const isCollapsed = regularSessionsCollapsed.has(project.id);
                  const renderRegularSessions = () => {
                    if (regularSessions.length === 0) return null;
                    if (groups.length === 0) {
                      return renderSortableSessions(regularSessions);
                    }
                    return groups.map(group => (
                      <WorktreeGroupItem
                        key={group.key}
                        group={group}
                        isExpanded={expandedWorktrees.has(`${project.id}:${group.key}`)}
                        onToggle={() => toggleWorktree(`${project.id}:${group.key}`)}
                      >
                        {renderSortableSessions(group.sessions)}
                      </WorktreeGroupItem>
                    ));
                  };

                  return (
                    <div className="ml-1 mt-0.5" data-testid="session-list">
                      {mainSession && (
                        <SupervisorGroupItem
                          key={mainSession.id}
                          onSelect={() => {
                            if (onOpenDashboard) onOpenDashboard(project.id);
                          }}
                          isSelected={selectedSessionId === mainSession.id}
                          isActive={activeRunSessionIds.has(mainSession.id)}
                          phase={v2Agents[project.id]?.phase}
                          taskCount={taskSessions.length}
                          taskChildren={taskSessions.length > 0 ? renderSortableSessions(taskSessions) : null}
                        />
                      )}
                      {regularSessions.length > 0 && mainSession && (
                        <div className="mt-1">
                          <button
                            onClick={() => toggleRegularSessions(project.id)}
                            className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                              Sessions
                            </span>
                            <span className="text-[10px] text-muted-foreground/50">
                              {regularSessions.length}
                            </span>
                            <svg
                              className={`ml-auto w-2.5 h-2.5 opacity-40 transition-transform duration-200 ${!isCollapsed ? 'rotate-90' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          {!isCollapsed && (
                            <div className="mt-0.5">
                              {renderRegularSessions()}
                            </div>
                          )}
                        </div>
                      )}
                      {!mainSession && renderRegularSessions()}

                      {/* New session form */}
                      {creatingSessionForProject === project.id && (
                        <div className="mt-1">
                          <input
                          type="text"
                          value={newSessionName}
                          onChange={(e) => setNewSessionName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreateSession(project.id);
                            if (e.key === 'Escape') {
                              setCreatingSessionForProject(null);
                              setNewSessionName('');
                              setNewSessionProviderId('');
                            }
                          }}
                          placeholder="Session name (optional)"
                          className="w-full px-2 py-1.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                          autoFocus
                        />
                        {providers.length > 0 && (
                          <select
                            value={newSessionProviderId}
                            onChange={(e) => setNewSessionProviderId(e.target.value)}
                            className="w-full px-2 py-1.5 mt-1 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                          >
                            <option value="">Default (from project)</option>
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.type}){p.isDefault ? ' *' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        <div className="flex gap-1 mt-1.5">
                          <button
                            onClick={() => handleCreateSession(project.id)}
                            className="flex-1 px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-xs"
                          >
                            Create
                          </button>
                          <button
                            onClick={() => {
                              setCreatingSessionForProject(null);
                              setNewSessionName('');
                              setNewSessionProviderId('');
                            }}
                            className="flex-1 px-2 py-1 bg-muted/60 hover:bg-muted rounded-lg text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
                })()}
              </SortableItem>
            ))}
          </SortableList>
        )}

        {/* New Project */}
        {showNewProjectForm ? (
          <div className="mt-1 px-1">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowNewProjectForm(false);
                  setNewProjectName('');
                  setNewProjectRootPath('');
                }
              }}
              placeholder="Project name"
              className="w-full px-2 py-1.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              autoFocus
            />
            <input
              type="text"
              value={newProjectRootPath}
              onChange={(e) => setNewProjectRootPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateProject();
                if (e.key === 'Escape') {
                  setShowNewProjectForm(false);
                  setNewProjectName('');
                  setNewProjectRootPath('');
                }
              }}
              placeholder="Working directory (e.g. /path/to/project)"
              className="w-full px-2 py-1.5 mt-1 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <div className="flex gap-1 mt-1.5">
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || creatingProject}
                className="flex-1 px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-xs disabled:opacity-50"
              >
                {creatingProject ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setShowNewProjectForm(false);
                  setNewProjectName('');
                  setNewProjectRootPath('');
                }}
                className="flex-1 px-2 py-1 bg-muted/60 hover:bg-muted rounded-lg text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNewProjectForm(true)}
            disabled={!isConnected}
            className="w-full mt-1 h-7 text-left px-1 text-sm flex items-center gap-1.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-[11px] tracking-wide">New Project</span>
          </button>
        )}
      </div>

      {/* Active Sessions - Fixed at bottom */}
      <div className="flex-shrink-0">
        <ActiveSessionsPanel
          onSessionSelect={handleActiveSessionSelect}
        />
      </div>

      {/* Automations & Settings */}
      <div className="border-t border-border p-2 space-y-0.5">
        {onOpenAutomations && (
          <button
            onClick={() => {
              onOpenAutomations();
              if (onClose) onClose();
            }}
            className="w-full text-left px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-secondary hover:text-foreground flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Automations
          </button>
        )}
        <button
          onClick={() => setShowSettings(true)}
          data-testid="settings-button"
          className="w-full text-left px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-secondary hover:text-foreground flex items-center gap-2"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          Settings
        </button>
      </div>

      </>
    )}
    </div>
    {/* Portaled modals: render outside glass container to avoid stacking context issues */}
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
}
