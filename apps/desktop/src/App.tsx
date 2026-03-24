import { useEffect, useState, useRef, useMemo } from 'react';
import { Bot, ChevronsRight, ChevronsLeft, MessageSquare, Activity, Clock, Cloud, Gauge, StickyNote, Puzzle, type LucideIcon } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ChatInterface } from './components/chat/ChatInterface';
import { ServerSelector } from './components/ServerSelector';
import { MobileSetup } from './components/MobileSetup';
import { WindowsSetup } from './components/WindowsSetup';
import { ClaudiaBallWindow } from './components/claudia/ClaudiaBallWindow';
import { ClaudiaChatWindow } from './components/claudia/ClaudiaChatWindow';
import { ClaudiaChat } from './components/claudia/ClaudiaChat';
import { AgentFeedPanel } from './components/agent-feed/AgentFeedPanel';
import { useAgentFeedStore } from './stores/agentFeedStore';
import { ToastContainer } from './components/ToastContainer';
import { FileViewerWindow } from './components/fileviewer/FileViewerWindow';
import { WorkflowEditorWindow } from './features/workflows/components/WorkflowEditorWindow';
import { AutomationWindow } from './features/automation/AutomationWindow';
import { SessionChatWindow } from './components/chat/SessionChatWindow';
import { TerminalWindow } from './components/terminal/TerminalWindow';
import { DraftWindow } from './components/draft/DraftWindow';
import { PluginWindow } from './components/PluginWindow';
import { ProjectDashboard } from './components/dashboard/ProjectDashboard';
import { ThemeProvider } from './contexts/ThemeContext';
import { ConnectionProvider, useConnection } from './contexts/ConnectionContext';
import { useDataLoader } from './hooks/useDataLoader';
import { useServerStore } from './stores/serverStore';
import { useGatewayStore, isGatewayTarget } from './stores/gatewayStore';
import { useProjectStore } from './stores/projectStore';
import { useClaudiaStore } from './stores/claudiaStore';
import { useIsMobile } from './hooks/useMediaQuery';
import { useClaudiaStatus } from './hooks/useClaudiaStatus';
import { useAndroidBack } from './hooks/useAndroidBack';
import { eagerSyncAllBackends } from './services/sessionSync';
import { useFileViewerStore } from './stores/fileViewerStore';
import { useUIStore } from './stores/uiStore';
import { useTerminalStore } from './stores/terminalStore';
import { usePluginStore, selectPluginPanels } from './stores/pluginStore';
import { useDraftEditorStore } from './stores/draftEditorStore';
import { xtermRegistry } from './utils/xtermRegistry';
import { initBuiltinPanels } from './plugins/builtinPanels';
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { useServerLatencyMonitor } from './hooks/useServerLatencyMonitor';
import { UpdateBanner } from './components/UpdateBanner';
import { BrandMark } from './components/BrandMark';
import { useShortcutStore } from './stores/shortcutStore';

const isDesktopTauri = typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && !navigator.userAgent.includes('Android');

// ── Plugin Dock ─────────────────────────────────────────────────
// Icon name → Lucide component mapping for plugin-declared icons.
// Plugins can also use image files (icon.svg / icon.png) in their ui/ directory.
const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
  MessageSquare, Activity, Clock, Cloud, Gauge, StickyNote, Puzzle, Bot,
};

function PluginIcon({ name, pluginId, size = 16 }: { name?: string; pluginId?: string; size?: number }) {
  // Image file: icon value contains a file extension (e.g. "icon.svg", "logo.png")
  const activeServer = useServerStore(s => s.getActiveServer?.());
  if (name && pluginId && /\.\w+$/.test(name)) {
    const address = activeServer?.address || 'localhost:3100';
    const baseUrl = address.includes('://') ? address : `http://${address}`;
    const src = `${baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/frontend/${name}`;
    return <img src={src} alt="" style={{ width: size, height: size }} className="object-contain" />;
  }
  // Lucide icon name
  const Icon = name ? PLUGIN_ICON_MAP[name] : undefined;
  if (Icon) return <Icon size={size} />;
  return <Puzzle size={size} />;
}

/**
 * Selector: returns panels from active plugins that have an iframe frontend.
 * Uses a stable reference to avoid unnecessary re-renders.
 */
function useActivePluginPanels() {
  const allPanels = usePluginStore(selectPluginPanels);
  const activeIds = usePluginStore(
    (s) => s.plugins.filter(p => p.status === 'active').map(p => p.manifest.id),
  );
  // Use JSON.stringify for stable dependency comparison
  const activeIdsKey = useMemo(() => JSON.stringify(activeIds), [activeIds]);
  const activeSet = useMemo(() => new Set(JSON.parse(activeIdsKey)), [activeIdsKey]);
  return useMemo(
    () => allPanels.filter(p => p.iframeUrl && p.pluginId && activeSet.has(p.pluginId)),
    [allPanels, activeSet],
  );
}

/** Plugin Dock — fixed area in header for third-party plugin windows (max 5, scrollable). */
function PluginWindowButtons() {
  const pluginPanels = useActivePluginPanels();

  if (pluginPanels.length === 0 || !isDesktopTauri) return null;

  const openWindow = async (panel: typeof pluginPanels[0]) => {
    try {
      const { openPluginWindow } = await import('./utils/pluginWindow');
      await openPluginWindow({
        pluginId: panel.pluginId,
        panelId: panel.id,
        title: panel.label || 'Plugin',
        width: 900,
        height: 650,
        iframeUrl: panel.iframeUrl,
      });
    } catch (err) {
      console.error('Failed to open plugin window:', err);
    }
  };

  return (
    <div className="flex items-center mr-1.5">
      <div className="w-px h-4 bg-border mr-1.5" />

      <div
        className="flex items-center gap-0.5 overflow-x-auto scrollbar-none"
        style={{ maxWidth: 5 * 32 }}
      >
        {pluginPanels.map(panel => (
          <button
            key={panel.id}
            onClick={() => openWindow(panel)}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-all"
            title={panel.label}
          >
            <PluginIcon name={panel.icon} pluginId={panel.pluginId} size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}

function AppContent() {
  const { connectServer, embeddedServerStatus, embeddedServerError } = useConnection();
  const { connectionStatus } = useServerStore();
  const { selectedSessionId, selectedProjectId, sessions, projects, selectProject, selectSession, setDashboardView } = useProjectStore();
  const [dashboardProjectId, setDashboardProjectId] = useState<string | null>(null);
  const { directGatewayUrl, lastActiveBackendId, isConnected: isGatewayConnected, discoveredBackends } = useGatewayStore();
  const { isExpanded: isAgentExpanded, setExpanded: setAgentExpanded } = useClaudiaStore();
  const { hasUnread: hasClaudiaUnread, hasRunning: hasClaudiaRunning, hasPermissionPending: hasClaudiaPermissionPending } = useClaudiaStatus();
  const disabledBuiltinPanels = usePluginStore((s) => s.disabledBuiltinPanels);
  const feedUnreadCount = useAgentFeedStore((s) => s.unreadCount);
  const [isFeedOpen, setFeedOpen] = useState(false);
  const fileViewerFullscreen = useFileViewerStore((s) => s.fullscreen);
  const fileViewerFilePath = useFileViewerStore((s) => s.filePath);
  const fileViewerProjectRoot = useFileViewerStore((s) => s.projectRoot);
  const setFileViewerFullscreen = useFileViewerStore((s) => s.setFullscreen);
  const removePoppedOutSession = useUIStore((s) => s.removePoppedOutSession);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // When a session is selected, exit the dashboard view
  const prevSessionRef = useRef(selectedSessionId);
  useEffect(() => {
    if (selectedSessionId && selectedSessionId !== prevSessionRef.current) {
      setDashboardProjectId(null);
    }
    prevSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);
  const isMobile = useIsMobile();
  const selectedSession = selectedSessionId ? sessions.find((session) => session.id === selectedSessionId) ?? null : null;
  const [claudiaProjectId, setClaudiaProjectId] = useState<string | null>(null);
  const claudiaContextProjectId = (selectedSession?.projectId || dashboardProjectId || selectedProjectId || null) === claudiaProjectId
    ? null
    : (selectedSession?.projectId || dashboardProjectId || selectedProjectId || null);
  const localServer = useServerStore((s) => s.getDefaultServer());
  const claudiaServerUrl = useMemo(() => {
    const localAddress = localServer?.address || 'localhost:3100';
    return localAddress.includes('://') ? localAddress : `http://${localAddress}`;
  }, [localServer?.address]);

  const mobileInitDone = useRef(false);
  const hasConnected = useRef(false);

  // Track if we've ever connected (to avoid showing loading on reconnect)
  if (connectionStatus === 'connected') {
    hasConnected.current = true;
  }

  // Register builtin plugin panel components (once at startup)
  useEffect(() => { initBuiltinPanels(); }, []);

  // Initialize global shortcut config (once at startup, desktop only)
  useEffect(() => {
    if (!isDesktopTauri) return;
    const { loadConfig } = useShortcutStore.getState();
    void loadConfig();
  }, []);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    let cancelled = false;

    (async () => {
      try {
        const { ensureAgent } = await import('./services/api/servers');
        const ensured = await ensureAgent();
        if (!cancelled) {
          setClaudiaProjectId(ensured.projectId);
        }
      } catch (error) {
        console.warn('[App] Failed to ensure Claudia host project:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionStatus]);

  // Launch Claudia floating ball (desktop only, once)
  useEffect(() => {
    if (!isDesktopTauri || isMobile || !claudiaProjectId) return;
    (async () => {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const { invoke } = await import('@tauri-apps/api/core');
        const { emit } = await import('@tauri-apps/api/event');
        const existing = await WebviewWindow.getByLabel('claudia-ball');
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const authToken = ''; // Local server trusts localhost connections
        const serverId = 'local';
        const serverName = localServer?.name || 'Local Server';
        const hostWindow = getCurrentWindow();
        const scale = typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
          ? window.devicePixelRatio
          : 1;
        const hostPos = await hostWindow.outerPosition().catch(() => null);
        const hostSize = await hostWindow.outerSize().catch(() => null);
        const hostX = hostPos ? hostPos.x / scale : window.screenX;
        const hostY = hostPos ? hostPos.y / scale : window.screenY;
        const hostWidth = hostSize ? hostSize.width / scale : window.outerWidth;
        const hostHeight = hostSize ? hostSize.height / scale : window.outerHeight;

        const ballParams = new URLSearchParams({
          claudiaBall: 'true',
          serverUrl: claudiaServerUrl,
          authToken,
          serverId,
          serverName,
        });
        if (claudiaProjectId) {
          ballParams.set('projectId', claudiaProjectId);
        }
        if (claudiaContextProjectId) {
          ballParams.set('contextProjectId', claudiaContextProjectId);
        }
        // Local backend — no gateway needed

        const chatParams = new URLSearchParams({ claudiaChat: 'true' });
        for (const key of ['serverUrl', 'authToken', 'serverId', 'serverName', 'gatewayUrl', 'gatewaySecret', 'projectId', 'contextProjectId'] as const) {
          const val = ballParams.get(key);
          if (val) chatParams.set(key, val);
        }

        if (!existing) {
          await invoke('create_claudia_ball', {
            ballUrl: `${window.location.origin}${window.location.pathname}?${ballParams}`,
            x: Math.max(16, Math.floor(hostX + hostWidth - 72)),
            y: Math.max(16, Math.floor(hostY + hostHeight - 96)),
          });
        }

        void invoke('preload_claudia_chat', {
          chatUrl: `${window.location.origin}${window.location.pathname}?${chatParams}`,
        }).catch((preloadErr) => {
          console.warn('[App] Failed to preload Claudia chat window:', preloadErr);
        });

        await emit('claudia:context', {
          serverUrl: claudiaServerUrl,
          authToken,
          serverId,
          serverName,
          projectId: claudiaProjectId,
          contextProjectId: claudiaContextProjectId,
        });
      } catch (err) {
        console.warn('[App] Failed to create Claudia floating ball:', err);
      }
    })();
  }, [claudiaContextProjectId, claudiaProjectId, claudiaServerUrl, isMobile, localServer?.name]);

  useEffect(() => {
    if (!isDesktopTauri || isMobile) return;
    (async () => {
      try {
        const { emit } = await import('@tauri-apps/api/event');
        await emit('claudia:unread', {
          unread: hasClaudiaUnread,
          running: hasClaudiaRunning,
          permissionPending: hasClaudiaPermissionPending,
        });
      } catch {
        // Ignore when Tauri event bridge is unavailable during startup.
      }
    })();
  }, [hasClaudiaPermissionPending, hasClaudiaUnread, hasClaudiaRunning, isMobile]);

  // Auto-update check (desktop only, silent)
  useAutoUpdate();
  useServerLatencyMonitor();

  // Load data from server
  useDataLoader();

  // Android back gesture: close fullscreen file viewer (pri 25)
  useAndroidBack(() => setFileViewerFullscreen(false), fileViewerFullscreen, 25);

  // Android back gesture: close agent panel (pri 20)
  useAndroidBack(() => setAgentExpanded(false), isMobile && isAgentExpanded, 20);

  // Android back gesture: close sidebar (pri 10)
  useAndroidBack(() => setSidebarOpen(false), isMobile && sidebarOpen, 10);

  // Android back gesture: open sidebar when nothing else is open (pri 5)
  useAndroidBack(() => setSidebarOpen(true), isMobile && !sidebarOpen && !isAgentExpanded && !fileViewerFullscreen, 5);


  // Mobile: prevent localhost connection on initial load
  useEffect(() => {
    if (!isMobile || mobileInitDone.current) return;
    mobileInitDone.current = true;

    const { activeServerId } = useServerStore.getState();
    if (activeServerId === 'local') {
      useServerStore.getState().setActiveServer(null);
    }
  }, [isMobile]);

  // Mobile: auto-reconnect to last used backend when gateway discovers it
  const mobileAutoConnectDone = useRef(false);
  useEffect(() => {
    if (!isMobile || mobileAutoConnectDone.current) return;
    if (!lastActiveBackendId || !isGatewayTarget(lastActiveBackendId)) return;
    if (!isGatewayConnected) return;

    // Check if the last backend is online
    const backendId = lastActiveBackendId.slice(3); // remove "gw:" prefix
    const backendOnline = discoveredBackends.some(b => b.online && b.backendId === backendId);
    if (!backendOnline) return;

    // Auto-connect once
    mobileAutoConnectDone.current = true;
    console.log('[App] Auto-reconnecting to last used backend:', lastActiveBackendId);
    useServerStore.getState().setActiveServer(lastActiveBackendId);
    connectServer(lastActiveBackendId);
  }, [isMobile, lastActiveBackendId, isGatewayConnected, discoveredBackends, connectServer]);

  // Eager sync when app comes back to foreground (e.g. returning to Mac after using mobile)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[App] App became visible, triggering eager sync');
        eagerSyncAllBackends();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || new URLSearchParams(window.location.search).has('sessionWindow')) {
      return;
    }

    let cleanupSession: (() => void) | undefined;
    let cleanupTerminal: (() => void) | undefined;
    let cleanupDraft: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      cleanupSession = await listen<{ sessionId?: string }>('session-window-closed', (event) => {
        const closedSessionId = event.payload?.sessionId;
        if (closedSessionId) {
          removePoppedOutSession(closedSessionId);
        }
      });
      cleanupTerminal = await listen<{ terminalId?: string }>('terminal-window-closed', (event) => {
        const closedTerminalId = event.payload?.terminalId;
        if (closedTerminalId) {
          useTerminalStore.getState().removePoppedOutTerminal(closedTerminalId);
          useTerminalStore.getState().markNeedsReattach(closedTerminalId);
          xtermRegistry.markDetached(closedTerminalId);
          // Restore terminal panel visibility in main window
          usePluginStore.getState().updatePanelVisibility('terminal', true);
        }
      });
      cleanupDraft = await listen<{ sessionId?: string }>('draft-window-closed', () => {
        useDraftEditorStore.getState().setPoppedOut(false, null);
      });
    })();

    return () => {
      cleanupSession?.();
      cleanupTerminal?.();
      cleanupDraft?.();
    };
  }, [removePoppedOutSession]);

  // Mobile: show setup screen when gateway is not configured
  if (isMobile && !directGatewayUrl) {
    return <MobileSetup />;
  }

  // Windows: show setup screen when server is not configured
  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
  const hasConnectedServer = connectionStatus === 'connected' || hasConnected.current;
  if (isWindows && embeddedServerStatus === 'wsl-mode' && !hasConnectedServer) {
    return <WindowsSetup />;
  }

  // Desktop: show loading screen during initial startup
  if (!isMobile && !hasConnected.current && connectionStatus !== 'connected') {
    const statusText =
      embeddedServerStatus === 'error'
        ? embeddedServerError || 'Server failed to start'
        : embeddedServerStatus === 'starting'
          ? 'Starting server...'
          : 'Connecting...';
    const isError = embeddedServerStatus === 'error';

    return (
      <div className="flex flex-col h-dvh bg-background text-foreground">
        <div className="safe-top-spacer bg-background flex-shrink-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center" data-tauri-drag-region>
          <div className="text-center">
            {isError ? (
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                <svg className="w-5 h-5 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            ) : (
              <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            )}
            <p className={`text-sm ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>{statusText}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-background text-foreground">
      {/* Top safe area spacer: notch/status bar on mobile, traffic lights on desktop */}
      <div
        className={`safe-top-spacer bg-card flex-shrink-0 ${isMobile && selectedSessionId && !isAgentExpanded ? 'hidden' : ''}`}
        data-tauri-drag-region
      />

      {/* Header - hidden on mobile when ChatInterface has its own session bar */}
      <header
        className={`h-12 md:h-14 border-b border-border flex items-center px-2 md:px-4 bg-card flex-shrink-0 ${isMobile && selectedSessionId && !isAgentExpanded ? 'hidden' : ''}`}
        data-tauri-drag-region
      >
        {/* Left section: Logo and app name */}
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0" data-tauri-drag-region>
          {/* Mobile: back button when agent is active, hamburger otherwise */}
          {isMobile && isAgentExpanded ? (
            <button
              onClick={() => setAgentExpanded(false)}
              className="p-2 rounded hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
              aria-label="Close agent"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : isMobile ? (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
              aria-label="Open menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          ) : null}

          {/* Logo - hidden on mobile, with left padding for macOS traffic lights on desktop */}
          <div className="hidden md:flex items-center gap-2" data-tauri-drag-region>
            <div className="w-7 h-7 rounded-xl border border-border/70 bg-card/80 dark:bg-white/5 dark:border-white/10 shadow-sm backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <BrandMark className="w-[1.625rem] h-[1.625rem] object-contain pointer-events-none select-none drop-shadow-sm" />
            </div>
            <span className="font-semibold text-sm text-foreground leading-tight" data-tauri-drag-region>MyClaudia</span>
          </div>

          {/* Sidebar toggle */}
          {!isMobile && (
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground ml-2"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <ChevronsRight size={16} strokeWidth={2} /> : <ChevronsLeft size={16} strokeWidth={2} />}
            </button>
          )}
        </div>

        {/* Center section: Server selector + Feed */}
        <div className="flex-1 flex items-center justify-start ml-2 md:ml-4 min-w-0 gap-2">
          {isMobile && isAgentExpanded ? (
            <div className="flex items-center gap-2">
              <Bot size={16} strokeWidth={1.75} className="text-primary" />
              <span className="font-semibold text-sm text-foreground">Agent</span>
            </div>
          ) : isMobile ? null : (
            <>
              <ServerSelector />
              {/* Feed toggle + inline dropdown */}
              {!disabledBuiltinPanels.includes('agent-feed') && (
                <div className="relative">
                  <button
                    onClick={() => setFeedOpen(!isFeedOpen)}
                    className={`relative p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors ${
                      isFeedOpen ? 'bg-secondary text-foreground' : ''
                    }`}
                    title={isFeedOpen ? 'Close Notifications' : 'Notifications'}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    {feedUnreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center bg-primary text-primary-foreground text-[9px] font-medium rounded-full px-0.5">
                        {feedUnreadCount > 99 ? '99+' : feedUnreadCount}
                      </span>
                    )}
                  </button>
                </div>
              )}
              {/* Automation button — built-in, lives with other system icons */}
              <button
                onClick={() => {
                  import('./features/automation/openAutomationWindow').then(m => m.openAutomationWindow());
                }}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                title="Automation"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Plugin window buttons — plugin-registered icons on the right */}
        <PluginWindowButtons />

        {/* Agent toggle button — mobile only (desktop uses floating ball) */}
        {isMobile && (
          <button
            onClick={() => setAgentExpanded(!isAgentExpanded)}
            className={`relative p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors mr-2 ${
              isAgentExpanded ? 'bg-secondary text-foreground' : ''
            }`}
            title={isAgentExpanded ? 'Close Claudia' : 'Open Claudia'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {hasClaudiaUnread && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full animate-pulse" />
            )}
          </button>
        )}
      </header>

      {/* Update notification banner (VS Code style) */}
      {!isMobile && <UpdateBanner />}

      {/* Content area: Sidebar + Main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          isMobile={isMobile}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          hideHeader={true}
          onOpenDashboard={(projectId) => {
            selectProject(projectId);
            selectSession(null);
            setDashboardView(projectId, 'home');
            setDashboardProjectId(projectId);
          }}
        />

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {/* Chat Area */}
          <div className="flex-1 overflow-hidden relative">
            {/* Mobile agent panel (full-screen overlay, always mounted to preserve state) */}
            {isMobile && (
              <div className={`absolute inset-0 z-20 bg-background ${isAgentExpanded ? '' : 'hidden'}`}>
                <button
                  onClick={() => setAgentExpanded(false)}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-10
                             flex items-center px-1 py-2
                             bg-zinc-400/60 text-zinc-600 rounded-r-md shadow-sm
                             border border-l-0 border-zinc-300
                             active:bg-zinc-400/80
                             dark:bg-zinc-600/60 dark:text-zinc-400
                             dark:border-zinc-600 dark:active:bg-zinc-600/80"
                  title="Close Claudia"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <ClaudiaChat isMobile={true} />
              </div>
            )}

            {/* Mobile feed panel (full-screen overlay) */}
            {isMobile && isFeedOpen && (
              <div className="absolute inset-0 z-20 bg-background">
                <button
                  onClick={() => setFeedOpen(false)}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-10
                             flex items-center px-1 py-2
                             bg-zinc-400/60 text-zinc-600 rounded-r-md shadow-sm
                             border border-l-0 border-zinc-300
                             active:bg-zinc-400/80
                             dark:bg-zinc-600/60 dark:text-zinc-400
                             dark:border-zinc-600 dark:active:bg-zinc-600/80"
                  title="Close Feed"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <AgentFeedPanel />
              </div>
            )}

            {/* Project Dashboard / Chat / Welcome */}
            {dashboardProjectId && projects.find((p) => p.id === dashboardProjectId) ? (
              <ProjectDashboard
                projectId={dashboardProjectId}
                projectRootPath={projects.find((p) => p.id === dashboardProjectId)!.rootPath}
              />
            ) : selectedSessionId ? (
              <ChatInterface
                key={selectedSessionId}
                sessionId={selectedSessionId}
                onOpenSidebar={() => setSidebarOpen(true)}
                onReturnToDashboard={(projectId) => {
                  selectProject(projectId);
                  selectSession(null);
                  setDashboardProjectId(projectId);
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <h2 className="text-xl font-semibold mb-2">Welcome to MyClaudia</h2>
                  <p>Select a project and session to start chatting</p>
                </div>
              </div>
            )}
          </div>

        </main>

        {/* Desktop: Feed dropdown panel (anchored below header) */}
        {!isMobile && isFeedOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setFeedOpen(false)} />
            <div className="fixed left-1/2 -translate-x-1/2 top-[3.5rem] w-[420px] max-h-[60vh] z-40 bg-card border border-border rounded-lg shadow-lg flex flex-col overflow-hidden">
              <AgentFeedPanel />
            </div>
          </>
        )}

        {/* Desktop: Claudia is now a floating ball window — no side panel */}
      </div>

      {/* Toast notifications */}
      <ToastContainer />

      {/* Fullscreen file viewer overlay (mobile) */}
      {fileViewerFullscreen && fileViewerFilePath && fileViewerProjectRoot && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          <div className="safe-top-spacer bg-card flex-shrink-0" />
          <FileViewerWindow
            filePath={fileViewerFilePath}
            projectRoot={fileViewerProjectRoot}
            onClose={() => setFileViewerFullscreen(false)}
          />
        </div>
      )}
    </div>
  );
}

function App() {
  // Check if this window is a standalone file viewer (opened via "Open in new window")
  const params = new URLSearchParams(window.location.search);
  const fileViewerPath = params.get('fileViewer');
  const fileViewerRoot = params.get('projectRoot');

  if (fileViewerPath && fileViewerRoot) {
    const serverUrl = params.get('serverUrl') || '';
    const authToken = params.get('authToken') || '';
    const serverName = params.get('serverName') || undefined;
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <FileViewerWindow
          filePath={fileViewerPath}
          projectRoot={fileViewerRoot}
          serverUrl={serverUrl}
          authToken={authToken}
          serverName={serverName}
        />
      </ThemeProvider>
    );
  }

  // Check if this window is a standalone automation panel
  if (params.get('automationWindow')) {
    const serverUrl = params.get('serverUrl') || '';
    const authToken = params.get('authToken') || '';
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <AutomationWindow serverUrl={serverUrl} authToken={authToken} />
      </ThemeProvider>
    );
  }

  // Check if this window is a standalone workflow editor
  const workflowEditorProjectId = params.get('workflowEditor');
  if (workflowEditorProjectId) {
    const serverUrl = params.get('serverUrl') || '';
    const authToken = params.get('authToken') || '';
    const workflowId = params.get('workflowId') || undefined;
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <WorkflowEditorWindow
          projectId={workflowEditorProjectId}
          workflowId={workflowId}
          serverUrl={serverUrl}
          authToken={authToken}
          serverId={params.get('serverId') || undefined}
          serverName={params.get('serverName') || undefined}
          gatewayUrl={params.get('gatewayUrl') || undefined}
          gatewaySecret={params.get('gatewaySecret') || undefined}
        />
      </ThemeProvider>
    );
  }

  // Check if this window is a standalone session chat window
  const sessionWindowId = params.get('sessionWindow');
  if (sessionWindowId) {
    const serverUrl = params.get('serverUrl') || '';
    const projectId = params.get('projectId') || '';
    const authToken = params.get('authToken') || '';
    const serverId = params.get('serverId') || undefined;
    const serverName = params.get('serverName') || undefined;
    const gatewayUrl = params.get('gatewayUrl') || undefined;
    const gatewaySecret = params.get('gatewaySecret') || undefined;
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <SessionChatWindow
          sessionId={sessionWindowId}
          projectId={projectId}
          serverUrl={serverUrl}
          authToken={authToken}
          serverId={serverId}
          serverName={serverName}
          gatewayUrl={gatewayUrl}
          gatewaySecret={gatewaySecret}
        />
      </ThemeProvider>
    );
  }

  // Check if this window is a standalone draft editor window
  const draftSessionId = params.get('draftWindow');
  if (draftSessionId) {
    const serverUrl = params.get('serverUrl') || '';
    const authToken = params.get('authToken') || '';
    const serverId = params.get('serverId') || undefined;
    const serverName = params.get('serverName') || undefined;
    const gatewayUrl = params.get('gatewayUrl') || undefined;
    const gatewaySecret = params.get('gatewaySecret') || undefined;
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <DraftWindow
          sessionId={draftSessionId}
          serverUrl={serverUrl}
          authToken={authToken}
          serverId={serverId}
          serverName={serverName}
          gatewayUrl={gatewayUrl}
          gatewaySecret={gatewaySecret}
        />
      </ThemeProvider>
    );
  }

  // Check if this window is a standalone terminal window
  const terminalWindowId = params.get('terminalWindow');
  if (terminalWindowId) {
    const serverUrl = params.get('serverUrl') || '';
    const projectId = params.get('projectId') || '';
    const authToken = params.get('authToken') || '';
    const serverId = params.get('serverId') || undefined;
    const serverName = params.get('serverName') || undefined;
    const gatewayUrl = params.get('gatewayUrl') || undefined;
    const gatewaySecret = params.get('gatewaySecret') || undefined;
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <TerminalWindow
          terminalId={terminalWindowId}
          projectId={projectId}
          serverUrl={serverUrl}
          authToken={authToken}
          serverId={serverId}
          serverName={serverName}
          gatewayUrl={gatewayUrl}
          gatewaySecret={gatewaySecret}
        />
      </ThemeProvider>
    );
  }

  // Check if this window is the Claudia floating ball
  if (params.get('claudiaBall')) {
    return <ClaudiaBallWindow />;
  }

  // Check if this window is the standalone Claudia chat
  if (params.get('claudiaChat')) {
    return (
      <ClaudiaChatWindow
        serverUrl={params.get('serverUrl') || ''}
        authToken={params.get('authToken') || ''}
        serverId={params.get('serverId') || undefined}
        serverName={params.get('serverName') || undefined}
        gatewayUrl={params.get('gatewayUrl') || undefined}
        gatewaySecret={params.get('gatewaySecret') || undefined}
        projectId={params.get('projectId') || undefined}
        contextProjectId={params.get('contextProjectId') || undefined}
      />
    );
  }

  // Check if this window is a standalone plugin window
  const pluginWindowId = params.get('pluginWindow');
  if (pluginWindowId) {
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <PluginWindow pluginId={pluginWindowId} params={params} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark-neutral">
      <ConnectionProvider>
        <AppContent />
      </ConnectionProvider>
    </ThemeProvider>
  );
}

export default App;
