import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { ConnectionProvider } from '../../contexts/ConnectionContext';
import { ChatInterface } from './ChatInterface';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';
import * as api from '../../services/api';

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
}

/** Standalone session chat window rendered in a separate Tauri window */
export function SessionChatWindow({ sessionId, projectId, serverUrl, authToken }: SessionChatWindowProps) {
  useWindowCloseSync(sessionId);

  return (
    <div className="h-screen bg-background text-foreground">
      <ConnectionProvider standaloneServerUrl={serverUrl}>
        <SessionChatContent
          sessionId={sessionId}
          projectId={projectId}
          serverUrl={serverUrl}
          authToken={authToken}
        />
      </ConnectionProvider>
    </div>
  );
}

interface SessionChatContentProps {
  sessionId: string;
  projectId: string;
  serverUrl: string;
  authToken: string;
}

function SessionChatContent({ sessionId, projectId }: SessionChatContentProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionStatus = useServerStore((s) => s.connectionStatus);

  // Once WebSocket is connected, load project/session data into the stores
  useEffect(() => {
    if (connectionStatus !== 'connected') return;

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
        if (projectId) store.selectProject(projectId);
        store.selectSession(sessionId);

        setLoaded(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load session data');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [connectionStatus, sessionId, projectId]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="text-sm text-destructive mb-2">{error}</div>
          <button
            onClick={() => window.close()}
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
      <div className="flex items-center justify-center h-screen">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ChatInterface
      sessionId={sessionId}
      onReturnToDashboard={() => window.close()}
    />
  );
}
