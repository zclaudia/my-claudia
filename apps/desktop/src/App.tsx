import { useEffect, useState, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Bot, ChevronsRight, ChevronsLeft, MessageSquare, Activity, Clock, Cloud, Gauge, StickyNote, Puzzle, type LucideIcon } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar } from './components/Sidebar';
import { ChatInterface } from './components/chat/ChatInterface';
import { ServerSelector } from './components/ServerSelector';
import { MobileSetup } from './components/MobileSetup';
import { WindowsSetup } from './components/WindowsSetup';
import { ClaudiaChat } from './components/claudia/ClaudiaChat';
import { NotificationsPanel } from './components/notifications/NotificationsPanel';
import { useNotificationFeedStore } from './stores/notificationFeedStore';
import { ToastContainer } from './components/ToastContainer';

// Lazy-loaded popout windows (only loaded when the specific window type is opened)
const FileViewerWindow = lazy(() => import('./components/fileviewer/FileViewerWindow').then(m => ({ default: m.FileViewerWindow })));
const WorkflowEditorWindow = lazy(() => import('./features/workflows/components/WorkflowEditorWindow').then(m => ({ default: m.WorkflowEditorWindow })));
const AutomationWindow = lazy(() => import('./features/automation/AutomationWindow').then(m => ({ default: m.AutomationWindow })));
const SessionChatWindow = lazy(() => import('./components/chat/SessionChatWindow').then(m => ({ default: m.SessionChatWindow })));
const TerminalWindow = lazy(() => import('./components/terminal/TerminalWindow').then(m => ({ default: m.TerminalWindow })));
const DraftWindow = lazy(() => import('./components/draft/DraftWindow').then(m => ({ default: m.DraftWindow })));
const PluginWindow = lazy(() => import('./components/PluginWindow').then(m => ({ default: m.PluginWindow })));
const ClaudiaBallWindow = lazy(() => import('./components/claudia/ClaudiaBallWindow').then(m => ({ default: m.ClaudiaBallWindow })));
const ClaudiaChatWindow = lazy(() => import('./components/claudia/ClaudiaChatWindow').then(m => ({ default: m.ClaudiaChatWindow })));

// Lazy-loaded heavy feature components
const ProjectDashboard = lazy(() => import('./components/dashboard/ProjectDashboard').then(m => ({ default: m.ProjectDashboard })));
import { ThemeProvider } from './contexts/ThemeContext';
import { ConnectionProvider, useConnection } from './contexts/ConnectionContext';
import { useDataLoader } from './hooks/useDataLoader';
import { useSelectionCoordinator } from './hooks/useSelectionCoordinator';
import { useServerStore } from './stores/serverStore';
import { useFacadeStore } from './stores/facadeStore';
import { useGatewayStore } from './stores/gatewayStore';
import { useProjectStore } from './stores/projectStore';
import { useClaudiaStore } from './stores/claudiaStore';
import { useIsMobile } from './hooks/useMediaQuery';
import { canReachBackend } from './utils/backendConnection';
import { useClaudiaStatus } from './hooks/useClaudiaStatus';
import { useAndroidBack } from './hooks/useAndroidBack';
import { useSwipeBack } from './hooks/useSwipeBack';
import { eagerSyncAllBackends } from './services/sessionSync';
import { useFileViewerStore } from './stores/fileViewerStore';
import { useUIStore } from './stores/uiStore';
import { useTerminalStore } from './stores/terminalStore';
import { usePluginStore, selectPluginPanels } from './stores/pluginStore';
import { useDraftEditorStore } from './stores/draftEditorStore';
import { LEGACY_LOCAL_SERVER_ID, resolveCanonicalBackendId } from './utils/controlPlane';
import { xtermRegistry } from './utils/xtermRegistry';
import { initBuiltinPanels } from './plugins/builtinPanels';
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { useServerLatencyMonitor } from './hooks/useServerLatencyMonitor';
import { useActiveSessionStream } from './hooks/useActiveSessionStream';
import { UpdateBanner } from './components/UpdateBanner';
import { BrandMark } from './components/BrandMark';
import { useShortcutStore } from './stores/shortcutStore';
import { useAgentConfigStore } from './stores/agentConfigStore';
import { isDesktopTauri } from './utils/platform';
import { isLocalBackendId, resolveLocalBackendId } from './utils/controlPlane';
import { shouldShowDirectGatewaySetup } from './utils/directGatewaySetup';

// ── Plugin Dock ─────────────────────────────────────────────────
// Icon name → Lucide component mapping for plugin-declared icons.
// Plugins can also use image files (icon.svg / icon.png) in their ui/ directory.
const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
  MessageSquare, Activity, Clock, Cloud, Gauge, StickyNote, Puzzle, Bot,
};

function PluginIcon({ name, pluginId, size = 16 }: { name?: string; pluginId?: string; size?: number }) {
  // Image file: icon value contains a file extension (e.g. "icon.svg", "logo.png")
  const localServerPort = useServerStore(s => s.localServerPort);
  if (name && pluginId && /\.\w+$/.test(name)) {
    const baseUrl = `http://localhost:${localServerPort || 3100}`;
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

  if (pluginPanels.length === 0 || !isDesktopTauri()) return null;

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
  const { activeServerId, controlPlaneState } = useServerStore();
  const { selectedSessionId, selectedProjectId, sessions, projects, selectSession, setDashboardView } = useProjectStore();
  const { selectProject } = useSelectionCoordinator();
  const [dashboardProjectId, setDashboardProjectId] = useState<string | null>(null);
  const openAutomationWindowFn = useCallback(() => {
    import('./features/automation/openAutomationWindow').then(m => m.openAutomationWindow());
  }, []);
  const { directGatewayUrl, lastActiveBackendId } = useGatewayStore();
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const { isExpanded: isAgentExpanded, setExpanded: setAgentExpanded } = useClaudiaStore();
  const { hasUnread: hasClaudiaUnread, hasRunning: hasClaudiaRunning, hasPermissionPending: hasClaudiaPermissionPending } = useClaudiaStatus();
  const disabledBuiltinPanels = usePluginStore((s) => s.disabledBuiltinPanels);
  const notificationUnreadCount = useNotificationFeedStore((s) => s.unreadCount);
  const [isFeedOpen, setFeedOpen] = useState(false);
  const fileViewerFullscreen = useFileViewerStore((s) => s.fullscreen);
  const fileViewerFilePath = useFileViewerStore((s) => s.filePath);
  const fileViewerProjectRoot = useFileViewerStore((s) => s.projectRoot);
  const setFileViewerFullscreen = useFileViewerStore((s) => s.setFullscreen);
  const removePoppedOutSession = useUIStore((s) => s.removePoppedOutSession);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agentSwipePreview, setAgentSwipePreview] = useState<{
    mode: 'open' | 'close' | null;
    progress: number;
  }>({ mode: null, progress: 0 });
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
  const agentConfig = useAgentConfigStore((s) => s.config);
  const agentConfigLoaded = useAgentConfigStore((s) => s.hasLoaded);
  const loadAgentConfig = useAgentConfigStore((s) => s.loadConfig);
  const localServerPort = useServerStore((s) => s.localServerPort);
  const facadeLocalBackendId = useFacadeStore((s) => s.localBackendId);
  const localBackendId = facadeLocalBackendId || resolveLocalBackendId();
  const localBackendName = useFacadeStore((s) =>
    s.backends.find((backend) => backend.backendId === (s.localBackendId || resolveLocalBackendId()))?.name
  );
  const shortcut = useShortcutStore((s) => s.shortcut);
  const shortcutEnabled = useShortcutStore((s) => s.enabled);
  const claudiaServerUrl = useMemo(() => {
    return `http://localhost:${localServerPort || 3100}`;
  }, [localServerPort]);
  const claudiaSwipePreviewProgress = useMemo(() => {
    const progress = Math.max(0, Math.min(1, agentSwipePreview.progress));
    if (progress === 0 || progress === 1) return progress;
    // Add a light damping curve so the panel lags the finger slightly and eases in.
    return Math.min(1, progress * 0.72 + progress * progress * 0.28);
  }, [agentSwipePreview.progress]);
  const claudiaOverlayOpacity = useMemo(() => {
    if (agentSwipePreview.mode === 'open') {
      return claudiaSwipePreviewProgress * 0.14;
    }
    if (agentSwipePreview.mode === 'close') {
      return (1 - claudiaSwipePreviewProgress) * 0.14;
    }
    return isAgentExpanded ? 0.14 : 0;
  }, [agentSwipePreview.mode, claudiaSwipePreviewProgress, isAgentExpanded]);
  const dashboardProject = dashboardProjectId
    ? projects.find((project) => project.id === dashboardProjectId) || null
    : null;

  useActiveSessionStream();

  const mobileInitDone = useRef(false);
  const hasConnected = useRef(false);

  // Track if we've ever connected (to avoid showing loading on reconnect)
  if (controlPlaneState === 'ready') {
    hasConnected.current = true;
  }

  // Register builtin plugin panel components (once at startup)
  useEffect(() => { initBuiltinPanels(); }, []);

  // Initialize global shortcut config (once at startup, desktop only)
  useEffect(() => {
    if (!isDesktopTauri()) return;
    const { loadConfig } = useShortcutStore.getState();
    void loadConfig();
  }, []);

  useEffect(() => {
    if (controlPlaneState !== 'ready') return;
    void loadAgentConfig();
  }, [controlPlaneState, loadAgentConfig]);

  useEffect(() => {
    if (controlPlaneState !== 'ready' || !agentConfigLoaded || !agentConfig?.enabled) return;
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
  }, [agentConfig?.enabled, agentConfigLoaded, controlPlaneState]);

  // Keep desktop floating ball visibility in sync with the Claudia master toggle.
  useEffect(() => {
    if (!isDesktopTauri() || isMobile || !agentConfigLoaded) return;
    (async () => {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const { invoke } = await import('@tauri-apps/api/core');
        const { emit } = await import('@tauri-apps/api/event');
        const existing = await WebviewWindow.getByLabel('claudia-ball');
        const existingChat = await WebviewWindow.getByLabel('claudia-chat');

        if (!agentConfig?.enabled) {
          if (existingChat) {
            await existingChat.hide().catch(() => undefined);
          }
          if (existing) {
            await existing.hide().catch(() => undefined);
          }
          return;
        }

        if (!claudiaProjectId) return;

        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const authToken = ''; // Local server trusts localhost connections
        const serverId = resolveCanonicalBackendId(localBackendId ?? LEGACY_LOCAL_SERVER_ID, localBackendId) || LEGACY_LOCAL_SERVER_ID;
        const serverName = localBackendName || 'Local Server';
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
        } else {
          const chatVisible = existingChat
            ? await existingChat.isVisible().catch(() => false)
            : false;
          if (!chatVisible) {
            await existing.show().catch(() => undefined);
          }
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
  }, [agentConfig?.enabled, agentConfigLoaded, claudiaContextProjectId, claudiaProjectId, claudiaServerUrl, isMobile, localBackendId, localBackendName]);

  useEffect(() => {
    if (!isDesktopTauri() || isMobile || !agentConfigLoaded) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('update_global_shortcut', {
          shortcut: agentConfig?.enabled && shortcutEnabled ? shortcut : null,
        });
      } catch (err) {
        console.warn('[App] Failed to sync Claudia shortcut state:', err);
      }
    })();
  }, [agentConfig?.enabled, agentConfigLoaded, isMobile, shortcut, shortcutEnabled]);

  useEffect(() => {
    if (!isDesktopTauri() || isMobile) return;
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

  // Mobile swipe: left-swipe from the center band to open Claudia Chat.
  // Avoid the physical screen edges so Android system back gestures can keep priority there.
  const swipeOpenClaudiaRef = useSwipeBack({
    onSwipe: () => setAgentExpanded(true),
    onProgress: (progress) => setAgentSwipePreview(progress > 0 ? { mode: 'open', progress } : { mode: null, progress: 0 }),
    enabled: isMobile && !isAgentExpanded && !sidebarOpen && !fileViewerFullscreen,
    direction: 'left',
    startZone: { startRatio: 0.25, endRatio: 0.75 },
    threshold: 60,
  });

  // Mobile swipe: right-swipe anywhere in Claudia Chat to close
  const swipeCloseClaudiaRef = useSwipeBack({
    onSwipe: () => setAgentExpanded(false),
    onProgress: (progress) => setAgentSwipePreview(progress > 0 ? { mode: 'close', progress } : { mode: null, progress: 0 }),
    enabled: isMobile && isAgentExpanded,
    direction: 'right',
    fullWidth: true,
    threshold: 60,
    velocityThreshold: 0.18,
  });

  useEffect(() => {
    if (isAgentExpanded) {
      setAgentSwipePreview((current) => current.mode === 'open' ? { mode: null, progress: 0 } : current);
      return;
    }
    setAgentSwipePreview((current) => current.mode === 'close' ? { mode: null, progress: 0 } : current);
  }, [isAgentExpanded]);

  // Mobile: prevent localhost connection on initial load
  useEffect(() => {
    if (!isMobile || mobileInitDone.current) return;
    mobileInitDone.current = true;

    const { activeServerId } = useServerStore.getState();
    if (isLocalBackendId(activeServerId)) {
      useServerStore.getState().setActiveServer(null);
    }
  }, [isMobile]);

  // Mobile: auto-reconnect to last used backend when gateway discovers it
  const mobileAutoConnectDone = useRef(false);
  useEffect(() => {
    if (!isMobile || mobileAutoConnectDone.current) return;
    if (!lastActiveBackendId) return;
    if (facadeConnectionState !== 'connected') return;

    const backendId = lastActiveBackendId;
    const activeBackend = facadeBackends.find((b) => b.backendId === activeServerId);
    const activeBackendReady = activeBackend?.runtimeState === 'ready' || activeBackend?.runtimeState === 'opening';
    // Manual selection already chose the backend in this app lifetime.
    // Only auto-reconnect when restoring from a cold start.
    if (activeServerId === backendId && activeBackendReady) {
      mobileAutoConnectDone.current = true;
      return;
    }

    // Check if the last backend is online
    const backendOnline = facadeBackends.some((b) => b.backendId === backendId && canReachBackend(facadeConnectionState, b));
    if (!backendOnline) return;

    // Auto-connect once
    mobileAutoConnectDone.current = true;
    console.log('[App] Auto-reconnecting to last used backend:', lastActiveBackendId);
    useServerStore.getState().setActiveServer(lastActiveBackendId);
    connectServer(lastActiveBackendId);
  }, [isMobile, lastActiveBackendId, facadeConnectionState, facadeBackends, activeServerId, connectServer]);

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

  const requiresDirectGatewaySetup = shouldShowDirectGatewaySetup({
    directGatewayUrl,
    activeServerId,
    availableBackendIds: facadeBackends.map((backend) => backend.backendId),
  });

  // Mobile: require both gateway config and an available backend selection.
  if (isMobile && requiresDirectGatewaySetup) {
    return <MobileSetup />;
  }

  // Windows: show setup screen when server is not configured
  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
  const hasConnectedServer = controlPlaneState === 'ready' || hasConnected.current;
  const shouldRenderWindowsSetup = isWindows
    && embeddedServerStatus === 'wsl-mode'
    && (!hasConnectedServer || (directGatewayUrl ? requiresDirectGatewaySetup : false));

  if (shouldRenderWindowsSetup) {
    return <WindowsSetup />;
  }

  // Desktop: show loading screen during initial startup
  if (!isMobile && !hasConnected.current && controlPlaneState !== 'ready') {
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
            <span className="font-semibold text-sm text-foreground">Claudia</span>
          ) : isMobile ? null : (
            <>
              <ServerSelector />
              {/* Feed toggle + inline dropdown */}
              {!disabledBuiltinPanels.includes('notifications') && (
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
                    {notificationUnreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center bg-primary text-primary-foreground text-[9px] font-medium rounded-full px-0.5">
                        {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Plugin window buttons — plugin-registered icons on the right */}
        <PluginWindowButtons />

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
          onOpenNotifications={() => {
            setAgentExpanded(false);
            setFeedOpen((current) => !current);
          }}
          isNotificationsOpen={isFeedOpen}
          onOpenDashboard={(projectId) => {
            selectProject(projectId);
            selectSession(null);
            setDashboardView(projectId, 'home');
            setDashboardProjectId(projectId);
          }}
          onOpenAutomations={openAutomationWindowFn}
        />

        {/* Main Content */}
        <main ref={swipeOpenClaudiaRef} className="flex-1 flex flex-col overflow-hidden relative">
          {!isMobile && (
            <ToastContainer className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex flex-col gap-2 pointer-events-none" />
          )}

          {/* Chat Area */}
          <div className="flex-1 overflow-hidden relative">
            {isMobile && (isAgentExpanded || agentSwipePreview.mode === 'open' || agentSwipePreview.mode === 'close') && (
              <div
                className={`absolute inset-0 z-10 bg-black/100 ${
                  agentSwipePreview.mode ? 'transition-none' : 'transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
                }`}
                style={{
                  opacity: claudiaOverlayOpacity,
                  pointerEvents: 'none',
                }}
              />
            )}
            {/* Mobile agent panel (full-screen overlay, always mounted to preserve state) */}
            {isMobile && (
              <div
                ref={swipeCloseClaudiaRef}
                className={`absolute inset-0 z-20 bg-background will-change-transform ${
                  isAgentExpanded || agentSwipePreview.mode === 'open' ? '' : 'hidden'
                } ${
                  agentSwipePreview.mode ? 'transition-none' : 'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
                }`}
                style={{
                  transform: isAgentExpanded
                    ? `translateX(${agentSwipePreview.mode === 'close' ? claudiaSwipePreviewProgress * 100 : 0}%)`
                    : `translateX(${(1 - (agentSwipePreview.mode === 'open' ? claudiaSwipePreviewProgress : 0)) * 100}%)`,
                  pointerEvents: isAgentExpanded ? 'auto' : 'none',
                  boxShadow: isAgentExpanded || agentSwipePreview.mode === 'open'
                    ? `-16px 0 40px rgba(0, 0, 0, ${0.14 + claudiaSwipePreviewProgress * 0.08})`
                    : 'none',
                }}
              >
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
                  aria-label="Close Claudia"
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
                <NotificationsPanel />
              </div>
            )}

            {/* Project Dashboard / Chat / Welcome */}
            {dashboardProject ? (
              <Suspense fallback={<LazyFallback />}>
                <ProjectDashboard
                  projectId={dashboardProject.id}
                  projectRootPath={dashboardProject.rootPath}
                  onOpenAutomations={openAutomationWindowFn}
                />
              </Suspense>
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
              <NotificationsPanel />
            </div>
          </>
        )}

        {/* Desktop: Claudia is now a floating ball window — no side panel */}
      </div>

      {/* Toast notifications */}
      {isMobile && <ToastContainer />}

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

const LazyFallback = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>
  </div>
);

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
        <ErrorBoundary label="FileViewer">
          <Suspense fallback={<LazyFallback />}>
          <FileViewerWindow
            filePath={fileViewerPath}
            projectRoot={fileViewerRoot}
            serverUrl={serverUrl}
            authToken={authToken}
            serverName={serverName}
          />
        </Suspense>
          </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Check if this window is a standalone automation panel
  if (params.get('automationWindow')) {
    const serverUrl = params.get('serverUrl') || '';
    const authToken = params.get('authToken') || '';
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <ErrorBoundary label="Automation">
          <Suspense fallback={<LazyFallback />}>
          <AutomationWindow serverUrl={serverUrl} authToken={authToken} />
        </Suspense>
          </ErrorBoundary>
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
        <ErrorBoundary label="WorkflowEditor">
          <Suspense fallback={<LazyFallback />}>
          <WorkflowEditorWindow
            projectId={workflowEditorProjectId}
            workflowId={workflowId}
            serverUrl={serverUrl}
            authToken={authToken}
            serverId={params.get('serverId') || undefined}
            serverName={params.get('serverName') || undefined}
            gatewayUrl={params.get('gatewayUrl') || undefined}
            gatewaySecret={params.get('gatewaySecret') || undefined}
            initialMode={(params.get('initialMode') as 'toolbox' | 'ai') || undefined}
          />
        </Suspense>
          </ErrorBoundary>
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
        <ErrorBoundary label="SessionChat">
          <Suspense fallback={<LazyFallback />}>
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
        </Suspense>
          </ErrorBoundary>
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
        <ErrorBoundary label="DraftEditor">
          <Suspense fallback={<LazyFallback />}>
          <DraftWindow
            sessionId={draftSessionId}
            serverUrl={serverUrl}
            authToken={authToken}
            serverId={serverId}
            serverName={serverName}
            gatewayUrl={gatewayUrl}
            gatewaySecret={gatewaySecret}
          />
        </Suspense>
          </ErrorBoundary>
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
        <ErrorBoundary label="Terminal">
          <Suspense fallback={<LazyFallback />}>
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
        </Suspense>
          </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Check if this window is the Claudia floating ball
  if (params.get('claudiaBall')) {
    return <Suspense fallback={<LazyFallback />}><ClaudiaBallWindow /></Suspense>;
  }

  // Check if this window is the standalone Claudia chat
  if (params.get('claudiaChat')) {
    return (
      <Suspense fallback={<LazyFallback />}>
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
      </Suspense>
    );
  }

  // Check if this window is a standalone plugin window
  const pluginWindowId = params.get('pluginWindow');
  if (pluginWindowId) {
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <ErrorBoundary label="Plugin">
          <Suspense fallback={<LazyFallback />}>
          <PluginWindow pluginId={pluginWindowId} params={params} />
        </Suspense>
          </ErrorBoundary>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark-neutral">
      <ErrorBoundary label="App">
        <ConnectionProvider>
          <AppContent />
        </ConnectionProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
