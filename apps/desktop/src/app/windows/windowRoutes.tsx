import { lazy, type ReactNode } from 'react';
import { WindowShell } from './WindowShell';

const FileViewerWindow = lazy(() => import('../../components/fileviewer/FileViewerWindow').then(m => ({ default: m.FileViewerWindow })));
const WorkflowEditorWindow = lazy(() => import('../../features/workflows/components/WorkflowEditorWindow').then(m => ({ default: m.WorkflowEditorWindow })));
const AIReviewLogsWindow = lazy(() => import('../../features/permissions/AIReviewLogsWindow').then(m => ({ default: m.AIReviewLogsWindow })));
const AutomationWindow = lazy(() => import('../../features/automation/AutomationWindow').then(m => ({ default: m.AutomationWindow })));
const SessionChatWindow = lazy(() => import('../../features/chat/SessionChatWindow').then(m => ({ default: m.SessionChatWindow })));
const TerminalWindow = lazy(() => import('../../components/terminal/TerminalWindow').then(m => ({ default: m.TerminalWindow })));
const DraftWindow = lazy(() => import('../../components/draft/DraftWindow').then(m => ({ default: m.DraftWindow })));
const PluginWindow = lazy(() => import('../../components/notch/PluginWindow').then(m => ({ default: m.PluginWindow })));
const ClaudiaBallWindow = lazy(() => import('../../features/claudia/ClaudiaBallWindow').then(m => ({ default: m.ClaudiaBallWindow })));
const NotchWindowLazy = lazy(() => import('../../components/notch/NotchWindow').then(m => ({ default: m.NotchWindow })));
const ClaudiaChatWindow = lazy(() => import('../../features/claudia/ClaudiaChatWindow').then(m => ({ default: m.ClaudiaChatWindow })));
const WindowManagerWindow = lazy(() => import('../../components/windowmanager/WindowManagerWindow').then(m => ({ default: m.WindowManagerWindow })));

interface StandaloneWindowRoute {
  id: string;
  render: (params: URLSearchParams) => ReactNode | null;
}

function optionalParam(params: URLSearchParams, key: string): string | undefined {
  return params.get(key) || undefined;
}

export const standaloneWindowRoutes: StandaloneWindowRoute[] = [
  {
    id: 'file-viewer',
    render: (params) => {
      const fileViewerPath = params.get('fileViewer');
      const projectRoot = params.get('projectRoot');
      if (!fileViewerPath || !projectRoot) return null;
      return (
        <WindowShell label="FileViewer">
          <FileViewerWindow
            filePath={fileViewerPath}
            projectRoot={projectRoot}
            serverUrl={params.get('serverUrl') || ''}
            authToken={params.get('authToken') || ''}
            serverName={optionalParam(params, 'serverName')}
          />
        </WindowShell>
      );
    },
  },
  {
    id: 'automation',
    render: (params) => {
      if (!params.get('automationWindow')) return null;
      return (
        <WindowShell
          label="Automation"
          connection={{
            standaloneServerUrl: params.get('serverUrl') || '',
            standaloneServerId: optionalParam(params, 'serverId'),
            standaloneGatewayUrl: optionalParam(params, 'gatewayUrl'),
            standaloneGatewaySecret: optionalParam(params, 'gatewaySecret'),
          }}
        >
          <AutomationWindow
            serverUrl={params.get('serverUrl') || ''}
            authToken={params.get('authToken') || ''}
            serverId={optionalParam(params, 'serverId')}
            initialTab={(params.get('initialTab') as 'automations' | 'workflows') || undefined}
            initialProjectId={optionalParam(params, 'initialProjectId')}
          />
        </WindowShell>
      );
    },
  },
  {
    id: 'workflow-editor',
    render: (params) => {
      const projectId = params.get('workflowEditor');
      if (!projectId) return null;
      return (
        <WindowShell label="WorkflowEditor">
          <WorkflowEditorWindow
            projectId={projectId}
            workflowId={optionalParam(params, 'workflowId')}
            serverUrl={params.get('serverUrl') || ''}
            authToken={params.get('authToken') || ''}
            serverId={optionalParam(params, 'serverId')}
            serverName={optionalParam(params, 'serverName')}
            gatewayUrl={optionalParam(params, 'gatewayUrl')}
            gatewaySecret={optionalParam(params, 'gatewaySecret')}
            initialMode={(params.get('initialMode') as 'toolbox' | 'ai') || undefined}
            readOnly={params.get('readOnly') === '1'}
          />
        </WindowShell>
      );
    },
  },
  {
    id: 'ai-review-logs',
    render: (params) => {
      const runId = params.get('aiReviewLogs');
      if (!runId) return null;
      return (
        <WindowShell label="AIReviewLogs">
          <AIReviewLogsWindow
            runId={runId}
            serverUrl={params.get('serverUrl') || ''}
            authToken={params.get('authToken') || ''}
            serverName={optionalParam(params, 'serverName')}
          />
        </WindowShell>
      );
    },
  },
  {
    id: 'session-chat',
    render: (params) => {
      const sessionId = params.get('sessionWindow');
      if (!sessionId) return null;
      return (
        <WindowShell label="SessionChat">
          <SessionChatWindow
            sessionId={sessionId}
            projectId={params.get('projectId') || ''}
            serverUrl={params.get('serverUrl') || ''}
            authToken={params.get('authToken') || ''}
            serverId={optionalParam(params, 'serverId')}
            serverName={optionalParam(params, 'serverName')}
            gatewayUrl={optionalParam(params, 'gatewayUrl')}
            gatewaySecret={optionalParam(params, 'gatewaySecret')}
          />
        </WindowShell>
      );
    },
  },
  {
    id: 'draft',
    render: (params) => {
      const sessionId = params.get('draftWindow');
      if (!sessionId) return null;
      return (
        <WindowShell label="DraftEditor">
          <DraftWindow
            sessionId={sessionId}
            serverUrl={params.get('serverUrl') || ''}
            authToken={params.get('authToken') || ''}
            serverId={optionalParam(params, 'serverId')}
            serverName={optionalParam(params, 'serverName')}
            gatewayUrl={optionalParam(params, 'gatewayUrl')}
            gatewaySecret={optionalParam(params, 'gatewaySecret')}
          />
        </WindowShell>
      );
    },
  },
  {
    id: 'terminal',
    render: (params) => {
      const terminalId = params.get('terminalWindow');
      if (!terminalId) return null;
      return (
        <WindowShell label="Terminal">
          <TerminalWindow
            terminalId={terminalId}
            projectId={params.get('projectId') || ''}
            serverUrl={params.get('serverUrl') || ''}
            authToken={params.get('authToken') || ''}
            serverId={optionalParam(params, 'serverId')}
            serverName={optionalParam(params, 'serverName')}
            gatewayUrl={optionalParam(params, 'gatewayUrl')}
            gatewaySecret={optionalParam(params, 'gatewaySecret')}
          />
        </WindowShell>
      );
    },
  },
  {
    id: 'claudia-ball',
    render: (params) => params.get('claudiaBall')
      ? <WindowShell withTheme={false}><ClaudiaBallWindow /></WindowShell>
      : null,
  },
  {
    id: 'notch',
    render: (params) => params.get('notchWindow')
      ? <WindowShell withTheme={false}><NotchWindowLazy /></WindowShell>
      : null,
  },
  {
    id: 'claudia-chat',
    render: (params) => {
      if (!params.get('claudiaChat')) return null;
      return (
        <WindowShell withTheme={false}>
          <ClaudiaChatWindow
            serverUrl={params.get('serverUrl') || ''}
            authToken={params.get('authToken') || ''}
            serverId={optionalParam(params, 'serverId')}
            serverName={optionalParam(params, 'serverName')}
            gatewayUrl={optionalParam(params, 'gatewayUrl')}
            gatewaySecret={optionalParam(params, 'gatewaySecret')}
            projectId={optionalParam(params, 'projectId')}
            contextProjectId={optionalParam(params, 'contextProjectId')}
          />
        </WindowShell>
      );
    },
  },
  {
    id: 'window-manager',
    render: (params) => params.get('windowManager')
      ? <WindowShell label="WindowManager"><WindowManagerWindow /></WindowShell>
      : null,
  },
  {
    id: 'plugin',
    render: (params) => {
      const pluginId = params.get('pluginWindow');
      if (!pluginId) return null;
      return (
        <WindowShell label="Plugin">
          <PluginWindow pluginId={pluginId} params={params} />
        </WindowShell>
      );
    },
  },
];

export function resolveStandaloneWindowRoute(
  params: URLSearchParams,
): { id: string; element: ReactNode } | null {
  for (const route of standaloneWindowRoutes) {
    const element = route.render(params);
    if (element) return { id: route.id, element };
  }
  return null;
}
