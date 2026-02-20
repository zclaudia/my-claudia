import { useEffect, useState, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatInterface } from './components/chat/ChatInterface';
import { ServerSelector } from './components/ServerSelector';
import { MobileSetup } from './components/MobileSetup';
import { AgentWidget } from './components/agent/AgentWidget';
import { AgentPanel } from './components/agent/AgentPanel';
import { ThemeProvider } from './contexts/ThemeContext';
import { ConnectionProvider, useConnection } from './contexts/ConnectionContext';
import { useDataLoader } from './hooks/useDataLoader';
import { useServerManager } from './hooks/useServerManager';
import { useServerStore } from './stores/serverStore';
import { useGatewayStore, isGatewayTarget } from './stores/gatewayStore';
import { useProjectStore } from './stores/projectStore';
import { useAgentStore } from './stores/agentStore';
import { useIsMobile } from './hooks/useMediaQuery';
import { useAndroidBack } from './hooks/useAndroidBack';
import { migrateServersFromLocalStorage, needsMigration } from './utils/migrateServers';

function AppContent() {
  const { connectServer } = useConnection();
  const { addServer } = useServerManager();
  const { connectionStatus } = useServerStore();
  const { selectedSessionId } = useProjectStore();
  const { directGatewayUrl, lastActiveBackendId, isConnected: isGatewayConnected, discoveredBackends } = useGatewayStore();
  const { isExpanded: isAgentExpanded, isConfigured: isAgentConfigured, setExpanded: setAgentExpanded } = useAgentStore();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const migrationDone = useRef(false);
  const mobileInitDone = useRef(false);

  // Load data from server
  useDataLoader();

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

  // Mobile: show setup screen when gateway is not configured
  if (isMobile && !directGatewayUrl) {
    return <MobileSetup />;
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
        <div className="flex items-center gap-2 md:gap-3 md:min-w-[200px] flex-shrink-0" data-tauri-drag-region>
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
          <div className="hidden md:flex items-center gap-2 md:pl-16" data-tauri-drag-region>
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="text-base">🤖</span>
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
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {sidebarCollapsed ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                )}
              </svg>
            </button>
          )}
        </div>

        {/* Center/Right section: Server selector or Agent title */}
        <div className="flex-1 flex items-center justify-start ml-2 md:ml-4 min-w-0">
          {isMobile && isAgentExpanded ? (
            <div className="flex items-center gap-2">
              <span className="text-base">🤖</span>
              <span className="font-semibold text-sm text-foreground">Agent Assistant</span>
            </div>
          ) : (
            <ServerSelector />
          )}
        </div>
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
          <div className="flex-1 overflow-hidden">
            {isMobile && isAgentExpanded ? (
              isAgentConfigured ? (
                <div className="relative h-full">
                  {/* Left-side collapse arrow (absolute so it doesn't shift content) */}
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
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                    <p className="text-sm">Setting up Agent...</p>
                  </div>
                </div>
              )
            ) : selectedSessionId ? (
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
      </div>

      {/* Agent Widget */}
      <AgentWidget />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark-neutral">
      <ConnectionProvider>
        <AppContent />
      </ConnectionProvider>
    </ThemeProvider>
  );
}

export default App;
