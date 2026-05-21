import { useEffect, useState, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { emit as emitTauri } from '@tauri-apps/api/event';
import { NOTCH_EVENT } from './services/notchBridge';
import { Sidebar } from './features/sidebar/Sidebar';
import { SessionChatLayout } from './features/chat/SessionChatLayout';
import { MobileSetup } from './components/setup/MobileSetup';
import { WindowsSetup } from './components/setup/WindowsSetup';
import { ToastContainer } from './components/ToastContainer';
import { UpdateBanner } from './components/UpdateBanner';
import { WindowRouter } from './app/WindowRouter';
import { AppHeader } from './app/AppHeader';
import { MobileOverlays } from './app/MobileOverlays';
import { useConnection } from './contexts/ConnectionContext';
import { useDataLoader } from './hooks/useDataLoader';
import { useSelectionCoordinator } from './hooks/useSelectionCoordinator';
import { useIsMobile } from './hooks/useMediaQuery';
import { useAndroidBack } from './hooks/useAndroidBack';
import { useSwipeBack } from './hooks/useSwipeBack';
import { useNotchBridgeHost } from './hooks/useNotchBridgeHost';
import { useAutoUpdate } from './hooks/useAutoUpdate';
import { useServerLatencyMonitor } from './hooks/useServerLatencyMonitor';
import { useActiveSessionStream } from './hooks/useActiveSessionStream';
import { useMainWindowGeometry } from './hooks/useMainWindowGeometry';
import { useClaudiaDesktop } from './hooks/useClaudiaDesktop';
import { useDeepLinkNavigation } from './hooks/useDeepLinkNavigation';
import { useMobileInit } from './hooks/useMobileInit';
import { useTauriWindowEvents } from './hooks/useTauriWindowEvents';
import { useServerStore } from './stores/serverStore';
import { useFacadeStore } from './stores/facadeStore';
import { useProjectStore } from './stores/projectStore';
import { useSelectionStore } from './stores/selectionStore';
import { useClaudiaStore } from './stores/claudiaStore';
import { useFileViewerStore } from './stores/fileViewerStore';
import { usePluginStore } from './stores/pluginStore';
import { useRecoveryStore } from './stores/recoveryStore';
import { useNotificationFeedStore } from './stores/notificationFeedStore';
import { useGatewayStore } from './stores/gatewayStore';
import { useShortcutStore } from './stores/shortcutStore';
import { isDesktopTauri } from './utils/platform';
import { initBuiltinPanels } from './plugins/builtinPanels';
import { shouldShowDirectGatewaySetup } from './utils/directGatewaySetup';
import { getMobileControlPlaneState } from './services/mobileConnectionState';
import type { OpenAutomationWindowOptions } from './features/automation/openAutomationWindow';

const FileViewerWindow = lazy(() => import('./components/fileviewer/FileViewerWindow').then(m => ({ default: m.FileViewerWindow })));
const ProjectDashboard = lazy(() => import('./features/dashboard/ProjectDashboard').then(m => ({ default: m.ProjectDashboard })));

const LazyFallback = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>
  </div>
);

function AppContent() {
  const { embeddedServerStatus, embeddedServerError } = useConnection();
  const isMobile = useIsMobile();

  // --- Store selectors ---
  const activeServerId = useServerStore((s) => s.activeServerId);
  const transportStatus = useRecoveryStore((s) => s.transport.status);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeSnapshotVersion = useFacadeStore((s) => s.snapshotVersion);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const selectedSessionId = useSelectionStore((s) => s.selectedSessionId);
  const selectedProjectId = useSelectionStore((s) => s.selectedProjectId);
  const sessions = useProjectStore((s) => s.sessions);
  const projects = useProjectStore((s) => s.projects);
  const selectSession = useProjectStore((s) => s.selectSession);
  const setDashboardView = useSelectionStore((s) => s.setDashboardView);
  const isAgentExpanded = useClaudiaStore((s) => s.isExpanded);
  const setAgentExpanded = useClaudiaStore((s) => s.setExpanded);
  const disabledBuiltinPanels = usePluginStore((s) => s.disabledBuiltinPanels);
  const notificationUnreadCount = useNotificationFeedStore((s) => s.unreadCount);
  const directGatewayUrl = useGatewayStore((s) => s.directGatewayUrl);
  const fileViewerFullscreen = useFileViewerStore((s) => s.fullscreen);
  const fileViewerFilePath = useFileViewerStore((s) => s.filePath);
  const fileViewerProjectRoot = useFileViewerStore((s) => s.projectRoot);
  const setFileViewerFullscreen = useFileViewerStore((s) => s.setFullscreen);

  const { selectBackend: _selectBackend, selectProject: selectProjectRoute, selectSession: _selectSessionRoute } = useSelectionCoordinator();

  // --- Local state ---
  const [dashboardProjectId, setDashboardProjectId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isFeedOpen, setFeedOpen] = useState(false);
  const [agentSwipePreview, setAgentSwipePreview] = useState<{
    mode: 'open' | 'close' | null;
    progress: number;
  }>({ mode: null, progress: 0 });

  const hasConnected = useRef(false);

  // --- Derived state ---
  const controlPlaneState = isMobile
    ? getMobileControlPlaneState(facadeConnectionState, facadeSnapshotVersion)
    : (transportStatus === 'connected' ? 'ready' : transportStatus === 'error' ? 'error' : 'connecting');

  if (controlPlaneState === 'ready') {
    hasConnected.current = true;
  }

  const selectedSession = selectedSessionId ? sessions.find((s) => s.id === selectedSessionId) ?? null : null;
  const dashboardProject = dashboardProjectId
    ? projects.find((p) => p.id === dashboardProjectId) || null
    : null;

  const currentContextProjectId = selectedSession?.projectId || dashboardProjectId || selectedProjectId || null;

  const claudiaSwipePreviewProgress = useMemo(() => {
    const progress = Math.max(0, Math.min(1, agentSwipePreview.progress));
    if (progress === 0 || progress === 1) return progress;
    return Math.min(1, progress * 0.72 + progress * progress * 0.28);
  }, [agentSwipePreview.progress]);

  const claudiaOverlayOpacity = useMemo(() => {
    if (agentSwipePreview.mode === 'open') return claudiaSwipePreviewProgress * 0.14;
    if (agentSwipePreview.mode === 'close') return (1 - claudiaSwipePreviewProgress) * 0.14;
    return isAgentExpanded ? 0.14 : 0;
  }, [agentSwipePreview.mode, claudiaSwipePreviewProgress, isAgentExpanded]);

  const openAutomationWindowFn = useCallback((opts?: OpenAutomationWindowOptions) => {
    import('./features/automation/openAutomationWindow').then(m => m.openAutomationWindow(opts ?? {}));
  }, []);

  const openProjectDashboardWindowFn = useCallback((projectId: string) => {
    const project = useProjectStore.getState().projects.find((item) => item.id === projectId);
    import('./features/dashboard/openProjectDashboardWindow').then(m => m.openProjectDashboardWindow({
      projectId,
      projectName: project?.name,
    }));
  }, []);

  // --- Extracted hooks ---
  useClaudiaDesktop({
    isMobile,
    controlPlaneState,
    claudiaContextProjectId: currentContextProjectId,
  });

  useDeepLinkNavigation(controlPlaneState);
  useMobileInit(isMobile);
  useTauriWindowEvents();
  useMainWindowGeometry();
  useNotchBridgeHost({ enabled: !isMobile });
  useActiveSessionStream();
  useAutoUpdate();
  useServerLatencyMonitor();
  useDataLoader();

  // Register builtin plugin panels once
  useEffect(() => { initBuiltinPanels(); }, []);

  // Initialize global shortcut config (desktop only)
  useEffect(() => {
    if (!isDesktopTauri()) return;
    const { loadConfig } = useShortcutStore.getState();
    void loadConfig();
  }, []);

  // When a session is selected, exit the dashboard view
  const prevSessionRef = useRef(selectedSessionId);
  useEffect(() => {
    if (selectedSessionId && selectedSessionId !== prevSessionRef.current) {
      setDashboardProjectId(null);
    }
    prevSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  // Reset swipe preview on expand/collapse
  useEffect(() => {
    if (isAgentExpanded) {
      setAgentSwipePreview((c) => c.mode === 'open' ? { mode: null, progress: 0 } : c);
      return;
    }
    setAgentSwipePreview((c) => c.mode === 'close' ? { mode: null, progress: 0 } : c);
  }, [isAgentExpanded]);

  // --- Android back gestures ---
  useAndroidBack(() => setFileViewerFullscreen(false), fileViewerFullscreen, 25);
  useAndroidBack(() => setAgentExpanded(false), isMobile && isAgentExpanded, 20);
  useAndroidBack(() => setSidebarOpen(false), isMobile && sidebarOpen, 10);
  useAndroidBack(() => setSidebarOpen(true), isMobile && !sidebarOpen && !isAgentExpanded && !fileViewerFullscreen, 5);

  // --- Mobile swipe gestures ---
  const swipeOpenClaudiaRef = useSwipeBack({
    onSwipe: () => setAgentExpanded(true),
    onProgress: (progress) => setAgentSwipePreview(progress > 0 ? { mode: 'open', progress } : { mode: null, progress: 0 }),
    enabled: isMobile && !isAgentExpanded && !sidebarOpen && !fileViewerFullscreen,
    direction: 'left',
    startZone: { startRatio: 0.25, endRatio: 0.75 },
    threshold: 60,
  });

  const swipeCloseClaudiaRef = useSwipeBack({
    onSwipe: () => setAgentExpanded(false),
    onProgress: (progress) => setAgentSwipePreview(progress > 0 ? { mode: 'close', progress } : { mode: null, progress: 0 }),
    enabled: isMobile && isAgentExpanded,
    direction: 'right',
    fullWidth: true,
    threshold: 60,
    velocityThreshold: 0.18,
  });

  // --- Conditional early returns (setup / loading screens) ---
  const requiresDirectGatewaySetup = shouldShowDirectGatewaySetup({
    directGatewayUrl,
    activeServerId,
    availableBackendIds: facadeBackends.map((b) => b.backendId),
  });

  if (isMobile && requiresDirectGatewaySetup) {
    return <MobileSetup />;
  }

  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
  const hasConnectedServer = controlPlaneState === 'ready' || hasConnected.current;
  const shouldRenderWindowsSetup = isWindows
    && embeddedServerStatus === 'wsl-mode'
    && (!hasConnectedServer || (directGatewayUrl ? requiresDirectGatewaySetup : false));

  if (shouldRenderWindowsSetup) {
    return <WindowsSetup />;
  }

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

  // --- Main render ---
  return (
    <div className="flex flex-col h-dvh bg-background text-foreground">
      <div
        className={`safe-top-spacer bg-card flex-shrink-0 ${isMobile && selectedSessionId && !isAgentExpanded ? 'hidden' : ''}`}
        data-tauri-drag-region
      />

      {/* Inline the hidden-on-mobile check the same way the original did */}
      {!(isMobile && selectedSessionId && !isAgentExpanded) && (
        <AppHeader
          isMobile={isMobile}
          isAgentExpanded={isAgentExpanded}
          sidebarCollapsed={sidebarCollapsed}
          notificationUnreadCount={notificationUnreadCount}
          disableNotifications={disabledBuiltinPanels.includes('notifications')}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenSidebar={() => setSidebarOpen(true)}
          onCloseAgent={() => setAgentExpanded(false)}
        />
      )}

      {!isMobile && <UpdateBanner />}

      <div className="flex flex-1 overflow-hidden">
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

        <main ref={swipeOpenClaudiaRef} className="flex-1 flex flex-col overflow-hidden relative">
          <div className="flex-1 overflow-hidden relative">
            {isMobile && (
              <MobileOverlays
                isAgentExpanded={isAgentExpanded}
                isFeedOpen={isFeedOpen}
                swipeCloseRef={swipeCloseClaudiaRef}
                agentSwipePreview={agentSwipePreview}
                claudiaSwipePreviewProgress={claudiaSwipePreviewProgress}
                claudiaOverlayOpacity={claudiaOverlayOpacity}
                onCloseAgent={() => setAgentExpanded(false)}
                onCloseFeed={() => setFeedOpen(false)}
              />
            )}

            {dashboardProject ? (
              <Suspense fallback={<LazyFallback />}>
                <ProjectDashboard
                  projectId={dashboardProject.id}
                  projectRootPath={dashboardProject.rootPath}
                  onOpenAutomations={openAutomationWindowFn}
                  onOpenDashboardWindow={openProjectDashboardWindowFn}
                />
              </Suspense>
            ) : selectedSessionId ? (
              <SessionChatLayout
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
      </div>

      {isMobile && <ToastContainer className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2" />}

      {fileViewerFullscreen && fileViewerFilePath && fileViewerProjectRoot && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          <div className="safe-top-spacer bg-card flex-shrink-0" />
          <Suspense fallback={<LazyFallback />}>
            <FileViewerWindow
              filePath={fileViewerFilePath}
              projectRoot={fileViewerProjectRoot}
              onClose={() => setFileViewerFullscreen(false)}
            />
          </Suspense>
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
