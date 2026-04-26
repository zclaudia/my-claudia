import { useEffect, useState, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { ChevronsRight, ChevronsLeft } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ChatInterface } from './components/chat/ChatInterface';
import { ServerSelector } from './components/ServerSelector';
import { MobileSetup } from './components/MobileSetup';
import { WindowsSetup } from './components/WindowsSetup';
import { ClaudiaChat } from './components/claudia/ClaudiaChat';
import { NotificationsPanel } from './components/notifications/NotificationsPanel';
import { useNotificationFeedStore } from './stores/notificationFeedStore';
import { ToastContainer } from './components/ToastContainer';
import { useNotchBridgeHost } from './hooks/useNotchBridgeHost';
import { emit as emitTauri } from '@tauri-apps/api/event';
import { NOTCH_EVENT } from './services/notchBridge';
import { WindowRouter } from './app/WindowRouter';
import { PluginWindowButtons } from './app/PluginDock';

// Lazy-loaded heavy feature components
const FileViewerWindow = lazy(() => import('./components/fileviewer/FileViewerWindow').then(m => ({ default: m.FileViewerWindow })));
const ProjectDashboard = lazy(() => import('./components/dashboard/ProjectDashboard').then(m => ({ default: m.ProjectDashboard })));

const LazyFallback = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>
  </div>
);
import { useConnection } from './contexts/ConnectionContext';
import { useDataLoader } from './hooks/useDataLoader';
import { useSelectionCoordinator } from './hooks/useSelectionCoordinator';
import { useServerStore } from './stores/serverStore';
import { useFacadeStore } from './stores/facadeStore';
import { useGatewayStore } from './stores/gatewayStore';
import { useProjectStore } from './stores/projectStore';
import { useSelectionStore } from './stores/selectionStore';
import { useClaudiaStore } from './stores/claudiaStore';
import { useIsMobile } from './hooks/useMediaQuery';
import { useClaudiaStatus } from './hooks/useClaudiaStatus';
import { useAndroidBack } from './hooks/useAndroidBack';
import { useSwipeBack } from './hooks/useSwipeBack';
import { useFileViewerStore } from './stores/fileViewerStore';
import { useUIStore } from './stores/uiStore';
import { useTerminalStore } from './stores/terminalStore';
import { usePluginStore } from './stores/pluginStore';
import { useDraftEditorStore } from './stores/draftEditorStore';
import { LEGACY_LOCAL_SERVER_ID, resolveCanonicalBackendId } from './utils/controlPlane';
import { xtermRegistry } from './utils/xtermRegistry';
import { initBuiltinPanels } from './plugins/builtinPanels';
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { useServerLatencyMonitor } from './hooks/useServerLatencyMonitor';
import { useActiveSessionStream } from './hooks/useActiveSessionStream';
import { useMainWindowGeometry } from './hooks/useMainWindowGeometry';
import { useRecoveryStore } from './stores/recoveryStore';
import { UpdateBanner } from './components/UpdateBanner';
import { BrandMark } from './components/BrandMark';
import { useShortcutStore } from './stores/shortcutStore';
import { useAgentConfigStore } from './stores/agentConfigStore';
import { isDesktopTauri } from './utils/platform';
import { isLocalBackendId, resolveLocalBackendId } from './utils/controlPlane';
import { shouldShowDirectGatewaySetup } from './utils/directGatewaySetup';
import {
  clearSelectionDeepLinkFromCurrentUrl,
  consumeSelectionDeepLinkFromWindow,
  hasSelectionDeepLinkTarget,
  parseSelectionDeepLink,
  parseSelectionDeepLinkUrl,
  SELECTION_DEEP_LINK_EVENT,
  type SelectionDeepLinkTarget,
} from './utils/selectionDeepLink';
import {
  getMobileBackendViewState,
  getMobileControlPlaneState,
  isMobileGatewayConnected,
} from './services/mobileConnectionState';

function AppContent() {
  const { connectServer, embeddedServerStatus, embeddedServerError } = useConnection();
  const isMobile = useIsMobile();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const transportStatus = useRecoveryStore((s) => s.transport.status);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeSnapshotVersion = useFacadeStore((s) => s.snapshotVersion);
  const controlPlaneState = isMobile
    ? getMobileControlPlaneState(facadeConnectionState, facadeSnapshotVersion)
    : (transportStatus === 'connected' ? 'ready' : transportStatus === 'error' ? 'error' : 'connecting');
  const selectedSessionId = useSelectionStore((s) => s.selectedSessionId);
  const selectedProjectId = useSelectionStore((s) => s.selectedProjectId);
  const sessions = useProjectStore((s) => s.sessions);
  const projects = useProjectStore((s) => s.projects);
  const selectSession = useProjectStore((s) => s.selectSession);
  const setDashboardView = useSelectionStore((s) => s.setDashboardView);
  const { selectBackend, selectProject: selectProjectRoute, selectSession: selectSessionRoute } = useSelectionCoordinator();
  const [dashboardProjectId, setDashboardProjectId] = useState<string | null>(null);
  const openAutomationWindowFn = useCallback(() => {
    import('./features/automation/openAutomationWindow').then(m => m.openAutomationWindow());
  }, []);
  const directGatewayUrl = useGatewayStore((s) => s.directGatewayUrl);
  const lastActiveBackendId = useGatewayStore((s) => s.lastActiveBackendId);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const isAgentExpanded = useClaudiaStore((s) => s.isExpanded);
  const setAgentExpanded = useClaudiaStore((s) => s.setExpanded);
  const { hasUnread: hasClaudiaUnread, hasRunning: hasClaudiaRunning, hasPermissionPending: hasClaudiaPermissionPending } = useClaudiaStatus();
  const disabledBuiltinPanels = usePluginStore((s) => s.disabledBuiltinPanels);
  const notificationUnreadCount = useNotificationFeedStore((s) => s.unreadCount);
  const [isFeedOpen, setFeedOpen] = useState(false);
  useMainWindowGeometry();
  // Host bridge: on desktop, spawn the independent notch window and keep it in sync.
  useNotchBridgeHost({ enabled: !isMobile });
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

  const applySelectionDeepLinkTarget = useCallback((target: SelectionDeepLinkTarget) => {
    if (!hasSelectionDeepLinkTarget(target)) return;

    if (target.sessionId) {
      selectSessionRoute(target.sessionId, { backendId: target.backendId });
      return;
    }

    if (target.projectId) {
      if (target.backendId) selectBackend(target.backendId);
      selectProjectRoute(target.projectId);
      return;
    }

    if (target.backendId) {
      selectBackend(target.backendId);
    }
  }, [selectBackend, selectProjectRoute, selectSessionRoute]);

  useEffect(() => {
    if (controlPlaneState !== 'ready') return;
    const target = parseSelectionDeepLink(window.location.search);
    if (!hasSelectionDeepLinkTarget(target)) return;

    applySelectionDeepLinkTarget(target);
    clearSelectionDeepLinkFromCurrentUrl();
  }, [applySelectionDeepLinkTarget, controlPlaneState]);

  useEffect(() => {
    if (controlPlaneState !== 'ready') return;

    const pendingTarget = consumeSelectionDeepLinkFromWindow();
    if (pendingTarget) {
      applySelectionDeepLinkTarget(pendingTarget);
    }

    const handleSelectionTarget = (event: Event) => {
      const rawTarget = (event as CustomEvent<string>).detail;
      if (typeof rawTarget !== 'string' || !rawTarget.trim()) return;
      applySelectionDeepLinkTarget(parseSelectionDeepLinkUrl(rawTarget));
    };

    window.addEventListener(SELECTION_DEEP_LINK_EVENT, handleSelectionTarget as EventListener);
    return () => {
      window.removeEventListener(SELECTION_DEEP_LINK_EVENT, handleSelectionTarget as EventListener);
    };
  }, [applySelectionDeepLinkTarget, controlPlaneState]);

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
    if (!isMobileGatewayConnected(facadeConnectionState)) return;

    const backendId = lastActiveBackendId;
    const activeBackendViewState = getMobileBackendViewState(
      backendId,
      facadeConnectionState,
      facadeBackends,
    );
    const activeBackendReady = activeBackendViewState === 'ready' || activeBackendViewState === 'backend_subscribing';
    if (activeServerId === backendId && activeBackendReady) {
      mobileAutoConnectDone.current = true;
      return;
    }

    const backendViewState = getMobileBackendViewState(
      backendId,
      facadeConnectionState,
      facadeBackends,
    );
    if (backendViewState === 'offline') return;

    mobileAutoConnectDone.current = true;
    console.log('[App] Auto-reconnecting to last used backend:', lastActiveBackendId);
    useServerStore.getState().setActiveServer(lastActiveBackendId);
    connectServer(lastActiveBackendId);
  }, [isMobile, lastActiveBackendId, facadeConnectionState, facadeBackends, activeServerId, connectServer]);

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
              {/* Feed toggle — desktop routes through the independent notch window */}
              {!disabledBuiltinPanels.includes('notifications') && (
                <div className="relative">
                  <button
                    onClick={() => { void emitTauri(NOTCH_EVENT.toggle, {}); }}
                    className="relative p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Notifications"
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
            if (isMobile) {
              setFeedOpen((current) => !current);
            } else {
              void emitTauri(NOTCH_EVENT.toggle, {});
            }
          }}
          isNotificationsOpen={isMobile ? isFeedOpen : false}
          onOpenDashboard={(projectId) => {
            selectProjectRoute(projectId);
            selectSession(null);
            setDashboardView(projectId, 'home');
            setDashboardProjectId(projectId);
          }}
          onOpenAutomations={openAutomationWindowFn}
        />

        {/* Main Content */}
        <main ref={swipeOpenClaudiaRef} className="flex-1 flex flex-col overflow-hidden relative">
          {/* Desktop: NotchPanel lives in the independent top-of-screen `notch` window.
              Mobile: keep the in-window NotchPanel as a fallback since Tauri mobile
              does not support an independent always-on-top window. */}

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
                  selectProjectRoute(projectId);
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

        {/* Desktop: Claudia is now a floating ball window — no side panel.
            Notifications dropdown is handled by NotchPanel at top-center (灵动岛). */}
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

function App() {
  return (
    <WindowRouter>
      <AppContent />
    </WindowRouter>
  );
}

export default App;
