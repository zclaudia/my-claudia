/**
 * Window Router — detects URL params to render standalone windows
 * (file viewer, automation, workflow editor, session chat, terminal,
 * draft editor, claudia ball/chat, notch, plugin).
 * Falls through to the main AppContent if no standalone param is found.
 */
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ThemeProvider } from '../contexts/ThemeContext';
import { ConnectionProvider } from '../contexts/ConnectionContext';

// Lazy-loaded popout windows
const FileViewerWindow = lazy(() => import('../components/fileviewer/FileViewerWindow').then(m => ({ default: m.FileViewerWindow })));
const WorkflowEditorWindow = lazy(() => import('../features/workflows/components/WorkflowEditorWindow').then(m => ({ default: m.WorkflowEditorWindow })));
const AutomationWindow = lazy(() => import('../features/automation/AutomationWindow').then(m => ({ default: m.AutomationWindow })));
const SessionChatWindow = lazy(() => import('../components/chat/SessionChatWindow').then(m => ({ default: m.SessionChatWindow })));
const TerminalWindow = lazy(() => import('../components/terminal/TerminalWindow').then(m => ({ default: m.TerminalWindow })));
const DraftWindow = lazy(() => import('../components/draft/DraftWindow').then(m => ({ default: m.DraftWindow })));
const PluginWindow = lazy(() => import('../components/PluginWindow').then(m => ({ default: m.PluginWindow })));
const ClaudiaBallWindow = lazy(() => import('../components/claudia/ClaudiaBallWindow').then(m => ({ default: m.ClaudiaBallWindow })));
const NotchWindowLazy = lazy(() => import('../components/NotchWindow').then(m => ({ default: m.NotchWindow })));
const ClaudiaChatWindow = lazy(() => import('../components/claudia/ClaudiaChatWindow').then(m => ({ default: m.ClaudiaChatWindow })));
const WindowManagerWindow = lazy(() => import('../components/windowmanager/WindowManagerWindow').then(m => ({ default: m.WindowManagerWindow })));

const LazyFallback = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>
  </div>
);

/** Main entry component — passed as children when no standalone window is detected. */
export function WindowRouter({ children }: { children: React.ReactNode }) {
  const params = new URLSearchParams(window.location.search);

  // File viewer
  const fileViewerPath = params.get('fileViewer');
  const fileViewerRoot = params.get('projectRoot');
  if (fileViewerPath && fileViewerRoot) {
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <ErrorBoundary label="FileViewer">
          <Suspense fallback={<LazyFallback />}>
            <FileViewerWindow
              filePath={fileViewerPath}
              projectRoot={fileViewerRoot}
              serverUrl={params.get('serverUrl') || ''}
              authToken={params.get('authToken') || ''}
              serverName={params.get('serverName') || undefined}
            />
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Automation window
  if (params.get('automationWindow')) {
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <ErrorBoundary label="Automation">
          <ConnectionProvider
            standaloneServerUrl={params.get('serverUrl') || ''}
            standaloneServerId={params.get('serverId') || undefined}
            standaloneGatewayUrl={params.get('gatewayUrl') || undefined}
            standaloneGatewaySecret={params.get('gatewaySecret') || undefined}
          >
            <Suspense fallback={<LazyFallback />}>
              <AutomationWindow
                serverUrl={params.get('serverUrl') || ''}
                authToken={params.get('authToken') || ''}
                serverId={params.get('serverId') || undefined}
              />
            </Suspense>
          </ConnectionProvider>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Workflow editor
  const workflowEditorProjectId = params.get('workflowEditor');
  if (workflowEditorProjectId) {
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <ErrorBoundary label="WorkflowEditor">
          <Suspense fallback={<LazyFallback />}>
            <WorkflowEditorWindow
              projectId={workflowEditorProjectId}
              workflowId={params.get('workflowId') || undefined}
              serverUrl={params.get('serverUrl') || ''}
              authToken={params.get('authToken') || ''}
              serverId={params.get('serverId') || undefined}
              serverName={params.get('serverName') || undefined}
              gatewayUrl={params.get('gatewayUrl') || undefined}
              gatewaySecret={params.get('gatewaySecret') || undefined}
              initialMode={(params.get('initialMode') as 'toolbox' | 'ai') || undefined}
              readOnly={params.get('readOnly') === '1'}
            />
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Session chat window
  const sessionWindowId = params.get('sessionWindow');
  if (sessionWindowId) {
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <ErrorBoundary label="SessionChat">
          <Suspense fallback={<LazyFallback />}>
            <SessionChatWindow
              sessionId={sessionWindowId}
              projectId={params.get('projectId') || ''}
              serverUrl={params.get('serverUrl') || ''}
              authToken={params.get('authToken') || ''}
              serverId={params.get('serverId') || undefined}
              serverName={params.get('serverName') || undefined}
              gatewayUrl={params.get('gatewayUrl') || undefined}
              gatewaySecret={params.get('gatewaySecret') || undefined}
            />
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Draft editor window
  const draftSessionId = params.get('draftWindow');
  if (draftSessionId) {
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <ErrorBoundary label="DraftEditor">
          <Suspense fallback={<LazyFallback />}>
            <DraftWindow
              sessionId={draftSessionId}
              serverUrl={params.get('serverUrl') || ''}
              authToken={params.get('authToken') || ''}
              serverId={params.get('serverId') || undefined}
              serverName={params.get('serverName') || undefined}
              gatewayUrl={params.get('gatewayUrl') || undefined}
              gatewaySecret={params.get('gatewaySecret') || undefined}
            />
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Terminal window
  const terminalWindowId = params.get('terminalWindow');
  if (terminalWindowId) {
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <ErrorBoundary label="Terminal">
          <Suspense fallback={<LazyFallback />}>
            <TerminalWindow
              terminalId={terminalWindowId}
              projectId={params.get('projectId') || ''}
              serverUrl={params.get('serverUrl') || ''}
              authToken={params.get('authToken') || ''}
              serverId={params.get('serverId') || undefined}
              serverName={params.get('serverName') || undefined}
              gatewayUrl={params.get('gatewayUrl') || undefined}
              gatewaySecret={params.get('gatewaySecret') || undefined}
            />
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Claudia floating ball
  if (params.get('claudiaBall')) {
    return <Suspense fallback={<LazyFallback />}><ClaudiaBallWindow /></Suspense>;
  }

  // Notch window (Dynamic Island)
  if (params.get('notchWindow')) {
    return <Suspense fallback={<LazyFallback />}><NotchWindowLazy /></Suspense>;
  }

  // Claudia chat window
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

  // Window manager
  if (params.get('windowManager')) {
    return (
      <ThemeProvider defaultTheme="dark-neutral">
        <ErrorBoundary label="WindowManager">
          <Suspense fallback={<LazyFallback />}>
            <WindowManagerWindow />
          </Suspense>
        </ErrorBoundary>
      </ThemeProvider>
    );
  }

  // Plugin window
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

  // Default: main app
  return (
    <ThemeProvider defaultTheme="dark-neutral">
      <ErrorBoundary label="App">
        <ConnectionProvider>
          {children}
        </ConnectionProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
