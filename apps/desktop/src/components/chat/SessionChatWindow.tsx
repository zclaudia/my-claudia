import { useState, useEffect } from 'react';
import { Loader2, Server, FolderOpen } from 'lucide-react';
import { ConnectionProvider } from '../../contexts/ConnectionContext';
import { ChatInterface } from './ChatInterface';
import { useServerStore } from '../../stores/serverStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useProjectStore } from '../../stores/projectStore';
import * as api from '../../services/api';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';

/** Compact context bar showing backend + project info for standalone windows */
export function WindowContextBar({ serverName, projectId }: { serverName?: string; projectId?: string }) {
  if (!serverName && !projectId) return null;
  return (
    <div
      className="flex items-center gap-3 px-3 py-1 border-b border-border bg-muted/50 flex-shrink-0 text-[11px] text-muted-foreground"
      data-tauri-drag-region
    >
      {serverName && (
        <span className="flex items-center gap-1">
          <Server size={11} className="flex-shrink-0" />
          <span className="truncate">{serverName}</span>
        </span>
      )}
      {projectId && (
        <span className="flex items-center gap-1">
          <FolderOpen size={11} className="flex-shrink-0" />
          <span className="truncate">{projectId}</span>
        </span>
      )}
    </div>
  );
}

// Listen for control events from the main window (focus / close)
async function registerWindowListeners() {
  const { listen, emitTo } = await import('@tauri-apps/api/event');
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();

  const unlistenFocus = await listen('session-window-focus', async () => {
    await win.show();
    await win.setFocus();
  });

  const unlistenClose = await listen('session-window-close', async () => {
    await win.close();
  });

  return {
    notifyClosed: async (sessionId: string) => {
      try {
        await emitTo('main', 'session-window-closed', { sessionId });
      } catch {
        // Ignore missing main window during app shutdown.
      }
    },
    cleanup: () => {
      unlistenFocus();
      unlistenClose();
    },
  };
}

async function closeCurrentWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}

function useWindowCloseSync(sessionId: string) {
  useEffect(() => {
    let dispose: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const listeners = await registerWindowListeners();
      const unlistenCloseRequested = await win.onCloseRequested(() => {
        void listeners.notifyClosed(sessionId);
      });

      dispose = () => {
        unlistenCloseRequested();
        listeners.cleanup();
      };
    })();

    return () => {
      dispose?.();
    };
  }, [sessionId]);
}

interface SessionChatWindowProps {
  sessionId: string;
  projectId: string;
  serverUrl: string;
  authToken: string;
  serverId?: string;
  serverName?: string;
  gatewayUrl?: string;
  gatewaySecret?: string;
}

/** Standalone session chat window rendered in a separate Tauri window */
export function SessionChatWindow({
  sessionId,
  projectId,
  serverUrl,
  authToken: _authToken,
  serverId,
  serverName,
  gatewayUrl,
  gatewaySecret,
}: SessionChatWindowProps) {
  useWindowCloseSync(sessionId);

  return (
    <div className="flex flex-col h-dvh bg-background text-foreground safe-top-pad">
      {serverName && (
        <WindowContextBar serverName={serverName} projectId={projectId} />
      )}
      <div className="flex-1 min-h-0">
        <ConnectionProvider
          standaloneServerUrl={serverUrl}
          standaloneServerId={serverId}
          standaloneServerName={serverName}
          standaloneGatewayUrl={gatewayUrl}
          standaloneGatewaySecret={gatewaySecret}
        >
          <SessionChatContent
            sessionId={sessionId}
            projectId={projectId}
          />
        </ConnectionProvider>
      </div>
    </div>
  );
}

interface SessionChatContentProps {
  sessionId: string;
  projectId: string;
}

function SessionChatContent({ sessionId, projectId }: SessionChatContentProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { selectProject, selectSession } = useSelectionCoordinator();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const isConnected = useRecoveryStore((s) => {
    if (!activeServerId) return false;
    return s.backends[activeServerId]?.status === 'ready';
  });

  // Once WebSocket is connected, load project/session data into the stores
  useEffect(() => {
    if (!isConnected) return;

    let cancelled = false;
    (async () => {
      try {
        const [projects, sessions, providers] = await Promise.all([
          api.getProjects(),
          api.getSessions(),
          api.getProviders(),
        ]);

        if (cancelled) return;

        const store = useProjectStore.getState();
        store.setProjects(projects);
        store.mergeSessions(sessions);
        store.setProviders(providers);

        // Select the target project and session
        if (projectId) selectProject(projectId);
        selectSession(sessionId);

        setLoaded(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load session data');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [isConnected, sessionId, projectId, selectProject, selectSession]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <div className="text-center">
          <div className="text-sm text-destructive mb-2">{error}</div>
          <button
            onClick={() => { void closeCurrentWindow(); }}
            className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-secondary"
          >
            Close Window
          </button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ChatInterface
      sessionId={sessionId}
      onReturnToDashboard={() => { void closeCurrentWindow(); }}
    />
  );
}
