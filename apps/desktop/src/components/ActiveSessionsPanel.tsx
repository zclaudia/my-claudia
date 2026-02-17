import { useMemo, useState } from 'react';
import { useSessionsStore, type RemoteSession } from '../stores/sessionsStore';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';
import { isGatewayTarget } from '../stores/gatewayStore';

interface ActiveSessionsPanelProps {
  onSessionSelect?: (backendId: string, sessionId: string) => void;
}

export function ActiveSessionsPanel({ onSessionSelect }: ActiveSessionsPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { remoteSessions } = useSessionsStore();
  const { activeServerId, servers } = useServerStore();
  const { sessions: localSessions } = useProjectStore();

  // Get current backend ID (the one we're connected to via gateway)
  const currentBackendId = useMemo(() => {
    if (!activeServerId || !isGatewayTarget(activeServerId)) {
      return null;
    }
    return activeServerId.startsWith('gateway:')
      ? activeServerId.slice('gateway:'.length)
      : null;
  }, [activeServerId]);

  // Combine all active sessions from all backends (including local and current)
  const allActiveSessionsByBackend = useMemo(() => {
    const result = new Map<string, RemoteSession[]>();

    // 1. Local backend (direct connection, not via gateway)
    if (activeServerId && !isGatewayTarget(activeServerId)) {
      const localActiveSessions = localSessions
        .filter(s => s.isActive)
        .map(s => ({ ...s, isActive: true } as RemoteSession));

      if (localActiveSessions.length > 0) {
        result.set('__local__', localActiveSessions);
      }
    }

    // 2. All remote backends (including current gateway backend)
    remoteSessions.forEach((sessions, backendId) => {
      const activeSessions = sessions.filter(s => s.isActive);
      if (activeSessions.length > 0) {
        result.set(backendId, activeSessions);
      }
    });

    return result;
  }, [remoteSessions, activeServerId, localSessions]);

  // Don't show if not connected to any backend
  if (!activeServerId) {
    return null;
  }

  // Show empty state if no active sessions
  const hasActiveSessions = allActiveSessionsByBackend.size > 0;

  // Get backend name from servers list
  const getBackendName = (backendId: string): string => {
    // Special case: local backend
    if (backendId === '__local__') {
      return 'Local Backend';
    }

    // Find server info from servers list
    const server = servers.find(s => s.id === `gateway:${backendId}`);
    const baseName = server?.name || `Backend ${backendId.slice(0, 8)}`;

    // Mark current backend
    if (backendId === currentBackendId) {
      return `${baseName} (Current)`;
    }

    return baseName;
  };

  // Sort sessions by update time (all are active)
  const sortSessions = (sessions: RemoteSession[]): RemoteSession[] => {
    return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  };

  return (
    <div className={`border-t border-border ${isCollapsed ? '' : 'h-[40vh] overflow-y-auto'}`}>
      {/* Header with collapse button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-secondary/50 transition-colors"
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase">
          Active Sessions
        </span>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${
            isCollapsed ? '-rotate-90' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {!isCollapsed && (!hasActiveSessions ? (
        <div className="px-2 pb-2">
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No active sessions
          </div>
        </div>
      ) : (
        <div className="px-2 pb-2 space-y-3">
          {Array.from(allActiveSessionsByBackend.entries()).map(([backendId, sessions]) => {
          // All sessions here are active, sort by update time
          const sortedSessions = sortSessions(sessions);

          return (
            <div key={backendId}>
              {/* Backend Header */}
              <div className="px-2 py-1 bg-secondary/50 rounded text-xs font-medium text-muted-foreground flex items-center gap-2">
                <svg
                  className="w-3.5 h-3.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                  />
                </svg>
                <span className="truncate">{getBackendName(backendId)}</span>
                <span className="ml-auto text-xs opacity-70">{sessions.length}</span>
              </div>

              {/* Sessions List - All are active */}
              <ul className="mt-1 space-y-0.5 ml-2">
                {sortedSessions.map((session) => (
                  <li key={session.id}>
                    <button
                      onClick={() => {
                        // Special handling for local sessions
                        if (backendId === '__local__') {
                          onSessionSelect?.('local', session.id);
                        } else {
                          onSessionSelect?.(backendId, session.id);
                        }
                      }}
                      className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-secondary active:bg-secondary flex items-center gap-2 group"
                    >
                      {/* Session Icon */}
                      <svg
                        className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                        />
                      </svg>

                      {/* Session Name */}
                      <span className="flex-1 truncate text-muted-foreground group-hover:text-foreground">
                        {session.name || `Session ${session.id.slice(0, 8)}`}
                      </span>

                      {/* Running Badge - all sessions here are active */}
                      <span className="flex-shrink-0 px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded text-xs font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                        Running
                      </span>
                    </button>

                    {/* Session metadata */}
                    <div className="px-2 ml-6 text-xs text-muted-foreground">
                      Last updated: {new Date(session.updatedAt).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        </div>
      ))}
    </div>
  );
}
