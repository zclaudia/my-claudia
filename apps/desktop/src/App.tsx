import { useEffect, useState, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatInterface } from './components/chat/ChatInterface';
import { ServerSelector } from './components/ServerSelector';
import { PermissionModal } from './components/permission/PermissionModal';
import { ThemeProvider } from './contexts/ThemeContext';
import { ConnectionProvider, useConnection } from './contexts/ConnectionContext';
import { useDataLoader } from './hooks/useDataLoader';
import { useServerManager } from './hooks/useServerManager';
import { useServerStore } from './stores/serverStore';
import { useProjectStore } from './stores/projectStore';
import { usePermissionStore } from './stores/permissionStore';
import { useIsMobile } from './hooks/useMediaQuery';
import { migrateServersFromLocalStorage, needsMigration } from './utils/migrateServers';

function AppContent() {
  const { sendMessage } = useConnection();
  const { addServer } = useServerManager();
  const { connectionStatus } = useServerStore();
  const { selectedSessionId } = useProjectStore();
  const { pendingRequest, clearRequest } = usePermissionStore();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const migrationDone = useRef(false);

  // Load data from server
  useDataLoader();

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

  const handlePermissionDecision = useCallback(
    (requestId: string, allow: boolean, remember?: boolean) => {
      sendMessage({
        type: 'permission_decision',
        requestId,
        allow,
        remember
      });
      clearRequest();
    },
    [sendMessage, clearRequest]
  );

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* macOS Traffic Lights Space - draggable area */}
      <div
        className="hidden md:block h-[28px] bg-card flex-shrink-0"
        data-tauri-drag-region
      />

      {/* Unified Header - spans full width */}
      <header
        className="h-14 border-b border-border flex items-center px-2 md:px-4 bg-card flex-shrink-0"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        data-tauri-drag-region
      >
        {/* Left section: Logo and app name */}
        <div className="flex items-center gap-2 md:gap-3 md:min-w-[200px]" data-tauri-drag-region>
          {/* Mobile hamburger menu */}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
              aria-label="Open menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}

          {/* Logo - with left padding for macOS traffic lights (desktop only) */}
          <div className="flex items-center gap-2 md:pl-16" data-tauri-drag-region>
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <span className="text-base">🤖</span>
            </div>
            <div className="flex flex-col" data-tauri-drag-region>
              <span className="font-semibold text-sm text-foreground leading-tight" data-tauri-drag-region>My Claudia</span>
              <span className="text-[10px] text-muted-foreground leading-tight">AI Assistant</span>
            </div>
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

        {/* Center/Right section: Server selector */}
        <div className="flex-1 flex items-center justify-start ml-2 md:ml-4">
          <ServerSelector />
        </div>

        {/* Right section: placeholder for future items */}
        <div className="flex items-center gap-2">
          {/* Future items like settings, user info */}
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
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Chat Area */}
          <div className="flex-1 overflow-hidden">
            {selectedSessionId ? (
              <ChatInterface sessionId={selectedSessionId} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <h2 className="text-xl font-semibold mb-2">Welcome to My Claudia</h2>
                  <p>Select a project and session to start chatting</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Permission Modal */}
      <PermissionModal
        request={pendingRequest}
        onDecision={handlePermissionDecision}
      />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <ConnectionProvider>
        <AppContent />
      </ConnectionProvider>
    </ThemeProvider>
  );
}

export default App;
