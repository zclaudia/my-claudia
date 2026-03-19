import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { Workflow } from '@my-claudia/shared';
import { WorkflowEditor } from './WorkflowEditor';

interface WorkflowEditorWindowProps {
  projectId: string;
  workflowId?: string;
  serverUrl: string;
  authToken: string;
}

/** Standalone workflow editor rendered in a separate Tauri window */
export function WorkflowEditorWindow({ projectId, workflowId, serverUrl, authToken }: WorkflowEditorWindowProps) {
  const [workflow, setWorkflow] = useState<Workflow | undefined>(undefined);
  const [loading, setLoading] = useState(!!workflowId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workflowId || !serverUrl) {
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
      />
    </div>
  );
}
