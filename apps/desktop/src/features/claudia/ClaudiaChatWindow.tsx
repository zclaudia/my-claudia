import { useEffect, useRef, useState } from 'react';
import { ThemeProvider, useTheme, isDarkTheme } from '../../contexts/ThemeContext';
import { ConnectionProvider } from '../../contexts/ConnectionContext';
import { ClaudiaChat } from './ClaudiaChat';
import { useDataLoader } from '../../hooks/useDataLoader';
import { usePermissionStore } from '../../stores/permissionStore';
import { useClaudiaStatus } from '../../hooks/useClaudiaStatus';

interface ClaudiaChatWindowProps {
  serverUrl: string;
  authToken: string;
  serverId?: string;
  serverName?: string;
  gatewayUrl?: string;
  gatewaySecret?: string;
  projectId?: string;
  contextProjectId?: string;
}

interface ClaudiaWindowContext {
  serverUrl?: string;
  authToken?: string;
  serverId?: string;
  serverName?: string;
  gatewayUrl?: string;
  gatewaySecret?: string;
  projectId?: string | null;
  contextProjectId?: string | null;
}

/**
 * Standalone Claudia chat window — rendered in a separate borderless Tauri window.
 * Has its own WebSocket connection to the backend.
 */
function ClaudiaChatWindowContent({
  isMobile = false,
  hostProjectId,
  contextProjectId,
}: { isMobile?: boolean; hostProjectId?: string; contextProjectId?: string }) {
  useDataLoader();
  const { claudiaTaskSessionIds, hasRunning: hasClaudiaRunning, hasPermissionPending: hasClaudiaPermissionPending } = useClaudiaStatus();
  const permissionRequests = usePermissionStore((state) =>
    state.pendingRequests.filter((request) => !request.sessionId || claudiaTaskSessionIds.includes(request.sessionId))
  );
  const lastAutoOpenedRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { emit } = await import('@tauri-apps/api/event');
        await emit('claudia:unread', {
          unread: false,
          running: hasClaudiaRunning,
          permissionPending: hasClaudiaPermissionPending,
        });
      } catch {
        // Ignore when the event bridge is not ready yet.
      }
    })();
  }, [hasClaudiaPermissionPending, hasClaudiaRunning]);

  useEffect(() => {
    const latestRequestId = permissionRequests[permissionRequests.length - 1]?.requestId;
    if (!latestRequestId) return;
    if (lastAutoOpenedRequestIdRef.current === latestRequestId) return;
    lastAutoOpenedRequestIdRef.current = latestRequestId;

    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        const visible = await currentWindow.isVisible();
        if (visible) return;

        const { invoke } = await import('@tauri-apps/api/core');
        const params = new URLSearchParams(window.location.search);
        await invoke('show_claudia_chat', {
          chatUrl: `${window.location.origin}${window.location.pathname}?${params}`,
          screenWidth: window.screen.availWidth,
          screenHeight: window.screen.availHeight,
        });
      } catch {
        // Ignore auto-open failures and keep the permission card queued.
      }
    })();
  }, [permissionRequests]);

  return <ClaudiaChat isMobile={isMobile} hostProjectId={hostProjectId} contextProjectId={contextProjectId} />;
}

/** Header with theme-aware logo */
function ClaudiaHeader({ onClose }: { onClose: () => void }) {
  const { resolvedTheme } = useTheme();
  const isDark = isDarkTheme(resolvedTheme);

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between px-3 py-2 border-b border-border bg-card flex-shrink-0"
    >
      <div className="flex items-center gap-2" data-tauri-drag-region>
        <img
          src={isDark ? '/logo-transparent-dark.png' : '/logo.png'}
          alt="Claudia"
          className="w-5 h-5 object-contain"
          draggable={false}
        />
        <span className="font-semibold text-xs text-foreground" data-tauri-drag-region>Claudia</span>
      </div>
      <button
        onClick={onClose}
        className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        title="Hide"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function ClaudiaChatWindow({
  serverUrl,
  authToken,
  serverId,
  serverName,
  gatewayUrl,
  gatewaySecret,
  projectId,
  contextProjectId,
}: ClaudiaChatWindowProps) {
  const [context, setContext] = useState<Required<Pick<ClaudiaWindowContext, 'serverUrl' | 'authToken'>> & ClaudiaWindowContext>(() => ({
    serverUrl,
    authToken,
    serverId,
    serverName,
    gatewayUrl,
    gatewaySecret,
    projectId,
    contextProjectId,
  }));

  // Custom title bar drag + close
  useEffect(() => {
    let cleanupClose: (() => void) | undefined;
    let cleanupContext: (() => void) | undefined;
    document.documentElement.classList.add('claudia-chat-window');
    document.body.classList.add('claudia-chat-window');

    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { listen } = await import('@tauri-apps/api/event');
      const win = getCurrentWindow();
      // Hide instead of destroying so reopen is instant.
      cleanupClose = await win.onCloseRequested(async (e) => {
        e.preventDefault();
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('hide_claudia_chat');
      });
      cleanupContext = await listen<ClaudiaWindowContext>('claudia:context', (event) => {
        setContext((prev) => ({ ...prev, ...event.payload }));
      });
    })();
    return () => {
      cleanupClose?.();
      cleanupContext?.();
      document.documentElement.classList.remove('claudia-chat-window');
      document.body.classList.remove('claudia-chat-window');
    };
  }, []);

  const handleClose = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('hide_claudia_chat');
    } catch {
      window.close();
    }
  };

  return (
    <ThemeProvider defaultTheme="dark-neutral">
      <div className="h-dvh w-full bg-transparent p-1.5">
        <div className="flex h-full flex-col overflow-hidden rounded-[18px] border border-border/60 bg-background text-foreground">
          {/* Custom title bar */}
          <ClaudiaHeader onClose={handleClose} />

          {/* Chat content with its own connection */}
          <div className="flex-1 min-h-0">
            <ConnectionProvider
              standaloneServerUrl={context.serverUrl}
              standaloneServerId={context.serverId}
              standaloneServerName={context.serverName}
              standaloneGatewayUrl={context.gatewayUrl}
              standaloneGatewaySecret={context.gatewaySecret}
            >
              <ClaudiaChatWindowContent
                hostProjectId={context.projectId ?? undefined}
                contextProjectId={context.contextProjectId ?? undefined}
              />
            </ConnectionProvider>
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}
