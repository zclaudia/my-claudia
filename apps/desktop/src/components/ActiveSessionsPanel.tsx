import { useMemo, useState, useEffect } from 'react';
import { useSessionsStore, type RemoteSession, LOCAL_BACKEND_KEY } from '../stores/sessionsStore';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';
import { isGatewayTarget, parseBackendId, toGatewayServerId, useGatewayStore } from '../stores/gatewayStore';

interface ActiveSessionsPanelProps {
  onSessionSelect?: (backendId: string, sessionId: string) => void;
}

function formatTimeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function ActiveSessionsPanel({ onSessionSelect }: ActiveSessionsPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [, forceUpdate] = useState(0);
  const { remoteSessions, activeSessionIdsByBackend, recentlyCompletedSessions, dismissRecentlyCompleted, clearAllRecentlyCompleted } = useSessionsStore();
  const { activeServerId, servers, connections } = useServerStore();
  const { sessions: localSessions, projects } = useProjectStore();
  const { localBackendId, discoveredBackends } = useGatewayStore();
  const hasDirectLocalConnection = (connections.local?.status === 'connected' || connections.local?.status === 'connecting');

  // Refresh "X ago" timestamps every 30s
  useEffect(() => {
    if (recentlyCompletedSessions.length === 0) return;
    const timer = setInterval(() => forceUpdate(n => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [recentlyCompletedSessions.length]);

  // Get current backend ID (the one we're connected to via gateway)
  const currentBackendId = useMemo(() => {
    if (!activeServerId || !isGatewayTarget(activeServerId)) {
      return null;
    }
    return parseBackendId(activeServerId);
  }, [activeServerId]);

  // Build active session groups from a single source of truth:
  // sessionsStore.activeSessionIdsByBackend
  const allActiveSessionsByBackend = useMemo(() => {
    const result = new Map<string, RemoteSession[]>();
    const hasLocalBucket = activeSessionIdsByBackend.has(LOCAL_BACKEND_KEY);
    const localAliasBackendIds = new Set<string>();
    if (localBackendId) localAliasBackendIds.add(localBackendId);
    if (hasDirectLocalConnection) localAliasBackendIds.add('local');

    activeSessionIdsByBackend.forEach((activeIds, backendId) => {
      if (activeIds.size === 0) return;
      if (
        backendId !== LOCAL_BACKEND_KEY
        && hasLocalBucket
        && localAliasBackendIds.has(backendId)
      ) {
        return;
      }

      if (backendId === LOCAL_BACKEND_KEY) {
        const mergedActiveIds = new Set(activeIds);
        if (hasLocalBucket) {
          for (const aliasBackendId of localAliasBackendIds) {
            const aliasActive = activeSessionIdsByBackend.get(aliasBackendId);
            if (!aliasActive) continue;
            for (const sessionId of aliasActive) mergedActiveIds.add(sessionId);
          }
        }

        const localById = new Map(localSessions.map(s => [s.id, s]));
        const gatewayById = new Map<string, RemoteSession>();
        for (const aliasBackendId of localAliasBackendIds) {
          const localFromGateway = remoteSessions.get(aliasBackendId) || [];
          for (const s of localFromGateway) gatewayById.set(s.id, s);
        }

        const sessions: RemoteSession[] = [];
        for (const sessionId of mergedActiveIds) {
          const local = localById.get(sessionId);
          const gw = gatewayById.get(sessionId);
          const source = local || gw;
          if (!source) {
            sessions.push({
              id: sessionId,
              projectId: '',
              name: `Session ${sessionId.slice(0, 8)}`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              isActive: true,
            } as RemoteSession);
          } else {
            sessions.push({ ...source, isActive: true } as RemoteSession);
          }
        }
        if (sessions.length > 0) {
          result.set(LOCAL_BACKEND_KEY, sessions);
        }
        return;
      }

      const backendSessions = remoteSessions.get(backendId) || [];
      if (backendSessions.length === 0) return;
      const byId = new Map(backendSessions.map(s => [s.id, s]));
      const sessions: RemoteSession[] = [];
      for (const sessionId of activeIds) {
        const session = byId.get(sessionId);
        if (session) {
          sessions.push({ ...session, isActive: true });
        } else {
          sessions.push({
            id: sessionId,
            projectId: '',
            name: `Session ${sessionId.slice(0, 8)}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isActive: true,
          } as RemoteSession);
        }
      }
      if (sessions.length > 0) {
        result.set(backendId, sessions);
      }
    });

    return result;
  }, [activeSessionIdsByBackend, remoteSessions, localSessions, localBackendId, hasDirectLocalConnection]);

  // Don't show if not connected to any backend
  if (!activeServerId) {
    return null;
  }

  const hasActiveSessions = allActiveSessionsByBackend.size > 0;

  // Get backend name from gateway metadata / servers list
  const getBackendName = (backendId: string): string => {
    if (backendId === LOCAL_BACKEND_KEY) {
      return 'Local Backend';
    }
    const discovered = discoveredBackends.find(b => b.backendId === backendId);
    const server = servers.find(s => s.id === toGatewayServerId(backendId));
    const baseName = discovered?.name || server?.name || `Backend ${backendId.slice(0, 8)}`;
    if (backendId === currentBackendId) {
      return `${baseName} (Current)`;
    }
    return baseName;
  };

  const sortSessions = (sessions: RemoteSession[]): RemoteSession[] => {
    return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  };

  const getProjectName = (projectId: string): string | null => {
    const project = projects.find(p => p.id === projectId);
    return project?.name || null;
  };

  const totalActive = Array.from(allActiveSessionsByBackend.values()).reduce((sum, s) => sum + s.length, 0);
  const hasRecentlyCompleted = recentlyCompletedSessions.length > 0;

  return (
    <div className="px-2 pb-2">
      <div className="rounded-xl border border-border/50 bg-muted/30 p-1.5 transition-all duration-200">
        {/* Header */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wide">
            Active Sessions
          </span>
          {hasActiveSessions && (
            <span className="text-[10px] text-muted-foreground/50">
              {totalActive}
            </span>
          )}
          <svg
            className={`ml-auto w-2.5 h-2.5 opacity-40 transition-transform duration-200 ${
              isCollapsed ? '' : 'rotate-90'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {!isCollapsed && (!hasActiveSessions ? (
          <div className="px-2 py-2 text-center text-[10px] text-muted-foreground/50">
            No active sessions
          </div>
        ) : (
          <div className="mt-0.5 max-h-[200px] overflow-y-auto space-y-1">
            {Array.from(allActiveSessionsByBackend.entries()).map(([backendId, sessions]) => {
              const sortedSessions = sortSessions(sessions);
              return (
                <div key={backendId}>
                  {/* Backend label */}
                  <div className="flex items-center gap-1.5 px-2 py-0.5">
                    <svg
                      className="w-3 h-3 text-muted-foreground/50 shrink-0"
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                      />
                    </svg>
                    <span className="text-[10px] text-muted-foreground/70 truncate">
                      {getBackendName(backendId)}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground/40 shrink-0">
                      {sessions.length}
                    </span>
                  </div>

                  {/* Session items */}
                  <ul className="space-y-0.5">
                    {sortedSessions.map((session) => (
                      <li key={session.id}>
                        <button
                          onClick={() => {
                            if (backendId === LOCAL_BACKEND_KEY) {
                              onSessionSelect?.('local', session.id);
                            } else {
                              onSessionSelect?.(backendId, session.id);
                            }
                          }}
                          className="w-full text-left h-7 px-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors flex items-center gap-1.5"
                        >
                          <span className="truncate flex-1">
                            {session.name || `Session ${session.id.slice(0, 8)}`}
                          </span>
                          {getProjectName(session.projectId) && (
                            <span className="text-[9px] text-muted-foreground/40 shrink-0 truncate max-w-[60px]">
                              {getProjectName(session.projectId)}
                            </span>
                          )}
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}

        {/* Recently Completed */}
        {hasRecentlyCompleted && (
          <div className="mt-1 border-t border-border/30 pt-1">
            <div className="flex items-center gap-1.5 px-2 py-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                Recently Completed
              </span>
              <button
                onClick={clearAllRecentlyCompleted}
                className="ml-auto text-[9px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="max-h-[150px] overflow-y-auto space-y-0.5">
              {recentlyCompletedSessions.map(({ session, backendId, completedAt }) => (
                <div key={session.id} className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (backendId === LOCAL_BACKEND_KEY) {
                        onSessionSelect?.('local', session.id);
                      } else {
                        onSessionSelect?.(backendId, session.id);
                      }
                    }}
                    className="flex-1 min-w-0 text-left h-7 px-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors flex items-center gap-1.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
                    <span className="truncate flex-1">
                      {session.name || `Session ${session.id.slice(0, 8)}`}
                    </span>
                    <span className="text-[9px] text-muted-foreground/40 shrink-0">
                      {formatTimeAgo(completedAt)}
                    </span>
                    {getProjectName(session.projectId) && (
                      <span className="text-[9px] text-muted-foreground/30 shrink-0 truncate max-w-[50px]">
                        {getProjectName(session.projectId)}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => dismissRecentlyCompleted(session.id)}
                    className="w-5 h-5 flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground transition-colors shrink-0"
                    aria-label="Dismiss"
                  >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
