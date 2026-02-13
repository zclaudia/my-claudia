import { useSessionsStore, type RemoteSession } from '../stores/sessionsStore';
import { useServerStore } from '../stores/serverStore';
import { isGatewayTarget, parseBackendId } from '../stores/gatewayStore';

interface RemoteSessionsListProps {
  onSessionSelect?: (backendId: string, sessionId: string) => void;
}

export function RemoteSessionsList({ onSessionSelect }: RemoteSessionsListProps) {
  const { remoteSessions } = useSessionsStore();
  const { activeServerId } = useServerStore();

  // Only show remote sessions when connected through gateway
  if (!activeServerId || !isGatewayTarget(activeServerId)) {
    return null;
  }

  const backendEntries = Array.from(remoteSessions.entries());

  if (backendEntries.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border">
      <div className="px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase">
          Remote Sessions
        </span>
      </div>

      <div className="px-2 pb-2 space-y-3">
        {backendEntries.map(([backendId, sessions]) => (
          <div key={backendId}>
            {/* Backend Header */}
            <div className="px-2 py-1 bg-secondary/50 rounded text-xs font-medium text-muted-foreground flex items-center gap-2">
              <svg
                className="w-3.5 h-3.5"
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
              <span className="truncate">Backend {backendId.slice(0, 8)}</span>
              <span className="ml-auto text-xs opacity-70">{sessions.length}</span>
            </div>

            {/* Sessions List */}
            {sessions.length > 0 && (
              <ul className="mt-1 space-y-0.5 ml-2">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <button
                      onClick={() => onSessionSelect?.(backendId, session.id)}
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

                      {/* Active Badge */}
                      {session.isActive && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded text-xs font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                          Running
                        </span>
                      )}
                    </button>

                    {/* Session metadata */}
                    {session.isActive && (
                      <div className="px-2 ml-6 text-xs text-muted-foreground">
                        Last updated: {new Date(session.updatedAt).toLocaleString()}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Empty state */}
            {sessions.length === 0 && (
              <div className="px-2 py-2 text-xs text-muted-foreground italic">
                No sessions
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
