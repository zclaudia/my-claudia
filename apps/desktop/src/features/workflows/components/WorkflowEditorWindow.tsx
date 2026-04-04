import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { Workflow } from '@my-claudia/shared';
import { ConnectionProvider } from '../../../contexts/ConnectionContext';
import { useServerStore } from '../../../stores/serverStore';
import { useRecoveryStore } from '../../../stores/recoveryStore';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useMobileRecoveryStore } from '../../../stores/mobileRecoveryStore';
import { useProjectStore } from '../../../stores/projectStore';
import * as api from '../../../services/api';
import { WorkflowEditor } from './WorkflowEditor';
import { isMobileBackendUsable } from '../../../services/mobileConnectionState';
import { isAndroid } from '../../../utils/platform';

interface WorkflowEditorWindowProps {
  projectId: string;
  workflowId?: string;
  serverUrl: string;
  authToken: string;
  serverId?: string;
  serverName?: string;
  gatewayUrl?: string;
  gatewaySecret?: string;
  initialMode?: 'toolbox' | 'ai';
}

/** Standalone workflow editor rendered in a separate Tauri window */
export function WorkflowEditorWindow({
  projectId,
  workflowId,
  serverUrl,
  authToken,
  serverId,
  serverName,
  gatewayUrl,
  gatewaySecret,
  initialMode,
}: WorkflowEditorWindowProps) {
  return (
    <ConnectionProvider
      standaloneServerUrl={serverUrl}
      standaloneServerId={serverId}
      standaloneServerName={serverName}
      standaloneGatewayUrl={gatewayUrl}
      standaloneGatewaySecret={gatewaySecret}
    >
      <WorkflowEditorWindowContent
        projectId={projectId}
        workflowId={workflowId}
        serverUrl={serverUrl}
        authToken={authToken}
        initialMode={initialMode}
      />
    </ConnectionProvider>
  );
}

function WorkflowEditorWindowContent({ projectId, workflowId, serverUrl, authToken, initialMode }: Omit<WorkflowEditorWindowProps, 'serverId' | 'serverName' | 'gatewayUrl' | 'gatewaySecret'>) {
  const mobileRecoveryEnabled = isAndroid();
  const [workflow, setWorkflow] = useState<Workflow | undefined>(undefined);
  const [loading, setLoading] = useState(!!workflowId);
  const [error, setError] = useState<string | null>(null);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const recoveryIsConnected = useRecoveryStore((s) => {
    if (mobileRecoveryEnabled || !activeServerId) return false;
    return s.backends[activeServerId]?.status === 'ready';
  });
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const mobileRecoveryPhase = useMobileRecoveryStore((s) => s.phase);
  const isConnected = mobileRecoveryEnabled
    ? isMobileBackendUsable({
      backendId: activeServerId,
      connectionState: facadeConnectionState,
      backends: facadeBackends,
      recoveryPhase: mobileRecoveryPhase,
    })
    : recoveryIsConnected;

  useEffect(() => {
    if (!isConnected) return;

    let cancelled = false;
    (async () => {
      try {
        const [projects, providers] = await Promise.all([
          api.getProjects(),
          api.getProviders(),
        ]);
        if (cancelled) return;
        const store = useProjectStore.getState();
        store.setProjects(projects);
        store.setProviders(providers);
        store.selectProject(projectId);
      } catch (err) {
        if (!cancelled) console.warn('[WorkflowEditorWindow] Failed to load workflow editor context:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [isConnected, projectId]);

  useEffect(() => {
    if (!serverUrl) {
      setError('Missing server URL');
      setLoading(false);
      return;
    }

    if (!workflowId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = authToken;
        const resp = await fetch(`${serverUrl}/api/workflows/${workflowId}`, { headers });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        if (!json.success || !json.data) throw new Error(json.error?.message || 'Failed to load workflow');
        if (!cancelled) {
          setWorkflow(json.data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load workflow');
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [workflowId, serverUrl, authToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <div className="text-center">
          <div className="text-sm text-destructive mb-2">{error}</div>
          <button
            onClick={() => window.close()}
            className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-secondary"
          >
            Close Window
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background text-foreground">
      <WorkflowEditor
        workflow={workflow}
        projectId={projectId}
        onBack={() => window.close()}
        onSaved={() => {}}
        standalone
        serverUrl={serverUrl}
        authToken={authToken}
        initialMode={initialMode}
      />
    </div>
  );
}
