import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useServerStore } from '../stores/serverStore';
import { ProjectSettings } from './ProjectSettings';
import { SettingsPanel } from './SettingsPanel';
import { SearchFilters } from './SearchFilters';
import { ActiveSessionsPanel } from './ActiveSessionsPanel';
import * as api from '../services/api';
import type { SearchResult, SearchHistoryEntry, SearchFilters as Filters } from '../services/api';
import { filterSessions } from '../utils/filterHelpers';
import type { FilterState } from '../types/filter';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  hideHeader?: boolean;
}

export function Sidebar({ collapsed, onToggle, isMobile, isOpen, onClose, hideHeader }: SidebarProps) {
  const {
    projects = [],
    sessions = [],
    selectedProjectId,
    selectedSessionId,
    selectProject,
    selectSession,
    addProject,
    addSession,
    deleteProject,
    deleteSession,
    updateSession,
  } = useProjectStore();

  const { connectionStatus, setActiveServer } = useServerStore();

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectRootPath, setNewProjectRootPath] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingSessionForProject, setCreatingSessionForProject] = useState<string | null>(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [contextMenuProject, setContextMenuProject] = useState<string | null>(null);
  const [contextMenuSession, setContextMenuSession] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameSessionValue, setRenameSessionValue] = useState('');
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
  const searchTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const settingsProject = settingsProjectId ? projects?.find(p => p.id === settingsProjectId) || null : null;

  // Memoize sessions grouped by project ID to avoid repeated filtering
  // This significantly improves performance when toggling project expansion
  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, typeof sessions>();
    sessions.forEach(session => {
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
        name: newSessionName.trim() || undefined
      });
      addSession(session);
      setNewSessionName('');
      setCreatingSessionForProject(null);
      selectSession(session.id);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
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

  const handleDeleteSession = async (sessionId: string) => {
    if (!isConnected) return;

    try {
      await api.deleteSession(sessionId);
      deleteSession(sessionId);
      setContextMenuSession(null);
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleRenameSession = async (sessionId: string) => {
    const newName = renameSessionValue.trim();
    if (!newName || !isConnected) {
      setRenamingSessionId(null);
      return;
    }
    try {
      await api.updateSession(sessionId, { name: newName });
      updateSession(sessionId, { name: newName });
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
    setRenamingSessionId(null);
  };

  const startRenamingSession = (sessionId: string, currentName: string) => {
    setRenamingSessionId(sessionId);
    setRenameSessionValue(currentName || '');
    setContextMenuSession(null);
  };

  const handleExportSession = useCallback(async (sessionId: string) => {
    try {
      const { markdown, sessionName } = await api.exportSession(sessionId);
      // Download as file
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sessionName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setContextMenuSession(null);
    } catch (error) {
      console.error('Failed to export session:', error);
    }
  }, []);

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
        <div className="fixed inset-y-0 left-0 w-64 bg-card z-50 shadow-xl flex flex-col">
          {/* Header with close button */}
          <div className="h-[72px] border-b border-border flex items-center justify-between px-4">
            <h1 className="font-semibold text-lg">My Claudia</h1>
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
                      <div className="text-muted-foreground mt-0.5 line-clamp-2">{r.content}</div>
                      {r.resultType && r.resultType !== 'message' && (
                        <div className="text-xs text-primary mt-1">
                          {r.resultType === 'file' ? '📄 File' : '🔧 Tool'}
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
            <div className="flex items-center gap-1.5 mb-2 px-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase leading-none">
                Projects
              </span>
              {(
                <button
                  onClick={() => setShowNewProjectForm(true)}
                  disabled={!isConnected}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-secondary active:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!isConnected ? "Connect to server first" : "Add Project"}
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
                      strokeWidth={2.5}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>
              )}
            </div>

            {/* New Project Form */}
            {showNewProjectForm && (
              <div className="mb-2 px-2">
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
                  className="w-full px-3 py-2.5 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
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
                  className="w-full px-3 py-2.5 mt-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim() || creatingProject}
                    className="flex-1 px-3 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 rounded text-sm disabled:opacity-50"
                  >
                    {creatingProject ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setShowNewProjectForm(false);
                      setNewProjectName('');
                      setNewProjectRootPath('');
                    }}
                    className="flex-1 px-3 py-2.5 bg-secondary hover:bg-secondary/80 active:bg-secondary/70 rounded text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground px-2">No projects yet</p>
            ) : filteredProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground px-2">No active sessions</p>
            ) : (
              <ul className="space-y-0.5">
                {filteredProjects.map((project) => (
                  <li key={project.id}>
                    <div className="flex items-center group relative">
                      <button
                        onClick={() => toggleProject(project.id)}
                        className={`flex-1 min-w-0 min-h-[44px] text-left px-2 rounded text-sm flex items-center gap-2 ${
                          selectedProjectId === project.id
                            ? 'bg-secondary text-foreground'
                            : 'text-muted-foreground hover:bg-secondary active:bg-secondary'
                        }`}
                      >
                        <svg
                          className={`w-4 h-4 flex-shrink-0 transition-transform ${
                            expandedProjects.has(project.id) ? 'rotate-90' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                        <span className="truncate font-semibold">{project.name}</span>
                      </button>
                      {/* Project menu button */}
                      {(
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setContextMenuProject(contextMenuProject === project.id ? null : project.id);
                          }}
                          className="w-10 h-10 rounded hover:bg-secondary active:bg-secondary flex-shrink-0 flex items-center justify-center"
                        >
                          <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                      )}

                      {/* Project context menu */}
                      {contextMenuProject === project.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setContextMenuProject(null)} />
                          <div className="absolute right-0 top-full mt-1 w-44 bg-popover border border-border rounded-lg shadow-lg z-50">
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
                        </>
                      )}
                    </div>

                    {/* Sessions */}
                    {expandedProjects.has(project.id) && (
                      <ul className="ml-6 mt-1 space-y-1" data-testid="session-list">
                        {getFilteredSessionsForProject(project.id)
                          .map((session) => (
                            <li key={session.id} className="relative group" data-testid="session-item">
                              <div className="flex items-center">
                                {renamingSessionId === session.id ? (
                                  <input
                                    autoFocus
                                    type="text"
                                    value={renameSessionValue}
                                    onChange={(e) => setRenameSessionValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleRenameSession(session.id);
                                      if (e.key === 'Escape') setRenamingSessionId(null);
                                    }}
                                    onBlur={() => handleRenameSession(session.id)}
                                    className="flex-1 min-w-0 min-h-[44px] px-2 rounded text-sm bg-secondary border border-border text-foreground outline-none"
                                  />
                                ) : (
                                  <button
                                    onClick={() => {
                                      selectSession(session.id);
                                      if (onClose) onClose();
                                    }}
                                    className={`flex-1 min-w-0 min-h-[44px] text-left px-2 rounded text-sm truncate flex items-center ${
                                      selectedSessionId === session.id
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground'
                                    }`}
                                  >
                                    {session.name || 'Untitled Session'}
                                  </button>
                                )}
                                {/* Session menu button */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setContextMenuSession(contextMenuSession === session.id ? null : session.id);
                                  }}
                                  className="w-10 h-10 rounded hover:bg-secondary active:bg-secondary flex-shrink-0 flex items-center justify-center"
                                >
                                  <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                                  </svg>
                                </button>
                              </div>

                              {/* Session context menu */}
                              {contextMenuSession === session.id && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setContextMenuSession(null)} />
                                  <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-border rounded-lg shadow-lg z-50">
                                    <button
                                      onClick={() => startRenamingSession(session.id, session.name || '')}
                                      className="w-full text-left px-3 py-3 text-sm hover:bg-secondary active:bg-secondary"
                                    >
                                      Rename
                                    </button>
                                    <button
                                      onClick={() => handleExportSession(session.id)}
                                      className="w-full text-left px-3 py-3 text-sm hover:bg-secondary active:bg-secondary"
                                    >
                                      Export Markdown
                                    </button>
                                    <button
                                      onClick={() => handleDeleteSession(session.id)}
                                      className="w-full text-left px-3 py-3 text-sm text-destructive hover:bg-secondary active:bg-secondary"
                                    >
                                      Delete Session
                                    </button>
                                  </div>
                                </>
                              )}
                            </li>
                          ))}

                        {/* New session form */}
                        {creatingSessionForProject === project.id && (
                          <li>
                            <input
                              type="text"
                              value={newSessionName}
                              onChange={(e) => setNewSessionName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreateSession(project.id);
                                if (e.key === 'Escape') {
                                  setCreatingSessionForProject(null);
                                  setNewSessionName('');
                                }
                              }}
                              placeholder="Session name (optional)"
                              className="w-full px-3 py-2.5 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
                              autoFocus
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleCreateSession(project.id)}
                                className="flex-1 px-3 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 rounded text-sm"
                              >
                                Create
                              </button>
                              <button
                                onClick={() => {
                                  setCreatingSessionForProject(null);
                                  setNewSessionName('');
                                }}
                                className="flex-1 px-3 py-2.5 bg-secondary hover:bg-secondary/80 active:bg-secondary/70 rounded text-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Active Sessions - Fixed at bottom */}
          <div className="flex-shrink-0">
            <ActiveSessionsPanel
              onSessionSelect={(backendId, sessionId) => {
                // Handle session selection - switch backend if needed, then select session
                if (backendId === 'local' || backendId === '__local__') {
                  // Local session - just select it
                  selectSession(sessionId);
                } else {
                  // Remote session - switch to the backend first, then select session
                  setActiveServer(`gateway:${backendId}`);
                  selectSession(sessionId);
                }
                if (onClose) onClose();
              }}
            />
          </div>

          {/* Settings Button */}
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

          {/* Project Settings Modal */}
          <ProjectSettings
            project={settingsProject}
            isOpen={!!settingsProjectId}
            onClose={() => setSettingsProjectId(null)}
          />

          {/* Settings Panel */}
          <SettingsPanel
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
          />
        </div>
      </>
    );
  }

  // Desktop: use CSS to show/hide sidebar instead of unmounting
  // This avoids expensive remounting and improves toggle performance
  return (
    <div
      className={`bg-card border-r border-border flex flex-col transition-[width] duration-150 ease-out ${
        collapsed ? 'w-0 overflow-hidden' : 'w-64'
      }`}
    >
      {/* Only render content when not collapsed to improve performance */}
      {!collapsed && (
        <>
      {/* Header - only shown if hideHeader is false */}
      {!hideHeader && (
        <div
          className="h-16 flex items-center justify-between pl-20 pr-3 mt-6"
          data-tauri-drag-region
        >
          <div className="flex items-center gap-2" data-tauri-drag-region>
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="text-lg">🤖</span>
            </div>
            <div className="flex flex-col" data-tauri-drag-region>
              <h1 className="font-semibold text-base text-foreground leading-tight" data-tauri-drag-region>My Claudia</h1>
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
            className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
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
                  <div className="text-muted-foreground mt-0.5 line-clamp-2">{r.content}</div>
                  {r.resultType && r.resultType !== 'message' && (
                    <div className="text-xs text-primary mt-0.5">
                      {r.resultType === 'file' ? '📄 File' : '🔧 Tool'}
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
        <div className="flex items-center gap-1.5 mb-2 px-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase leading-none">
            Projects
          </span>
          {(
            <button
              onClick={() => setShowNewProjectForm(true)}
              disabled={!isConnected}
              className="flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              title={!isConnected ? "Connect to server first" : "Add Project"}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
          )}
        </div>

        {/* New Project Form */}
        {showNewProjectForm && (
          <div className="mb-2 px-2">
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
              className="w-full px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
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
              className="w-full px-2 py-1 mt-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
            />
            <div className="flex gap-1 mt-1">
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || creatingProject}
                className="flex-1 px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded text-xs disabled:opacity-50"
              >
                {creatingProject ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setShowNewProjectForm(false);
                  setNewProjectName('');
                  setNewProjectRootPath('');
                }}
                className="flex-1 px-2 py-1 bg-secondary hover:bg-secondary/80 rounded text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2">No projects yet</p>
        ) : filteredProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2">No active sessions</p>
        ) : (
          <ul className="space-y-1">
            {filteredProjects.map((project) => (
              <li key={project.id}>
                <div className="flex items-center group relative">
                  <button
                    onClick={() => toggleProject(project.id)}
                    className={`flex-1 min-w-0 h-7 text-left px-2 rounded text-sm flex items-center gap-2 ${
                      selectedProjectId === project.id
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    <svg
                      className={`w-4 h-4 flex-shrink-0 transition-transform ${
                        expandedProjects.has(project.id) ? 'rotate-90' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    <span className="truncate font-semibold">{project.name}</span>
                  </button>
                  {/* Project menu button */}
                  {(
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setContextMenuProject(contextMenuProject === project.id ? null : project.id);
                      }}
                      className="w-7 h-7 rounded opacity-0 group-hover:opacity-100 hover:bg-secondary flex-shrink-0 flex items-center justify-center"
                    >
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                      </svg>
                    </button>
                  )}

                  {/* Project context menu */}
                  {contextMenuProject === project.id && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setContextMenuProject(null)} />
                    <div className="absolute right-0 top-full mt-1 w-36 bg-popover border border-border rounded shadow-lg z-50">
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
                  </>
                  )}
                </div>

                {/* Sessions */}
                {expandedProjects.has(project.id) && (
                  <ul className="ml-6 mt-1 space-y-1" data-testid="session-list">
                    {getFilteredSessionsForProject(project.id)
                      .map((session) => (
                        <li key={session.id} className="relative group" data-testid="session-item">
                          <div className="flex items-center">
                            {renamingSessionId === session.id ? (
                              <input
                                autoFocus
                                type="text"
                                value={renameSessionValue}
                                onChange={(e) => setRenameSessionValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRenameSession(session.id);
                                  if (e.key === 'Escape') setRenamingSessionId(null);
                                }}
                                onBlur={() => handleRenameSession(session.id)}
                                className="flex-1 min-w-0 h-7 px-2 rounded text-sm bg-secondary border border-border text-foreground outline-none"
                              />
                            ) : (
                              <button
                                onClick={() => {
                                  selectSession(session.id);
                                  if (isMobile && onClose) onClose();
                                }}
                                className={`flex-1 min-w-0 h-7 text-left px-2 rounded text-sm truncate flex items-center border border-transparent ${
                                  selectedSessionId === session.id
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                                }`}
                              >
                                {session.name || 'Untitled Session'}
                              </button>
                            )}
                            {/* Session menu button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setContextMenuSession(contextMenuSession === session.id ? null : session.id);
                              }}
                              className="w-7 h-7 rounded opacity-0 group-hover:opacity-100 hover:bg-secondary flex-shrink-0 flex items-center justify-center"
                            >
                              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                              </svg>
                            </button>
                          </div>

                          {/* Session context menu */}
                          {contextMenuSession === session.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setContextMenuSession(null)} />
                              <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-border rounded shadow-lg z-50">
                                <button
                                  onClick={() => startRenamingSession(session.id, session.name || '')}
                                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary"
                                >
                                  Rename
                                </button>
                                <button
                                  onClick={() => handleExportSession(session.id)}
                                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary"
                                >
                                  Export Markdown
                                </button>
                                <button
                                  onClick={() => handleDeleteSession(session.id)}
                                  className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-secondary"
                                >
                                  Delete Session
                                </button>
                              </div>
                            </>
                          )}
                        </li>
                      ))}

                    {/* New session form */}
                    {creatingSessionForProject === project.id && (
                      <li>
                        <input
                          type="text"
                          value={newSessionName}
                          onChange={(e) => setNewSessionName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreateSession(project.id);
                            if (e.key === 'Escape') {
                              setCreatingSessionForProject(null);
                              setNewSessionName('');
                            }
                          }}
                          placeholder="Session name (optional)"
                          className="w-full px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
                          autoFocus
                        />
                        <div className="flex gap-1 mt-1">
                          <button
                            onClick={() => handleCreateSession(project.id)}
                            className="flex-1 px-2 py-0.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded text-xs"
                          >
                            Create
                          </button>
                          <button
                            onClick={() => {
                              setCreatingSessionForProject(null);
                              setNewSessionName('');
                            }}
                            className="flex-1 px-2 py-0.5 bg-secondary hover:bg-secondary/80 rounded text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Active Sessions - Fixed at bottom */}
      <div className="flex-shrink-0">
        <ActiveSessionsPanel
          onSessionSelect={(backendId, sessionId) => {
            // Handle session selection - switch backend if needed, then select session
            if (backendId === 'local' || backendId === '__local__') {
              // Local session - just select it
              selectSession(sessionId);
            } else {
              // Remote session - switch to the backend first, then select session
              setActiveServer(`gateway:${backendId}`);
              selectSession(sessionId);
            }
          }}
        />
      </div>

      {/* Settings Button */}
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

      {/* Project Settings Modal */}
      <ProjectSettings
        project={settingsProject}
        isOpen={!!settingsProjectId}
        onClose={() => setSettingsProjectId(null)}
      />

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
      </>
    )}
    </div>
  );
}
