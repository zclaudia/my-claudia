import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Bot, FileText, Wrench } from 'lucide-react';

const isDesktopTauri = typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && !navigator.userAgent.includes('Android');

async function openSessionInNewWindow(sessionId: string, projectId: string) {
  if (!isDesktopTauri) return;
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { getBaseUrl, getAuthHeaders } = await import('../services/api');
    const label = `session-chat-${Date.now()}`;
    const serverUrl = getBaseUrl();
    const authToken = (getAuthHeaders() as Record<string, string>)['Authorization'] || '';
    const params = new URLSearchParams({ sessionWindow: sessionId, projectId, serverUrl, authToken });
    new WebviewWindow(label, {
      url: `${window.location.origin}${window.location.pathname}?${params}`,
      title: 'Session',
      width: 900,
      height: 700,
      center: true,
      dragDropEnabled: false,
    });
    const { useUIStore } = await import('../stores/uiStore');
    useUIStore.getState().addPoppedOutSession(sessionId, label);
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
import { toGatewayServerId } from '../stores/gatewayStore';
import { useSupervisionStore } from '../stores/supervisionStore';
import { usePermissionStore } from '../stores/permissionStore';
import { useAskUserQuestionStore } from '../stores/askUserQuestionStore';
import { useChatStore } from '../stores/chatStore';
import { useSwipeBack } from '../hooks/useSwipeBack';
import { useUIStore } from '../stores/uiStore';
import { ProjectSettings } from './ProjectSettings';
import { SettingsPanel } from './SettingsPanel';
import { SearchFilters } from './SearchFilters';
import { ActiveSessionsPanel } from './ActiveSessionsPanel';
import { ServerSelector } from './ServerSelector';
import { PluginPermissionDialog } from './PluginPermissionDialog';
import { SessionItem } from './sidebar/SessionItem';
import { WorktreeGroupItem } from './sidebar/WorktreeGroupItem';
import { SupervisorGroupItem } from './sidebar/SupervisorGroupItem';
import { groupSessionsByWorktree } from './sidebar/worktreeGrouping';
import * as api from '../services/api';
import type { SearchResult, SearchHistoryEntry, SearchFilters as Filters } from '../services/api';
import type { GitWorktree } from '@my-claudia/shared';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  hideHeader?: boolean;
  onOpenDashboard?: (projectId: string) => void;
}

function normalizeSearchPreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized || 'No preview text';
}

export function Sidebar({ collapsed, onToggle, isMobile, isOpen, onClose, hideHeader, onOpenDashboard }: SidebarProps) {
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
  } = useProjectStore();

  const { connectionStatus, setActiveServer, servers, getDefaultServer } = useServerStore();
  const v2Agents = useSupervisionStore((s) => s.agents);

  // Sessions with pending permission or question requests
  const permSessionIds = usePermissionStore(s => new Set(s.pendingRequests.map(r => r.sessionId)));
  const questionSessionIds = useAskUserQuestionStore(s => new Set(s.pendingRequests.map(r => r.sessionId)));
  const hasPendingForSession = useCallback((sessionId: string) => {
    return permSessionIds.has(sessionId) || questionSessionIds.has(sessionId);
  }, [permSessionIds, questionSessionIds]);

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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [searchFilters, setSearchFilters] = useState<Filters>({});
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [expandedWorktrees, setExpandedWorktrees] = useState<Set<string>>(new Set());
  const [regularSessionsCollapsed, setRegularSessionsCollapsed] = useState<Set<string>>(new Set());
  const [worktreesByProject, setWorktreesByProject] = useState<Map<string, GitWorktree[]>>(new Map());
  const searchTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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
      const localServerId = servers.find((s) => s.id === 'local')?.id
        || getDefaultServer()?.id
        || servers[0]?.id
        || 'local';
      selectWithServerContext(localServerId);
      return;
    }

    selectWithServerContext(toGatewayServerId(backendId));
  }, [servers, getDefaultServer, setActiveServer, selectSession]);

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


  // Load search history on mount
  useEffect(() => {
    const loadSearchHistory = async () => {
      try {
        const history = await api.getSearchHistory();
        setSearchHistory(history);
      } catch (error) {
        console.error('Failed to load search history:', error);
      }
    };
    loadSearchHistory();
  }, []);

  const handleSearch = useCallback((query: string, filters?: Filters) => {
    setSearchQuery(query);
    setShowSearchHistory(false); // Hide history when typing
    setSearchOffset(0); // Reset offset for new search
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setHasMoreResults(false);
      return;
    }
    setIsSearching(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const filtersToUse = filters || searchFilters;
        const pageSize = 50;
        const results = await api.searchMessages(query.trim(), { ...filtersToUse, limit: pageSize, offset: 0 });
        setSearchResults(results);
        setHasMoreResults(results.length === pageSize); // If we got full page, there might be more
        // Reload search history after search
        const history = await api.getSearchHistory();
        setSearchHistory(history);
      } catch (error) {
        console.error('Search failed:', error);
        setSearchResults([]);
        setHasMoreResults(false);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, [searchFilters]);

  const handleLoadMore = useCallback(async () => {
    if (!searchQuery.trim() || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const pageSize = 50;
      const newOffset = searchOffset + pageSize;
      const results = await api.searchMessages(searchQuery.trim(), {
        ...searchFilters,
        limit: pageSize,
        offset: newOffset
      });

      setSearchResults(prev => [...prev, ...results]);
      setSearchOffset(newOffset);
      setHasMoreResults(results.length === pageSize);
    } catch (error) {
      console.error('Load more failed:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [searchQuery, searchFilters, searchOffset, isLoadingMore]);

  const handleSelectHistoryItem = useCallback((query: string) => {
    handleSearch(query);
    setShowSearchHistory(false);
  }, [handleSearch]);

  const handleSearchFocus = useCallback(() => {
    if (!searchQuery.trim() && searchHistory.length > 0) {
      setShowSearchHistory(true);
    }
  }, [searchQuery, searchHistory.length]);

  const handleSearchBlur = useCallback(() => {
    // Delay hiding to allow clicking on history items
    setTimeout(() => setShowSearchHistory(false), 200);
  }, []);

  const handleClearHistory = useCallback(async () => {
    try {
      await api.clearSearchHistory();
      setSearchHistory([]);
      setShowSearchHistory(false);
    } catch (error) {
      console.error('Failed to clear search history:', error);
    }
  }, []);

  const handleFiltersChange = useCallback((filters: Filters) => {
    setSearchFilters(filters);
    // Re-run search with new filters if there's a query
    if (searchQuery.trim()) {
      handleSearch(searchQuery, filters);
    }
  }, [searchQuery, handleSearch]);

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
            <ServerSelector />
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
            <div className="border-b border-border max-h-60 overflow-y-auto">
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
              <ul className="space-y-2">
                {filteredProjects.map((project) => (
                  <li key={project.id}>
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
                      const groups = getWorktreeGroupsForProject(project.id);
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

                      const renderWithSupervisorGroups = (sessionList: typeof sessions) => {
                        const tasksByParent = new Map<string, typeof sessions>();
                        let mainSession: (typeof sessions)[number] | null = null;
                        const regularSessions: typeof sessions = [];
                        for (const s of sessionList) {
                          if (s.projectRole === 'task' && s.parentSessionId) {
                            const list = tasksByParent.get(s.parentSessionId) || [];
                            list.push(s);
                            tasksByParent.set(s.parentSessionId, list);
                          } else if (s.projectRole === 'main') {
                            mainSession = s;
                          } else {
                            regularSessions.push(s);
                          }
                        }
                        if (mainSession) {
                          const tasks = tasksByParent.get(mainSession.id) || [];
                          const isCollapsed = regularSessionsCollapsed.has(project.id);
                          return (
                            <>
                              <SupervisorGroupItem
                                key={mainSession.id}
                                onSelect={() => {
                                  if (onOpenDashboard) onOpenDashboard(project.id);
                                  if (onClose) onClose();
                                }}
                                isSelected={selectedSessionId === mainSession!.id}
                                isActive={activeRunSessionIds.has(mainSession!.id)}
                                phase={v2Agents[project.id]?.phase}
                                taskCount={tasks.length}
                                taskChildren={tasks.map(renderSession)}
                              />
                              {regularSessions.length > 0 && (
                                <li className="mt-1">
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
                                    <ul className="mt-0.5 space-y-0.5">
                                      {regularSessions.map(renderSession)}
                                    </ul>
                                  )}
                                </li>
                              )}
                            </>
                          );
                        }
                        // No supervisor — render flat
                        return sessionList.map(renderSession);
                      };

                      return (
                        <div className="ml-1 mt-0.5" data-testid="session-list">
                          {groups.length === 0 ? (
                            // Flat list (no worktree grouping)
                            <ul className="space-y-0.5">
                              {renderWithSupervisorGroups(getFilteredSessionsForProject(project.id))}
                            </ul>
                          ) : (
                            // Tree view grouped by worktree
                            groups.map(group => (
                              <WorktreeGroupItem
                                key={group.key}
                                group={group}
                                isExpanded={expandedWorktrees.has(`${project.id}:${group.key}`)}
                                onToggle={() => toggleWorktree(`${project.id}:${group.key}`)}
                                isMobile
                              >
                                {renderWithSupervisorGroups(group.sessions)}
                              </WorktreeGroupItem>
                            ))
                          )}

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
                  </li>
                ))}
              </ul>
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
        <div className="border-b border-border max-h-48 overflow-y-auto mx-2">
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
          <ul className="space-y-2">
            {filteredProjects.map((project) => (
              <li key={project.id}>
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
                  const groups = getWorktreeGroupsForProject(project.id);
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
                      onPopOut={isDesktopTauri && !isMobile ? () => openSessionInNewWindow(session.id, session.projectId) : undefined}
                    />
                  );

                  // Render a list of sessions with supervisor grouping applied
                  const renderWithSupervisorGroups = (sessionList: typeof sessions) => {
                    // Collect task sessions keyed by parent, and find main session
                    const tasksByParent = new Map<string, typeof sessions>();
                    let mainSession: (typeof sessions)[number] | null = null;
                    const regularSessions: typeof sessions = [];

                    for (const s of sessionList) {
                      if (s.projectRole === 'task' && s.parentSessionId) {
                        const list = tasksByParent.get(s.parentSessionId) || [];
                        list.push(s);
                        tasksByParent.set(s.parentSessionId, list);
                      } else if (s.projectRole === 'main') {
                        mainSession = s;
                      } else {
                        regularSessions.push(s);
                      }
                    }

                    // When a supervisor main session exists, show it + collapsible Sessions group
                    if (mainSession) {
                      const tasks = tasksByParent.get(mainSession.id) || [];
                      const isCollapsed = regularSessionsCollapsed.has(project.id);
                      return (
                        <>
                          <SupervisorGroupItem
                            key={mainSession.id}
                            onSelect={() => {
                              if (onOpenDashboard) onOpenDashboard(project.id);
                            }}
                            isSelected={selectedSessionId === mainSession!.id}
                            isActive={activeRunSessionIds.has(mainSession!.id)}
                            phase={v2Agents[project.id]?.phase}
                            taskCount={tasks.length}
                            taskChildren={tasks.map(renderSession)}
                          />
                          {regularSessions.length > 0 && (
                            <li className="mt-1">
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
                                <ul className="mt-0.5 space-y-0.5">
                                  {regularSessions.map(renderSession)}
                                </ul>
                              )}
                            </li>
                          )}
                        </>
                      );
                    }

                    // No supervisor — render flat
                    return sessionList.map(renderSession);
                  };

                  return (
                    <div className="ml-1 mt-0.5" data-testid="session-list">
                      {groups.length === 0 ? (
                        // Flat list (no worktree grouping)
                        <ul className="space-y-0.5">
                          {renderWithSupervisorGroups(getFilteredSessionsForProject(project.id))}
                        </ul>
                      ) : (
                        // Tree view grouped by worktree
                        groups.map(group => (
                          <WorktreeGroupItem
                            key={group.key}
                            group={group}
                            isExpanded={expandedWorktrees.has(`${project.id}:${group.key}`)}
                            onToggle={() => toggleWorktree(`${project.id}:${group.key}`)}
                          >
                            {renderWithSupervisorGroups(group.sessions)}
                          </WorktreeGroupItem>
                        ))
                      )}

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
              </li>
            ))}
          </ul>
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

      {/* Settings */}
      <div className="border-t border-border p-2">
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
