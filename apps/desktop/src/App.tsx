import { useEffect, useState, useRef } from 'react';
import { Bot, ChevronsRight, ChevronsLeft } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ChatInterface } from './components/chat/ChatInterface';
import { ServerSelector } from './components/ServerSelector';
import { MobileSetup } from './components/MobileSetup';
import { AgentPanel } from './components/agent/AgentPanel';
import { AgentSidePanel } from './components/agent/AgentSidePanel';
import { FileViewerWindow } from './components/fileviewer/FileViewerWindow';
import { ThemeProvider } from './contexts/ThemeContext';
import { ConnectionProvider, useConnection } from './contexts/ConnectionContext';
import { useDataLoader } from './hooks/useDataLoader';
import { useServerManager } from './hooks/useServerManager';
import { useServerStore } from './stores/serverStore';
import { useGatewayStore, isGatewayTarget } from './stores/gatewayStore';
import { useProjectStore } from './stores/projectStore';
import { useAgentStore } from './stores/agentStore';
import { isClientAIConfigured } from './services/clientAI';
import { useIsMobile } from './hooks/useMediaQuery';
import { useAndroidBack } from './hooks/useAndroidBack';
import { migrateServersFromLocalStorage, needsMigration } from './utils/migrateServers';
import { eagerSyncAllBackends } from './services/sessionSync';
import { useFileViewerStore } from './stores/fileViewerStore';

function AppContent() {
  const { connectServer, embeddedServerStatus, embeddedServerError } = useConnection();
  const { addServer } = useServerManager();
  const { connectionStatus } = useServerStore();
  const { selectedSessionId } = useProjectStore();
  const { directGatewayUrl, lastActiveBackendId, isConnected: isGatewayConnected, discoveredBackends } = useGatewayStore();
  const { isExpanded: isAgentExpanded, hasUnread: hasAgentUnread, setExpanded: setAgentExpanded } = useAgentStore();
  const isAgentConfigured = isClientAIConfigured();
  const fileViewerFullscreen = useFileViewerStore((s) => s.fullscreen);
  const fileViewerFilePath = useFileViewerStore((s) => s.filePath);
  const fileViewerProjectRoot = useFileViewerStore((s) => s.projectRoot);
  const setFileViewerFullscreen = useFileViewerStore((s) => s.setFullscreen);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const migrationDone = useRef(false);
  const mobileInitDone = useRef(false);
  const hasConnected = useRef(false);

  // Track if we've ever connected (to avoid showing loading on reconnect)
  if (connectionStatus === 'connected') {
    hasConnected.current = true;
  }

  // Load data from server
  useDataLoader();

  // Android back gesture: close fullscreen file viewer (pri 25)
  useAndroidBack(() => setFileViewerFullscreen(false), fileViewerFullscreen, 25);

  // Android back gesture: close agent panel (pri 20)
  useAndroidBack(() => setAgentExpanded(false), isMobile && isAgentExpanded, 20);

  // Android back gesture: close sidebar (pri 10)
  useAndroidBack(() => setSidebarOpen(false), isMobile && sidebarOpen, 10);

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

  // One-time migration from localStorage to database
  useEffect(() => {
    if (connectionStatus === 'connected' && !migrationDone.current && needsMigration()) {
      migrationDone.current = true;
      migrateServersFromLocalStorage(addServer).then(count => {
        if (count > 0) {
          console.log(`[App] Successfully migrated ${count} servers from localStorage to database`);
        }
      });
    }
  }, [connectionStatus, addServer]);

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

  // Mobile: show setup screen when gateway is not configured
  if (isMobile && !directGatewayUrl) {
    return <MobileSetup />;
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
      <div className="flex flex-col h-screen bg-background text-foreground">
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
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Top safe area spacer: notch/status bar on mobile, traffic lights on desktop */}
      <div
        className="safe-top-spacer bg-card flex-shrink-0"
        data-tauri-drag-region
      />

      {/* Unified Header - spans full width */}
      <header
        className="h-12 md:h-14 border-b border-border flex items-center px-2 md:px-4 bg-card flex-shrink-0"
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
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Bot size={16} strokeWidth={1.75} className="text-primary" />
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

        {/* Center section: Server selector or Agent title */}
        <div className="flex-1 flex items-center justify-start ml-2 md:ml-4 min-w-0">
          {isMobile && isAgentExpanded ? (
            <div className="flex items-center gap-2">
              <Bot size={16} strokeWidth={1.75} className="text-primary" />
              <span className="font-semibold text-sm text-foreground">Agent</span>
            </div>
          ) : (
            <ServerSelector />
          )}
        </div>

        {/* Agent toggle button */}
        {isAgentConfigured && (
          <button
            onClick={() => setAgentExpanded(!isAgentExpanded)}
            className={`relative p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors mr-2 ${
              isAgentExpanded ? 'bg-secondary text-foreground' : ''
            }`}
            title={isAgentExpanded ? 'Close Agent' : 'Open Agent'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {hasAgentUnread && !isAgentExpanded && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full animate-pulse" />
            )}
          </button>
        )}
      </header>

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
        />

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {/* Chat Area */}
          <div className="flex-1 overflow-hidden relative">
            {/* Mobile agent panel (full-screen overlay, always mounted to preserve state) */}
            {isMobile && isAgentConfigured && (
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
                  title="Close Agent"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <AgentPanel isMobile={true} showHeader={false} />
              </div>
            )}

            {/* Chat / Welcome (always mounted to preserve terminal state) */}
            {selectedSessionId ? (
              <ChatInterface sessionId={selectedSessionId} />
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

        {/* Desktop: Agent Side Panel (always mounted to preserve conversation state) */}
        {!isMobile && isAgentConfigured && (
          <div className={isAgentExpanded ? 'contents' : 'hidden'}>
            <AgentSidePanel />
          </div>
        )}
      </div>

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
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <FileViewerWindow
          filePath={fileViewerPath}
          projectRoot={fileViewerRoot}
          serverUrl={serverUrl}
          authToken={authToken}
        />
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
